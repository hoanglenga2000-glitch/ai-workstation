'use strict';
const config = require('../config/index');
const { log } = require('../utils/log');

/**
 * Lightweight token counter: ~3.5 chars per token for CJK-mixed content.
 * Avoids heavy tiktoken dependency; accuracy within +/-15% is acceptable
 * for billing estimation when upstream doesn't return usage in stream.
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * SSE stream: Anthropic-format proxy (converts OpenAI SSE to Anthropic events).
 *
 * Key billing fix: accumulates outputText during streaming and captures the
 * upstream usage field (some providers send it in the final chunk).
 * Returns { inputTokens, outputTokens, outputText } so callers can charge.
 *
 * Handles client disconnect gracefully — aborts upstream reader and still
 * returns accumulated usage for billing.
 */
async function callAiStream(res, openaiBody) {
  const upstream = await fetch(config.AI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + config.AI_KEY,
    },
    body: JSON.stringify(openaiBody),
    signal: AbortSignal.timeout(config.AI_TIMEOUT),
  });

  res.writeHead(upstream.status, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const msgId = 'msg_' + Date.now();
  const model = openaiBody.model;

  // Track whether client is still connected
  let clientDisconnected = false;
  res.on('close', () => { clientDisconnected = true; });

  // Safe write helper — silently skips if client disconnected
  function safeWrite(data) {
    if (clientDisconnected || res.writableEnded) return;
    try { res.write(data); } catch (_) { clientDisconnected = true; }
  }

  safeWrite('event: message_start\ndata: ' + JSON.stringify({
    type: 'message_start',
    message: { id: msgId, type: 'message', role: 'assistant', content: [], model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } },
  }) + '\n\n');
  safeWrite('event: content_block_start\ndata: ' + JSON.stringify({
    type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' },
  }) + '\n\n');

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outputText = '';
  let upstreamUsage = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();

        if (data === '[DONE]') {
          safeWrite('event: content_block_stop\ndata: ' + JSON.stringify({ type: 'content_block_stop', index: 0 }) + '\n\n');
          safeWrite('event: message_delta\ndata: ' + JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: upstreamUsage?.completion_tokens || estimateTokens(outputText) },
          }) + '\n\n');
          safeWrite('event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n');
          break;
        }

        try {
          const chunk = JSON.parse(data);

          // Capture usage from any chunk (some providers send it on every chunk,
          // others only on the final one)
          if (chunk.usage) upstreamUsage = chunk.usage;

          const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
          if (delta && delta.content) {
            outputText += delta.content;
            safeWrite('event: content_block_delta\ndata: ' + JSON.stringify({
              type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta.content },
            }) + '\n\n');
          }

          if (chunk.choices && chunk.choices[0] && chunk.choices[0].finish_reason) {
            // Final chunk — capture usage if present
            if (chunk.usage) upstreamUsage = chunk.usage;
            safeWrite('event: content_block_stop\ndata: ' + JSON.stringify({ type: 'content_block_stop', index: 0 }) + '\n\n');
            safeWrite('event: message_delta\ndata: ' + JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { output_tokens: upstreamUsage?.completion_tokens || estimateTokens(outputText) },
            }) + '\n\n');
            safeWrite('event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n');
          }
        } catch (_) { /* skip unparseable lines */ }
      }
    }
  } catch (e) {
    // If client disconnected, the reader may throw — that's expected
    if (!clientDisconnected) {
      log('error', 'stream_read_error', { error: e.message });
    }
  } finally {
    // Always close the response if not already ended
    if (!res.writableEnded) {
      try { res.end(); } catch (_) { /* ignore */ }
    }
    // Cancel upstream reader if still open (e.g. client disconnected early)
    try { reader.cancel(); } catch (_) { /* ignore */ }
  }

  const inputEstimate = estimateTokens(JSON.stringify(openaiBody.messages));
  const result = {
    inputTokens: upstreamUsage?.prompt_tokens || inputEstimate,
    outputTokens: upstreamUsage?.completion_tokens || estimateTokens(outputText),
    outputText,
  };

  log('info', 'stream_complete', {
    model,
    clientDisconnected,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    outputLen: outputText.length,
    usageSource: upstreamUsage ? 'upstream' : 'estimated',
  });

  return result;
}

// Non-streaming Anthropic-format response
async function callAiNonStream(openaiBody) {
  const resp = await fetch(config.AI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + config.AI_KEY,
    },
    body: JSON.stringify(openaiBody),
    signal: AbortSignal.timeout(config.AI_TIMEOUT),
  });
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message || 'AI API error');
  return {
    content: json.choices?.[0]?.message?.content || '',
    usage: json.usage,
  };
}

// Build OpenAI body from Anthropic-format request
function buildOpenAiBody(body, model) {
  const openaiMessages = [];
  if (body.system) {
    openaiMessages.push({ role: 'system', content: body.system });
  }
  if (body.messages) {
    for (const msg of body.messages) {
      openaiMessages.push({ role: msg.role, content: msg.content });
    }
  }
  const openaiBody = {
    model,
    messages: openaiMessages,
    max_tokens: body.max_tokens || 4096,
    stream: !!body.stream,
  };
  if (body.temperature !== undefined) openaiBody.temperature = body.temperature;
  return openaiBody;
}

// callAi: raw OpenAI-format call, accepts messages array + model, returns full response JSON
async function callAi(messages, model) {
  const payload = { model: model || config.DEFAULT_MODEL, messages };
  const resp = await fetch(config.AI_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.AI_KEY },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.AI_TIMEOUT),
  });
  const txt = await resp.text();
  if (resp.status >= 400) throw new Error('AI HTTP ' + resp.status + ': ' + txt.slice(0, 500));
  try { return JSON.parse(txt); } catch (e) { throw new Error('AI parse: ' + e.message); }
}

// callAiSafe: wraps callAi with null-content retry and fallback
async function callAiSafe(rawMessages, model) {
  const messages = (rawMessages || []).slice();
  if (!messages.some(m => m && m.role === 'system')) {
    messages.unshift({ role: 'system', content: '请直接以中文回答，给出具体、可操作的最终回复。不要返回空内容，不要只输出思考过程。' });
  }
  let data = await callAi(messages, model);
  let content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || null;
  if (!content) {
    log('warn', 'callai_null_retry', { usage: data && data.usage });
    const retry = messages.slice();
    retry.push({ role: 'user', content: '请直接给出最终回复（Markdown），不要返回空内容。' });
    data = await callAi(retry, model);
    content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || null;
    if (!content) {
      const rc = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.reasoning_content;
      content = rc || '当前上游模型本次未返回内容，请稍后重试。';
      data.choices[0].message.content = content;
    }
  }
  return data;
}

module.exports = { callAiStream, callAiNonStream, buildOpenAiBody, callAi, callAiSafe, estimateTokens };

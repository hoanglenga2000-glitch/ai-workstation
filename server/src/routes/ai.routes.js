'use strict';
const express = require('express');
const https = require('https');
const config = require('../config/index');
const { asyncRoute } = require('../middleware/errorHandler');
const { callAiStream, callAiNonStream, buildOpenAiBody } = require('../services/ai.service');
const { chargeUser, preAuthCheck } = require('../services/billing.service');
const { log } = require('../utils/log');

const router = express.Router();

// POST /v1/messages — Anthropic-format proxy (converts to OpenAI, handles SSE stream)
router.post('/v1/messages', asyncRoute(async (req, res) => {
  try {
    const body = req.body;
    const model = config.DEFAULT_MODEL;
    const isStream = !!body.stream;
    const openaiBody = buildOpenAiBody(body, model);
    const userId = req.user?.id;

    // Pre-auth balance check (estimate based on input)
    if (userId) {
      const inputEstimate = JSON.stringify(openaiBody.messages).length / 4;
      const canAfford = await preAuthCheck(userId, model, inputEstimate);
      if (!canAfford) {
        return res.status(402).json({ error: '余额不足，请充值后继续使用' });
      }
    }

    if (isStream) {
      await callAiStream(res, openaiBody);
      // Post-stream billing (best-effort, usage not always available in stream)
    } else {
      const result = await callAiNonStream(openaiBody);

      // Charge user based on actual usage
      if (userId && result.usage) {
        chargeUser(userId, model, result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0, { taskId: 'chat' })
          .catch(e => log('warn', 'billing_failed', { userId, error: e.message }));
      }

      res.json({
        id: 'msg_' + Date.now(),
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: result.content }],
        model,
        stop_reason: 'end_turn',
        usage: result.usage || { input_tokens: 0, output_tokens: 0 },
      });
    }
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'AI upstream error: ' + e.message });
    }
  }
}));

// POST /v1/chat/completions — OpenAI-compatible proxy with SSE passthrough and retry
router.post('/v1/chat/completions', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const model = body.model || config.DEFAULT_MODEL;
  const isStream = !!body.stream;
  const payload = {
    model,
    messages: body.messages || [],
    max_tokens: body.max_tokens || 4096,
    stream: isStream,
  };
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.top_p !== undefined) payload.top_p = body.top_p;

  const doRequest = () => new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const urlObj = new URL(config.AI_CHAT_URL);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + (urlObj.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.AI_KEY,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: config.AI_TIMEOUT,
    };
    const r = https.request(opts, resolve);
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(new Error('upstream timeout')); });
    r.write(postData);
    r.end();
  });

  let upstream;
  try {
    upstream = await doRequest();
  } catch (e1) {
    try { upstream = await doRequest(); } catch (e2) {
      return res.status(502).json({ error: 'AI upstream error: ' + e2.message });
    }
  }

  if (isStream) {
    res.writeHead(upstream.statusCode, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    upstream.on('data', (chunk) => res.write(chunk));
    upstream.on('end', () => res.end());
    upstream.on('error', () => { if (!res.writableEnded) res.end(); });
  } else {
    const chunks = [];
    upstream.on('data', (c) => chunks.push(c));
    upstream.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        const json = JSON.parse(raw);
        res.status(upstream.statusCode).json(json);
      } catch (_) {
        res.status(upstream.statusCode).send(raw);
      }
    });
    upstream.on('error', (e) => {
      if (!res.headersSent) res.status(502).json({ error: 'AI upstream error: ' + e.message });
    });
  }
}));

module.exports = router;

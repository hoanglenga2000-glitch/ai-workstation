// routes/anthropic-proxy.js - Anthropic API 代理
const express = require('express');
const router = express.Router();
const https = require('https');

// POST /v1/messages - 代理 Anthropic Messages API
router.post('/messages', async (req, res) => {
  try {
    const { model, messages, max_tokens, system, stream } = req.body;

    // 构建请求到阿里云百炼
    const AI_BASE = process.env.LTCRAFT_BASE_URL || 'https://cc-vibe.com/v1';
    const AI_KEY = process.env.LTCRAFT_API_KEY;
    const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'claude-haiku-4-5-20251001';

    const url = new URL(AI_BASE);
    const requestBody = JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: messages,
      max_tokens: max_tokens || 4096,
      stream: stream || false
    });

    const opts = {
      hostname: url.hostname,
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_KEY}`,
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 120000
    };

    if (stream) {
      // 流式响应
      const proxyReq = https.request(opts, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (error) => {
        console.error('代理请求错误:', error);
        res.status(500).json({ error: '代理请求失败' });
      });

      proxyReq.write(requestBody);
      proxyReq.end();
    } else {
      // 非流式响应
      const aiResponse = await new Promise((resolve, reject) => {
        const req = https.request(opts, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            if (response.statusCode >= 400) {
              return reject(new Error(`AI API 错误 ${response.statusCode}: ${text}`));
            }
            try {
              resolve(JSON.parse(text));
            } catch (e) {
              reject(new Error('AI 响应解析失败'));
            }
          });
        });
        req.on('error', reject);
        req.write(requestBody);
        req.end();
      });

      // 转换为 Anthropic 格式
      const anthropicResponse = {
        id: aiResponse.id || 'msg_' + Date.now(),
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'text',
          text: aiResponse.choices?.[0]?.message?.content || ''
        }],
        model: aiResponse.model,
        stop_reason: 'end_turn',
        usage: {
          input_tokens: aiResponse.usage?.prompt_tokens || 0,
          output_tokens: aiResponse.usage?.completion_tokens || 0
        }
      };

      res.json(anthropicResponse);
    }
  } catch (error) {
    console.error('Anthropic 代理错误:', error);
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: error.message
      }
    });
  }
});

module.exports = router;

// routes/agents.js - Agent相关接口
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/agents - 获取Agent列表
router.get('/', async (req, res) => {
  try {
    const [agents] = await db.query(`
      SELECT * FROM agents
      ORDER BY created_at DESC
    `);
    
    // 解析 JSON 字段
    const parsedAgents = agents.map(agent => ({
      ...agent,
      capabilities: typeof agent.capabilities === 'string' ? JSON.parse(agent.capabilities || '[]') : agent.capabilities || [],
      tools: typeof agent.tools === 'string' ? JSON.parse(agent.tools || '[]') : agent.tools || []
    }));
    
    res.json(parsedAgents);
  } catch (error) {
    console.error('获取Agent失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/agents/:id - 获取单个Agent
router.get('/:id', async (req, res) => {
  try {
    const [[agent]] = await db.query(
      'SELECT * FROM agents WHERE id = ?',
      [req.params.id]
    );
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent不存在' });
    }
    
    // 解析 JSON 字段
    const parsedAgent = {
      ...agent,
      capabilities: typeof agent.capabilities === 'string' ? JSON.parse(agent.capabilities || '[]') : agent.capabilities || [],
      tools: typeof agent.tools === 'string' ? JSON.parse(agent.tools || '[]') : agent.tools || []
    };
    
    res.json(parsedAgent);
  } catch (error) {
    console.error('获取Agent失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /api/agents/:id/chat - 智能体聊天接口
router.post('/:id/chat', async (req, res) => {
  try {
    const { id } = req.params;
    const { message, conversationId } = req.body;

    if (!message) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }

    // 获取智能体信息
    const [[agent]] = await db.query('SELECT * FROM agents WHERE id = ?', [id]);
    if (!agent) {
      return res.status(404).json({ error: '智能体不存在' });
    }

    // 检查智能体状态
    if (agent.status === 'offline') {
      return res.status(400).json({ error: '智能体当前离线' });
    }

    // 构建 AI 请求
    const https = require('https');
    const AI_BASE = process.env.LTCRAFT_BASE_URL || 'https://ai.ltcraft.cn';
    const AI_KEY = process.env.LTCRAFT_API_KEY;
    const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'deepseek-chat';

    const url = new URL(AI_BASE);
    const body = JSON.stringify({
      model: agent.model || DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: agent.system_prompt || `你是${agent.name}，${agent.description}`
        },
        {
          role: 'user',
          content: message
        }
      ]
    });

    const opts = {
      hostname: url.hostname,
      port: 443,
      path: (url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname) + '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    };

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
      req.write(body);
      req.end();
    });

    const reply = aiResponse.choices?.[0]?.message?.content || '抱歉，我无法回答这个问题。';

    res.json({
      message: reply,
      agent: {
        id: agent.id,
        name: agent.name,
        avatar: agent.avatar
      }
    });
  } catch (error) {
    console.error('智能体聊天失败:', error);
    res.status(500).json({ error: '聊天失败，请稍后重试' });
  }
});

module.exports = router;

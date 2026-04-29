'use strict';
const express = require('express');
const config = require('../config/index');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const { parseJsonColumn } = require('../utils/helpers');
const { log } = require('../utils/log');
const { callAiSafe } = require('../services/ai.service');

const router = express.Router();
const AGENT_ORDER = "FIELD(id,'ceo','hr','finance','sales','operations','tech','support')";

router.get('/agents', asyncRoute(async (_req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM agents ORDER BY ' + AGENT_ORDER);
  rows.forEach((r) => { r.capabilities = parseJsonColumn(r.capabilities) || []; r.tools = parseJsonColumn(r.tools) || []; r.todayTaskCount = r.today_tasks || 0; delete r.today_tasks; });
  res.json(rows);
}));

router.get('/agents/:id', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM agents WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'agent not found' });
  const r = rows[0];
  r.capabilities = parseJsonColumn(r.capabilities) || [];
  r.tools = parseJsonColumn(r.tools) || [];
  res.json(r);
}));

router.put('/agents/:id', asyncRoute(async (req, res) => {
  const { model, system_prompt, status, capabilities, tools, description, name } = req.body || {};
  const pool = getPool();
  await pool.query(
    'UPDATE agents SET name=COALESCE(?,name), description=COALESCE(?,description), model=COALESCE(?,model), system_prompt=COALESCE(?,system_prompt), status=COALESCE(?,status), capabilities=COALESCE(?,capabilities), tools=COALESCE(?,tools) WHERE id=?',
    [name || null, description || null, model || null, system_prompt || null, status || null,
     capabilities ? JSON.stringify(capabilities) : null, tools ? JSON.stringify(tools) : null, req.params.id],
  );
  res.json({ success: true });
}));

// ============== MESSAGES (chat) ==============
router.get('/agents/:id/messages', asyncRoute(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    [req.params.id, limit],
  );
  res.json(rows.reverse());
}));

const agentMessageHandler = asyncRoute(async (req, res) => {
  const { content } = req.body || {};
  const role = (req.body && req.body.role) || 'user';
  const agentId = req.params.id;
  if (!content) return res.status(400).json({ error: 'content required' });
  const pool = getPool();

  const [userInsert] = await pool.query(
    'INSERT INTO messages (conversation_id, agent_id, role, content) VALUES (1, ?, ?, ?)',
    [agentId, role, content],
  );

  if (role !== 'user') {
    return res.json({ success: true, id: userInsert.insertId });
  }

  const [agents] = await pool.query('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (!agents.length) return res.status(404).json({ error: 'agent not found' });
  const agent = agents[0];

  const [history] = await pool.query(
    'SELECT role, content FROM messages WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20',
    [agentId],
  );
  const messages = history.reverse();
  const [availWfs] = await pool.query(
    "SELECT name, description, trigger_condition FROM workflows WHERE status=1 AND is_template=0 AND JSON_CONTAINS(agents, JSON_QUOTE(?)) ORDER BY id DESC LIMIT 20",
    [agentId]
  );
  let wfPrompt = '';
  if (availWfs.length > 0) {
    wfPrompt = '\n\n可用工作流（用户请求匹配时请推荐并以 【执行工作流：名称】 标记，系统会提供触发按钮）：\n' + availWfs.map(function (w, i) { return (i + 1) + '. 【' + w.name + '】 ' + (w.description || '') + (w.trigger_condition ? ' (触发：' + w.trigger_condition + ')' : ''); }).join('\n');
  }
  const sysContent = (agent.system_prompt || '') + wfPrompt;
  if (sysContent.trim()) messages.unshift({ role: 'system', content: sysContent });

  let aiData;
  try {
    aiData = await callAiSafe(messages, agent.model || config.DEFAULT_MODEL);
  } catch (e) {
    log('error', 'ai_call_failed', { agent: agentId, error: e.message });
    return res.status(502).json({ error: 'AI 调用失败: ' + e.message });
  }

  const aiContent = (aiData && aiData.choices && aiData.choices[0] && aiData.choices[0].message && aiData.choices[0].message.content) || '(无回复)';
  const [aiInsert] = await pool.query(
    'INSERT INTO messages (conversation_id, agent_id, role, content) VALUES (1, ?, "assistant", ?)',
    [agentId, aiContent],
  );

  if (global.wsManager) {
    global.wsManager.sendToConversation(1, 'new-message', {
      id: aiInsert.insertId, conversation_id: 1, agent_id: agentId, role: 'assistant', content: aiContent, created_at: new Date().toISOString(),
    });
  }

  res.json({ success: true, id: aiInsert.insertId, content: aiContent });
});

router.post('/agents/:id/messages', agentMessageHandler);
router.post('/agents/:id/chat', agentMessageHandler);

router.delete('/agents/:id/messages', asyncRoute(async (req, res) => {
  const pool = getPool();
  await pool.query('DELETE FROM messages WHERE agent_id = ?', [req.params.id]);
  res.json({ success: true });
}));

module.exports = router;

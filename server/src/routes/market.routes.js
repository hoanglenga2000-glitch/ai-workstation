'use strict';
const express = require('express');
const config = require('../config/index');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const { tokenAuth } = require('../middleware/auth');
const { callAi } = require('../services/ai.service');

const router = express.Router();

// ========== 智能体市场 ==========
router.get('/api/market/agents', asyncRoute(async (req, res) => {
  const { category, price_type, search } = req.query;
  let sql = 'SELECT * FROM agent_market WHERE is_public=1';
  const params = [];
  if (category) { sql += ' AND category=?'; params.push(category); }
  if (price_type) { sql += ' AND price_type=?'; params.push(price_type); }
  if (search) { sql += ' AND (name LIKE ? OR description LIKE ?)'; params.push('%' + search + '%', '%' + search + '%'); }
  sql += ' ORDER BY usage_count DESC, rating DESC, id DESC';
  const pool = getPool();
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}));

router.get('/api/market/agents/:id', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM agent_market WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Agent not found' });
  res.json(rows[0]);
}));

router.post('/api/market/agents/:id/use', asyncRoute(async (req, res) => {
  const agentId = req.params.id;
  const pool = getPool();
  const [agentRows] = await pool.query('SELECT * FROM agent_market WHERE id=?', [agentId]);
  if (!agentRows.length) return res.status(404).json({ error: 'Agent not found' });
  const agent = agentRows[0];

  const userId = req.user ? req.user.id : null;
  if (!userId) return res.status(401).json({ error: '请先登录' });

  if (agent.price_type !== 'free') {
    const cost = agent.price || 0;
    // Atomic deduction — prevents race condition
    const [deductResult] = await pool.query(
      'UPDATE user_balance SET balance = balance - ?, total_consumed = total_consumed + ? WHERE user_id = ? AND balance >= ?',
      [cost, cost, userId, cost]
    );
    if (deductResult.affectedRows === 0) {
      return res.status(402).json({ error: '余额不足' });
    }
  }

  const userMessage = req.body.message || req.body.input || '你好';
  const systemPrompt = agent.prompt_template || '你是一个AI助手';

  try {
    const [modelRows] = await pool.query('SELECT * FROM model_market WHERE model_id=?', [agent.model]);
    const modelId = modelRows.length ? modelRows[0].model_id : config.DEFAULT_MODEL;
    const result = await callAi(systemPrompt, userMessage, { model: modelId });

    await pool.query(
      'INSERT INTO agent_usage_log (agent_id, user_id, input_text, output_text, tokens_used) VALUES (?,?,?,?,?)',
      [agentId, userId, userMessage, result.content, result.usage?.total_tokens || 0]
    );

    await pool.query('UPDATE agent_market SET usage_count=usage_count+1 WHERE id=?', [agentId]);
    res.json({ success: true, response: result.content, usage: result.usage });
  } catch (e) {
    // Refund on AI failure for paid agents
    if (agent.price_type !== 'free') {
      const cost = agent.price || 0;
      await pool.query('UPDATE user_balance SET balance = balance + ?, total_consumed = total_consumed - ? WHERE user_id = ?', [cost, cost, userId]);
    }
    res.status(502).json({ error: 'AI 调用失败: ' + e.message });
  }
}));

router.post('/api/market/agents', asyncRoute(async (req, res) => {
  const userId = req.user ? req.user.id : 1;
  const { name, category, description, prompt_template, model, price_type } = req.body || {};
  if (!name || !prompt_template) return res.status(400).json({ error: 'name and prompt_template required' });
  const pool = getPool();
  const [result] = await pool.query(
    'INSERT INTO agent_market (name, category, description, prompt_template, model, price_type, author_id, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [name, category || 'other', description, prompt_template, model || 'gpt-5.4', price_type || 'free', userId, false]
  );
  res.json({ success: true, id: result.insertId });
}));

// ========== 模型市场 ==========
router.get('/api/market/models', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM model_market WHERE is_available=1 ORDER BY sort_order ASC, id ASC');
  res.json(rows);
}));

router.get('/api/market/models/:id', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM model_market WHERE model_id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Model not found' });
  res.json(rows[0]);
}));

// ========== 场景分类 ==========
router.get('/api/scenarios', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM scenario_categories ORDER BY sort_order ASC');
  res.json(rows);
}));

router.get('/api/scenarios/:id/agents', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [categoryRows] = await pool.query('SELECT name_en FROM scenario_categories WHERE id=?', [req.params.id]);
  if (!categoryRows.length) return res.status(404).json({ error: 'Scenario not found' });
  const category = categoryRows[0].name_en;
  const [agentRows] = await pool.query(
    'SELECT * FROM agent_market WHERE category=? AND is_public=1 ORDER BY usage_count DESC',
    [category]
  );
  res.json(agentRows);
}));

router.get('/api/scenarios/categories', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM scenario_categories ORDER BY sort_order ASC, id ASC');
  res.json(rows);
}));

router.get('/api/scenarios/categories/:id', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM scenario_categories WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Category not found' });
  res.json(rows[0]);
}));

module.exports = router;

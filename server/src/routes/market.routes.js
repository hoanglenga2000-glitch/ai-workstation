'use strict';
const express = require('express');

const config = require('../config/index');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const { callAiSafe } = require('../services/ai.service');
const { log } = require('../utils/log');

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

/**
 * 智能体调用 — 流水单模式（最终一致性保证）
 *
 * 流程:
 * 1. 事务内: 扣费 + 插入 status='pending' 流水单
 * 2. 事务外: 调用 AI
 * 3. 成功: UPDATE 流水单 status='completed'
 * 4. 失败: 事务内: UPDATE 流水单 status='failed' + 退款
 *
 * 崩溃恢复: 如果进程在步骤2后崩溃，流水单保持 'pending'。
 * 可通过定时任务扫描超时的 pending 记录进行退款补偿。
 */
router.post('/api/market/agents/:id/use', asyncRoute(async (req, res) => {
  const agentId = req.params.id;
  const pool = getPool();
  const [agentRows] = await pool.query('SELECT * FROM agent_market WHERE id=?', [agentId]);
  if (!agentRows.length) return res.status(404).json({ error: 'Agent not found' });
  const agent = agentRows[0];

  const userId = req.user ? req.user.id : null;
  if (!userId) return res.status(401).json({ error: '请先登录' });

  const userMessage = req.body.message || req.body.input || '你好';
  const systemPrompt = agent.prompt_template || '你是一个AI助手';
  const cost = (agent.price_type !== 'free') ? (agent.price || 0) : 0;
  let usageId = null;

  // Step 1: 事务 — 扣费 + 创建 pending 流水单
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (cost > 0) {
      const [deductResult] = await conn.query(
        'UPDATE user_balance SET balance = balance - ?, total_consumed = total_consumed + ? WHERE user_id = ? AND balance >= ?',
        [cost, cost, userId, cost]
      );
      if (deductResult.affectedRows === 0) {
        await conn.rollback();
        conn.release();
        return res.status(402).json({ error: '余额不足' });
      }
    }

    const [insertResult] = await conn.query(
      'INSERT INTO agent_usage_log (agent_id, user_id, input_text, output_text, tokens_used, status, cost, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, NOW())',
      [agentId, userId, userMessage, '', 'pending', cost]
    );
    usageId = insertResult.insertId;

    await conn.commit();
    log('info', 'agent_use_pending', { usageId, agentId, userId, cost });
  } catch (e) {
    await conn.rollback();
    conn.release();
    log('error', 'agent_use_deduct_failed', { agentId, userId, error: e.message });
    return res.status(500).json({ error: '扣费失败: ' + e.message });
  } finally {
    conn.release();
  }

  // Step 2: 调用 AI（事务外，不持有连接）
  try {
    const [modelRows] = await pool.query('SELECT * FROM model_market WHERE model_id=?', [agent.model]);
    const modelId = modelRows.length ? modelRows[0].model_id : config.DEFAULT_MODEL;

    // callAiSafe 接受 messages 数组，不是 (prompt, message, opts)
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];
    const aiData = await callAiSafe(messages, modelId);
    const aiContent = (aiData && aiData.choices && aiData.choices[0] && aiData.choices[0].message && aiData.choices[0].message.content) || '(无回复)';
    const tokensUsed = aiData?.usage?.total_tokens || 0;

    // Step 3: 成功 — 更新流水单
    await pool.query(
      'UPDATE agent_usage_log SET status=?, output_text=?, tokens_used=? WHERE id=?',
      ['completed', aiContent, tokensUsed, usageId]

    );
    await pool.query('UPDATE agent_market SET usage_count=usage_count+1 WHERE id=?', [agentId]);

    log('info', 'agent_use_completed', { usageId, agentId, userId, tokensUsed });
    res.json({ success: true, response: aiContent, usage: aiData?.usage || {} });

  } catch (e) {
    // Step 4: 失败 — 事务内退款 + 标记流水单
    log('error', 'agent_use_ai_failed', { usageId, agentId, userId, error: e.message });

    const refundConn = await pool.getConnection();
    try {
      await refundConn.beginTransaction();

      await refundConn.query(
        'UPDATE agent_usage_log SET status=?, error_msg=? WHERE id=? AND status=?',
        ['failed', e.message.slice(0, 500), usageId, 'pending']
      );

      if (cost > 0) {
        await refundConn.query(
          'UPDATE user_balance SET balance = balance + ?, total_consumed = total_consumed - ? WHERE user_id = ?',
          [cost, cost, userId]
        );
        log('info', 'agent_use_refunded', { usageId, agentId, userId, cost });
      }

      await refundConn.commit();
    } catch (refundErr) {
      await refundConn.rollback();
      // 退款失败是严重事件，必须记录以便人工介入
      log('error', 'agent_use_refund_failed', { usageId, agentId, userId, cost, error: refundErr.message });
    } finally {
      refundConn.release();
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
    [name, category || 'other', description || '', prompt_template, model || config.DEFAULT_MODEL, price_type || 'free', userId, false]
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

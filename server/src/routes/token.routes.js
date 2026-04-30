'use strict';
const express = require('express');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/api/token/balance', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const userId = req.user.id;
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM user_balance WHERE user_id=?', [userId]);
  if (!rows.length) {
    await pool.query('INSERT INTO user_balance (user_id, balance, free_quota) VALUES (?, 0, 10000)', [userId]);
    return res.json({ balance: 0, total_recharged: 0, total_consumed: 0, free_quota: 10000 });
  }
  res.json(rows[0]);
}));

router.get('/api/token/usage', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const userId = req.user.id;
  const { limit = 50, offset = 0 } = req.query;
  const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
  const safeOffset = Math.max(parseInt(offset) || 0, 0);
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT tul.id, tul.user_id, tul.task_id, tul.model_used, tul.input_tokens, tul.output_tokens, tul.platform_tokens_cost AS total_tokens, tul.actual_cost_cny AS cost, tul.created_at FROM token_usage_logs tul WHERE tul.user_id=? ORDER BY tul.created_at DESC LIMIT ? OFFSET ?',
    [userId, safeLimit, safeOffset]
  );
  res.json(rows);
}));

router.get('/api/token/stats', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const userId = req.user.id;
  const pool = getPool();
  const [balanceRows] = await pool.query('SELECT * FROM user_balance WHERE user_id=?', [userId]);
  const balance = balanceRows.length ? balanceRows[0] : { balance: 0, free_quota: 10000 };
  const [todayRows] = await pool.query('SELECT SUM(platform_tokens_cost) as tokens, SUM(actual_cost_cny) as cost FROM token_usage_logs WHERE user_id=? AND DATE(created_at)=CURDATE()', [userId]);
  const today = todayRows[0] || { tokens: 0, cost: 0 };
  const [monthRows] = await pool.query('SELECT SUM(platform_tokens_cost) as tokens, SUM(actual_cost_cny) as cost FROM token_usage_logs WHERE user_id=? AND YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())', [userId]);
  const month = monthRows[0] || { tokens: 0, cost: 0 };
  res.json({
    balance: balance.balance || 0,
    free_quota: balance.free_quota || 0,
    today_tokens: today.tokens || 0,
    today_cost: today.cost || 0,
    month_tokens: month.tokens || 0,
    month_cost: month.cost || 0,
  });
}));

router.post('/api/token/recharge', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '支付系统接入中，暂不开放自助充值' });
  const { user_id, amount } = req.body || {};
  const targetUserId = user_id || req.user.id;
  if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: '充值金额无效（0-100000）' });
  }
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM user_balance WHERE user_id=?', [targetUserId]);
  if (!rows.length) {
    await pool.query('INSERT INTO user_balance (user_id, balance, total_recharged) VALUES (?, ?, ?)', [targetUserId, amount, amount]);
  } else {
    await pool.query('UPDATE user_balance SET balance=balance+?, total_recharged=total_recharged+? WHERE user_id=?', [amount, amount, targetUserId]);
  }
  res.json({ success: true, message: '充值成功', user_id: targetUserId, amount });
}));

module.exports = router;

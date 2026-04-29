'use strict';
const express = require('express');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const { tokenAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/api/token/balance', asyncRoute(async (req, res) => {
  if (!tokenAuth(req)) return res.status(401).json({ error: '请先登录' });
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
  if (!tokenAuth(req)) return res.status(401).json({ error: '请先登录' });
  const userId = req.user.id;
  const { limit = 50, offset = 0 } = req.query;
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT tu.*, am.name as agent_name, mm.model_name FROM token_usage tu LEFT JOIN agent_market am ON tu.agent_id = am.id LEFT JOIN model_market mm ON tu.model_id = mm.model_id WHERE tu.user_id=? ORDER BY tu.created_at DESC LIMIT ? OFFSET ?',
    [userId, parseInt(limit), parseInt(offset)]
  );
  res.json(rows);
}));

router.get('/api/token/stats', asyncRoute(async (req, res) => {
  if (!tokenAuth(req)) return res.status(401).json({ error: '请先登录' });
  const userId = req.user.id;
  const pool = getPool();
  const [balanceRows] = await pool.query('SELECT * FROM user_balance WHERE user_id=?', [userId]);
  const balance = balanceRows.length ? balanceRows[0] : { balance: 0, free_quota: 10000 };
  const [todayRows] = await pool.query('SELECT SUM(total_tokens) as tokens, SUM(cost) as cost FROM token_usage WHERE user_id=? AND DATE(created_at)=CURDATE()', [userId]);
  const today = todayRows[0] || { tokens: 0, cost: 0 };
  const [monthRows] = await pool.query('SELECT SUM(total_tokens) as tokens, SUM(cost) as cost FROM token_usage WHERE user_id=? AND YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())', [userId]);
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
  if (!tokenAuth(req)) return res.status(401).json({ error: '请先登录' });
  const userId = req.user.id;
  const { amount } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: '充值金额无效' });
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM user_balance WHERE user_id=?', [userId]);
  if (!rows.length) {
    await pool.query('INSERT INTO user_balance (user_id, balance, total_recharged) VALUES (?, ?, ?)', [userId, amount, amount]);
  } else {
    await pool.query('UPDATE user_balance SET balance=balance+?, total_recharged=total_recharged+? WHERE user_id=?', [amount, amount, userId]);
  }
  res.json({ success: true, message: '充值成功' });
}));

module.exports = router;

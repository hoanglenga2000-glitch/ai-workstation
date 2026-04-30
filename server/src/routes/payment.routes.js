'use strict';
const express = require('express');
const crypto = require('crypto');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const { log } = require('../utils/log');
const config = require('../config/index');

const router = express.Router();

const RECHARGE_PLANS = [
  { id: 'plan_10',  amount: 10,  tokens: 10000,  label: '10元 / 10000 Token' },
  { id: 'plan_50',  amount: 50,  tokens: 55000,  label: '50元 / 55000 Token (赠10%)' },
  { id: 'plan_100', amount: 100, tokens: 120000, label: '100元 / 120000 Token (赠20%)' },
  { id: 'plan_500', amount: 500, tokens: 650000, label: '500元 / 650000 Token (赠30%)' },
];

router.get('/api/payment/plans', (_req, res) => {
  res.json(RECHARGE_PLANS);
});

router.post('/api/payment/create-order', asyncRoute(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: '请先登录' });

  const { plan_id } = req.body || {};
  const plan = RECHARGE_PLANS.find(p => p.id === plan_id);
  if (!plan) return res.status(400).json({ error: '无效的充值套餐' });

  const orderId = crypto.randomUUID();
  const pool = getPool();
  await pool.query(
    'INSERT INTO payment_orders (id, user_id, amount_cny, tokens_granted, status, payment_method) VALUES (?, ?, ?, ?, ?, ?)',
    [orderId, userId, plan.amount, plan.tokens, 'pending', 'pending']
  );

  res.json({
    success: true,
    order_id: orderId,
    amount: plan.amount,
    tokens: plan.tokens,
    message: '订单已创建，请等待支付网关接入后完成支付',
  });
}));

router.get('/api/payment/order/:id', asyncRoute(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: '请先登录' });

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, amount_cny, tokens_granted, status, payment_method, created_at, paid_at FROM payment_orders WHERE id = ? AND user_id = ?',
    [req.params.id, userId]
  );
  if (!rows.length) return res.status(404).json({ error: '订单不存在' });
  res.json(rows[0]);
}));

router.get('/api/payment/orders', asyncRoute(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: '请先登录' });

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, amount_cny, tokens_granted, status, payment_method, created_at, paid_at FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [userId]
  );
  res.json(rows);
}));

// Admin: manually fulfill an order (for testing before payment gateway)
router.post('/api/payment/fulfill/:id', asyncRoute(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可操作' });
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query(
      'SELECT * FROM payment_orders WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ error: '订单不存在' });
    }
    if (order.status !== 'pending') {
      await conn.rollback();
      return res.json({ success: true, message: '订单已处理', status: order.status });
    }

    await conn.query(
      'UPDATE payment_orders SET status = "paid", paid_at = NOW(), payment_method = "admin_manual" WHERE id = ?',
      [order.id]
    );
    await conn.query(
      'INSERT INTO user_balance (user_id, balance, total_recharged) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance), total_recharged = total_recharged + VALUES(total_recharged)',
      [order.user_id, order.tokens_granted, order.tokens_granted]
    );
    await conn.commit();
    log('info', 'payment_fulfilled', { order_id: order.id, user_id: order.user_id, tokens: order.tokens_granted });
    res.json({ success: true, message: '充值成功' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: '处理失败: ' + e.message });
  } finally {
    conn.release();
  }
}));

module.exports = router;

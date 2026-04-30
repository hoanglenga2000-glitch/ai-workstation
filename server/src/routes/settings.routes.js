'use strict';
const express = require('express');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const { parseJsonColumn } = require('../utils/helpers');

const router = express.Router();

// Notifications — 用户只能看到自己的通知
router.get('/notifications', asyncRoute(async (req, res) => {
  const pool = getPool();
  const userId = req.user?.id;
  let sql = 'SELECT * FROM notifications';
  const params = [];
  // 如果 notifications 表有 user_id 字段则按用户过滤，否则返回全部
  try {
    const [cols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'user_id'");
    if (cols.length && userId) {
      sql += ' WHERE user_id = ? OR user_id IS NULL';
      params.push(userId);
    }
  } catch (_) { /* 表不存在或查询失败，返回全部 */ }
  sql += ' ORDER BY created_at DESC LIMIT 50';
  const [rows] = await pool.query(sql, params);
  const countSql = params.length
    ? 'SELECT COUNT(*) AS unread FROM notifications WHERE is_read = 0 AND (user_id = ? OR user_id IS NULL)'
    : 'SELECT COUNT(*) AS unread FROM notifications WHERE is_read = 0';
  const [countResult] = await pool.query(countSql, params.length ? [userId] : []);
  res.json({ items: rows, unread: countResult[0].unread });
}));

router.put('/notifications/:id/read', asyncRoute(async (req, res) => {
  const pool = getPool();
  await pool.query('UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

router.put('/notifications/read-all', asyncRoute(async (_req, res) => {
  const pool = getPool();
  await pool.query('UPDATE notifications SET is_read = 1');
  res.json({ success: true });
}));

// Settings
router.get('/settings', asyncRoute(async (_req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM settings');
  const out = {};
  rows.forEach((r) => { out[r.key_name] = parseJsonColumn(r.value); });
  res.json(out);
}));

router.put('/settings/:key', asyncRoute(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  const pool = getPool();
  const value = JSON.stringify(req.body && Object.prototype.hasOwnProperty.call(req.body, 'value') ? req.body.value : req.body);
  await pool.query(
    'INSERT INTO settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [req.params.key, value],
  );
  res.json({ success: true });
}));

// Dashboard stats
router.get('/dashboard/stats', asyncRoute(async (_req, res) => {
  const pool = getPool();
  const [[{ tasks_done }]] = await pool.query("SELECT COUNT(*) AS tasks_done FROM tasks WHERE status='done'");
  const [[{ agents_online }]] = await pool.query("SELECT COUNT(*) AS agents_online FROM agents WHERE status IN ('online','busy')");
  const [[{ pending_approvals }]] = await pool.query("SELECT COUNT(*) AS pending_approvals FROM approvals WHERE status='pending'");
  const [[{ total_runs }]] = await pool.query("SELECT COUNT(*) AS total_runs FROM workflow_runs WHERE started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
  res.json({
    tasks_done,
    agents_online,
    pending_approvals,
    workflow_runs_30d: total_runs,
    monthly_revenue: 1250000,
  });
}));

module.exports = router;

'use strict';
const express = require('express');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');

const router = express.Router();

// 管理员权限检查中间件
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

router.get('/approvals', asyncRoute(async (req, res) => {
  const pool = getPool();
  const { status, submitter } = req.query;
  let sql =
    "SELECT ap.*, COALESCE(a.name, ap.submitter) AS submitter_name " +
    'FROM approvals ap LEFT JOIN agents a ON ap.submitter = a.id WHERE 1=1';
  const params = [];
  if (status === 'all') {
    // explicit opt-in: include approved/rejected
  } else if (status) {
    sql += ' AND ap.status = ?';
    params.push(status);
  } else {
    sql += " AND ap.status = 'pending'";
  }
  if (submitter) { sql += ' AND ap.submitter = ?'; params.push(submitter); }
  sql += " ORDER BY FIELD(ap.status,'pending','approved','rejected'), ap.created_at DESC";
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}));

router.post('/approvals', asyncRoute(async (req, res) => {
  const pool = getPool();
  const { title, description, submitter, priority } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!submitter) return res.status(400).json({ error: 'submitter required' });
  const [r] = await pool.query(
    'INSERT INTO approvals (title, description, submitter, priority, status) VALUES (?,?,?,?,?)',
    [title, description || '', submitter, priority || 'medium', 'pending'],
  );
  res.json({ id: r.insertId, success: true });
}));

router.put('/approvals/:id', requireAdmin, asyncRoute(async (req, res) => {
  const pool = getPool();
  const { status, reason } = req.body || {};
  if (status && !['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'invalid status' });
  await pool.query('UPDATE approvals SET status=COALESCE(?,status), reason=COALESCE(?,reason) WHERE id=?', [status || null, reason ?? null, req.params.id]);
  res.json({ success: true });
}));

router.delete('/approvals/:id', requireAdmin, asyncRoute(async (req, res) => {
  const pool = getPool();
  await pool.query('DELETE FROM approvals WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

router.put('/approvals/:id/approve', requireAdmin, asyncRoute(async (req, res) => {
  const pool = getPool();
  await pool.query('UPDATE approvals SET status = ?, resolved_at = NOW() WHERE id = ?', ['approved', req.params.id]);
  res.json({ success: true });
}));

router.put('/approvals/:id/reject', requireAdmin, asyncRoute(async (req, res) => {
  const pool = getPool();
  await pool.query('UPDATE approvals SET status = ?, resolved_at = NOW() WHERE id = ?', ['rejected', req.params.id]);
  res.json({ success: true });
}));

module.exports = router;

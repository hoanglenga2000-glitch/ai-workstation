'use strict';
const express = require('express');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const { parseJsonColumn } = require('../utils/helpers');

const router = express.Router();

const AGENT_ORDER = "FIELD(status,'online','busy','idle','offline'), id";

// Frontend API endpoints (static/simple)
router.get("/api/stats/overview", asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const [[{ tasks_done }]] = await pool.query("SELECT COUNT(*) AS tasks_done FROM tasks WHERE status='done'");
  const [[{ agents_online }]] = await pool.query("SELECT COUNT(*) AS agents_online FROM agents WHERE status IN ('online','busy')");
  const [[{ pending_approvals }]] = await pool.query("SELECT COUNT(*) AS pending_approvals FROM approvals WHERE status='pending'");
  const [[{ monthly_revenue }]] = await pool.query(
    "SELECT COALESCE(SUM(tokens_granted), 0) AS monthly_revenue FROM payment_orders WHERE status='paid' AND MONTH(paid_at)=MONTH(CURDATE()) AND YEAR(paid_at)=YEAR(CURDATE())"
  );
  res.json({
    todayTasksCompleted: tasks_done,
    activeAgents: agents_online,
    pendingApprovals: pending_approvals,
    monthlyRevenue: monthly_revenue
  });
}));

router.get("/api/activities", asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  res.json([]);
}));

router.get("/api/approvals", asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const [rows] = await pool.query("SELECT ap.*, COALESCE(a.name, ap.submitter) AS submitter_name FROM approvals ap LEFT JOIN agents a ON ap.submitter = a.id WHERE ap.status = 'pending' ORDER BY ap.created_at DESC");
  res.json(rows);
}));

router.get("/api/agents", asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const [rows] = await pool.query("SELECT * FROM agents ORDER BY " + AGENT_ORDER);
  rows.forEach((r) => { r.capabilities = parseJsonColumn(r.capabilities) || []; r.tools = parseJsonColumn(r.tools) || []; r.todayTaskCount = r.today_tasks || 0; delete r.today_tasks; });
  res.json(rows);
}));

// Mirror /agents/* routes under /api/agents/*
router.get('/api/agents/:id', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM agents WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'agent not found' });
  const r = rows[0];
  r.capabilities = parseJsonColumn(r.capabilities) || [];
  r.tools = parseJsonColumn(r.tools) || [];
  res.json(r);
}));

router.put('/api/agents/:id', asyncRoute(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  const pool = getPool();
  const { model, system_prompt, status, capabilities, tools, description, name } = req.body || {};
  await pool.query(
    'UPDATE agents SET name=COALESCE(?,name), description=COALESCE(?,description), model=COALESCE(?,model), system_prompt=COALESCE(?,system_prompt), status=COALESCE(?,status), capabilities=COALESCE(?,capabilities), tools=COALESCE(?,tools) WHERE id=?',
    [name || null, description || null, model || null, system_prompt || null, status || null,
     capabilities ? JSON.stringify(capabilities) : null, tools ? JSON.stringify(tools) : null, req.params.id],
  );
  res.json({ success: true });
}));

router.delete('/api/agents/:id', asyncRoute(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  const pool = getPool();
  await pool.query('DELETE FROM agents WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

router.get('/api/agents/:id/messages', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const [rows] = await pool.query(
    'SELECT * FROM messages WHERE agent_id = ? AND (user_id = ? OR user_id IS NULL) ORDER BY created_at DESC LIMIT ?',
    [req.params.id, req.user.id, limit],
  );
  res.json(rows.reverse());
}));

// Missing route aliases for frontend compatibility
router.get('/agents/:id/history', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const [rows] = await pool.query(
    'SELECT * FROM messages WHERE agent_id = ? AND (user_id = ? OR user_id IS NULL) ORDER BY created_at DESC LIMIT ?',
    [req.params.id, req.user.id, limit],
  );
  res.json(rows.reverse());
}));

// /tasks/:id -> GET single task
router.get('/tasks/:id', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const [[row]] = await pool.query('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Task not found' });
  if (row.metadata && typeof row.metadata === 'string') try { row.metadata = JSON.parse(row.metadata); } catch(_) {}
  res.json(row);
}));

// /workflows/:id/history -> alias for /workflows/:id/runs
router.get('/workflows/:id/history', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50',
    [req.params.id]
  );
  res.json(rows);
}));

module.exports = router;

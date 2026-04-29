'use strict';
const express = require('express');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const { parseJsonColumn } = require('../utils/helpers');

const router = express.Router();

router.get('/reports/overview', asyncRoute(async (_req, res) => {
  const pool = getPool();
  const [tasksByStatus] = await pool.query("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status");
  const [tasksByAssignee] = await pool.query(
    "SELECT t.assignee, COALESCE(a.name, t.assignee) AS assignee_name, COUNT(*) AS n FROM tasks t LEFT JOIN agents a ON t.assignee=a.id GROUP BY t.assignee ORDER BY n DESC",
  );
  const [approvalsByStatus] = await pool.query("SELECT status, COUNT(*) AS n FROM approvals GROUP BY status");
  const [messagesByDay] = await pool.query(
    "SELECT DATE(created_at) AS day, COUNT(*) AS n FROM messages WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY day",
  );
  const [workflowLastRun] = await pool.query(
    'SELECT id, name, category, last_run, last_run_status FROM workflows ORDER BY last_run DESC, id LIMIT 20',
  );
  res.json({
    tasks_by_status: tasksByStatus,
    tasks_by_assignee: tasksByAssignee,
    approvals_by_status: approvalsByStatus,
    messages_last_7d: messagesByDay,
    workflows: workflowLastRun,
  });
}));

router.get('/reports/agents', asyncRoute(async (_req, res) => {
  const pool = getPool();
  try {
    const [agents] = await pool.query('SELECT id, name, role, status, model FROM agents');
    const [msgCounts] = await pool.query('SELECT agent_id, COUNT(*) as count FROM messages GROUP BY agent_id');
    const countMap = Object.fromEntries(msgCounts.map(r => [r.agent_id, r.count]));
    res.json(agents.map(a => ({ ...a, message_count: countMap[a.id] || 0 })));
  } catch (e) {
    res.json([]);
  }
}));

router.get('/reports/usage', asyncRoute(async (_req, res) => {
  const pool = getPool();
  try {
    const [rows] = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count FROM messages WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY DATE(created_at) ORDER BY date`
    );
    res.json({ daily: rows, total: rows.reduce((s, r) => s + r.count, 0) });
  } catch (e) {
    res.json({ daily: [], total: 0 });
  }
}));

// Workflow template library
router.get('/workflow-templates', asyncRoute(async (req, res) => {
  const pool = getPool();
  const { q, category, agent, limit, offset } = req.query;
  let sql = 'SELECT id, name, description, trigger_condition, category, agents, nodes, node_types, template_source, template_id FROM workflows WHERE is_template = 1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (agent)    { sql += ' AND JSON_CONTAINS(agents, JSON_QUOTE(?))'; params.push(agent); }
  if (q)        { sql += ' AND (name LIKE ? OR description LIKE ?)'; const s = '%'+q+'%'; params.push(s, s); }
  sql += ' ORDER BY id LIMIT ? OFFSET ?';
  params.push(Math.min(parseInt(limit || '40', 10) || 40, 200), parseInt(offset || '0', 10) || 0);
  const [rows] = await pool.query(sql, params);
  rows.forEach((r) => { r.agents = parseJsonColumn(r.agents) || []; r.node_types = parseJsonColumn(r.node_types) || []; });
  res.json(rows);
}));

router.get('/workflow-templates/stats', asyncRoute(async (_req, res) => {
  const pool = getPool();
  const [cats] = await pool.query("SELECT category, COUNT(*) AS n FROM workflows WHERE is_template=1 GROUP BY category ORDER BY n DESC");
  const [[tot]] = await pool.query("SELECT COUNT(*) AS total FROM workflows WHERE is_template=1");
  res.json({ total: tot.total, categories: cats });
}));

router.post('/workflow-templates/:id/adopt', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM workflows WHERE id=? AND is_template=1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'template not found' });
  const t = rows[0];
  const overrides = req.body || {};
  const [r] = await pool.query(
    'INSERT INTO workflows (name, description, trigger_condition, category, status, agents, nodes, node_types, definition, is_template, slug, last_run_status) VALUES (?,?,?,?,1,?,?,?,?,0,?,"never")',
    [overrides.name || t.name,
     overrides.description || t.description,
     t.trigger_condition, t.category,
     t.agents, t.nodes, t.node_types, t.definition, t.slug]
  );
  res.json({ id: r.insertId, success: true, cloned_from: t.id });
}));

// Agent <-> Workflow association
router.get('/agents/:id/workflows', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT id, name, description, category, trigger_condition, status FROM workflows WHERE is_template=0 AND JSON_CONTAINS(agents, JSON_QUOTE(?)) ORDER BY status DESC, id DESC",
    [req.params.id]
  );
  res.json(rows);
}));

router.post('/agents/:id/workflows', asyncRoute(async (req, res) => {
  const pool = getPool();
  const { workflow_id } = req.body || {};
  if (!workflow_id) return res.status(400).json({ error: 'workflow_id required' });
  const [rows] = await pool.query('SELECT agents FROM workflows WHERE id=?', [workflow_id]);
  if (!rows.length) return res.status(404).json({ error: 'workflow not found' });
  const current = parseJsonColumn(rows[0].agents) || [];
  if (!current.includes(req.params.id)) current.push(req.params.id);
  await pool.query('UPDATE workflows SET agents=? WHERE id=?', [JSON.stringify(current), workflow_id]);
  res.json({ success: true, agents: current });
}));

router.delete('/agents/:id/workflows/:wfId', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT agents FROM workflows WHERE id=?', [req.params.wfId]);
  if (!rows.length) return res.status(404).json({ error: 'workflow not found' });
  const current = (parseJsonColumn(rows[0].agents) || []).filter(function (a) { return a !== req.params.id; });
  await pool.query('UPDATE workflows SET agents=? WHERE id=?', [JSON.stringify(current), req.params.wfId]);
  res.json({ success: true, agents: current });
}));

module.exports = router;

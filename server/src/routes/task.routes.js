'use strict';
const express = require('express');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/tasks', asyncRoute(async (req, res) => {
  const { assignee, status, priority } = req.query;
  let sql =
    "SELECT t.*, COALESCE(a.name, t.assignee, '未分配') AS assignee_name " +
    'FROM tasks t LEFT JOIN agents a ON t.assignee = a.id WHERE 1=1';
  const params = [];
  if (assignee) { sql += ' AND t.assignee = ?'; params.push(assignee); }
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority); }
  sql += " ORDER BY FIELD(t.priority,'high','medium','low'), t.deadline ASC";
  const pool = getPool();
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}));

router.post('/tasks', asyncRoute(async (req, res) => {
  const { title, description, assignee, priority, status, deadline, progress } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!assignee) return res.status(400).json({ error: 'assignee required' });
  const pool = getPool();
  const [r] = await pool.query(
    'INSERT INTO tasks (title, description, assignee, priority, status, deadline, progress) VALUES (?,?,?,?,?,?,?)',
    [title, description || '', assignee, priority || 'medium', status || 'todo', deadline || null, progress || 0],
  );
  res.json({ id: r.insertId, success: true });
}));

router.put('/tasks/:id', asyncRoute(async (req, res) => {
  const { title, description, assignee, priority, status, deadline, progress } = req.body || {};
  const pool = getPool();
  await pool.query(
    'UPDATE tasks SET title=COALESCE(?,title), description=COALESCE(?,description), assignee=COALESCE(?,assignee), priority=COALESCE(?,priority), status=COALESCE(?,status), deadline=COALESCE(?,deadline), progress=COALESCE(?,progress) WHERE id=?',
    [title || null, description ?? null, assignee || null, priority || null, status || null, deadline || null,
     progress === undefined || progress === null ? null : progress, req.params.id],
  );
  res.json({ success: true });
}));

router.delete('/tasks/:id', asyncRoute(async (req, res) => {
  const pool = getPool();
  await pool.query('DELETE FROM tasks WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

module.exports = router;

'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const { toCamelCase } = require('../utils/helpers');

const router = express.Router();

const uploadDir = path.join(__dirname, '../../..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.UPLOAD_MAX_SIZE_MB) || 20) * 1024 * 1024 },
});

router.get('/knowledge', asyncRoute(async (req, res) => {
  const pool = getPool();
  const acceptHeader = req.get('Accept') || '';
  const jsonIndex = acceptHeader.indexOf('application/json');
  const htmlIndex = acceptHeader.indexOf('text/html');
  if (htmlIndex >= 0 && (jsonIndex < 0 || htmlIndex < jsonIndex)) {
    res.set('Vary', 'Accept');
    res.set('Cache-Control', 'no-store');
    return res.sendFile(path.join(__dirname, '../../..', 'index.html'));
  }
  if (!req.user) return res.status(401).json({ error: '请先登录' });

  const { department, search, category } = req.query;
  let sql = 'SELECT * FROM knowledge_docs WHERE 1=1';
  const params = [];
  if (department) { sql += ' AND department = ?'; params.push(department); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (search) { sql += ' AND (title LIKE ? OR content LIKE ?)'; params.push('%' + search + '%', '%' + search + '%'); }
  sql += ' ORDER BY updated_at DESC';
  const [rows] = await pool.query(sql, params);
  res.json(toCamelCase(rows));
}));

router.get('/knowledge/search', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const { q } = req.query;
  if (!q) return res.json([]);
  const search = '%' + q + '%';
  const [rows] = await pool.query(
    'SELECT * FROM knowledge_docs WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC',
    [search, search]
  );
  res.json(toCamelCase(rows));
}));

router.get('/knowledge/:id', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const [[row]] = await pool.query('SELECT * FROM knowledge_docs WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Knowledge item not found' });
  res.json(row);
}));

router.post('/knowledge', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const { title, category, department, content, file_type } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const [r] = await pool.query(
    'INSERT INTO knowledge_docs (title, category, department, content, file_type) VALUES (?,?,?,?,?)',
    [title, category || '', department || '', content || '', file_type || ''],
  );
  res.json({ id: r.insertId, success: true });
}));

router.delete('/knowledge/:id', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const [rows] = await pool.query('SELECT file_path FROM knowledge_docs WHERE id = ?', [req.params.id]);
  if (rows.length && rows[0].file_path) {
    const fp = path.join(__dirname, '../../..', rows[0].file_path.replace(/^\//, ''));
    try { fs.unlinkSync(fp); } catch { /* ignore */ }
  }
  await pool.query('DELETE FROM knowledge_docs WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

router.post('/knowledge/upload', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const { category, department } = req.body || {};
  const title = req.file.originalname;
  const file_type = path.extname(req.file.originalname).substring(1).toLowerCase();
  const file_path = '/uploads/' + req.file.filename;
  let content = '';
  if (['txt', 'md', 'csv', 'json', 'log', 'xml'].includes(file_type)) {
    try { content = fs.readFileSync(req.file.path, 'utf-8').slice(0, 2000000); }
    catch (e) { content = 'File path: ' + file_path; }
  } else {
    content = 'File path: ' + file_path;
  }
  const [r] = await pool.query(
    'INSERT INTO knowledge_docs (title, category, department, content, file_type, file_path, file_size) VALUES (?,?,?,?,?,?,?)',
    [title, category || '未分类', department || '通用', content, file_type, file_path, req.file.size],
  );

  const [[doc]] = await pool.query('SELECT * FROM knowledge_docs WHERE id = ?', [r.insertId]);
  res.json(toCamelCase(doc));
}));

// Activity logs
router.get('/activity-logs', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 200);
  const [rows] = await pool.query(
    "SELECT l.*, COALESCE(a.name, l.agent_id) AS agent_name " +
    'FROM activity_logs l LEFT JOIN agents a ON l.agent_id = a.id ORDER BY l.created_at DESC LIMIT ?',
    [limit],
  );
  res.json(rows);
}));

router.post('/activity-logs', asyncRoute(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const pool = getPool();
  const { agent_id, action, detail } = req.body || {};
  if (!agent_id || !action) return res.status(400).json({ error: 'agent_id and action required' });
  const [r] = await pool.query('INSERT INTO activity_logs (agent_id, action, detail) VALUES (?,?,?)', [agent_id, action, detail || '']);
  res.json({ id: r.insertId, success: true });
}));

module.exports = router;

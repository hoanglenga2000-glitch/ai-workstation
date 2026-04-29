'use strict';
const express = require('express');
const path = require('path');
const zlib = require('zlib');
const config = require('../config/index');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const { parseJsonColumn } = require('../utils/helpers');
const { callAiSafe } = require('../services/ai.service');
const { runMiniN8n } = require('../services/workflow.engine');

const router = express.Router();

function formatWorkflowRow(r) {
  const agents = parseJsonColumn(r.agents) || [];
  const nodesRaw = r.nodes;
  const nodeCount = typeof nodesRaw === 'number' ? nodesRaw : (Array.isArray(parseJsonColumn(nodesRaw)) ? parseJsonColumn(nodesRaw).length : 0);
  return {
    id: String(r.id),
    name: r.name || '',
    description: r.description || '',
    trigger: r.trigger_condition || 'manual',
    category: r.category || '自定义',
    status: r.status === 1 ? 'enabled' : 'disabled',
    agents,
    nodeCount,
    lastRun: r.last_run || '',
    lastExecutionStatus: r.last_run_status || 'idle',
    isTemplate: r.is_template === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function workflowListQuery(req) {
  const { category, agent, search, limit, template } = req.query;
  let sql = 'SELECT id, name, description, trigger_condition, category, status, agents, nodes, last_run, last_run_status, is_template, created_at, updated_at FROM workflows WHERE 1=1';
  const params = [];
  if (template === '1' || template === 'all') { /* include templates */ } else { sql += ' AND is_template = 0'; }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (agent) { sql += ' AND JSON_CONTAINS(agents, JSON_QUOTE(?))'; params.push(agent); }
  if (search) { sql += ' AND (name LIKE ? OR description LIKE ?)'; const q = '%' + search + '%'; params.push(q, q); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.min(parseInt(limit || '300', 10) || 300, 500));
  return { sql, params };
}

function handleBrowserOrApi(req, res, next) {
  const acceptHeader = req.get('Accept') || '';
  const jsonIndex = acceptHeader.indexOf('application/json');
  const htmlIndex = acceptHeader.indexOf('text/html');
  if (htmlIndex >= 0 && (jsonIndex < 0 || htmlIndex < jsonIndex)) {
    res.set('Vary', 'Accept');
    res.set('Cache-Control', 'no-store');
    return res.sendFile(path.join(__dirname, '../../../index.html'));
  }
  next();
}

router.get('/workflows', handleBrowserOrApi, asyncRoute(async (req, res) => {
  const { sql, params } = workflowListQuery(req);
  const pool = getPool();
  const [rows] = await pool.query(sql, params);
  res.json(rows.map(formatWorkflowRow));
}));

router.get('/workflows/', handleBrowserOrApi, asyncRoute(async (req, res) => {
  const { sql, params } = workflowListQuery(req);
  const pool = getPool();
  const [rows] = await pool.query(sql, params);
  res.json(rows.map(formatWorkflowRow));
}));

router.get('/workflows/:id', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM workflows WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'workflow not found' });
  const r = rows[0];
  r.agents = parseJsonColumn(r.agents) || [];
  r.nodes = parseJsonColumn(r.nodes) || [];
  res.json(r);
}));

router.post('/workflows', asyncRoute(async (req, res) => {
  const { name, description, trigger, trigger_condition, category, agents, nodes, nodeCount } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const agentsJson = JSON.stringify(Array.isArray(agents) ? agents : []);
  const nodesVal = Number.isFinite(+nodeCount) ? +nodeCount : (Number.isFinite(+nodes) ? +nodes : 0);
  const triggerVal = trigger_condition || trigger || 'manual';
  const pool = getPool();
  const [r] = await pool.query(
    'INSERT INTO workflows (name, description, trigger_condition, category, status, agents, nodes, last_run_status) VALUES (?,?,?,?,1,?,?,"idle")',
    [name, description || '', triggerVal, category || '', agentsJson, nodesVal],
  );
  res.json({
    id: String(r.insertId),
    name,
    description: description || '',
    trigger: triggerVal,
    category: category || '自定义',
    status: 'enabled',
    agents: Array.isArray(agents) ? agents : [],
    nodeCount: nodesVal,
    lastRun: '',
    lastExecutionStatus: 'idle',
    isTemplate: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}));

router.post('/workflows/:id/toggle', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM workflows WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'workflow not found' });
  const r = rows[0];
  const newStatus = r.status === 1 ? 0 : 1;
  await pool.query('UPDATE workflows SET status = ? WHERE id = ?', [newStatus, req.params.id]);
  res.json(formatWorkflowRow(Object.assign({}, r, { status: newStatus })));
}));

router.put('/workflows/:id', asyncRoute(async (req, res) => {
  const { status, name, description, trigger_condition, category, agents, nodes } = req.body || {};
  const pool = getPool();
  if (status !== undefined) {
    await pool.query('UPDATE workflows SET status = ? WHERE id = ?', [status ? 1 : 0, req.params.id]);
  }
  await pool.query(
    'UPDATE workflows SET name=COALESCE(?,name), description=COALESCE(?,description), trigger_condition=COALESCE(?,trigger_condition), category=COALESCE(?,category), agents=COALESCE(?,agents), nodes=COALESCE(?,nodes) WHERE id=?',
    [name || null, description ?? null, trigger_condition ?? null, category || null,
     agents ? JSON.stringify(agents) : null,
     nodes === undefined || nodes === null ? null : +nodes,
     req.params.id],
  );
  res.json({ success: true });
}));

router.delete('/workflows/:id', asyncRoute(async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM workflow_runs WHERE workflow_id = ?', [req.params.id]);
    await conn.query('DELETE FROM workflows WHERE id = ?', [req.params.id]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  res.json({ success: true });
}));

router.get('/workflows/:id/runs', asyncRoute(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, workflow_id, status, trigger_type, duration_ms, error_message, started_at, finished_at, LEFT(output, 2000) AS output FROM workflow_runs WHERE workflow_id = ? ORDER BY id DESC LIMIT ?',
    [req.params.id, limit],
  );
  res.json(rows);
}));

router.post('/workflows/:id/run', asyncRoute(async (req, res) => {
  const wfId = req.params.id;
  const pool = getPool();
  const [wfs] = await pool.query('SELECT * FROM workflows WHERE id = ?', [wfId]);
  if (!wfs.length) return res.status(404).json({ error: 'workflow not found' });
  const wf = wfs[0];
  const agentsList = parseJsonColumn(wf.agents) || [];
  const primaryAgent = agentsList[0] || 'ceo';

  const [runInsert] = await pool.query(
    'INSERT INTO workflow_runs (workflow_id, status, trigger_type, input) VALUES (?, "running", ?, ?)',
    [wfId, req.body && req.body.trigger_type ? String(req.body.trigger_type) : 'manual', JSON.stringify(req.body || {})],
  );
  const runId = runInsert.insertId;

  const [agents] = await pool.query('SELECT * FROM agents WHERE id = ?', [primaryAgent]);
  const agent = agents[0] || { model: config.DEFAULT_MODEL, system_prompt: null, name: primaryAgent };

  const startedAt = Date.now();
  const prompt =
    '你是 ' + (agent.name || primaryAgent) + '。现在要执行工作流【' + wf.name + '】。\n' +
    '描述：' + (wf.description || '(无)') + '\n' +
    '触发条件：' + (wf.trigger_condition || '(手动)') + '\n' +
    '类别：' + (wf.category || '') + '\n' +
    '请按该工作流的通常步骤，给出本次执行的摘要（100-300 字），并在末尾加一行 "状态: 成功" 或 "状态: 失败(原因)"。';
  const msgs = [];
  if (agent.system_prompt) msgs.push({ role: 'system', content: agent.system_prompt });
  msgs.push({ role: 'user', content: prompt });

  let status = 'success';
  let output = '';
  let errMsg = null;
  try {
    const ai = await callAiSafe(msgs, agent.model || config.DEFAULT_MODEL);
    output = (ai && ai.choices && ai.choices[0] && ai.choices[0].message && ai.choices[0].message.content) || '';
    if (/状态[:：]\s*失败/.test(output)) status = 'failed';
  } catch (e) {
    status = 'failed';
    errMsg = e.message;
  }
  const duration = Date.now() - startedAt;

  await pool.query(
    'UPDATE workflow_runs SET status=?, output=?, error_message=?, duration_ms=?, finished_at=NOW() WHERE id=?',
    [status, output, errMsg, duration, runId],
  );
  await pool.query('UPDATE workflows SET last_run=NOW(), last_run_status=? WHERE id=?', [status === 'success' ? 'success' : 'failed', wfId]);
  await pool.query('INSERT INTO activity_logs (agent_id, action, detail) VALUES (?, ?, ?)',
    [primaryAgent, '执行工作流：' + wf.name, (status === 'success' ? '成功 ' : '失败 ') + '(' + duration + 'ms)']);

  res.json({
    success: status === 'success',
    run_id: runId, status, duration_ms: duration,
    output: output.slice(0, 4000),
    error: errMsg,
  });
}));

// POST /workflows/:id/execute — simple AI-based execution
router.post('/workflows/:id/execute', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [wfs] = await pool.query('SELECT * FROM workflows WHERE id = ?', [req.params.id]);
  if (!wfs.length) return res.status(404).json({ error: 'workflow not found' });
  const wf = wfs[0];
  const agentsList = parseJsonColumn(wf.agents) || [];
  const primaryAgent = agentsList[0] || 'ceo';
  const [agents] = await pool.query('SELECT * FROM agents WHERE id = ?', [primaryAgent]);
  const agent = agents[0] || { model: config.DEFAULT_MODEL, system_prompt: null, name: primaryAgent };
  const prompt = '你是 ' + (agent.name || primaryAgent) + '。请执行工作流【' + wf.name + '】并给出执行摘要。';
  const msgs = [];
  if (agent.system_prompt) msgs.push({ role: 'system', content: agent.system_prompt });
  msgs.push({ role: 'user', content: prompt });
  const ai = await callAiSafe(msgs, agent.model || config.DEFAULT_MODEL);
  const content = (ai && ai.choices && ai.choices[0] && ai.choices[0].message && ai.choices[0].message.content) || '';
  res.json({ success: true, output: content });
}));

// POST /workflows/:id/execute-real — mini n8n runner
router.post('/workflows/:id/execute-real', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, name, definition, template_id FROM workflows WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'workflow not found' });
  const wf = rows[0];
  let defText = wf.definition;
  if (!defText && wf.template_id) {
    const [tr] = await pool.query('SELECT raw_json_gz FROM workflow_templates WHERE slug = ? LIMIT 1', [wf.template_id]);
    if (tr.length && tr[0].raw_json_gz) { try { defText = zlib.gunzipSync(tr[0].raw_json_gz).toString('utf-8'); } catch (_) {} }
  }
  if (!defText) return res.status(400).json({ error: '工作流没有可执行的定义（需从 n8n 模板导入）' });
  let def; try { def = JSON.parse(defText); } catch (e) { return res.status(500).json({ error: 'definition parse: ' + e.message }); }
  const [runRow] = await pool.query("INSERT INTO workflow_runs (workflow_id, status, trigger_type, input) VALUES (?, 'running', ?, ?)",
    [wf.id, req.body && req.body.trigger_type ? String(req.body.trigger_type) : 'real-runner', JSON.stringify(req.body || {})]);
  const runId = runRow.insertId;
  const t0 = Date.now();
  let result; try { result = await runMiniN8n(def); } catch (e) { result = { ok: false, error: e.message, trace: [], warnings: [] }; }
  const duration = Date.now() - t0;
  const allOk = !!result.ok && !result.error;
  const st = allOk ? 'success' : 'failed';
  const outputJson = JSON.stringify({ summary: allOk ? '真实执行完成' : '真实执行中断', visited: result.visited, node_count: result.node_count, warnings: result.warnings, trace: result.trace });
  await pool.query('UPDATE workflow_runs SET status=?, output=?, error_message=?, duration_ms=?, finished_at=NOW() WHERE id=?',
    [st, outputJson.slice(0, 1000000), (result.warnings || []).join(' | ').slice(0, 2000) || null, duration, runId]);
  await pool.query('UPDATE workflows SET last_run=NOW(), last_run_status=? WHERE id=?', [st, wf.id]);
  res.json({ success: allOk, status: st, run_id: runId, duration_ms: duration, node_count: result.node_count, visited: result.visited, warnings: result.warnings || [], trace: result.trace, error: result.error });
}));

// ============== WORKFLOW TEMPLATES ==============
router.get('/templates', asyncRoute(async (req, res) => {
  const pool = getPool();
  const { q, category, trigger, complexity, app: appFilter, sort, limit: rawLimit, offset: rawOffset } = req.query;
  const limit = Math.min(parseInt(rawLimit || '20', 10) || 20, 100);
  const offset = parseInt(rawOffset || '0', 10) || 0;
  let sql = 'SELECT id, slug, name, description, category, trigger_type, node_count, complexity, apps, created_at FROM workflow_templates WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)'; params.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (trigger) { sql += ' AND trigger_type = ?'; params.push(trigger); }
  if (complexity) { sql += ' AND complexity = ?'; params.push(complexity); }
  if (appFilter) { sql += ' AND JSON_SEARCH(apps, "one", ?) IS NOT NULL'; params.push(appFilter); }
  sql += ' ORDER BY ' + (sort === 'name' ? 'name ASC' : sort === 'oldest' ? 'id ASC' : 'id DESC');
  sql += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const [rows] = await pool.query(sql, params);
  rows.forEach((r) => { r.apps = parseJsonColumn(r.apps) || []; });

  let countSql = 'SELECT COUNT(*) AS total FROM workflow_templates WHERE 1=1';
  const cp = [];
  if (q) { countSql += ' AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)'; cp.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  if (category) { countSql += ' AND category = ?'; cp.push(category); }
  if (trigger) { countSql += ' AND trigger_type = ?'; cp.push(trigger); }
  if (complexity) { countSql += ' AND complexity = ?'; cp.push(complexity); }
  if (appFilter) { countSql += ' AND JSON_SEARCH(apps, "one", ?) IS NOT NULL'; cp.push(appFilter); }
  const [[{ total }]] = await pool.query(countSql, cp);

  res.json({ total, offset, limit, items: rows });
}));

router.get('/templates/facets', asyncRoute(async (_req, res) => {
  const pool = getPool();
  const [categories] = await pool.query("SELECT category, COUNT(*) AS n FROM workflow_templates GROUP BY category ORDER BY n DESC");
  const [triggers] = await pool.query("SELECT trigger_type, COUNT(*) AS n FROM workflow_templates GROUP BY trigger_type ORDER BY n DESC LIMIT 30");
  const [complexities] = await pool.query("SELECT complexity, COUNT(*) AS n FROM workflow_templates GROUP BY complexity");
  res.json({ categories, triggers, complexities });
}));

router.get('/templates/:slug', asyncRoute(async (req, res) => {
  const param = req.params.slug;
  const pool = getPool();
  let [rows] = await pool.query('SELECT * FROM workflow_templates WHERE slug = ? LIMIT 1', [param]);
  if (!rows.length && /^\d+$/.test(param)) {
    [rows] = await pool.query('SELECT * FROM workflow_templates WHERE id = ? LIMIT 1', [param]);
  }
  if (!rows.length) return res.status(404).json({ error: 'template not found' });
  const r = rows[0];
  r.apps = parseJsonColumn(r.apps) || [];
  let rawJson = null;
  if (r.raw_json_gz) {
    try { rawJson = zlib.gunzipSync(r.raw_json_gz).toString('utf-8'); } catch (e) {}
  }
  delete r.raw_json_gz;
  try { r.raw = rawJson ? JSON.parse(rawJson) : null; } catch (_) { r.raw = rawJson; }
  res.json(r);
}));

router.post('/workflows/from-template/:slug', asyncRoute(async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM workflow_templates WHERE slug = ? LIMIT 1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'template not found' });
  const tpl = rows[0];
  tpl.apps = parseJsonColumn(tpl.apps) || [];
  const body = req.body || {};
  const name = (body.name && String(body.name).trim()) || tpl.name;
  const category = body.category || tpl.category;
  const trigger_condition = body.trigger_condition || tpl.trigger_type || 'manual';
  const agents = Array.isArray(body.agents) && body.agents.length ? body.agents :
    (tpl.category === 'CRM/销售' ? ['sales'] :
     tpl.category === '邮件' ? ['operations'] :
     tpl.category === 'IM/沟通' ? ['support'] :
     tpl.category === 'AI/LLM' ? ['tech'] :
     ['operations']);
  let rawJsonStr = null;
  if (tpl.raw_json_gz) { try { rawJsonStr = zlib.gunzipSync(tpl.raw_json_gz).toString('utf-8'); } catch (_) {} }
  const [r] = await pool.query(
    "INSERT INTO workflows (name, description, trigger_condition, category, status, agents, nodes, last_run_status, definition, template_source, template_id, slug, is_template) VALUES (?,?,?,?,1,?,?,'never',?,?,?,?,0)",
    [name, tpl.description, trigger_condition, category, JSON.stringify(agents), tpl.node_count, rawJsonStr, 'n8n', tpl.slug, tpl.slug],
  );
  res.json({ id: r.insertId, success: true, workflow: { name, category, trigger_condition, agents, nodes: tpl.node_count, from_template: tpl.slug } });
}));

module.exports = router;

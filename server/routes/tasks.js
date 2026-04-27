// routes/tasks.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('../middleware/auth');
const { enqueueTask, getJobStatus, cancelJob } = require('../queues/agentQueue');
const db = require('../config/database');
const { sanitize } = require('../utils/sanitizer');
const logger = require('../utils/logger');

router.post('/', verifyToken, async (req, res) => {
  try {
    const { templateId, inputs = {}, model } = req.body;
    const userId = req.user.id;
    const userPlan = req.user.subscription_plan || 'free';

    if (!templateId) {
      return res.status(400).json({ error: '缺少必填参数: templateId' });
    }

    const cleanInputs = {};
    for (const [key, val] of Object.entries(inputs)) {
      cleanInputs[key] = sanitize(String(val));
    }

    const [[template]] = await db.query(
      'SELECT * FROM agent_templates WHERE id = ? AND (is_public = 1 OR creator_id = ?)',
      [templateId, userId]
    );
    if (!template) return res.status(404).json({ error: '模板不存在或无权访问' });

    const selectedModel = model || template.model_recommended || 'qwen-plus';
    const taskId = `task_${Date.now()}_${uuidv4().substr(0, 8)}`;
    
    await db.query(`
      INSERT INTO agent_tasks (id, user_id, template_id, model_used, inputs, status, token_estimated)
      VALUES (?, ?, ?, ?, ?, 'queued', ?)
    `, [taskId, userId, templateId, selectedModel, JSON.stringify(cleanInputs), template.token_estimate]);

    await enqueueTask(
      { taskId, userId, templateId, inputs: cleanInputs, model: selectedModel },
      userPlan
    );

    db.query('UPDATE agent_templates SET usage_count = usage_count + 1 WHERE id = ?', [templateId]);

    res.status(201).json({
      taskId,
      status: 'queued',
      estimatedTokenCost: template.token_estimate,
      model: selectedModel
    });

  } catch (error) {
    logger.error('创建任务失败', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, status } = req.query;

  let where = 'WHERE t.user_id = ?';
  const params = [userId];

  if (status) { where += ' AND t.status = ?'; params.push(status); }

  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const [tasks] = await db.query(`
    SELECT t.*, a.name AS template_name, a.category
    FROM agent_tasks t
    LEFT JOIN agent_templates a ON t.template_id = a.id
    ${where}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `, params);

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM agent_tasks t ${where}`,
    params.slice(0, -2)
  );

  res.json({ tasks, total, page: parseInt(page), limit: parseInt(limit) });
});

router.get('/:taskId', verifyToken, async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.id;

  const [[task]] = await db.query(`
    SELECT t.*, a.name AS template_name
    FROM agent_tasks t
    LEFT JOIN agent_templates a ON t.template_id = a.id
    WHERE t.id = ? AND t.user_id = ?
  `, [taskId, userId]);

  if (!task) return res.status(404).json({ error: '任务不存在' });

  if (task.status === 'queued' || task.status === 'running') {
    const jobStatus = await getJobStatus(taskId);
    task.queueInfo = jobStatus;
  }

  res.json(task);
});

router.delete('/:taskId', verifyToken, async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.id;

  const [[task]] = await db.query(
    'SELECT * FROM agent_tasks WHERE id = ? AND user_id = ?',
    [taskId, userId]
  );

  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (!['queued', 'running'].includes(task.status)) {
    return res.status(400).json({ error: '该任务无法取消' });
  }

  await cancelJob(taskId);
  await db.query("UPDATE agent_tasks SET status = 'cancelled' WHERE id = ?", [taskId]);

  res.json({ success: true, message: '任务已取消' });
});

module.exports = router;

// routes/legacy.js - 兼容旧前端的接口
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/agents - 获取智能体列表
router.get('/agents', async (req, res) => {
  try {
    const [agents] = await db.query(`
      SELECT 
        id, name, role, description, avatar, status, 
        model, system_prompt, capabilities, tools, 
        today_tasks, created_at, updated_at
      FROM agents
      ORDER BY created_at DESC
    `);
    res.json(agents);
  } catch (error) {
    console.error('获取智能体失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/agents/:id - 获取单个智能体
router.get('/agents/:id', async (req, res) => {
  try {
    const [[agent]] = await db.query('SELECT * FROM agents WHERE id = ?', [req.params.id]);
    if (!agent) return res.status(404).json({ error: '智能体不存在' });
    res.json(agent);
  } catch (error) {
    console.error('获取智能体失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /api/agents - 创建智能体
router.post('/agents', async (req, res) => {
  try {
    const { id, name, role, description, avatar, model, system_prompt, capabilities, tools } = req.body;
    
    await db.query(`
      INSERT INTO agents (id, name, role, description, avatar, model, system_prompt, capabilities, tools, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'online')
    `, [
      id || `agent_${Date.now()}`,
      name,
      role,
      description || '',
      avatar || '',
      model || 'qwen-plus',
      system_prompt || '',
      JSON.stringify(capabilities || []),
      JSON.stringify(tools || [])
    ]);
    
    res.status(201).json({ success: true, id });
  } catch (error) {
    console.error('创建智能体失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// PUT /api/agents/:id - 更新智能体
router.put('/agents/:id', async (req, res) => {
  try {
    const { name, role, description, avatar, status, model, system_prompt, capabilities, tools } = req.body;
    
    const updates = [];
    const values = [];
    
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (role !== undefined) { updates.push('role = ?'); values.push(role); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (model !== undefined) { updates.push('model = ?'); values.push(model); }
    if (system_prompt !== undefined) { updates.push('system_prompt = ?'); values.push(system_prompt); }
    if (capabilities !== undefined) { updates.push('capabilities = ?'); values.push(JSON.stringify(capabilities)); }
    if (tools !== undefined) { updates.push('tools = ?'); values.push(JSON.stringify(tools)); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }
    
    values.push(req.params.id);
    await db.query(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`, values);
    
    res.json({ success: true });
  } catch (error) {
    console.error('更新智能体失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// DELETE /api/agents/:id - 删除智能体
router.delete('/agents/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM agents WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('删除智能体失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/approvals - 获取审批列表
router.get('/approvals', async (req, res) => {
  try {
    const [approvals] = await db.query(`
      SELECT 
        id, title, description, submitter, priority, 
        status, reason, created_at, updated_at
      FROM approvals
      ORDER BY created_at DESC
    `);
    res.json(approvals);
  } catch (error) {
    console.error('获取审批失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /api/approvals - 创建审批
router.post('/approvals', async (req, res) => {
  try {
    const { title, description, submitter, priority } = req.body;
    
    const [result] = await db.query(`
      INSERT INTO approvals (title, description, submitter, priority, status)
      VALUES (?, ?, ?, ?, 'pending')
    `, [title, description, submitter, priority || 'medium']);
    
    res.status(201).json({ success: true, id: result.insertId });
  } catch (error) {
    console.error('创建审批失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// PUT /api/approvals/:id - 更新审批状态
router.put('/approvals/:id', async (req, res) => {
  try {
    const { status, reason } = req.body;
    
    await db.query(
      'UPDATE approvals SET status = ?, reason = ? WHERE id = ?',
      [status, reason || null, req.params.id]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('更新审批失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/dashboard - 仪表盘数据
router.get('/dashboard', async (req, res) => {
  try {
    const [[agentCount]] = await db.query('SELECT COUNT(*) as count FROM agents');
    const [[taskCount]] = await db.query('SELECT COUNT(*) as count FROM tasks');
    const [[approvalCount]] = await db.query('SELECT COUNT(*) as count FROM approvals WHERE status = "pending"');
    const [[userCount]] = await db.query('SELECT COUNT(*) as count FROM auth_users');
    
    res.json({
      agents: agentCount.count,
      tasks: taskCount.count,
      pendingApprovals: approvalCount.count,
      users: userCount.count
    });
  } catch (error) {
    console.error('获取仪表盘数据失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;

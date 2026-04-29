// routes/workflows.js - 工作流相关接口
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/workflows - 获取工作流列表
router.get('/', async (req, res) => {
  try {
    const [workflows] = await db.query(`
      SELECT * FROM workflows
      ORDER BY created_at DESC
    `);
    
    // 解析 JSON 字段
    const parsedWorkflows = workflows.map(workflow => ({
      ...workflow,
      agents: typeof workflow.agents === 'string' ? JSON.parse(workflow.agents || '[]') : workflow.agents || [],
      nodes: typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes || '[]') : workflow.nodes || [],
      definition: typeof workflow.definition === 'string' ? JSON.parse(workflow.definition || 'null') : workflow.definition,
      node_types: typeof workflow.node_types === 'string' ? JSON.parse(workflow.node_types || '[]') : workflow.node_types || []
    }));
    
    res.json(parsedWorkflows);
  } catch (error) {
    console.error('获取工作流失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/workflows/:id - 获取单个工作流
router.get('/:id', async (req, res) => {
  try {
    const [[workflow]] = await db.query(
      'SELECT * FROM workflows WHERE id = ?',
      [req.params.id]
    );
    
    if (!workflow) {
      return res.status(404).json({ error: '工作流不存在' });
    }
    
    // 解析 JSON 字段
    const parsedWorkflow = {
      ...workflow,
      agents: typeof workflow.agents === 'string' ? JSON.parse(workflow.agents || '[]') : workflow.agents || [],
      nodes: typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes || '[]') : workflow.nodes || [],
      definition: typeof workflow.definition === 'string' ? JSON.parse(workflow.definition || 'null') : workflow.definition,
      node_types: typeof workflow.node_types === 'string' ? JSON.parse(workflow.node_types || '[]') : workflow.node_types || []
    };
    
    res.json(parsedWorkflow);
  } catch (error) {
    console.error('获取工作流失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /api/workflows - 创建工作流
router.post('/', async (req, res) => {
  try {
    const { name, description, nodes, edges, status } = req.body;
    
    const [result] = await db.query(`
      INSERT INTO workflows (name, description, nodes, edges, status)
      VALUES (?, ?, ?, ?, ?)
    `, [
      name,
      description || '',
      JSON.stringify(nodes || []),
      JSON.stringify(edges || []),
      status || 'draft'
    ]);
    
    res.status(201).json({ success: true, id: result.insertId });
  } catch (error) {
    console.error('创建工作流失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// PUT /api/workflows/:id - 更新工作流
router.put('/:id', async (req, res) => {
  try {
    const { name, description, nodes, edges, status } = req.body;
    
    const updates = [];
    const values = [];
    
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (nodes !== undefined) { updates.push('nodes = ?'); values.push(JSON.stringify(nodes)); }
    if (edges !== undefined) { updates.push('edges = ?'); values.push(JSON.stringify(edges)); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }
    
    values.push(req.params.id);
    await db.query(`UPDATE workflows SET ${updates.join(', ')} WHERE id = ?`, values);
    
    res.json({ success: true });
  } catch (error) {
    console.error('更新工作流失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// DELETE /api/workflows/:id - 删除工作流
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM workflows WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('删除工作流失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;

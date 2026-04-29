// routes/knowledge.js - 知识库相关接口
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/knowledge - 获取知识库文档列表
router.get('/', async (req, res) => {
  try {
    const [docs] = await db.query(`
      SELECT * FROM knowledge_docs
      ORDER BY created_at DESC
    `);
    res.json(docs);
  } catch (error) {
    console.error('获取知识库失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/knowledge/:id - 获取单个文档
router.get('/:id', async (req, res) => {
  try {
    const [[doc]] = await db.query(
      'SELECT * FROM knowledge_docs WHERE id = ?',
      [req.params.id]
    );
    
    if (!doc) {
      return res.status(404).json({ error: '文档不存在' });
    }
    
    res.json(doc);
  } catch (error) {
    console.error('获取文档失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /api/knowledge - 创建文档
router.post('/', async (req, res) => {
  try {
    const { title, content, category, tags } = req.body;
    
    const [result] = await db.query(`
      INSERT INTO knowledge_docs (title, content, category, tags)
      VALUES (?, ?, ?, ?)
    `, [
      title,
      content || '',
      category || 'general',
      JSON.stringify(tags || [])
    ]);
    
    res.status(201).json({ success: true, id: result.insertId });
  } catch (error) {
    console.error('创建文档失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// PUT /api/knowledge/:id - 更新文档
router.put('/:id', async (req, res) => {
  try {
    const { title, content, category, tags } = req.body;
    
    const updates = [];
    const values = [];
    
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (content !== undefined) { updates.push('content = ?'); values.push(content); }
    if (category !== undefined) { updates.push('category = ?'); values.push(category); }
    if (tags !== undefined) { updates.push('tags = ?'); values.push(JSON.stringify(tags)); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }
    
    values.push(req.params.id);
    await db.query(`UPDATE knowledge_docs SET ${updates.join(', ')} WHERE id = ?`, values);
    
    res.json({ success: true });
  } catch (error) {
    console.error('更新文档失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// DELETE /api/knowledge/:id - 删除文档
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM knowledge_docs WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('删除文档失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;

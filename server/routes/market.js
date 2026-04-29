// routes/market.js - 市场相关接口
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/market/agents - 获取市场智能体
router.get('/agents', async (req, res) => {
  try {
    const { category, search } = req.query;
    
    let query = 'SELECT * FROM agent_market WHERE 1=1';
    const params = [];
    
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    
    if (search) {
      query += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY downloads DESC, created_at DESC';
    
    const [agents] = await db.query(query, params);
    res.json(agents);
  } catch (error) {
    console.error('获取市场智能体失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/market/models - 获取模型市场
router.get('/models', async (req, res) => {
  try {
    const [models] = await db.query(`
      SELECT * FROM model_market 
      ORDER BY popularity DESC, created_at DESC
    `);
    res.json(models);
  } catch (error) {
    console.error('获取模型市场失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;

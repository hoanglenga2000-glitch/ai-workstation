// routes/token.js - Token 相关接口
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/token/balance - 获取 Token 余额
router.get('/balance', async (req, res) => {
  try {
    // 假设用户 ID 为 1（后续可以从认证中间件获取）
    const userId = 1;
    
    const [[balance]] = await db.query(
      'SELECT * FROM user_balance WHERE user_id = ?',
      [userId]
    );
    
    if (!balance) {
      // 如果没有记录，创建默认余额
      await db.query(
        'INSERT INTO user_balance (user_id, balance, total_recharged) VALUES (?, 0, 0)',
        [userId]
      );
      return res.json({ user_id: userId, balance: 0, total_recharged: 0 });
    }
    
    res.json(balance);
  } catch (error) {
    console.error('获取 Token 余额失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/token/stats - 获取 Token 统计
router.get('/stats', async (req, res) => {
  try {
    const userId = 1;
    
    const [[stats]] = await db.query(`
      SELECT 
        COUNT(*) as total_calls,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost
      FROM token_usage
      WHERE user_id = ?
    `, [userId]);
    
    res.json({
      total_calls: stats.total_calls || 0,
      total_tokens: stats.total_tokens || 0,
      total_cost: stats.total_cost || 0
    });
  } catch (error) {
    console.error('获取 Token 统计失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/token/usage - 获取 Token 使用记录
router.get('/usage', async (req, res) => {
  try {
    const userId = 1;
    const { limit = 50, offset = 0 } = req.query;
    
    const [usage] = await db.query(`
      SELECT * FROM token_usage
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, parseInt(limit), parseInt(offset)]);
    
    res.json(usage);
  } catch (error) {
    console.error('获取 Token 使用记录失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;

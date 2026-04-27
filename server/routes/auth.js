// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { signTokens, verifyToken } = require('../middleware/auth');
const db = require('../config/database');
const logger = require('../utils/logger');

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const [[existing]] = await db.query('SELECT id FROM auth_users WHERE username = ?', [username]);
    if (existing) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO auth_users (username, password_hash, role, status) VALUES (?, ?, ?, ?)',
      [username, passwordHash, 'user', 'active']
    );

    const userId = result.insertId;

    await db.query('INSERT INTO token_wallets (id, user_id, balance) VALUES (UUID(), ?, 10000)', [userId]);

    const tokens = signTokens({ id: userId, username, role: 'user' });

    logger.info('用户注册成功', { userId, username });

    res.status(201).json({
      message: '注册成功',
      user: { id: userId, username, role: 'user' },
      ...tokens
    });

  } catch (error) {
    logger.error('注册失败', { error: error.message });
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const [[user]] = await db.query(
      'SELECT * FROM auth_users WHERE username = ? AND status = ?',
      [username, 'active']
    );

    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    await db.query(
      'UPDATE auth_users SET last_login_at = NOW(), login_count = login_count + 1 WHERE id = ?',
      [user.id]
    );

    const tokens = signTokens({
      id: user.id,
      username: user.username,
      role: user.role,
      subscription_plan: user.subscription_plan
    });

    logger.info('用户登录成功', { userId: user.id, username: user.username });

    res.json({
      message: '登录成功',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        subscription_plan: user.subscription_plan
      },
      ...tokens
    });

  } catch (error) {
    logger.error('登录失败', { error: error.message });
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/me', verifyToken, async (req, res) => {
  try {
    const [[user]] = await db.query(
      'SELECT id, username, role, subscription_plan, last_login_at, total_tasks_count FROM auth_users WHERE id = ?',
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const [[wallet]] = await db.query('SELECT balance FROM token_wallets WHERE user_id = ?', [user.id]);

    res.json({
      ...user,
      tokenBalance: wallet?.balance || 0
    });

  } catch (error) {
    logger.error('获取用户信息失败', { error: error.message });
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;

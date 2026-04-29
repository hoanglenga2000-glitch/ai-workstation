'use strict';
const express = require('express');
const config = require('../config/index');
const { getPool } = require('../config/database');
const { asyncRoute } = require('../middleware/errorHandler');
const {
  hashPassword, verifyPassword, issueCookie, verifySession, issueJwt, verifyJwt, blacklistJwt,
  validUsername, validPassword, touchLogin, loginRateLimit,
} = require('../middleware/auth');

const router = express.Router();

router.post('/auth/register', asyncRoute(async (req, res) => {
  if (!config.ALLOW_REGISTRATION) return res.status(403).json({ error: '注册已关闭' });
  const { username, password } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: '用户名 3-32 位，仅字母数字下划线' });
  if (!validPassword(password)) return res.status(400).json({ error: '密码至少 6 位' });
  const pool = getPool();
  const [dup] = await pool.query('SELECT id FROM auth_users WHERE username = ?', [username]);
  if (dup.length) return res.status(409).json({ error: '用户名已存在' });
  const [r] = await pool.query("INSERT INTO auth_users (username, password_hash, role, status) VALUES (?, ?, 'user', 'active')", [username, hashPassword(password)]);
  const userId = r.insertId;
  await pool.query('INSERT INTO user_balance (user_id, balance, total_recharged, total_consumed) VALUES (?, 10.00, 0, 0)', [userId]);
  const user = { id: userId, username, role: 'user' };
  const token = issueCookie(res, user);
  const resp = { success: true, user, token };
  if (config.FEATURE_JWT_AUTH) {
    const jwtTokens = issueJwt(user);
    resp.accessToken = jwtTokens.accessToken;
    resp.refreshToken = jwtTokens.refreshToken;
  }
  res.json(resp);
}));

router.post('/auth/login', asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  if (!loginRateLimit(ip)) return res.status(429).json({ error: '登录尝试过多，请稍后再试' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  const pool = getPool();
  const [rows] = await pool.query("SELECT id, username, password_hash, role, status FROM auth_users WHERE username = ? LIMIT 1", [username]);
  if (!rows.length) return res.status(401).json({ error: '用户名或密码错误' });
  const user = rows[0];
  if (user.status === 'disabled') return res.status(403).json({ error: '账号已被禁用' });
  if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: '用户名或密码错误' });
  touchLogin(user.id);
  const token = issueCookie(res, user);
  const resp = { success: true, user: { id: user.id, username: user.username, role: user.role }, token };
  if (config.FEATURE_JWT_AUTH) {
    const jwtTokens = issueJwt(user);
    resp.accessToken = jwtTokens.accessToken;
    resp.refreshToken = jwtTokens.refreshToken;
  }
  res.json(resp);
}));

router.post('/auth/refresh', asyncRoute(async (req, res) => {
  if (!config.FEATURE_JWT_AUTH) return res.status(404).json({ error: 'JWT auth not enabled' });
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  const decoded = verifyJwt(refreshToken);
  if (!decoded || decoded.type !== 'refresh') return res.status(401).json({ error: 'Invalid refresh token' });
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, username, role, status FROM auth_users WHERE id = ?', [decoded.uid]);
  if (!rows.length || rows[0].status === 'disabled') return res.status(401).json({ error: 'User not found or disabled' });
  const user = rows[0];
  const jwtTokens = issueJwt({ id: user.id, username: user.username, role: user.role });
  res.json({ accessToken: jwtTokens.accessToken, refreshToken: jwtTokens.refreshToken });
}));

router.get('/auth/me', asyncRoute(async (req, res) => {
  // Try JWT first
  if (config.FEATURE_JWT_AUTH) {
    const authHeader = req.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const decoded = verifyJwt(authHeader.slice(7));
      if (decoded && decoded.uid) {
        return res.json({ authenticated: true, user: { id: decoded.uid, username: decoded.u, role: decoded.role }, exp: decoded.exp * 1000, allow_registration: config.ALLOW_REGISTRATION });
      }
    }
  }
  // Fall back to cookie
  const s = verifySession(req.cookies && req.cookies[config.AUTH_COOKIE]);
  if (!s) return res.status(401).json({ error: '未登录' });
  res.json({ authenticated: true, user: { id: s.uid, username: s.u, role: s.role }, exp: s.exp, allow_registration: config.ALLOW_REGISTRATION });
}));

router.get('/auth/settings', asyncRoute(async (req, res) => {
  const s = verifySession(req.cookies && req.cookies[config.AUTH_COOKIE]);
  if (!s) return res.status(401).json({ error: '未登录' });
  res.json({ id: s.uid, username: s.u, role: s.role, allow_registration: config.ALLOW_REGISTRATION });
}));

router.post('/auth/logout', asyncRoute(async (req, res) => {
  // Blacklist JWT if present
  if (config.FEATURE_JWT_AUTH) {
    const authHeader = req.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      await blacklistJwt(token, 7200);
    }
  }
  res.setHeader('Set-Cookie', config.AUTH_COOKIE + '=; Max-Age=0; Path=/; SameSite=Lax; Secure');
  res.json({ success: true });
}));

router.get('/auth/users', asyncRoute(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    const s = verifySession(req.cookies && req.cookies[config.AUTH_COOKIE]);
    if (!s || s.role !== 'admin') return res.status(403).json({ error: '仅管理员可查看' });
  }
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, username, role, status, last_login_at, login_count, created_at FROM auth_users ORDER BY id');
  res.json(rows);
}));

router.put('/auth/users/:id', asyncRoute(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    const s = verifySession(req.cookies && req.cookies[config.AUTH_COOKIE]);
    if (!s || s.role !== 'admin') return res.status(403).json({ error: '仅管理员可修改' });
  }
  const { role, status, password } = req.body || {};
  if (role && ['admin', 'user'].indexOf(role) < 0) return res.status(400).json({ error: 'role invalid' });
  if (status && ['active', 'disabled'].indexOf(status) < 0) return res.status(400).json({ error: 'status invalid' });
  const sets = []; const params = [];
  if (role) { sets.push('role = ?'); params.push(role); }
  if (status) { sets.push('status = ?'); params.push(status); }
  if (password) { if (!validPassword(password)) return res.status(400).json({ error: '密码至少 6 位' }); sets.push('password_hash = ?'); params.push(hashPassword(password)); }
  if (!sets.length) return res.json({ success: true });
  params.push(req.params.id);
  const pool = getPool();
  await pool.query('UPDATE auth_users SET ' + sets.join(', ') + ' WHERE id = ?', params);
  res.json({ success: true });
}));

module.exports = router;

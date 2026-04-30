'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config/index');
const { getPool } = require('../config/database');
const { getRedis } = require('../config/redis');
const { log } = require('../utils/log');

// JWT constants
const JWT_ACCESS_EXPIRY = '2h';
const JWT_REFRESH_EXPIRY = '7d';
const JWT_BLACKLIST_PREFIX = 'jwt:bl:';

function issueJwt(user) {
  const payload = { uid: user.id, u: user.username, role: user.role };
  const accessToken = jwt.sign(payload, config.AUTH_SECRET, { expiresIn: JWT_ACCESS_EXPIRY });
  const refreshToken = jwt.sign({ ...payload, type: 'refresh' }, config.AUTH_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });
  return { accessToken, refreshToken };
}

function verifyJwt(token) {
  try {
    return jwt.verify(token, config.AUTH_SECRET);
  } catch (e) {
    return null;
  }
}

async function isJwtBlacklisted(token) {
  if (!config.FEATURE_JWT_AUTH) return false;
  try {
    const redis = getRedis();
    const result = await redis.get(JWT_BLACKLIST_PREFIX + token);
    return result !== null;
  } catch (e) {
    return false;
  }
}

async function blacklistJwt(token, expiresInSec) {
  if (!config.FEATURE_JWT_AUTH) return;
  try {
    const redis = getRedis();
    await redis.set(JWT_BLACKLIST_PREFIX + token, '1', 'EX', expiresInSec || 7200);
  } catch (e) {
    log('warn', 'jwt_blacklist_failed', { error: e.message });
  }
}

const AUTH_PUBLIC_PATHS = [
  /^\/healthz$/,
  /^\/(api\/)?auth\/(login|register)$/,
  /^\/(api\/)?auth\/refresh$/,
  /^\/(api\/)?payment\/plans$/,
];

const AUTH_PUBLIC_GET_ONLY = [
  /^\/(api\/)?auth\/me$/,
  /^\/(api\/)?market\/(agents|models)$/,
  /^\/(api\/)?market\/agents\/\d+$/,
  /^\/(api\/)?market\/models\/[\w\-]+$/,
  /^\/(api\/)?scenarios/,

];

function isPublic(req) {
  const path = typeof req === 'string' ? req : req.path;
  if (AUTH_PUBLIC_PATHS.some((p) => p.test(path))) return true;
  const method = typeof req === 'string' ? 'GET' : req.method;
  if (method === 'GET' && AUTH_PUBLIC_GET_ONLY.some((p) => p.test(path))) return true;
  return false;
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$N=16384$r=8$p=1$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    const derived = crypto.scryptSync(String(plain), salt, expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(derived, expected);
  } catch (e) { return false; }
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(o) {
  return b64url(Buffer.from(JSON.stringify(o), 'utf-8'));
}
function fromB64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4), 'base64');
}

function signSession(payload) {
  const p = b64urlJson(payload);
  const mac = b64url(crypto.createHmac('sha256', config.AUTH_SECRET).update(p).digest());
  return p + '.' + mac;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [p, mac] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', config.AUTH_SECRET).update(p).digest());
  if (mac !== expected) return null;
  try {
    const obj = JSON.parse(fromB64url(p).toString('utf-8'));
    if (!obj.exp || obj.exp < Date.now()) return null;
    return obj;
  } catch (_) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((kv) => {
    const i = kv.indexOf('=');
    if (i < 0) return;
    const k = kv.slice(0, i).trim();
    if (!k) return;
    out[k] = decodeURIComponent(kv.slice(i + 1).trim());
  });
  return out;
}

function issueCookie(res, user) {
  const token = signSession({
    u: user.username,
    uid: user.id,
    role: user.role,
    iat: Date.now(),
    exp: Date.now() + config.AUTH_MAX_AGE,
  });
  res.setHeader(
    'Set-Cookie',
    config.AUTH_COOKIE + '=' + encodeURIComponent(token) +
    '; Max-Age=' + Math.floor(config.AUTH_MAX_AGE / 1000) +
    '; Path=/; SameSite=Lax; Secure'
  );
  return token;
}

function validUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_.\-]{3,32}$/.test(u);
}

function validPassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 200;
}

function touchLogin(uid) {
  getPool().query('UPDATE auth_users SET last_login_at=NOW(), login_count=login_count+1 WHERE id=?', [uid]).catch(() => {});
}

function tokenAuth(req) {
  const session = verifySession(req.cookies && req.cookies[config.AUTH_COOKIE]);
  if (session) {
    req.user = { id: session.uid, username: session.u, role: session.role };
  }
  return !!session;
}

// Redis-backed login rate limiter (cluster-safe)
async function loginRateLimit(ip) {
  try {
    const redis = getRedis();
    const key = 'login:rl:' + ip;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);
    return count <= 10;
  } catch (e) {
    log('warn', 'login_rl_redis_failed', { ip, error: e.message });
    return true;
  }
}

// Cookie parsing middleware
function cookieParser(req, _res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  next();
}

// Auth enforcement middleware (supports both Cookie and JWT Bearer)
function authGate(req, res, next) {
  if (isPublic(req)) return next();

  // /workflows browser navigation: skip auth (SPA handles it)
  if (req.path === '/workflows' || req.path === '/workflows/') return next();
  if (req.path.startsWith('/workflows/')) {
    const acceptHeader = req.get('Accept') || '';
    const htmlIndex = acceptHeader.indexOf('text/html');
    const jsonIndex = acceptHeader.indexOf('application/json');
    if (htmlIndex >= 0 && (jsonIndex < 0 || htmlIndex < jsonIndex)) return next();
  }

  // Try JWT Bearer token first (if feature enabled)
  if (config.FEATURE_JWT_AUTH) {
    const authHeader = req.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = verifyJwt(token);
      if (decoded && decoded.uid) {
        req.user = { id: decoded.uid, username: decoded.u, role: decoded.role };
        req._authMethod = 'jwt';
        return next();
      }
    }
  }

  // Fall back to HMAC Cookie
  const s = verifySession(req.cookies && req.cookies[config.AUTH_COOKIE]);
  if (!s) return res.status(401).json({ error: '未登录或会话已过期' });
  req.user = { id: s.uid, username: s.u, role: s.role };
  req._authMethod = 'cookie';
  next();
}

// Admin seed on startup
async function seedAdmin() {
  const pool = getPool();
  const [r] = await pool.query('SELECT COUNT(*) AS n FROM auth_users');
  if (r[0].n === 0 && config.AUTH_PASSWORD) {
    const h = hashPassword(config.AUTH_PASSWORD);
    await pool.query(
      "INSERT INTO auth_users (username, password_hash, role, status) VALUES ('admin', ?, 'admin', 'active')",
      [h]
    );
    log('info', 'admin_seeded');
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  issueCookie,
  issueJwt,
  verifyJwt,
  isJwtBlacklisted,
  blacklistJwt,
  validUsername,
  validPassword,
  touchLogin,
  tokenAuth,
  loginRateLimit,
  cookieParser,
  authGate,
  seedAdmin,
  isPublic,
};

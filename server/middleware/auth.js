// middleware/auth.js
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || process.env.AUTH_SECRET || 'default-secret';
const REFRESH_SECRET = process.env.REFRESH_SECRET || JWT_SECRET + '-refresh';

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

  if (!token) return res.status(401).json({ error: '未授权，缺少 Token' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token 已过期' : 'Token 无效';
    return res.status(403).json({ error: msg, code: err.name });
  }
};

const optionalAuth = (req, res, next) => {
  const token = req.headers.authorization?.slice(7);
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  }
  next();
};

const signTokens = (user) => ({
  accessToken: jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: '24h' }
  ),
  refreshToken: jwt.sign(
    { id: user.id },
    REFRESH_SECRET,
    { expiresIn: '30d' }
  )
});

const verifyTokenDirect = (token) => jwt.verify(token, JWT_SECRET);

module.exports = { verifyToken, optionalAuth, signTokens, verifyTokenDirect };

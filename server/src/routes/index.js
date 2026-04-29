'use strict';
const express = require('express');
const { log } = require('../utils/log');

const router = express.Router();

// Health check (before auth) — deep check with MySQL + Redis
router.get('/healthz', async (_req, res) => {
  const checks = {};
  try {
    const { getPool } = require('../config/database');
    await getPool().query('SELECT 1');
    checks.mysql = 'ok';
  } catch (e) {
    checks.mysql = 'error: ' + e.message;
  }
  try {
    const { getRedis } = require('../config/redis');
    await getRedis().ping();
    checks.redis = 'ok';
  } catch (e) {
    checks.redis = 'error: ' + e.message;
  }
  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    checks,
    ts: Date.now(),
  });
});

// Mount all route modules
router.use(require('./auth.routes'));
router.use(require('./ai.routes'));
router.use(require('./market.routes'));
router.use(require('./token.routes'));
router.use(require('./payment.routes'));
router.use(require('./agent.routes'));
router.use(require('./task.routes'));
router.use(require('./workflow.routes'));
router.use(require('./approval.routes'));
router.use(require('./knowledge.routes'));
router.use(require('./settings.routes'));
router.use(require('./report.routes'));
router.use(require('./alias.routes'));

// /api prefix strip-and-redispatch (must be after all explicit routes)
router.use('/api', (req, res, next) => {
  if (req._apiRedirected) return next();
  req._apiRedirected = true;
  const stripped = req.url;
  req.url = stripped;
  req.originalUrl = stripped;
  router.handle(req, res, next);
});

module.exports = router;

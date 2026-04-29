'use strict';
const config = require('../config/index');
const { getRedis } = require('../config/redis');
const { log } = require('../utils/log');

let limiter = null;
let fallbackMap = new Map();

async function initRateLimiter() {
  if (!config.FEATURE_REDIS_RL) {
    log('info', 'rate_limiter_memory', { reason: 'FEATURE_REDIS_RL=false' });
    return;
  }

  try {
    const { RateLimiterRedis } = require('rate-limiter-flexible');
    const redis = getRedis();
    limiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:api',
      points: 60,
      duration: 60,
      blockDuration: 0,
    });
    log('info', 'rate_limiter_redis_ready');
  } catch (e) {
    log('warn', 'rate_limiter_fallback_memory', { error: e.message });
    limiter = null;
  }
}

function memoryRateLimit(key, limit, windowMs) {
  const now = Date.now();
  let rec = fallbackMap.get(key);
  if (!rec || now - rec.start > windowMs) {
    fallbackMap.set(key, { start: now, count: 1 });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count++;
  return true;
}

async function rateLimitMiddleware(req, res, next) {
  const key = req.ip || req.connection.remoteAddress || 'unknown';

  if (limiter) {
    try {
      await limiter.consume(key);
      return next();
    } catch (rejRes) {
      if (rejRes && rejRes.msBeforeNext !== undefined) {
        res.set('Retry-After', String(Math.ceil(rejRes.msBeforeNext / 1000)));
        return res.status(429).json({ error: 'Too many requests' });
      }
      // Redis error — fall through to memory
    }
  }

  // Memory fallback
  if (!memoryRateLimit(key, 60, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
}

module.exports = { initRateLimiter, rateLimitMiddleware };

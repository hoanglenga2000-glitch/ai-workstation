// config/redis.js
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: 0,
  retryStrategy: (times) => {
    if (times > 10) return null;
    return Math.min(times * 200, 5000);
  },
  lazyConnect: false
});

redis.on('connect', () => console.log('✓ Redis 已连接'));
redis.on('error', (err) => console.error('Redis 错误:', err.message));

module.exports = redis;

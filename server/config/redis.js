// config/redis.js - Redis 连接配置
const Redis = require('ioredis');
const logger = require('../utils/logger');

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 0,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false
};

// 创建 Redis 客户端
const redis = new Redis(redisConfig);

redis.on('connect', () => {
  logger.info('✓ Redis 连接成功', { host: redisConfig.host, port: redisConfig.port });
});

redis.on('error', (err) => {
  logger.error('✗ Redis 连接错误', { error: err.message });
});

redis.on('close', () => {
  logger.warn('⚠ Redis 连接已关闭');
});

module.exports = redis;

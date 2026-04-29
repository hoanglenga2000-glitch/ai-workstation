// cache/tokenCache.js - Token 余额缓存
const redis = require('../config/redis');
const logger = require('../utils/logger');

const CACHE_PREFIX = 'token:balance:';
const CACHE_TTL = 300; // 5分钟

class TokenCache {
  /**
   * 获取用户 Token 余额（优先从缓存）
   */
  async getBalance(userId) {
    try {
      const key = CACHE_PREFIX + userId;
      const cached = await redis.get(key);
      
      if (cached !== null) {
        logger.debug('Token余额缓存命中', { userId });
        return parseInt(cached);
      }
      
      return null; // 缓存未命中，需要查数据库
    } catch (error) {
      logger.error('获取Token缓存失败', { userId, error: error.message });
      return null;
    }
  }

  /**
   * 设置用户 Token 余额缓存
   */
  async setBalance(userId, balance) {
    try {
      const key = CACHE_PREFIX + userId;
      await redis.setex(key, CACHE_TTL, balance);
      logger.debug('Token余额已缓存', { userId, balance });
    } catch (error) {
      logger.error('设置Token缓存失败', { userId, error: error.message });
    }
  }

  /**
   * 清除用户 Token 余额缓存
   */
  async clearBalance(userId) {
    try {
      const key = CACHE_PREFIX + userId;
      await redis.del(key);
      logger.debug('Token余额缓存已清除', { userId });
    } catch (error) {
      logger.error('清除Token缓存失败', { userId, error: error.message });
    }
  }

  /**
   * 原子性扣减 Token（使用 Redis DECRBY）
   */
  async deductTokens(userId, amount) {
    try {
      const key = CACHE_PREFIX + userId;
      const newBalance = await redis.decrby(key, amount);
      
      if (newBalance < 0) {
        // 余额不足，回滚
        await redis.incrby(key, amount);
        return { success: false, error: '余额不足' };
      }
      
      return { success: true, newBalance };
    } catch (error) {
      logger.error('扣减Token失败', { userId, amount, error: error.message });
      return { success: false, error: error.message };
    }
  }
}

module.exports = new TokenCache();

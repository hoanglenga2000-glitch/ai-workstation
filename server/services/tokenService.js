// services/tokenService.js - Token 计费核心服务
const db = require('../config/database');
const tokenCache = require('../cache/tokenCache');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class TokenService {
  /**
   * 预检查并预扣 Token（任务开始前）
   */
  async preCheck(userId, templateId, model = 'qwen-max') {
    try {
      // 1. 获取用户余额（优先从缓存）
      let balance = await tokenCache.getBalance(userId);
      
      if (balance === null) {
        // 缓存未命中，查数据库
        const [[wallet]] = await db.query(
          'SELECT balance FROM token_wallets WHERE user_id = ?',
          [userId]
        );
        
        if (!wallet) {
          // 用户钱包不存在，创建一个
          await db.query(
            'INSERT INTO token_wallets (user_id, balance) VALUES (?, 0)',
            [userId]
          );
          balance = 0;
        } else {
          balance = wallet.balance;
        }
        
        // 写入缓存
        await tokenCache.setBalance(userId, balance);
      }

      // 2. 估算任务成本
      const estimatedCost = await this.estimateTaskCost(templateId, model);

      // 3. 检查余额是否足够
      if (balance < estimatedCost) {
        throw new Error(`余额不足，当前余额: ${balance} tokens，预估消耗: ${estimatedCost} tokens`);
      }

      // 4. 预扣费（乐观锁）
      const lockId = `lock_${Date.now()}_${uuidv4().substr(0, 8)}`;
      
      const [result] = await db.query(`
        UPDATE token_wallets 
        SET balance = balance - ?, locked_balance = locked_balance + ?
        WHERE user_id = ? AND balance >= ?
      `, [estimatedCost, estimatedCost, userId, estimatedCost]);

      if (result.affectedRows === 0) {
        throw new Error('余额不足或并发冲突，请重试');
      }

      // 5. 清除缓存（强制下次从DB读取最新余额）
      await tokenCache.clearBalance(userId);

      logger.info('Token预扣费成功', { userId, estimatedCost, lockId });

      return { lockId, estimatedCost };

    } catch (error) {
      logger.error('Token预检查失败', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * 任务完成后精准结算
   */
  async settleTask(taskId, userId, actualTokensUsed, model) {
    try {
      // 1. 获取任务的预扣金额
      const [[task]] = await db.query(
        'SELECT token_estimated FROM agent_tasks WHERE id = ?',
        [taskId]
      );

      if (!task) {
        throw new Error(`任务 ${taskId} 不存在`);
      }

      const estimatedCost = task.token_estimated || 0;
      const diff = estimatedCost - actualTokensUsed;

      // 2. 解锁预扣金额，扣除实际消耗
      await db.query(`
        UPDATE token_wallets
        SET locked_balance = locked_balance - ?,
            balance = balance + ?
        WHERE user_id = ?
      `, [estimatedCost, diff, userId]);

      // 3. 记录消费明细
      await db.query(`
        INSERT INTO token_usage_logs 
        (user_id, task_id, model_used, tokens_used, cost_usd, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [
        userId,
        taskId,
        model,
        actualTokensUsed,
        this.calculateCost(model, actualTokensUsed)
      ]);

      // 4. 更新任务记录
      await db.query(
        'UPDATE agent_tasks SET token_used = ? WHERE id = ?',
        [actualTokensUsed, taskId]
      );

      // 5. 清除缓存
      await tokenCache.clearBalance(userId);

      logger.info('Token结算完成', { 
        taskId, 
        userId, 
        estimated: estimatedCost, 
        actual: actualTokensUsed,
        refund: diff 
      });

      return { success: true, actualTokensUsed, refund: diff };

    } catch (error) {
      logger.error('Token结算失败', { taskId, userId, error: error.message });
      throw error;
    }
  }

  /**
   * 估算任务成本（基于模板和模型）
   */
  async estimateTaskCost(templateId, model) {
    // 简化版：根据模板类型和模型返回估算值
    // 实际应该分析模板的 prompt 长度
    const modelCosts = {
      'claude-sonnet': 5000,
      'claude-haiku': 1000,
      'gpt-4o': 4000,
      'gpt-4o-mini': 800,
      'qwen-max': 2000,
      'qwen-plus': 1500,
      'glm-4-flash': 500,
      'doubao-pro': 1200
    };

    return modelCosts[model] || 2000; // 默认2000 tokens
  }

  /**
   * 计算实际成本（USD）
   */
  calculateCost(model, tokens) {
    const pricing = {
      'claude-sonnet': { input: 0.000003, output: 0.000015 },
      'gpt-4o': { input: 0.0000025, output: 0.00001 },
      'qwen-max': { input: 0.0000004, output: 0.0000012 },
      'glm-4-flash': { input: 0.0000001, output: 0.0000001 }
    };

    const price = pricing[model] || { input: 0.000001, output: 0.000003 };
    
    // 简化：假设 input:output = 3:1
    const inputTokens = Math.floor(tokens * 0.75);
    const outputTokens = tokens - inputTokens;

    return (inputTokens * price.input + outputTokens * price.output).toFixed(6);
  }

  /**
   * 获取用户余额
   */
  async getBalance(userId) {
    // 优先从缓存读取
    let balance = await tokenCache.getBalance(userId);
    
    if (balance === null) {
      const [[wallet]] = await db.query(
        'SELECT balance, locked_balance FROM token_wallets WHERE user_id = ?',
        [userId]
      );
      
      if (!wallet) {
        return { balance: 0, locked: 0, available: 0 };
      }

      balance = wallet.balance;
      await tokenCache.setBalance(userId, balance);

      return {
        balance: wallet.balance,
        locked: wallet.locked_balance,
        available: wallet.balance - wallet.locked_balance
      };
    }

    return { balance, locked: 0, available: balance };
  }

  /**
   * 充值
   */
  async recharge(userId, amount, orderId) {
    try {
      await db.query(`
        UPDATE token_wallets 
        SET balance = balance + ?
        WHERE user_id = ?
      `, [amount, userId]);

      // 记录充值日志
      await db.query(`
        INSERT INTO token_usage_logs 
        (user_id, task_id, model_used, tokens_used, cost_usd, created_at)
        VALUES (?, ?, 'recharge', ?, 0, NOW())
      `, [userId, orderId, amount]);

      await tokenCache.clearBalance(userId);

      logger.info('Token充值成功', { userId, amount, orderId });
      return { success: true };

    } catch (error) {
      logger.error('Token充值失败', { userId, amount, error: error.message });
      throw error;
    }
  }
}

module.exports = new TokenService();

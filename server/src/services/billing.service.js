'use strict';
const { getPool } = require('../config/database');
const { log } = require('../utils/log');
const crypto = require('crypto');

const MODEL_PRICING = {
  'qwen-plus':         { input: 0.0008, output: 0.002 },
  'qwen-max':          { input: 0.04,   output: 0.12  },
  'qwen-turbo':        { input: 0.0003, output: 0.0006 },
  'deepseek-v4-flash': { input: 0.001,  output: 0.002 },
  'deepseek-chat':     { input: 0.001,  output: 0.002 },
  'glm-4-flash':       { input: 0.0001, output: 0.0001 },
};
const PLATFORM_MARKUP = 1.3;
const TOKENS_PER_CNY = 1000;

function estimateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['deepseek-v4-flash'];
  const costCny = (inputTokens / 1000 * pricing.input + outputTokens / 1000 * pricing.output) * PLATFORM_MARKUP;
  const platformTokens = Math.ceil(costCny * TOKENS_PER_CNY);
  return { costCny, platformTokens };
}

async function checkBalance(userId) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT balance FROM user_balance WHERE user_id = ?', [userId]);
  if (!rows.length) return 0;
  return Number(rows[0].balance) || 0;
}

async function chargeUser(userId, model, inputTokens, outputTokens, meta) {
  const { costCny, platformTokens } = estimateCost(model, inputTokens, outputTokens);
  if (platformTokens <= 0) return { charged: 0, costCny: 0 };

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'UPDATE user_balance SET balance = balance - ?, total_consumed = total_consumed + ? WHERE user_id = ? AND balance >= ?',
      [platformTokens, platformTokens, userId, platformTokens]
    );
    if (r.affectedRows === 0) {
      await conn.rollback();
      return { error: 'TOKEN_INSUFFICIENT', charged: 0 };
    }
    await conn.query(
      'INSERT INTO token_usage_logs (id, user_id, task_id, model_used, input_tokens, output_tokens, platform_tokens_cost, actual_cost_cny) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), userId, meta?.taskId || 'direct', model, inputTokens, outputTokens, platformTokens, costCny]
    );
    await conn.commit();
    log('info', 'billing_charge', { userId, model, inputTokens, outputTokens, platformTokens, costCny: costCny.toFixed(6) });
    return { charged: platformTokens, costCny };
  } catch (e) {
    await conn.rollback();
    log('error', 'billing_charge_failed', { userId, error: e.message });
    throw e;
  } finally {
    conn.release();
  }
}

async function preAuthCheck(userId, model, estimatedInputTokens) {
  // 用 estimatedInputTokens * 2 估算 output（长文生成场景 output 可能远大于 input）
  const { platformTokens } = estimateCost(model, estimatedInputTokens, estimatedInputTokens * 2);
  const balance = await checkBalance(userId);
  return balance >= platformTokens;
}

module.exports = { estimateCost, checkBalance, chargeUser, preAuthCheck, MODEL_PRICING };

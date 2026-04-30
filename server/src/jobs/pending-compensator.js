'use strict';
const { getPool } = require('../config/database');
const { log } = require('../utils/log');

const PENDING_TIMEOUT_MS = 3 * 60 * 1000; // 3 分钟超时即认为崩溃

async function compensatePendingUsage() {
  const pool = getPool();
  const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MS);

  // 查找超时的 pending 流水单
  const [rows] = await pool.query(
    "SELECT id, user_id, cost FROM agent_usage_log WHERE status = 'pending' AND created_at < ?",
    [cutoff]
  );

  if (!rows.length) return;
  log('info', 'pending_compensator_found', { count: rows.length });

  for (const row of rows) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 原子更新：只处理仍是 pending 的记录（防止并发重复处理）
      const [updated] = await conn.query(
        "UPDATE agent_usage_log SET status = 'failed', error_msg = 'process crash compensation' WHERE id = ? AND status = 'pending'",
        [row.id]
      );

      if (updated.affectedRows > 0 && row.cost > 0) {
        // 退款
        await conn.query(
          'UPDATE user_balance SET balance = balance + ?, total_consumed = total_consumed - ? WHERE user_id = ?',
          [row.cost, row.cost, row.user_id]
        );
        log('info', 'pending_compensated', { usageId: row.id, userId: row.user_id, cost: row.cost });
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      log('error', 'pending_compensate_failed', { usageId: row.id, error: e.message });
    } finally {
      conn.release();
    }
  }
}

function startPendingCompensator() {
  // 启动后延迟 30s 再开始（等待服务完全启动）
  setTimeout(() => {
    compensatePendingUsage().catch(e => log('error', 'compensator_error', { error: e.message }));
    // 每 5 分钟执行一次
    setInterval(() => {
      compensatePendingUsage().catch(e => log('error', 'compensator_error', { error: e.message }));
    }, 5 * 60 * 1000);
  }, 30000);
}

module.exports = { startPendingCompensator, compensatePendingUsage };

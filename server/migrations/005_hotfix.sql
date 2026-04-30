-- ============================================================
-- 005_hotfix.sql — 商业化热修复（基于代码审计发现）
-- MySQL 5.7 兼容版本
-- ============================================================

-- 1. agent_usage_log 字段已存在（status, cost, error_msg），跳过

-- 2. token_usage 表已存在（旧表），token_usage_logs 也存在（新表）
-- token.routes.js 已修改为直接查 token_usage_logs，无需创建视图

-- 3. 为现有用户创建 user_balance 记录（初始 10000 Token）
INSERT IGNORE INTO user_balance (user_id, balance, free_quota, total_recharged, total_consumed)
SELECT id, 10000, 10000, 0, 0
FROM auth_users
WHERE id NOT IN (SELECT user_id FROM user_balance);

-- 4. 验证
SELECT 'agent_usage_log columns' AS check_name,
  COUNT(*) AS found_count
FROM information_schema.COLUMNS
WHERE TABLE_NAME = 'agent_usage_log'
  AND COLUMN_NAME IN ('status', 'cost', 'error_msg')
  AND TABLE_SCHEMA = DATABASE();

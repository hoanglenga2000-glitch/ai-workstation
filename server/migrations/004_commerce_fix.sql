-- 004_commerce_fix.sql
-- Fixes type inconsistencies and adds missing constraints from 001-003
-- All user_id columns use INT to match auth_users.id

-- Ensure token_wallets references auth_users correctly
CREATE TABLE IF NOT EXISTS token_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  balance BIGINT NOT NULL DEFAULT 10000,
  total_purchased BIGINT DEFAULT 0,
  total_consumed BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Token usage logs with proper types
CREATE TABLE IF NOT EXISTS token_usage_logs (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  task_id VARCHAR(64) DEFAULT NULL,
  model_used VARCHAR(64) NOT NULL,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  platform_tokens_cost INT DEFAULT 0,
  actual_cost_cny DECIMAL(10,6) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_date (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Payment orders (for future payment gateway integration)
CREATE TABLE IF NOT EXISTS payment_orders (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  amount_cny DECIMAL(10,2) NOT NULL,
  tokens_granted BIGINT NOT NULL,
  status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
  payment_method VARCHAR(32) DEFAULT NULL,
  payment_order_id VARCHAR(128) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  INDEX idx_user (user_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agent usage log (fix user_id type)
CREATE TABLE IF NOT EXISTS agent_usage_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT NOT NULL,
  user_id INT DEFAULT NULL,
  input_text TEXT,
  output_text TEXT,
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent (agent_id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- User favorites
CREATE TABLE IF NOT EXISTS user_favorites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  agent_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_agent (user_id, agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

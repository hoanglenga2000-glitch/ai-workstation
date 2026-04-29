-- ============================================================
-- AI 智能体创作市场 — 数据库扩展（基于现有表）
-- ============================================================

-- 扩展 auth_users 表
ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(20) DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS api_key VARCHAR(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS total_tasks_count INT DEFAULT 0;

-- ============================================================
-- Token 钱包
-- ============================================================
CREATE TABLE IF NOT EXISTS token_wallets (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  balance BIGINT NOT NULL DEFAULT 10000,
  total_purchased BIGINT DEFAULT 0,
  total_consumed BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Token 消耗日志
-- ============================================================
CREATE TABLE IF NOT EXISTS token_usage_logs (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  task_id VARCHAR(100) NOT NULL,
  model_used VARCHAR(50) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  platform_tokens_cost BIGINT NOT NULL DEFAULT 0,
  actual_cost_cny DECIMAL(10,6) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user_id (user_id),
  INDEX idx_task_id (task_id),
  INDEX idx_model (model_used),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 智能体模板市场
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_templates (
  id VARCHAR(36) PRIMARY KEY,
  creator_id INT NULL,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE,
  description TEXT,
  category VARCHAR(50) DEFAULT 'general',
  subcategory VARCHAR(50),
  cover_image VARCHAR(255),
  config LONGTEXT NOT NULL,
  model_recommended VARCHAR(50) DEFAULT 'qwen-plus',
  inputs_schema JSON,
  token_estimate INT DEFAULT 5000,
  is_public BOOLEAN DEFAULT false,
  is_featured BOOLEAN DEFAULT false,
  usage_count INT DEFAULT 0,
  rating_sum INT DEFAULT 0,
  rating_count INT DEFAULT 0,
  tags JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_creator (creator_id),
  INDEX idx_category (category),
  INDEX idx_is_public (is_public),
  INDEX idx_is_featured (is_featured)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 内置模板数据
INSERT IGNORE INTO agent_templates (id, name, slug, description, category, model_recommended, token_estimate, is_public, is_featured, config, inputs_schema) VALUES
(UUID(), '长文写作团队', 'article-writer', '研究员+写手+编辑三智能体协同创作深度长文', '内容创作', 'qwen-plus', 15000, true, true,
 '{"agents":[{"role":"资深研究员","goal":"深入调研主题并收集高质量素材","backstory":"你是经验丰富的内容研究专家","task_description":"请针对主题「{topic}」进行深入调研"},{"role":"专业写手","goal":"基于研究成果创作高质量文章","backstory":"你是才华横溢的内容创作者","task_description":"请基于研究报告撰写{word_count}字的文章"},{"role":"资深编辑","goal":"审校和优化文章使其达到发表标准","backstory":"你是严格专业的编辑","task_description":"请全面审校并优化文章"}]}',
 '[{"key":"topic","label":"文章主题","type":"text","required":true},{"key":"word_count","label":"字数要求","type":"number","default":3000}]'),

(UUID(), '社交媒体矩阵', 'social-matrix', '一键生成微博/微信/小红书多平台内容', '社交媒体', 'qwen-plus', 5000, true, true,
 '{"agents":[{"role":"内容策略师","goal":"规划多平台内容策略","task_description":"针对「{topic}」规划各平台内容策略"},{"role":"文案写手","goal":"撰写各平台适配的文案","task_description":"根据策略生成各平台文案"}]}',
 '[{"key":"topic","label":"内容主题","type":"text","required":true},{"key":"brand","label":"品牌名称","type":"text"}]');

-- ============================================================
-- 智能体任务执行记录（扩展现有 tasks 表）
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_tasks (
  id VARCHAR(100) PRIMARY KEY,
  user_id INT NOT NULL,
  template_id VARCHAR(36) NOT NULL,
  model_used VARCHAR(50),
  inputs JSON,
  outputs LONGTEXT,
  status VARCHAR(20) DEFAULT 'queued',
  progress TINYINT DEFAULT 0,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  error_msg TEXT,
  token_estimated BIGINT DEFAULT 0,
  token_used BIGINT DEFAULT 0,
  queue_name VARCHAR(20) DEFAULT 'standard',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user_id (user_id),
  INDEX idx_template (template_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at),
  FOREIGN KEY (template_id) REFERENCES agent_templates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 用户收藏
-- ============================================================
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id INT NOT NULL,
  template_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, template_id),
  FOREIGN KEY (template_id) REFERENCES agent_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 智能体评分
-- ============================================================
CREATE TABLE IF NOT EXISTS template_ratings (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  template_id VARCHAR(36) NOT NULL,
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_user_template (user_id, template_id),
  FOREIGN KEY (template_id) REFERENCES agent_templates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { z } = require('zod');

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  HOST: z.string().default('127.0.0.1'),

  LTCRAFT_BASE_URL: z.string().url().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  LTCRAFT_API_KEY: z.string().min(1, 'LTCRAFT_API_KEY is required'),
  DEFAULT_MODEL: z.string().default('deepseek-v4-flash'),
  AI_CALL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120000),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('ai-zhjjq'),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_PASSWORD: z.string().default(''),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),

  AUTH_PASSWORD: z.string().default(''),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 chars'),
  ALLOW_REGISTRATION: z.string().default('true'),

  UPLOAD_MAX_SIZE_MB: z.coerce.number().int().min(1).max(500).default(20),

  FEATURE_REDIS_RL: z.string().default('true'),
  FEATURE_JWT_AUTH: z.string().default('true'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

const env = parsed.data;

const PORT = env.PORT;
const HOST = env.HOST;
const AI_BASE = env.LTCRAFT_BASE_URL;
const AI_KEY = env.LTCRAFT_API_KEY;
const AI_URL = (() => {
  try {
    const url = new URL(AI_BASE);
    return { hostname: url.hostname, pathname: url.pathname };
  } catch {
    return { hostname: 'dashscope.aliyuncs.com', pathname: '' };
  }
})();
const AI_HOSTNAME = AI_URL.hostname;
const AI_CHAT_URL = AI_BASE.replace(/\/$/, '') + '/chat/completions';
const AI_PATH = '/v1/chat/completions';
const AI_TIMEOUT = env.AI_CALL_TIMEOUT_MS;
const DEFAULT_MODEL = env.DEFAULT_MODEL;
const UPLOAD_MAX = env.UPLOAD_MAX_SIZE_MB * 1024 * 1024;

const DB_HOST = env.DB_HOST;
const DB_USER = env.DB_USER;
const DB_PASSWORD = env.DB_PASSWORD;
const DB_NAME = env.DB_NAME;
const DB_CONNECTION_LIMIT = env.DB_CONNECTION_LIMIT;

const REDIS_HOST = env.REDIS_HOST;
const REDIS_PORT = env.REDIS_PORT;
const REDIS_PASSWORD = env.REDIS_PASSWORD;
const REDIS_DB = env.REDIS_DB;

const AUTH_PASSWORD = env.AUTH_PASSWORD;
const AUTH_SECRET = env.AUTH_SECRET;
const AUTH_COOKIE = 'aiws_session';
const AUTH_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const ALLOW_REGISTRATION = env.ALLOW_REGISTRATION !== 'false';

const FEATURE_REDIS_RL = env.FEATURE_REDIS_RL !== 'false';
const FEATURE_JWT_AUTH = env.FEATURE_JWT_AUTH !== 'false';

module.exports = {
  PORT, HOST,
  AI_BASE, AI_KEY, AI_URL, AI_HOSTNAME, AI_CHAT_URL, AI_PATH, AI_TIMEOUT, DEFAULT_MODEL,
  UPLOAD_MAX,
  DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_CONNECTION_LIMIT,
  REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB,
  AUTH_PASSWORD, AUTH_SECRET, AUTH_COOKIE, AUTH_MAX_AGE, ALLOW_REGISTRATION,
  FEATURE_REDIS_RL, FEATURE_JWT_AUTH,
};

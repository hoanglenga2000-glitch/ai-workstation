// middleware/security.js - 安全防护中间件
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Helmet 安全头配置
 */
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

/**
 * API 限流配置
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 最多100个请求
  message: '请求过于频繁，请稍后再试',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('API限流触发', { 
      ip: req.ip, 
      path: req.path,
      userAgent: req.get('user-agent')
    });
    res.status(429).json({
      error: '请求过于频繁，请稍后再试',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * 创建任务限流（更严格）
 */
const createTaskLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 10, // 最多10个任务
  message: '创建任务过于频繁',
  skipSuccessfulRequests: false
});

/**
 * 登录限流
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 15分钟内最多5次登录尝试
  skipSuccessfulRequests: true,
  message: '登录尝试次数过多，请15分钟后再试'
});

/**
 * SQL注入防护 - 输入验证
 */
const sanitizeInput = (value) => {
  if (typeof value !== 'string') return value;
  
  // 移除危险字符
  return value
    .replace(/[<>"'%;()&+]/g, '')
    .trim();
};

/**
 * XSS防护 - HTML转义
 */
const escapeHtml = (text) => {
  if (typeof text !== 'string') return text;
  
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  
  return text.replace(/[&<>"']/g, (m) => map[m]);
};

/**
 * Prompt注入防护
 */
const sanitizePrompt = (prompt) => {
  if (typeof prompt !== 'string') return prompt;
  
  // 检测危险模式
  const dangerousPatterns = [
    /ignore\s+previous\s+instructions/i,
    /disregard\s+all\s+prior/i,
    /forget\s+everything/i,
    /system\s*:\s*you\s+are/i,
    /<\s*script/i,
    /javascript\s*:/i
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(prompt)) {
      logger.warn('检测到Prompt注入尝试', { prompt: prompt.substring(0, 100) });
      throw new Error('输入包含不安全内容');
    }
  }
  
  return prompt;
};

/**
 * 请求验证中间件
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    logger.warn('请求验证失败', { 
      errors: errors.array(),
      path: req.path,
      ip: req.ip
    });
    
    return res.status(400).json({
      error: '请求参数验证失败',
      details: errors.array()
    });
  }
  
  next();
};

/**
 * 创建任务验证规则
 */
const createTaskValidation = [
  body('userId').isInt({ min: 1 }).withMessage('userId必须是正整数'),
  body('templateId').isInt({ min: 1 }).withMessage('templateId必须是正整数'),
  body('userInput').isObject().withMessage('userInput必须是对象'),
  body('model').optional().isString().isLength({ max: 50 }).withMessage('model长度不能超过50'),
  validateRequest
];

/**
 * CORS配置
 */
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://ai.zhjjq.tech',
      'http://localhost:3000',
      'http://localhost:5173'
    ];
    
    // 允许无origin的请求（如Postman）
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn('CORS拒绝', { origin });
      callback(new Error('不允许的来源'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

module.exports = {
  helmetConfig,
  apiLimiter,
  createTaskLimiter,
  loginLimiter,
  sanitizeInput,
  escapeHtml,
  sanitizePrompt,
  validateRequest,
  createTaskValidation,
  corsOptions
};

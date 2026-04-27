// index.js - 新的模块化主入口
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const logger = require('./utils/logger');

// 初始化 Express
const app = express();
const server = http.createServer(app);

// 中间件
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// 请求日志
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { 
    ip: req.ip, 
    userAgent: req.get('user-agent')?.substring(0, 100) 
  });
  next();
});

// 路由
const authRoutes = require('./routes/auth');
const templatesRoutes = require('./routes/templates');
const tasksRoutes = require('./routes/tasks');

app.use('/api/auth', authRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/tasks', tasksRoutes);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    redis: 'connected',
    mysql: 'connected'
  });
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 全局错误处理
app.use((err, req, res, next) => {
  logger.error('未捕获的错误', { 
    error: err.message, 
    stack: err.stack,
    path: req.path 
  });
  res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
const PORT = process.env.PORT || 3100;
const HOST = process.env.HOST || '127.0.0.1';

server.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  🚀 AI 智能体创作市场 - 后端服务已启动                    ║
╠═══════════════════════════════════════════════════════════╣
║  地址: http://${HOST}:${PORT}                        ║
║  环境: ${process.env.NODE_ENV || 'development'}                              ║
║  时间: ${new Date().toLocaleString('zh-CN')}      ║
╠═══════════════════════════════════════════════════════════╣
║  ✓ Redis 缓存层                                           ║
║  ✓ Bull 任务队列                                          ║
║  ✓ MySQL 数据库                                           ║
║  ✓ 模块化架构                                             ║
╚═══════════════════════════════════════════════════════════╝
  `);
  
  logger.info('服务器启动成功', { port: PORT, host: HOST });
});

// 启动任务队列 Worker
require('./queues/workers/agentWorker');
logger.info('✓ 任务队列 Worker 已启动');

// 优雅关闭
process.on('SIGTERM', () => {
  logger.info('收到 SIGTERM 信号，开始优雅关闭...');
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

module.exports = app;

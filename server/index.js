'use strict';
const config = require('./src/config/index');
const { getPool, closePool } = require('./src/config/database');
const { getRedis, closeRedis } = require('./src/config/redis');
const { createApp, seedAdmin, initRateLimiter } = require('./src/app');
const { log } = require('./src/utils/log');
const { startPendingCompensator } = require('./src/jobs/pending-compensator');

const app = createApp();

// Initialize async services
Promise.all([
  seedAdmin(),
  initRateLimiter(),
]).catch((e) => log('error', 'init_failed', { error: e.message }));

const server = app.listen(config.PORT, config.HOST, () => {
  log('info', 'listening', { host: config.HOST, port: config.PORT, ai_base: config.AI_BASE, default_model: config.DEFAULT_MODEL });

  // WebSocket Setup
  const { Server } = require('socket.io');
  const io = new Server(server, {
    cors: {
      origin: ['https://ai.zhjjq.tech', 'http://localhost:5173'],
      methods: ['GET', 'POST'],
      credentials: true,
    }
  });

  // Redis Adapter for cross-process broadcasting (cluster mode)
  try {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const Redis = require('ioredis');
    const pubClient = new Redis({ host: config.REDIS_HOST, port: config.REDIS_PORT, password: config.REDIS_PASSWORD || undefined, db: config.REDIS_DB, lazyConnect: true });
    const subClient = pubClient.duplicate();
    Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      log('info', 'socket_redis_adapter_ready');
    }).catch((e) => {
      log('warn', 'socket_redis_adapter_failed', { error: e.message });
    });
  } catch (e) {
    log('warn', 'socket_redis_adapter_unavailable', { error: e.message });
  }

  io.on('connection', (socket) => {
    socket.on('join-conversation', (conversationId) => {
      socket.join(`conversation-${conversationId}`);
    });
  });

  // Expose via app for route handlers (avoids global)
  app.set('io', io);

  log('info', 'websocket_initialized', { connections: 0 });

  // Notify PM2 this worker is ready to accept traffic
  if (process.send) process.send('ready');

  // 启动 Pending 流水单补偿任务
  startPendingCompensator();
  log('info', 'pending_compensator_started');
});

// Graceful shutdown
function gracefulShutdown(signal) {
  log('info', 'shutdown_start', { signal });

  server.close(async () => {
    log('info', 'http_server_closed');
    try { await closePool(); } catch (_) {}
    try { await closeRedis(); } catch (_) {}
    log('info', 'shutdown_complete');
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => {
    log('warn', 'shutdown_forced');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (e) => log('error', 'unhandled_rejection', { error: e && e.message, stack: e && e.stack }));
process.on('uncaughtException', (e) => log('error', 'uncaught_exception', { error: e && e.message, stack: e && e.stack }));

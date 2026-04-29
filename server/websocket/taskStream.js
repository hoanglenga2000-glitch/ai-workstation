// websocket/taskStream.js - 任务实时推送
const WebSocket = require('ws');
const logger = require('../utils/logger');

class TaskStreamManager {
  constructor(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws/tasks'
    });
    
    this.clients = new Map(); // taskId -> Set of WebSocket clients
    
    this.setupWebSocket();
  }

  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress;
      logger.info('WebSocket连接建立', { ip });

      ws.isAlive = true;
      
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (error) {
          logger.error('WebSocket消息解析失败', { error: error.message });
          ws.send(JSON.stringify({ error: '无效的消息格式' }));
        }
      });

      ws.on('close', () => {
        logger.info('WebSocket连接关闭', { ip });
        this.removeClient(ws);
      });

      ws.on('error', (error) => {
        logger.error('WebSocket错误', { error: error.message });
      });

      // 发送欢迎消息
      ws.send(JSON.stringify({
        type: 'connected',
        message: '已连接到任务推送服务',
        timestamp: Date.now()
      }));
    });

    // 心跳检测（每30秒）
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          logger.warn('WebSocket心跳超时，关闭连接');
          return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    logger.info('✓ WebSocket服务已启动', { path: '/ws/tasks' });
  }

  handleMessage(ws, data) {
    const { action, taskId } = data;

    switch (action) {
      case 'subscribe':
        if (!taskId) {
          ws.send(JSON.stringify({ error: '缺少taskId' }));
          return;
        }
        this.subscribe(ws, taskId);
        ws.send(JSON.stringify({
          type: 'subscribed',
          taskId,
          message: '已订阅任务更新'
        }));
        logger.info('客户端订阅任务', { taskId });
        break;

      case 'unsubscribe':
        if (!taskId) {
          ws.send(JSON.stringify({ error: '缺少taskId' }));
          return;
        }
        this.unsubscribe(ws, taskId);
        ws.send(JSON.stringify({
          type: 'unsubscribed',
          taskId,
          message: '已取消订阅'
        }));
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;

      default:
        ws.send(JSON.stringify({ error: '未知的操作: ' + action }));
    }
  }

  subscribe(ws, taskId) {
    if (!this.clients.has(taskId)) {
      this.clients.set(taskId, new Set());
    }
    this.clients.get(taskId).add(ws);
    ws.subscribedTasks = ws.subscribedTasks || new Set();
    ws.subscribedTasks.add(taskId);
  }

  unsubscribe(ws, taskId) {
    if (this.clients.has(taskId)) {
      this.clients.get(taskId).delete(ws);
      if (this.clients.get(taskId).size === 0) {
        this.clients.delete(taskId);
      }
    }
    if (ws.subscribedTasks) {
      ws.subscribedTasks.delete(taskId);
    }
  }

  removeClient(ws) {
    if (ws.subscribedTasks) {
      ws.subscribedTasks.forEach(taskId => {
        this.unsubscribe(ws, taskId);
      });
    }
  }

  /**
   * 推送任务状态更新
   */
  pushTaskUpdate(taskId, status, data = {}) {
    const clients = this.clients.get(taskId);
    
    if (!clients || clients.size === 0) {
      return;
    }

    const message = JSON.stringify({
      type: 'task_update',
      taskId,
      status,
      data,
      timestamp: Date.now()
    });

    let sentCount = 0;
    clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        sentCount++;
      }
    });

    logger.debug('推送任务更新', { taskId, status, clients: sentCount });
  }

  /**
   * 推送任务开始
   */
  pushTaskStarted(taskId, data = {}) {
    this.pushTaskUpdate(taskId, 'started', data);
  }

  /**
   * 推送任务进度
   */
  pushTaskProgress(taskId, progress, message = '') {
    this.pushTaskUpdate(taskId, 'progress', { progress, message });
  }

  /**
   * 推送任务完成
   */
  pushTaskCompleted(taskId, result) {
    this.pushTaskUpdate(taskId, 'completed', { result });
  }

  /**
   * 推送任务失败
   */
  pushTaskFailed(taskId, error) {
    this.pushTaskUpdate(taskId, 'failed', { error });
  }

  /**
   * 推送任务日志
   */
  pushTaskLog(taskId, log) {
    this.pushTaskUpdate(taskId, 'log', { log });
  }

  /**
   * 关闭WebSocket服务
   */
  close() {
    clearInterval(this.heartbeatInterval);
    this.wss.close(() => {
      logger.info('WebSocket服务已关闭');
    });
  }
}

module.exports = TaskStreamManager;

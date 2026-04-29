// WebSocket 实时推送配置
const { Server } = require('socket.io');
const http = require('http');

function setupWebSocket(app, pool) {
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: ['https://ai.zhjjq.tech', 'http://localhost:5173'],
      credentials: true
    },
    path: '/socket.io/'
  });

  // 连接认证
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    // 简单验证，生产环境应该验证JWT
    next();
  });

  // 连接处理
  io.on('connection', (socket) => {
    console.log('WebSocket客户端连接:', socket.id);

    // 加入用户房间
    socket.on('join', (userId) => {
      socket.join(`user_${userId}`);
      console.log(`用户 ${userId} 加入房间`);
    });

    // 订阅任务更新
    socket.on('subscribe_task', (taskId) => {
      socket.join(`task_${taskId}`);
    });

    // 订阅工作流更新
    socket.on('subscribe_workflow', (workflowId) => {
      socket.join(`workflow_${workflowId}`);
    });

    socket.on('disconnect', () => {
      console.log('WebSocket客户端断开:', socket.id);
    });
  });

  // 导出推送函数
  const emitTaskUpdate = (taskId, data) => {
    io.to(`task_${taskId}`).emit('task_update', data);
  };

  const emitWorkflowUpdate = (workflowId, data) => {
    io.to(`workflow_${workflowId}`).emit('workflow_update', data);
  };

  const emitUserNotification = (userId, data) => {
    io.to(`user_${userId}`).emit('notification', data);
  };

  return {
    server,
    io,
    emitTaskUpdate,
    emitWorkflowUpdate,
    emitUserNotification
  };
}

module.exports = { setupWebSocket };

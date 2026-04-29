// queues/agentQueue.js - Bull 任务队列配置
const Queue = require('bull');
const logger = require('../utils/logger');

// Redis 配置
const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 0
};

// 创建任务队列
const agentQueue = new Queue('agent-tasks', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,                    // 失败重试3次
    backoff: {
      type: 'exponential',
      delay: 2000                   // 首次重试2秒，之后指数增长
    },
    removeOnComplete: 100,          // 保留最近100个完成任务
    removeOnFail: 200,              // 保留最近200个失败任务
    timeout: 600000                 // 10分钟超时
  }
});

// 队列事件监听
agentQueue.on('error', (error) => {
  logger.error('队列错误', { error: error.message });
});

agentQueue.on('waiting', (jobId) => {
  logger.debug('任务等待中', { jobId });
});

agentQueue.on('active', (job) => {
  logger.info('任务开始执行', { jobId: job.id, taskId: job.data.taskId });
});

agentQueue.on('completed', (job, result) => {
  logger.info('任务完成', { 
    jobId: job.id, 
    taskId: job.data.taskId,
    duration: Date.now() - job.timestamp 
  });
});

agentQueue.on('failed', (job, err) => {
  logger.error('任务失败', { 
    jobId: job.id, 
    taskId: job.data.taskId,
    error: err.message,
    attempts: job.attemptsMade 
  });
});

agentQueue.on('stalled', (job) => {
  logger.warn('任务超时', { jobId: job.id, taskId: job.data.taskId });
});

/**
 * 添加任务到队列
 */
async function addTask(taskData, options = {}) {
  const { taskId, userId, templateId, userInput, model } = taskData;
  
  const job = await agentQueue.add('execute-agent', {
    taskId,
    userId,
    templateId,
    userInput,
    model: model || 'qwen-plus'
  }, {
    jobId: taskId,                  // 使用taskId作为jobId，方便查询
    priority: options.priority || 10,
    ...options
  });

  logger.info('任务已入队', { taskId, jobId: job.id, model });
  
  return job;
}

/**
 * 获取任务状态
 */
async function getTaskStatus(taskId) {
  const job = await agentQueue.getJob(taskId);
  
  if (!job) {
    return { status: 'not_found' };
  }

  const state = await job.getState();
  const progress = job.progress();
  
  return {
    status: state,              // waiting, active, completed, failed, delayed
    progress: progress,
    attempts: job.attemptsMade,
    failedReason: job.failedReason,
    finishedOn: job.finishedOn,
    processedOn: job.processedOn
  };
}

/**
 * 取消任务
 */
async function cancelTask(taskId) {
  const job = await agentQueue.getJob(taskId);
  
  if (!job) {
    return false;
  }

  const state = await job.getState();
  
  if (state === 'active') {
    // 正在执行的任务无法取消，只能等待完成
    return false;
  }

  await job.remove();
  logger.info('任务已取消', { taskId });
  
  return true;
}

/**
 * 获取队列统计信息
 */
async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    agentQueue.getWaitingCount(),
    agentQueue.getActiveCount(),
    agentQueue.getCompletedCount(),
    agentQueue.getFailedCount(),
    agentQueue.getDelayedCount()
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed
  };
}

/**
 * 清理旧任务
 */
async function cleanOldJobs() {
  await agentQueue.clean(24 * 3600 * 1000, 'completed'); // 清理24小时前的完成任务
  await agentQueue.clean(7 * 24 * 3600 * 1000, 'failed'); // 清理7天前的失败任务
  logger.info('旧任务已清理');
}

module.exports = {
  agentQueue,
  addTask,
  getTaskStatus,
  cancelTask,
  getQueueStats,
  cleanOldJobs
};

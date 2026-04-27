// queues/agentQueue.js
const Bull = require('bull');
const logger = require('../utils/logger');

const createQueue = (name) => new Bull(name, {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3
  },
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200
  }
});

const queues = {
  premium: createQueue('agents:premium'),
  standard: createQueue('agents:standard'),
  budget: createQueue('agents:budget')
};

async function enqueueTask(taskData, userPlan = 'free') {
  const { taskId, userId, templateId, inputs, model } = taskData;

  const queueName = userPlan === 'pro' || userPlan === 'enterprise' ? 'premium' : 'standard';
  const queue = queues[queueName];

  const job = await queue.add(
    { taskId, userId, templateId, inputs, model },
    {
      jobId: taskId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      priority: userPlan === 'pro' ? 1 : 10,
      timeout: 10 * 60 * 1000,
    }
  );

  logger.info('任务已入队', { taskId, jobId: job.id, queue: queueName });
  return job;
}

async function getJobStatus(taskId) {
  for (const [name, queue] of Object.entries(queues)) {
    const job = await queue.getJob(taskId);
    if (job) {
      const state = await job.getState();
      return {
        taskId,
        state,
        progress: job.progress(),
        queue: name,
        failReason: job.failedReason
      };
    }
  }
  return null;
}

async function cancelJob(taskId) {
  for (const queue of Object.values(queues)) {
    const job = await queue.getJob(taskId);
    if (job) {
      await job.remove();
      return true;
    }
  }
  return false;
}

module.exports = { queues, enqueueTask, getJobStatus, cancelJob };

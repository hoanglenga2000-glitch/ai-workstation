// queues/workers/agentWorker.js
const { queues } = require('../agentQueue');
const llmService = require('../../services/llmService');
const db = require('../../config/database');
const logger = require('../../utils/logger');

const processTask = async (job) => {
  const { taskId, userId, templateId, inputs, model } = job.data;

  logger.info(`▶ 开始执行任务 ${taskId}`);

  try {
    await updateTaskStatus(taskId, 'running', null, null, new Date());

    job.progress(5);

    const template = await getTemplate(templateId);
    if (!template) throw new Error(`模板 ${templateId} 不存在`);

    const result = await runMultiAgentFlow(template, inputs, {
      model: model || template.model_recommended || 'qwen-plus',
      onProgress: (progress, agentName, message) => {
        job.progress(progress);
        logger.info(`任务进度 ${taskId}`, { progress, agent: agentName, message });
      }
    });

    const tokenUsed = result.totalTokens || 0;
    await updateTaskStatus(taskId, 'done', result.content, tokenUsed, null, new Date());

    job.progress(100);
    logger.info(`✓ 任务 ${taskId} 完成，消耗 ${tokenUsed} tokens`);
    return { success: true, tokenUsed };

  } catch (error) {
    logger.error(`✗ 任务 ${taskId} 失败: ${error.message}`);
    await updateTaskStatus(taskId, 'failed', null, null, null, null, error.message);
    throw error;
  }
};

async function runMultiAgentFlow(template, inputs, options) {
  const { model, onProgress } = options;
  const config = JSON.parse(template.config);
  const agents = config.agents || [];

  let context = '';
  let totalTokens = 0;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const progress = Math.round(((i + 1) / agents.length) * 90) + 5;

    onProgress?.(progress - 10, agent.role, `${agent.role} 正在工作...`);

    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt(agent, context)
      },
      {
        role: 'user',
        content: buildUserPrompt(agent, inputs, context)
      }
    ];

    const response = await llmService.chat(model, messages, {
      temperature: agent.temperature || 0.7,
      maxTokens: agent.maxTokens || 4000
    });

    context = response.content;
    totalTokens += response.usage.totalTokens;

    onProgress?.(progress, agent.role, `${agent.role} 完成`);
  }

  return { content: context, totalTokens };
}

function buildSystemPrompt(agent, previousContext) {
  return `你是一位${agent.role}。
你的目标：${agent.goal}
你的背景：${agent.backstory}

${previousContext ? `前一步的工作成果：\n${previousContext}` : ''}`;
}

function buildUserPrompt(agent, inputs, previousContext) {
  let prompt = agent.task_description || '';

  for (const [key, value] of Object.entries(inputs)) {
    prompt = prompt.replace(`{${key}}`, value);
  }

  return prompt;
}

async function updateTaskStatus(taskId, status, output, tokenUsed, startedAt, finishedAt, errorMsg) {
  const fields = ['status = ?'];
  const values = [status];

  if (output !== null && output !== undefined) { fields.push('outputs = ?'); values.push(output); }
  if (tokenUsed !== null) { fields.push('token_used = ?'); values.push(tokenUsed); }
  if (startedAt) { fields.push('started_at = ?'); values.push(startedAt); }
  if (finishedAt) { fields.push('finished_at = ?'); values.push(finishedAt); }
  if (errorMsg) { fields.push('error_msg = ?'); values.push(errorMsg); }

  values.push(taskId);
  await db.query(`UPDATE agent_tasks SET ${fields.join(', ')} WHERE id = ?`, values);
}

async function getTemplate(templateId) {
  const [rows] = await db.query('SELECT * FROM agent_templates WHERE id = ?', [templateId]);
  return rows[0];
}

Object.values(queues).forEach(queue => {
  queue.process(3, processTask);
});

module.exports = { processTask };

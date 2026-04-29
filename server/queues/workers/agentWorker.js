// queues/workers/agentWorker.js - 智能体任务执行 Worker
const agentQueue = require('../agentQueue');
const tokenService = require('../../services/tokenService');
const db = require('../../config/database');
const logger = require('../../utils/logger');

// LTCraft API配置
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || process.env.LTCRAFT_API_KEY;
const DASHSCOPE_BASE_URL = process.env.LTCRAFT_BASE_URL ? (process.env.LTCRAFT_BASE_URL.endsWith('/v1') ? process.env.LTCRAFT_BASE_URL : process.env.LTCRAFT_BASE_URL + '/v1') : 'https://cc-vibe.com/v1';

class AgentWorker {
  constructor() {
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      logger.warn('AgentWorker 已在运行');
      return;
    }

    logger.info('🚀 AgentWorker 启动中...');

    // 处理任务（并发数3）
    agentQueue.agentQueue.process('execute-agent', 3, async (job) => {
      return await this.executeTask(job);
    });

    // 监听事件
    agentQueue.agentQueue.on('completed', (job, result) => {
      logger.info('✓ 任务完成', { jobId: job.id, taskId: result.taskId });
    });

    agentQueue.agentQueue.on('failed', (job, err) => {
      logger.error('✗ 任务失败', { jobId: job.id, error: err.message });
    });

    this.isRunning = true;
    logger.info('✓ AgentWorker 已启动，并发数: 3');
  }

  async executeTask(job) {
    const { taskId, userId, templateId, userInput, model } = job.data;

    try {
      // 1. 更新任务状态
      await db.query(
        'UPDATE agent_tasks SET status = ?, started_at = NOW() WHERE id = ?',
        ['running', taskId]
      );

      // 2. 获取模板
      const [[template]] = await db.query(
        'SELECT * FROM agent_templates WHERE id = ?',
        [templateId]
      );

      if (!template) {
        throw new Error('模板不存在: ' + templateId);
      }

      const templateName = template.name;

      // 推送任务开始
      if (global.wsManager) {
        global.wsManager.pushTaskStarted(taskId, { model, templateName });
      }

      // 3. 构建Prompt
      const systemPrompt = template.system_prompt || '你是一个智能助手';
      let userPrompt = template.user_prompt_template || '';

      // 替换变量
      Object.keys(userInput).forEach(key => {
        const regex = new RegExp('{{' + key + '}}', 'g');
        userPrompt = userPrompt.replace(regex, userInput[key]);
      });

      // 4. 调用LLM
      logger.info('调用LLM', { taskId, model, promptLength: userPrompt.length });

      const startTime = Date.now();
      const response = await this.callLLM(model, systemPrompt, userPrompt);
      const duration = Date.now() - startTime;

      const { content, tokensUsed } = response;

      // 5. Token结算
      await tokenService.settleTask(taskId, userId, tokensUsed, model);

      // 6. 保存结果
      await db.query(
        'UPDATE agent_tasks SET status = ?, result = ?, token_used = ?, completed_at = NOW(), execution_time = ? WHERE id = ?',
        ['completed', content, tokensUsed, duration, taskId]
      );

      // 推送任务完成
      if (global.wsManager) {
        global.wsManager.pushTaskCompleted(taskId, { result: content, tokensUsed, duration });
      }

      logger.info('任务执行成功', { taskId, tokensUsed, duration });

      return {
        success: true,
        taskId,
        tokensUsed,
        duration,
        result: content
      };

    } catch (error) {
      logger.error('任务执行失败', { taskId, error: error.message });

      await db.query(
        'UPDATE agent_tasks SET status = ?, error_message = ? WHERE id = ?',
        ['failed', error.message, taskId]
      );

      // 推送任务失败
      if (global.wsManager) {
        global.wsManager.pushTaskFailed(taskId, { error: error.message });
      }

      throw error;
    }
  }

  async callLLM(model, systemPrompt, userPrompt) {
    try {
      const fetch = (await import('node-fetch')).default;
      
      const response = await fetch(DASHSCOPE_BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + DASHSCOPE_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || 'qwen-plus',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 4000
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error('LLM调用失败: ' + errorText);
      }

      const data = await response.json();
      const { choices, usage } = data;

      return {
        content: choices[0].message.content,
        tokensUsed: usage.total_tokens
      };

    } catch (error) {
      logger.error('LLM调用失败', { model, error: error.message });
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('停止 AgentWorker...');
    await agentQueue.agentQueue.close();
    this.isRunning = false;
    logger.info('✓ AgentWorker 已停止');
  }
}

const worker = new AgentWorker();

if (require.main === module) {
  worker.start();

  process.on('SIGTERM', async () => {
    logger.info('收到 SIGTERM 信号');
    await worker.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('收到 SIGINT 信号');
    await worker.stop();
    process.exit(0);
  });
}

module.exports = worker;

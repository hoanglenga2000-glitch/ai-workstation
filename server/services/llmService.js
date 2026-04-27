// services/llmService.js
const logger = require('../utils/logger');
require('dotenv').config();

const LTCRAFT_BASE_URL = process.env.LTCRAFT_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const LTCRAFT_API_KEY = process.env.LTCRAFT_API_KEY;

class LLMService {
  async chat(model, messages, options = {}) {
    const {
      temperature = 0.7,
      maxTokens = 4000,
      stream = false,
      onChunk = null,
      userId = null
    } = options;

    const startTime = Date.now();

    try {
      const response = await fetch(`${LTCRAFT_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LTCRAFT_API_KEY}`
        },
        body: JSON.stringify({
          model: model || process.env.DEFAULT_MODEL || 'qwen-plus',
          messages,
          temperature,
          max_tokens: maxTokens,
          stream
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`LLM 调用失败: ${error.error?.message || response.statusText}`);
      }

      if (stream && onChunk) {
        let fullContent = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

          for (const line of lines) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices[0]?.delta?.content || '';
              if (delta) {
                fullContent += delta;
                onChunk(delta, fullContent);
              }
            } catch (e) { /* 忽略解析错误 */ }
          }
        }

        return { content: fullContent, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      const usage = data.usage;

      logger.info('LLM 调用成功', {
        model,
        inputTokens: usage?.prompt_tokens,
        outputTokens: usage?.completion_tokens,
        durationMs: Date.now() - startTime,
        userId
      });

      return {
        content,
        usage: {
          inputTokens: usage?.prompt_tokens || 0,
          outputTokens: usage?.completion_tokens || 0,
          totalTokens: usage?.total_tokens || 0
        }
      };

    } catch (error) {
      logger.error('LLM 调用失败', { model, error: error.message });
      throw error;
    }
  }

  recommendModel(taskType, userPlan) {
    const recommendations = {
      article_writer: userPlan === 'free' ? 'qwen-plus' : 'qwen-max',
      seo_content: 'qwen-plus',
      social_media: 'qwen-turbo',
      coding: 'qwen-plus',
      default: 'qwen-plus'
    };

    return recommendations[taskType] || recommendations.default;
  }
}

module.exports = new LLMService();

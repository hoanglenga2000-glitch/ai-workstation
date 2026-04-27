// utils/sanitizer.js
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /forget\s+everything/i,
  /you\s+are\s+now\s+(a|an)/i,
  /act\s+as\s+(if|a|an)/i,
  /system\s*:\s*you\s+are/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
  /###\s*instruction/i,
  /override\s+your\s+(previous\s+)?instructions/i
];

const MAX_LENGTH = 10000;

function sanitize(text) {
  if (typeof text !== 'string') return '';

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error('检测到不安全的输入内容，请修改后重试');
    }
  }

  return text.trim().slice(0, MAX_LENGTH);
}

function sanitizeObject(obj, depth = 0) {
  if (depth > 5) return {};
  if (typeof obj !== 'object' || obj === null) return {};

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitize(value);
    } else if (typeof value === 'object') {
      result[key] = sanitizeObject(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

module.exports = { sanitize, sanitizeObject };

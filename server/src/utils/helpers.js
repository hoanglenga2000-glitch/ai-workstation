'use strict';

function parseJsonColumn(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch (_) { return null; }
}

function toCamelCase(input) {
  if (typeof input === 'string') {
    return input.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
  if (Array.isArray(input)) {
    return input.map(item => toCamelCase(item));
  }
  if (input && typeof input === 'object') {
    const out = {};
    for (const key of Object.keys(input)) {
      out[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = input[key];
    }
    return out;
  }
  return input;
}

function safeTrunc(v) {
  try {
    var s = JSON.stringify(v);
    if (s && s.length > 1200) return '(' + s.length + ' bytes)';
    return v;
  } catch (_) { return null; }
}

module.exports = { parseJsonColumn, toCamelCase, safeTrunc };

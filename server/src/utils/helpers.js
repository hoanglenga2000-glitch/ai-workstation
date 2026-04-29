'use strict';

function parseJsonColumn(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch (_) { return null; }
}

function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function safeTrunc(v) {
  try {
    var s = JSON.stringify(v);
    if (s && s.length > 1200) return '(' + s.length + ' bytes)';
    return v;
  } catch (_) { return null; }
}

module.exports = { parseJsonColumn, toCamelCase, safeTrunc };

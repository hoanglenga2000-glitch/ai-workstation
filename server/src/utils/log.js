'use strict';

function log(level, event, data) {
  const ts = new Date().toISOString();
  const base = { ts, level, event };
  const merged = data ? Object.assign(base, data) : base;
  console.log(JSON.stringify(merged));
}

module.exports = { log };

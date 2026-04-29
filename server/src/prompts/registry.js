'use strict';
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const cache = new Map();

function loadTemplate(name) {
  if (cache.has(name)) return cache.get(name);
  const filePath = path.join(TEMPLATES_DIR, name + '.md');
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  cache.set(name, content);
  return content;
}

function getPrompt(name, vars) {
  let tpl = loadTemplate(name);
  if (!tpl) return null;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      tpl = tpl.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), v || '');
    });
  }
  return tpl;
}

function clearCache() {
  cache.clear();
}

module.exports = { getPrompt, loadTemplate, clearCache };

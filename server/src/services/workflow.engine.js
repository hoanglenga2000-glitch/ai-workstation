'use strict';
const zlib = require('zlib');
const http = require('http');
const https = require('https');
const { safeTrunc } = require('../utils/helpers');

const MINI_RUNNER_TIMEOUT_MS = 30000;
const MINI_RUNNER_MAX_NODES = 50;
const MINI_RUNNER_HTTP_TIMEOUT_MS = 10000;

function _exp(str, ctx) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, function (_, expr) {
    try {
      expr = String(expr).trim();
      var m = expr.match(/^\$node\["([^"]+)"\]\.json(\.[\w\.]+)?$/);
      if (m) { var v = (ctx.nodeOutputs || {})[m[1]]; if (v == null) return ''; return _resolveDot(v, (m[2] || '').slice(1)); }
      var m2 = expr.match(/^\$json(\.[\w\.]+)?$/);
      if (m2) return _resolveDot(ctx.$json || {}, (m2[1] || '').slice(1));
      return '';
    } catch (_) { return ''; }
  });
}

function _resolveDot(obj, path) {
  if (!path) return typeof obj === 'string' ? obj : JSON.stringify(obj);
  var parts = path.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) { if (cur == null) return ''; cur = cur[parts[i]]; }
  if (cur == null) return '';
  return typeof cur === 'string' ? cur : JSON.stringify(cur);
}

function _expDeep(obj, ctx) {
  if (obj == null) return obj;
  if (typeof obj === 'string') return _exp(obj, ctx);
  if (Array.isArray(obj)) return obj.map(function (x) { return _expDeep(x, ctx); });
  if (typeof obj === 'object') { var o = {}; Object.keys(obj).forEach(function (k) { o[k] = _expDeep(obj[k], ctx); }); return o; }
  return obj;
}

async function _doHttp(params, ctx) {
  var url = _exp(params.url || '', ctx);
  if (!url) throw new Error('httpRequest: missing url');
  var method = (params.method || params.requestMethod || 'GET').toUpperCase();
  var headers = {};
  var hp = params.options && params.options.headers && params.options.headers.parameters;
  if (Array.isArray(hp)) hp.forEach(function (h) { if (h.name) headers[_exp(h.name, ctx)] = _exp(h.value || '', ctx); });
  var bodyText = null;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(method) >= 0 || params.sendBody === true) {
    if (typeof params.jsonBody === 'string') { bodyText = _exp(params.jsonBody, ctx); headers['content-type'] = headers['content-type'] || 'application/json'; }
    else if (params.bodyParametersJson) { bodyText = _exp(params.bodyParametersJson, ctx); headers['content-type'] = headers['content-type'] || 'application/json'; }
    else if (params.body) { bodyText = typeof params.body === 'string' ? _exp(params.body, ctx) : JSON.stringify(_expDeep(params.body, ctx)); headers['content-type'] = headers['content-type'] || 'application/json'; }
  }
  var lib = url.startsWith('https:') ? https : http;
  var u = new URL(url);
  var opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + (u.search || ''), method: method, headers: headers, timeout: MINI_RUNNER_HTTP_TIMEOUT_MS };
  return new Promise(function (resolve, reject) {
    var r = lib.request(opts, function (pr) {
      var chunks = [];
      pr.on('data', function (c) { chunks.push(c); });
      pr.on('end', function () {
        var txt = Buffer.concat(chunks).toString('utf-8').slice(0, 100000);
        var parsed; try { parsed = JSON.parse(txt); } catch (_) { parsed = null; }
        resolve({ status: pr.statusCode, body: parsed != null ? parsed : { text: txt } });
      });
    });
    r.on('error', reject);
    r.on('timeout', function () { r.destroy(new Error('http timeout')); });
    if (bodyText) r.write(bodyText);
    r.end();
  });
}

function _doSet(params, ctx) {
  var out = Object.assign({}, ctx.$json || {});
  var strs = params.values && params.values.string;
  if (Array.isArray(strs)) strs.forEach(function (a) { if (a.name) out[a.name] = _exp(a.value || '', ctx); });
  var na = params.assignments && params.assignments.assignments;
  if (Array.isArray(na)) na.forEach(function (a) { if (a.name) out[a.name] = _exp((a.value != null ? String(a.value) : ''), ctx); });
  return out;
}

function _doIf(params, ctx) {
  var conds = (params.conditions && params.conditions.string) || [];
  var comb = (params.combineOperation || 'all');
  var r = conds.map(function (c) {
    var a = _exp(c.value1 || '', ctx); var b = _exp(c.value2 || '', ctx);
    switch (c.operation) {
      case 'equals': case 'equal': return a === b;
      case 'notEqual': case 'notEquals': return a !== b;
      case 'contains': return String(a).indexOf(b) >= 0;
      case 'isEmpty': return !a;
      case 'isNotEmpty': return !!a;
      default: return !!a;
    }
  });
  var pass = comb === 'any' ? r.some(Boolean) : r.every(Boolean);
  return { out: ctx.$json, branch: pass ? 0 : 1 };
}

function _findStarts(nodes, conns) {
  var incoming = new Set();
  Object.keys(conns).forEach(function (src) {
    var main = (conns[src] && conns[src].main) || [];
    main.forEach(function (b) { (b || []).forEach(function (h) { if (h && h.node) incoming.add(h.node); }); });
  });
  return nodes.filter(function (n) {
    if (incoming.has(n.name)) return false;
    var t = String(n.type || '').toLowerCase();
    return t.indexOf('trigger') >= 0 || t.endsWith('.manualtrigger') || t.endsWith('.webhook') || t.endsWith('.start');
  });
}

async function runMiniN8n(def) {
  var t0 = Date.now();
  var trace = [], warnings = [];
  if (!def || !Array.isArray(def.nodes) || !def.nodes.length) return { ok: false, error: 'no nodes', trace, warnings };
  var conns = def.connections || {};
  var nodeMap = {}; def.nodes.forEach(function (n) { nodeMap[n.name] = n; });
  var starts = _findStarts(def.nodes, conns);
  if (!starts.length) starts = [def.nodes[0]];
  var outputs = {}; var visited = 0;

  async function walk(name, $json) {
    if (!name || !nodeMap[name]) return;
    if (Date.now() - t0 > MINI_RUNNER_TIMEOUT_MS) { warnings.push('global timeout'); return; }
    if (visited++ >= MINI_RUNNER_MAX_NODES) { warnings.push('max_nodes ' + MINI_RUNNER_MAX_NODES); return; }
    var n = nodeMap[name]; var t = String(n.type || '').toLowerCase();
    var params = n.parameters || {}; var ctx = { $json: $json || {}, nodeOutputs: outputs };
    var out = $json || {}; var branch = 0; var note;
    try {
      if (t.indexOf('trigger') >= 0 || t.endsWith('.manualtrigger') || t.endsWith('.webhook') || t.endsWith('.start')) { note = 'trigger:passthrough'; }
      else if (t.endsWith('.set') || t.endsWith('.set2')) { out = _doSet(params, ctx); note = 'set ok'; }
      else if (t.endsWith('.httprequest')) { var r = await _doHttp(params, ctx); out = { status: r.status, body: r.body }; note = 'http ' + r.status; }
      else if (t.endsWith('.if')) { var res = _doIf(params, ctx); out = res.out; branch = res.branch; note = 'if ' + (branch === 0 ? 'true' : 'false'); }
      else if (t.endsWith('.noop') || t.indexOf('stickynote') >= 0 || t.indexOf('respondtowebhook') >= 0) { note = 'noop'; }
      else { note = 'SKIPPED (unsupported: ' + n.type + ')'; warnings.push('unsupported_node:' + n.type); }
    } catch (e) { note = 'ERROR: ' + e.message; warnings.push('node_err:' + n.name + ':' + e.message); }
    outputs[n.name] = out;
    trace.push({ node: n.name, type: n.type, note: note, output: safeTrunc(out) });
    var branches = (conns[n.name] && conns[n.name].main) || [];
    var sel = branches[branch] || branches[0] || [];
    for (var i = 0; i < sel.length; i++) { await walk(sel[i].node, out); }
  }

  for (var i = 0; i < starts.length; i++) { await walk(starts[i].name, {}); }
  return { ok: true, trace: trace, warnings: warnings, node_count: def.nodes.length, visited: visited, duration_ms: Date.now() - t0 };
}

module.exports = { runMiniN8n };

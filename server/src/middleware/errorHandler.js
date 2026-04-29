'use strict';
const { log } = require('../utils/log');

function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      log('error', 'handler_error', {
        method: req.method,
        url: req.originalUrl,
        error: err && err.message,
        stack: err && err.stack,
      });
      if (res.headersSent) return;
      res.status(500).json({ error: err && err.message ? err.message : 'internal error' });
    });
  };
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
}

function finalErrorHandler(err, _req, res, _next) {
  log('error', 'unhandled', { error: err && err.message, stack: err && err.stack });
  if (!res.headersSent) {
    res.status(500).json({ error: 'internal error' });
  }
}

module.exports = { asyncRoute, notFoundHandler, finalErrorHandler };

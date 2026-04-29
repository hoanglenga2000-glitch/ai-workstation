'use strict';
const { log } = require('../utils/log');

function requestLogger(req, _res, next) {
  log('info', req.method + ' ' + req.originalUrl, {
    ip: req.ip,
    userAgent: (req.get('User-Agent') || '').slice(0, 120),
  });
  next();
}

module.exports = { requestLogger };

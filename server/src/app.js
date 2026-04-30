'use strict';
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config/index');
const { cookieParser, authGate, seedAdmin } = require('./middleware/auth');
const { rateLimitMiddleware, initRateLimiter } = require('./middleware/rateLimiter');
const { requestLogger } = require('./middleware/requestLogger');
const { notFoundHandler, finalErrorHandler } = require('./middleware/errorHandler');
const routes = require('./routes/index');
const { log } = require('./utils/log');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  // CORS
  app.use(cors({
    origin: ['https://ai.zhjjq.tech', 'http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
  }));

  app.use(express.json({ limit: '10mb' }));

  // Prevent browser from caching API responses
  app.use((req, res, next) => {
    const accept = req.get('Accept') || '';
    if (accept.includes('application/json')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Vary', 'Accept');
    }
    next();
  });

  // Rate limiting
  app.use(rateLimitMiddleware);

  // Cookie parsing
  app.use(cookieParser);

  // Auth enforcement
  app.use(authGate);

  // Request logger
  app.use(requestLogger);

  // Static uploads
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  // All routes
  app.use(routes);

  // 404 + error handlers
  app.use(notFoundHandler);
  app.use(finalErrorHandler);

  return app;
}

module.exports = { createApp, seedAdmin, initRateLimiter };

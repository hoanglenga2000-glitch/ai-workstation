'use strict';
const Redis = require('ioredis');
const config = require('./index');
const { log } = require('../utils/log');

let client = null;

function getRedis() {
  if (!client) {
    client = new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_PASSWORD || undefined,
      db: config.REDIS_DB,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });
    client.on('error', (err) => log('error', 'redis_error', { error: err.message }));
    client.on('connect', () => log('info', 'redis_connected'));
  }
  return client;
}

async function closeRedis() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { getRedis, closeRedis };

module.exports = {
  apps: [{
    name: 'ai-backend',
    script: './index.js',
    cwd: '/www/wwwroot/ai.zhjjq.tech/server',
    instances: 2,
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
    },
    // Graceful shutdown
    kill_timeout: 10000,
    listen_timeout: 5000,
    // Logging
    error_file: '/www/wwwroot/ai.zhjjq.tech/server/logs/error.log',
    out_file: '/www/wwwroot/ai.zhjjq.tech/server/logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
};

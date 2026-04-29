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
    // Zero-downtime reload: wait for 'ready' signal before routing traffic
    wait_ready: true,
    listen_timeout: 15000,
    kill_timeout: 10000,
    // Crash protection: stop if 5 restarts within 30s
    max_restarts: 5,
    min_uptime: 30000,
    // Logging
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
};

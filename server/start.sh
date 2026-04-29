#!/bin/bash
# AI工作站启动脚本

set -e

echo === AI工作站启动脚本 ===
echo 

# 1. 检查Redis
echo 检查Redis...
if ! redis-cli ping > /dev/null 2>&1; then
    echo 启动Redis...
    sudo redis-server /etc/redis/redis.conf --daemonize yes
    sleep 2
fi
echo ✓ Redis运行正常

# 2. 检查MySQL
echo 检查MySQL...
if ! mysql -u ai-zhjjq -p123456 -e SELECT 1 > /dev/null 2>&1; then
    echo ✗ MySQL连接失败
    exit 1
fi
echo ✓ MySQL连接正常

# 3. 停止旧进程
echo 停止旧进程...
pkill -f 'node.*index.js' || true
sleep 2

# 4. 启动Node服务
echo 启动Node服务...
cd /www/wwwroot/ai.zhjjq.tech/server
nohup node index.js > /tmp/ai-workstation.log 2>&1 &
NODE_PID=$!
echo Node进程ID: $NODE_PID

# 5. 等待启动
echo 等待服务启动...
sleep 5

# 6. 健康检查
echo 健康检查...
if curl -s http://127.0.0.1:3100/api/agents > /dev/null; then
    echo ✓ 服务启动成功
    echo 
    echo 服务地址: http://127.0.0.1:3100
    echo 日志文件: /tmp/ai-workstation.log
    echo 
else
    echo ✗ 服务启动失败，查看日志:
    tail -20 /tmp/ai-workstation.log
    exit 1
fi

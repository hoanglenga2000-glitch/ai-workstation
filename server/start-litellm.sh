#!/bin/bash
# LiteLLM 启动脚本

cd /www/wwwroot/ai.zhjjq.tech/server

# 检查是否已运行
if pgrep -f 'litellm --config' > /dev/null; then
    echo "LiteLLM已在运行"
    exit 0
fi

# 启动LiteLLM
nohup litellm --config litellm-config.yaml --port 4000 --host 127.0.0.1 > logs/litellm.log 2>&1 &

sleep 2

if pgrep -f 'litellm --config' > /dev/null; then
    echo "✅ LiteLLM启动成功 (端口4000)"
else
    echo "❌ LiteLLM启动失败"
    exit 1
fi

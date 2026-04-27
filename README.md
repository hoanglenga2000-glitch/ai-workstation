# AI工作站 - ai.zhjjq.tech

一个基于 Shadcn Admin 的 AI 代理管理平台。

## 项目结构

```
.
├── index.html          # 前端入口
├── assets/             # 前端静态资源
├── dist/               # 前端构建产物
├── images/             # 图片资源
├── server/             # 后端服务
│   ├── index.js        # 后端入口
│   ├── package.json    # 后端依赖
│   └── .env.example    # 环境变量示例
└── uploads/            # 上传文件目录
```

## 技术栈

### 前端
- React
- Shadcn UI
- Vite

### 后端
- Node.js
- Express
- MySQL

## 部署

### 前端
前端已构建为静态文件，直接部署 `index.html` 和相关资源即可。

### 后端
```bash
cd server
npm install
cp .env.example .env
# 配置 .env 文件
npm start
```

## 环境变量

后端需要配置以下环境变量（在 `server/.env` 中）：

```
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=ai-zhjjq
PORT=3100
```

## 数据库

使用 MySQL 数据库，包含以下主要表：
- users - 用户表
- agents - AI代理表
- 其他业务表

## License

MIT

# GaoAgent

轻量级本地局域网 AI 助手应用，支持智能对话、视频生成和图片生成功能。

## 功能特性

- **智能对话** - 基于 AI 的多智能体对话系统
- **视频生成** - 使用 Sora2 实现文生视频和图生视频
- **图片生成** - 使用 Nano Banana Pro 实现多图合成
- **角色创建** - 从视频中提取片段创建角色
- **本地优先** - 完全在本地网络运行
- **实时流式传输** - 实时观看生成进度

## 技术栈

### 后端
- Python 3.12+
- FastAPI - 现代异步 Web 框架
- SQLite - 轻量级任务管理数据库
- httpx - 异步 HTTP 客户端

### 前端
- Next.js 16 - React 框架（App Router）
- React 19 - UI 库
- TypeScript - 类型安全开发
- Vercel AI SDK - AI 集成
- Tailwind CSS - 原子化样式

## 项目结构

```
GaoAgent/
├── backend/           # FastAPI 后端
│   ├── main.py       # API 路由和应用入口
│   ├── config.py     # 配置管理
│   ├── tasks.py      # 任务管理逻辑
│   ├── db.py         # 数据库操作
│   ├── streaming.py  # 流处理工具
│   ├── validation.py # 输入验证
│   ├── storage.py    # 文件上传处理
│   └── chat_service.py # 聊天功能
├── web/              # Next.js 前端
│   ├── src/
│   │   ├── app/      # App Router 页面
│   │   ├── components/ # 可复用 React 组件
│   │   ├── hooks/     # 自定义 React Hooks
│   │   └── lib/       # 工具函数
│   └── package.json
├── AgentFramework/   # 智能体实现
├── scripts/          # 开发脚本
└── README.md
```

## 环境要求

- Python 3.12 或更高版本
- Node.js 18 或更高版本
- npm 或 yarn

## 安装

1. **克隆仓库**
```bash
git clone https://github.com/gaochao0609/GaoAgent.git
cd GaoAgent
```

2. **安装后端依赖**
```bash
cd backend
pip install -r requirements.txt
```

3. **安装前端依赖**
```bash
cd web
npm install
```

## 配置

设置以下环境变量：

**后端配置**（在 `backend/` 目录创建 `.env`）：
```env
# Sora API 配置
GRSAI_BASE_URL=https://grsai.dakka.com.cn
GRSAI_API_KEY=your_api_key_here

# LLM 配置（用于聊天）
LLM_API_KEY=your_llm_api_key
LLM_BASE_URL=https://api.openai.com/v1

# 路径配置
UPLOAD_DIR=./uploads
VIDEO_DB_PATH=./video_jobs.sqlite
IMAGE_DB_PATH=./image_jobs.sqlite
CHAT_STATE_DB=./helloagent_state.sqlite
```

**前端配置**（在 `web/` 目录创建 `.env.local`）：
```env
HELLOAGENT_BACKEND_URL=http://localhost:8000
HELLOAGENT_TRACE=1
HELLOAGENT_STREAM_DELTA=1
```

## 使用方法

### 启动后端

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

或使用提供的脚本：
```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

后端 API 将在 `http://localhost:8000` 访问

### 启动前端

```bash
cd web
npm run dev
```

用于局域网访问：
```bash
npm run dev:lan
```

前端将在 `http://localhost:3000` 访问

### 同时启动服务

在项目根目录运行开发脚本：
```bash
npm run all
```

## API 端点

### 聊天
- `POST /api/chat` - 发送聊天消息
- `GET /api/chat/state/{conversation_id}` - 获取对话状态

### 视频
- `POST /api/video/sora` - 生成视频（文生视频或图生视频）
- `POST /api/video/character` - 从上传的视频创建角色
- `POST /api/video/character-from-pid` - 从现有视频创建角色
- `GET /api/tasks/{task_id}` - 获取任务状态

### 图片
- `POST /api/image/nano-banana` - 生成图片

## 开发指南

### 代码规范

- **Python**: 遵循 PEP 8，使用 Black 格式化
- **TypeScript**: 遵循 ESLint 规则，使用 Prettier 格式化

### 生产构建

```bash
cd web
npm run build
npm run start
```

## 架构设计

### 后端架构
- **FastAPI** - 异步 REST API
- **SQLite** - 使用自定义存储抽象的任务持久化
- **流处理** - 通过 NDJSON 实现实时进度更新
- **智能体系统** - 针对不同用例的模块化智能体框架

### 前端架构
- **基于组件** - 模块化 React 组件
- **自定义 Hooks** - 可复用的状态逻辑
- **类型安全** - 完整的 TypeScript 覆盖
- **客户端流式传输** - 实时 UI 更新

## 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 注意事项

- 专为本地网络使用设计
- 需要有效的 Sora2 和 LLM 服务 API 密钥
- 生成的内容存储在本地 SQLite 数据库中
- 支持并发任务处理和进度跟踪

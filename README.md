# GaoAgent

轻量级本地局域网 AI 助手应用，支持智能对话、视频生成和图片生成功能。

## 功能特性
- **智能对话** - 基于多智能体的对话系统
- **视频生成** - 使用 Sora2 实现文生视频和图生视频
- **图片生成** - 使用 Nano Banana Pro 实现多图合成
- **角色创建** - 从视频中截取片段创建角色
- **本地优先** - 全部运行在本地局域网
- **实时流式** - NDJSON 流式返回进度与结果

## 技术栈

### 后端
- Python 3.12+
- FastAPI
- SQLite
- httpx

### 前端
- Next.js 16 (App Router)
- React 19
- TypeScript
- Vercel AI SDK
- Tailwind CSS

## 项目结构

```
GaoAgent/
  backend/
    api/
      chat.py
      image.py
      tasks.py
      video.py
    app.py
    app_state.py
    main.py
    config.py
    chat_service.py
    chat_state.py
    db.py
    tasks.py
    streaming.py
    storage.py
    validation.py
  web/
    src/
      app/
      components/
      hooks/
      lib/
    package.json
  AgentFramework/
  scripts/
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

**后端配置**（在 `backend/` 目录创建 `.env`）
```env
# Sora API
GRSAI_BASE_URL=https://grsai.dakka.com.cn
GRSAI_API_KEY=your_api_key_here

# LLM (用于聊天)
LLM_API_KEY=your_llm_api_key
LLM_BASE_URL=https://api.openai.com/v1

# 存储路径
UPLOAD_DIR=./uploads
VIDEO_DB_PATH=./video_jobs.sqlite
IMAGE_DB_PATH=./image_jobs.sqlite

# 聊天状态库 (二选一，优先 HELLOAGENT_STATE_DB)
HELLOAGENT_STATE_DB=./helloagent_state.sqlite
CHAT_STATE_DB=./helloagent_state.sqlite
```

**前端配置**（在 `web/` 目录创建 `.env.local`）
```env
# Chat API
HELLOAGENT_BACKEND_URL=http://localhost:8000

# Sora 相关代理
SORA_BACKEND_URL=http://localhost:8000/api/video/sora
SORA_CHARACTER_BACKEND_URL=http://localhost:8000/api/video/sora-character
SORA_CHARACTER_FROM_PID_BACKEND_URL=http://localhost:8000/api/video/sora-character-from-pid
NANO_BANANA_BACKEND_URL=http://localhost:8000/api/image/nano-banana

# Chat 额外信息
HELLOAGENT_TRACE=1
HELLOAGENT_STREAM_DELTA=1
```

## 使用方式

### 启动后端

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

或从仓库根目录启动：
```bash
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
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

在项目根目录运行：
```bash
npm run all
```

可通过环境变量调整端口：
```env
BACKEND_PORT=8000
FRONTEND_PORT=3000
HELLOAGENT_PYTHON=python
```

## API 端点

### 后端 FastAPI
- `POST /api/chat`
- `GET /api/chat/state/{conversation_id}`
- `POST /api/video/sora`
- `POST /api/video/sora-character`
- `POST /api/video/sora-character-from-pid`
- `GET /api/tasks/{task_id}`
- `POST /api/image/nano-banana`

### 前端 Next.js 代理
- `POST /api/chat` -> `HELLOAGENT_BACKEND_URL/api/chat`
- `POST /api/video/sora` -> `SORA_BACKEND_URL`
- `POST /api/video/character` -> `SORA_CHARACTER_BACKEND_URL`
- `POST /api/video/character-from-pid` -> `SORA_CHARACTER_FROM_PID_BACKEND_URL`
- `POST /api/image/nano-banana` -> `NANO_BANANA_BACKEND_URL`

## 开发规范

- **Python**: 遵循 PEP 8
- **TypeScript**: 遵循 ESLint/Prettier

## 生产构建

```bash
cd web
npm run build
npm run start
```

## 许可证

本项目采用 MIT 许可证，详见 `LICENSE`。

## 注意事项

- 专为本地局域网使用设计
- 需要有效的 Sora2 和 LLM API 密钥
- 生成内容存储在本地 SQLite 数据库
- 支持并发任务处理和进度跟踪

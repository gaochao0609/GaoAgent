# GaoAgent

A lightweight, local network AI assistant application with chat, video generation, and image generation capabilities.

## Features

- **Smart Chat** - AI-powered conversation system with multiple agent support
- **Video Generation** - Text-to-video and image-to-video using Sora2
- **Image Generation** - Multi-image synthesis with Nano Banana Pro
- **Character Creation** - Extract and create characters from videos
- **Local-first** - Runs entirely on your local network
- **Real-time Streaming** - Watch generation progress in real-time

## Tech Stack

### Backend
- Python 3.12+
- FastAPI - Modern async web framework
- SQLite - Lightweight database for job management
- httpx - Async HTTP client

### Frontend
- Next.js 16 - React framework with App Router
- React 19 - UI library
- TypeScript - Type-safe development
- Vercel AI SDK - AI integration
- Tailwind CSS - Utility-first styling

## Project Structure

```
GaoAgent/
├── backend/           # FastAPI backend
│   ├── main.py       # API routes and application entry
│   ├── config.py     # Configuration management
│   ├── tasks.py      # Job management logic
│   ├── db.py         # Database operations
│   ├── streaming.py  # Stream processing utilities
│   ├── validation.py  # Input validation
│   ├── storage.py    # File upload handling
│   └── chat_service.py # Chat functionality
├── web/              # Next.js frontend
│   ├── src/
│   │   ├── app/      # App router pages
│   │   ├── components/ # Reusable React components
│   │   ├── hooks/     # Custom React hooks
│   │   └── lib/       # Utility functions
│   └── package.json
├── AgentFramework/   # Agent implementations
├── scripts/          # Development scripts
└── README.md
```

## Prerequisites

- Python 3.12 or higher
- Node.js 18 or higher
- npm or yarn

## Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd GaoAgent
```

2. **Install backend dependencies**
```bash
cd backend
pip install -r requirements.txt
```

3. **Install frontend dependencies**
```bash
cd web
npm install
```

## Configuration

Set the following environment variables:

**Backend** (create `.env` in backend/):
```env
# Sora API Configuration
GRSAI_BASE_URL=https://grsai.dakka.com.cn
GRSAI_API_KEY=your_api_key_here

# LLM Configuration (for chat)
LLM_API_KEY=your_llm_api_key
LLM_BASE_URL=https://api.openai.com/v1

# Paths
UPLOAD_DIR=./uploads
VIDEO_DB_PATH=./video_jobs.sqlite
IMAGE_DB_PATH=./image_jobs.sqlite
CHAT_STATE_DB=./helloagent_state.sqlite
```

**Frontend** (create `.env.local` in web/):
```env
HELLOAGENT_BACKEND_URL=http://localhost:8000
HELLOAGENT_TRACE=1
HELLOAGENT_STREAM_DELTA=1
```

## Usage

### Start the Backend

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Or use the provided script:
```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The backend API will be available at `http://localhost:8000`

### Start the Frontend

```bash
cd web
npm run dev
```

For local network access:
```bash
npm run dev:lan
```

The frontend will be available at `http://localhost:3000`

### Start Both Services

Run the development script from the project root:
```bash
npm run all
```

## API Endpoints

### Chat
- `POST /api/chat` - Send chat message
- `GET /api/chat/state/{conversation_id}` - Get conversation state

### Video
- `POST /api/video/sora` - Generate video (text-to-video or image-to-video)
- `POST /api/video/character` - Create character from video upload
- `POST /api/video/character-from-pid` - Create character from existing video
- `GET /api/tasks/{task_id}` - Get task status

### Image
- `POST /api/image/nano-banana` - Generate images

## Development

### Code Style

- **Python**: Follow PEP 8, use Black for formatting
- **TypeScript**: Follow ESLint rules, use Prettier for formatting

### Build for Production

```bash
cd web
npm run build
npm run start
```

## Architecture

### Backend Architecture
- **FastAPI** - REST API with async support
- **SQLite** - Job persistence with custom store abstraction
- **Stream Processing** - Real-time progress updates via NDJSON
- **Agent System** - Modular agent framework for different use cases

### Frontend Architecture
- **Component-based** - Modular React components
- **Custom Hooks** - Reusable stateful logic
- **Type-safe** - Full TypeScript coverage
- **Client-side Streaming** - Real-time UI updates

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is private and confidential.

## Notes

- Designed for local network use only
- Requires valid API keys for Sora2 and LLM services
- Generated content is stored locally in SQLite databases
- Supports concurrent job processing with progress tracking

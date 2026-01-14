#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Starting backend (FastAPI)..."
cd "$repo_root"
uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
backend_pid=$!

echo "Starting frontend (Next.js)..."
cd "$repo_root/web"
npm run dev -- --hostname 0.0.0.0 --port 3000 &
frontend_pid=$!

trap 'kill $backend_pid $frontend_pid' EXIT
wait

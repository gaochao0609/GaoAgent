$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Starting backend (FastAPI)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repoRoot`"; uvicorn backend.main:app --host 0.0.0.0 --port 8000"

Write-Host "Starting frontend (Next.js)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repoRoot\\web`"; npm run dev -- --hostname 0.0.0.0 --port 3000"

Write-Host "Both services started. Frontend: http://<LAN-IP>:3000" -ForegroundColor Green

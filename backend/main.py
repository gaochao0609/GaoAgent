import asyncio
import base64
import uuid
from datetime import datetime
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

try:
  from .config import (
    IMAGE_DB_PATH,
    SORA_API_KEY,
    SORA_BASE_URL,
    UPLOAD_DIR,
    VIDEO_DB_PATH,
    ensure_upload_dir,
    logger,
  )
  from .db import IMAGE_TABLE_SQL, VIDEO_TABLE_SQL, SqliteJobStore
  from .storage import collect_upload_files, save_upload
  from .streaming import stream_ndjson_lines
  from .validation import (
    get_form_text,
    normalize_aspect_ratio,
    normalize_duration,
    normalize_image_aspect_ratio,
    normalize_image_model,
    normalize_image_size,
    normalize_pid,
    normalize_size,
    normalize_timestamps,
    require_api_key,
  )
  from .chat_service import stream_chat_events
  from .chat_state import load_state
  from .tasks import (
    build_headers,
    create_image_job_manager,
    create_video_job_manager,
  )
except ImportError:
  from config import (
    IMAGE_DB_PATH,
    SORA_API_KEY,
    SORA_BASE_URL,
    UPLOAD_DIR,
    VIDEO_DB_PATH,
    ensure_upload_dir,
    logger,
  )
  from db import IMAGE_TABLE_SQL, VIDEO_TABLE_SQL, SqliteJobStore
  from storage import collect_upload_files, save_upload
  from streaming import stream_ndjson_lines
  from validation import (
    get_form_text,
    normalize_aspect_ratio,
    normalize_duration,
    normalize_image_aspect_ratio,
    normalize_image_model,
    normalize_image_size,
    normalize_pid,
    normalize_size,
    normalize_timestamps,
    require_api_key,
  )
  from chat_service import stream_chat_events
  from chat_state import load_state
  from tasks import (
    build_headers,
    create_image_job_manager,
    create_video_job_manager,
  )

ensure_upload_dir()

app = FastAPI(title="Sora2 Proxy API")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

video_store = SqliteJobStore(VIDEO_DB_PATH, "video_jobs", VIDEO_TABLE_SQL)
image_store = SqliteJobStore(IMAGE_DB_PATH, "image_jobs", IMAGE_TABLE_SQL)
video_manager = create_video_job_manager(video_store)
image_manager = create_image_job_manager(image_store)


async def handle_upstream_error(
  response: httpx.Response,
) -> JSONResponse:
  details = (await response.aread()).decode("utf-8", errors="ignore")
  logger.warning("Upstream error %s: %s", response.status_code, details)
  return JSONResponse(
    {"error": "Upstream error", "details": details},
    status_code=response.status_code,
  )


@app.post("/api/chat")
async def chat(request: Request):
  payload = await request.json()
  prompt = (payload.get("prompt") if isinstance(payload, dict) else None) or ""
  prompt = str(prompt).strip()
  if not prompt:
    raise HTTPException(status_code=400, detail="Prompt is required.")

  conversation_id = ""
  if isinstance(payload, dict):
    conversation_id = str(
      payload.get("conversation_id") or payload.get("conversationId") or "default"
    )
  trace = bool(payload.get("trace") if isinstance(payload, dict) else False)
  stream_delta = bool(payload.get("stream_delta") if isinstance(payload, dict) else False)

  return StreamingResponse(
    stream_chat_events(prompt, conversation_id, trace, stream_delta),
    media_type="application/x-ndjson",
  )


@app.get("/api/chat/state/{conversation_id}")
def get_chat_state(conversation_id: str):
  state = load_state(conversation_id)
  if state is None:
    raise HTTPException(status_code=404, detail="Chat state not found.")
  return {"conversation_id": conversation_id, "state": state}


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
  job = video_store.fetch(task_id)
  if job:
    return {
      "id": task_id,
      "type": "video",
      "status": job.get("status"),
      "progress": job.get("progress"),
      "result": {"url": job.get("result_url"), "pid": job.get("pid")},
      "failure_reason": job.get("failure_reason"),
      "error": job.get("error"),
    }

  job = image_store.fetch(task_id)
  if job:
    return {
      "id": task_id,
      "type": "image",
      "status": job.get("status"),
      "progress": job.get("progress"),
      "result": {"url": job.get("result_url"), "content": job.get("result_content")},
      "failure_reason": job.get("failure_reason"),
      "error": job.get("error"),
    }

  state = load_state(task_id)
  if state is not None:
    return {"id": task_id, "type": "chat", "status": "input_required", "state": state}

  raise HTTPException(status_code=404, detail="Task not found.")


@app.post("/api/video/sora")
async def sora_video(request: Request):
  api_key = require_api_key(SORA_API_KEY)

  form = await request.form()
  prompt = get_form_text(form, "prompt").strip()
  mode = get_form_text(form, "mode", default="text").strip().lower()
  aspect_ratio = get_form_text(form, "aspectRatio", "aspect_ratio", default="9:16")
  duration = get_form_text(form, "duration", default="15")
  size = get_form_text(form, "size", default="small")
  remix_target_id = get_form_text(form, "remixTargetId", "remix_target_id").strip()
  image_url = get_form_text(form, "imageUrl", "image_url").strip()
  image = form.get("image")

  cleaned_prompt = prompt.strip()
  if not cleaned_prompt:
    raise HTTPException(status_code=400, detail="Prompt is required.")

  mode_value = "image" if mode == "image" else "text"
  upload_url = ""

  if mode_value == "image":
    if image_url and image_url.strip():
      upload_url = image_url.strip()
    elif isinstance(image, UploadFile):
      if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are supported.")
      _, data = await save_upload(image, UPLOAD_DIR)
      upload_url = base64.b64encode(data).decode("utf-8")
    else:
      raise HTTPException(status_code=400, detail="Image is required for image mode.")

  payload = {
    "model": "sora-2",
    "prompt": cleaned_prompt,
    "aspectRatio": normalize_aspect_ratio(aspect_ratio),
    "duration": normalize_duration(duration),
    "size": normalize_size(size),
  }

  request_id = uuid.uuid4().hex
  video_manager.create_job(
    request_id,
    {
      "prompt": cleaned_prompt,
      "mode": mode_value,
      "aspect_ratio": payload["aspectRatio"],
      "duration": payload["duration"],
      "size": payload["size"],
      "remix_target_id": remix_target_id,
    },
  )

  if upload_url:
    payload["url"] = upload_url
  if remix_target_id:
    payload["remixTargetId"] = remix_target_id

  headers = build_headers(api_key)
  upstream_url = f"{SORA_BASE_URL}/v1/video/sora-video"

  asyncio.create_task(video_manager.run_job(request_id, payload, headers, upstream_url))
  return JSONResponse({"request_id": request_id})


@app.post("/api/video/sora-character")
async def sora_character(request: Request):
  api_key = require_api_key(SORA_API_KEY)

  form = await request.form()
  timestamps_raw = get_form_text(form, "timestamps").strip()
  video = form.get("video")

  if not isinstance(video, UploadFile):
    raise HTTPException(status_code=400, detail="请上传视频文件。")
  if not video.content_type or not video.content_type.startswith("video/"):
    raise HTTPException(status_code=400, detail="仅支持上传视频文件。")

  if not timestamps_raw:
    raise HTTPException(status_code=400, detail="请提供截取范围。")

  timestamps = normalize_timestamps(timestamps_raw)
  _, data = await save_upload(video, UPLOAD_DIR)
  video_base64 = base64.b64encode(data).decode("utf-8")

  payload = {
    "url": video_base64,
    "timestamps": timestamps,
  }

  headers = build_headers(api_key)
  upstream_url = f"{SORA_BASE_URL}/v1/video/sora-upload-character"
  timeout = httpx.Timeout(30.0, read=300.0)

  async with httpx.AsyncClient(timeout=timeout) as client:
    async with client.stream("POST", upstream_url, headers=headers, json=payload) as response:
      if response.status_code >= 400:
        return await handle_upstream_error(response)

      return StreamingResponse(
        stream_ndjson_lines(response),
        media_type="application/x-ndjson",
      )


@app.post("/api/video/sora-character-from-pid")
async def sora_character_from_pid(request: Request):
  api_key = require_api_key(SORA_API_KEY)

  form = await request.form()
  pid = normalize_pid(get_form_text(form, "pid"))
  timestamps_raw = get_form_text(form, "timestamps").strip()
  if not timestamps_raw:
    raise HTTPException(status_code=400, detail="请提供截取范围。")
  timestamps = normalize_timestamps(timestamps_raw)

  payload = {
    "pid": pid,
    "timestamps": timestamps,
  }

  headers = build_headers(api_key)
  upstream_url = f"{SORA_BASE_URL}/v1/video/sora-create-character"
  timeout = httpx.Timeout(30.0, read=300.0)

  async with httpx.AsyncClient(timeout=timeout) as client:
    async with client.stream("POST", upstream_url, headers=headers, json=payload) as response:
      if response.status_code >= 400:
        return await handle_upstream_error(response)

      return StreamingResponse(
        stream_ndjson_lines(response),
        media_type="application/x-ndjson",
      )


@app.post("/api/image/nano-banana")
async def nano_banana(request: Request):
  api_key = require_api_key(SORA_API_KEY)

  form = await request.form()
  prompt = get_form_text(form, "prompt").strip()
  model = normalize_image_model(get_form_text(form, "model", default="nano-banana-pro"))
  aspect_ratio = normalize_image_aspect_ratio(
    get_form_text(form, "aspectRatio", "aspect_ratio", default="auto")
  )
  image_size = normalize_image_size(get_form_text(form, "imageSize", "image_size", default="1K"))

  if not prompt:
    raise HTTPException(status_code=400, detail="Prompt is required.")

  image_files = collect_upload_files(form, "images")
  urls = []
  for image in image_files:
    if not image.content_type or not image.content_type.startswith("image/"):
      raise HTTPException(status_code=400, detail="Only image uploads are supported.")
    _, data = await save_upload(image, UPLOAD_DIR)
    urls.append(base64.b64encode(data).decode("utf-8"))

  payload = {
    "model": model,
    "prompt": prompt,
    "aspectRatio": aspect_ratio,
    "imageSize": image_size,
  }
  if urls:
    payload["urls"] = list(urls)

  request_id = uuid.uuid4().hex
  image_manager.create_job(
    request_id,
    {
      "prompt": prompt,
      "model": model,
      "aspect_ratio": aspect_ratio,
      "image_size": image_size,
      "image_count": len(urls),
    },
  )

  headers = build_headers(api_key)
  upstream_url = f"{SORA_BASE_URL}/v1/draw/nano-banana"

  asyncio.create_task(image_manager.run_job(request_id, payload, headers, upstream_url))
  return JSONResponse({"request_id": request_id})

import asyncio
import base64
import uuid

import httpx
from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

try:
  from ..app_state import AppState
  from ..config import SORA_API_KEY, SORA_BASE_URL, UPLOAD_DIR
  from ..storage import save_upload
  from ..streaming import stream_ndjson_lines
  from ..tasks import build_headers
  from ..validation import (
    get_form_text,
    normalize_aspect_ratio,
    normalize_duration,
    normalize_pid,
    normalize_size,
    normalize_timestamps,
    require_api_key,
  )
  from .common import handle_upstream_error
except ImportError:  # pragma: no cover
  from app_state import AppState
  from config import SORA_API_KEY, SORA_BASE_URL, UPLOAD_DIR
  from storage import save_upload
  from streaming import stream_ndjson_lines
  from tasks import build_headers
  from validation import (
    get_form_text,
    normalize_aspect_ratio,
    normalize_duration,
    normalize_pid,
    normalize_size,
    normalize_timestamps,
    require_api_key,
  )
  from api.common import handle_upstream_error

router = APIRouter()


def _get_state(request: Request) -> AppState:
  return request.app.state.context


async def _image_to_base64(image: UploadFile) -> str:
  if not image.content_type or not image.content_type.startswith("image/"):
    raise HTTPException(status_code=400, detail="Only image uploads are supported.")
  _, data = await save_upload(image, UPLOAD_DIR)
  return base64.b64encode(data).decode("utf-8")


@router.post("/api/video/sora")
async def sora_video(request: Request):
  api_key = require_api_key(SORA_API_KEY)
  state = _get_state(request)

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
      upload_url = await _image_to_base64(image)
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
  state.video_manager.create_job(
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

  asyncio.create_task(state.video_manager.run_job(request_id, payload, headers, upstream_url))
  return JSONResponse({"request_id": request_id})


@router.post("/api/video/sora-character")
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


@router.post("/api/video/sora-character-from-pid")
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

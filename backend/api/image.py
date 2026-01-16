import asyncio
import base64
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

try:
  from ..app_state import AppState
  from ..config import SORA_API_KEY, SORA_BASE_URL, UPLOAD_DIR
  from ..storage import collect_upload_files, save_upload
  from ..tasks import build_headers
  from ..validation import (
    get_form_text,
    normalize_image_aspect_ratio,
    normalize_image_model,
    normalize_image_size,
    require_api_key,
  )
except ImportError:  # pragma: no cover
  from app_state import AppState
  from config import SORA_API_KEY, SORA_BASE_URL, UPLOAD_DIR
  from storage import collect_upload_files, save_upload
  from tasks import build_headers
  from validation import (
    get_form_text,
    normalize_image_aspect_ratio,
    normalize_image_model,
    normalize_image_size,
    require_api_key,
  )

router = APIRouter()


def _get_state(request: Request) -> AppState:
  return request.app.state.context


@router.post("/api/image/nano-banana")
async def nano_banana(request: Request):
  api_key = require_api_key(SORA_API_KEY)
  state = _get_state(request)

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
  state.image_manager.create_job(
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

  asyncio.create_task(state.image_manager.run_job(request_id, payload, headers, upstream_url))
  return JSONResponse({"request_id": request_id})

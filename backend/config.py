import logging
import os
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sora_api")

SORA_BASE_URL = os.getenv("GRSAI_BASE_URL", "https://grsai.dakka.com.cn").rstrip("/")
SORA_API_KEY = os.getenv("GRSAI_API_KEY")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads")).resolve()
VIDEO_DB_PATH = Path(os.getenv("VIDEO_DB_PATH", "./video_jobs.sqlite")).resolve()
IMAGE_DB_PATH = Path(os.getenv("IMAGE_DB_PATH", "./image_jobs.sqlite")).resolve()
CHAT_STATE_DB_PATH = Path(
  os.getenv("HELLOAGENT_STATE_DB") or os.getenv("CHAT_STATE_DB") or "./helloagent_state.sqlite"
).resolve()

SYSTEM_PROMPT_ENABLED = os.getenv("SYSTEM_PROMPT_ENABLED", "true").strip().lower() in {
  "1",
  "true",
  "yes",
  "on",
}

DEFAULT_IMAGE_SYSTEM_PROMPT = (
  "You are an Amazon ecommerce product imaging assistant. "
  "Follow Amazon image policies and the user's request. "
  "If the user does not specify image type, assume MAIN IMAGE.\n"
  "MAIN IMAGE rules: pure white #FFFFFF background, product only, no props "
  "unless part of the product, no text or watermarks, centered, clean lighting.\n"
  "A+ / lifestyle rules: contextual scenes are allowed, but keep product "
  "dominant, realistic scale, no deceptive claims, no copyrighted logos unless provided."
)

DEFAULT_VIDEO_SYSTEM_PROMPT = (
  "You are an Amazon ecommerce product video director. "
  "Follow the user's request and Amazon video policies. "
  "If the user does not specify type, assume a short promo/hero product video.\n"
  "Keep shots clean, stable, and product-focused. Avoid text overlays, "
  "watermarks, and copyrighted assets unless the user explicitly asks."
)

IMAGE_SYSTEM_PROMPT = os.getenv("IMAGE_SYSTEM_PROMPT", DEFAULT_IMAGE_SYSTEM_PROMPT).strip()
VIDEO_SYSTEM_PROMPT = os.getenv("VIDEO_SYSTEM_PROMPT", DEFAULT_VIDEO_SYSTEM_PROMPT).strip()


def ensure_upload_dir() -> None:
  UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

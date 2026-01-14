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
CHAT_STATE_DB_PATH = Path(os.getenv("HELLOAGENT_STATE_DB", "./helloagent_state.sqlite")).resolve()


def ensure_upload_dir() -> None:
  UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

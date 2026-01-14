import uuid
from pathlib import Path
from typing import Iterable

from fastapi import HTTPException, UploadFile

try:
  from .config import logger
except ImportError:  # pragma: no cover
  from config import logger


def collect_upload_files(form, key: str) -> list[UploadFile]:
  files = form.getlist(key) if hasattr(form, "getlist") else []
  return [file for file in files if isinstance(file, UploadFile)]


async def save_upload(file: UploadFile, upload_dir: Path) -> tuple[str, bytes]:
  suffix = Path(file.filename or "").suffix
  filename = f"{uuid.uuid4().hex}{suffix}"
  destination = upload_dir / filename
  buffer = bytearray()
  try:
    with destination.open("wb") as handle:
      while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
          break
        handle.write(chunk)
        buffer.extend(chunk)
  except Exception as exc:
    logger.exception("Failed to save upload %s", file.filename)
    raise HTTPException(status_code=500, detail="Failed to save uploaded file.") from exc
  return filename, bytes(buffer)

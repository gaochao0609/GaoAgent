from typing import Optional

from fastapi import HTTPException


def require_api_key(api_key: Optional[str]) -> str:
  if not api_key:
    raise HTTPException(status_code=500, detail="Missing GRSAI_API_KEY.")
  return api_key


def get_form_text(form, *names: str, default: str = "") -> str:
  for name in names:
    value = form.get(name)
    if value is not None:
      return str(value)
  return default


def normalize_choice(value: Optional[str], allowed: set[str], default: str) -> str:
  if value is None:
    return default
  cleaned = value.strip()
  return cleaned if cleaned in allowed else default


def normalize_aspect_ratio(value: Optional[str]) -> str:
  return normalize_choice(value, {"9:16", "16:9"}, "9:16")


def normalize_duration(value: Optional[str]) -> int:
  try:
    parsed = int(value) if value is not None else 15
  except ValueError:
    return 15
  return parsed if parsed in {10, 15} else 15


def normalize_size(value: Optional[str]) -> str:
  return normalize_choice(value, {"small", "large"}, "small")


def normalize_image_model(value: str) -> str:
  return normalize_choice(value, {"nano-banana-pro", "nano-banana-pro-cl"}, "nano-banana-pro")


def normalize_image_aspect_ratio(value: str) -> str:
  return normalize_choice(
    value,
    {"auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"},
    "auto"
  )


def normalize_image_size(value: str) -> str:
  return normalize_choice(value, {"1K", "2K", "4K"}, "1K")


def normalize_timestamps(value: str) -> str:
  parts = [item.strip() for item in value.split(",")]
  if len(parts) != 2:
    raise HTTPException(status_code=400, detail="截取范围格式应为 开始,结束。")
  try:
    start = float(parts[0])
    end = float(parts[1])
  except ValueError as exc:
    raise HTTPException(status_code=400, detail="截取范围必须为数字秒数。") from exc
  if start < 0 or end <= start:
    raise HTTPException(status_code=400, detail="截取范围必须是有效的起止秒数。")
  if end - start > 3:
    raise HTTPException(status_code=400, detail="截取范围不能超过 3 秒。")
  return f"{start:.2f},{end:.2f}"


def normalize_pid(value: str) -> str:
  cleaned = value.strip()
  if not cleaned:
    raise HTTPException(status_code=400, detail="pid is required.")
  return cleaned

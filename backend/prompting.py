from __future__ import annotations

try:
  from .config import IMAGE_SYSTEM_PROMPT, SYSTEM_PROMPT_ENABLED, VIDEO_SYSTEM_PROMPT
except ImportError:
  from config import IMAGE_SYSTEM_PROMPT, SYSTEM_PROMPT_ENABLED, VIDEO_SYSTEM_PROMPT


def build_prompt(user_prompt: str, kind: str) -> str:
  cleaned = (user_prompt or "").strip()
  if not cleaned:
    return ""
  if not SYSTEM_PROMPT_ENABLED:
    return cleaned

  if kind == "image":
    system_prompt = IMAGE_SYSTEM_PROMPT.strip()
  else:
    system_prompt = VIDEO_SYSTEM_PROMPT.strip()

  if not system_prompt:
    return cleaned

  return f"{system_prompt}\n\nUser prompt:\n{cleaned}"

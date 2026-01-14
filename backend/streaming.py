import json
from typing import Any, AsyncIterator, Callable, Optional


def _sanitize_line(line: str) -> Optional[str]:
  if not line:
    return None
  if line.startswith("data:"):
    line = line[5:].strip()
  if not line:
    return None
  return line


def _parse_payload(line: str) -> Optional[dict[str, Any]]:
  try:
    payload = json.loads(line)
  except json.JSONDecodeError:
    return None
  return payload if isinstance(payload, dict) else None


async def stream_ndjson_lines(
  response,
  on_payload: Optional[Callable[[dict[str, Any]], None]] = None,
) -> AsyncIterator[bytes]:
  async for raw_line in response.aiter_lines():
    line = _sanitize_line(raw_line)
    if not line:
      continue
    payload = _parse_payload(line)
    if payload and on_payload:
      on_payload(payload)
    yield f"{line}\n".encode("utf-8")


def extract_updates(payload: dict[str, Any], result_fields: list[str] | None = None) -> dict[str, object]:
  updates: dict[str, object] = {}
  status = payload.get("status")
  if isinstance(status, str):
    updates["status"] = status
  progress = payload.get("progress")
  if isinstance(progress, (int, float)):
    updates["progress"] = int(progress)
  failure_reason = payload.get("failure_reason")
  if isinstance(failure_reason, str) and failure_reason:
    updates["failure_reason"] = failure_reason
  error_detail = payload.get("error")
  if isinstance(error_detail, str) and error_detail:
    updates["error"] = error_detail
  results = payload.get("results")
  if isinstance(results, list) and results and result_fields:
    first = results[0] if isinstance(results[0], dict) else None
    if first:
      for field in result_fields:
        value = first.get(field)
        if isinstance(value, str) and value:
          updates[field] = value
  return updates


def extract_video_updates(payload: dict[str, Any]) -> dict[str, object]:
  return extract_updates(payload, ["result_url", "pid"])


def extract_image_updates(payload: dict[str, Any]) -> dict[str, object]:
  return extract_updates(payload, ["result_url", "result_content"])

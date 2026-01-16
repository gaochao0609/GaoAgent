from datetime import datetime

import httpx

try:
  from .config import SORA_BASE_URL, logger
  from .db import SqliteJobStore
  from .streaming import extract_updates, stream_ndjson_lines
except ImportError:
  from config import SORA_BASE_URL, logger
  from db import SqliteJobStore
  from streaming import extract_updates, stream_ndjson_lines


VIDEO_RESULT_FIELDS = ["result_url", "pid"]
IMAGE_RESULT_FIELDS = ["result_url", "result_content"]
HTTP_TIMEOUT = httpx.Timeout(30.0, read=300.0)


class JobManager:
  def __init__(self, store: SqliteJobStore, result_fields: list[str]):
    self._store = store
    self._result_fields = result_fields

  def create_job(self, request_id: str, params: dict) -> None:
    job_data = {
      "request_id": request_id,
      "created_at": datetime.utcnow().isoformat(),
      "status": "submitted",
      "progress": 0,
      **params,
    }
    self._store.insert(job_data)

  def update_job(self, request_id: str, **fields) -> None:
    if not fields:
      return
    self._store.update(request_id, fields)

  def complete_job_if_needed(self, request_id: str) -> None:
    job = self._store.fetch(request_id)
    if job and job.get("result_url") and job.get("status") not in {"succeeded", "failed"}:
      self.update_job(request_id, status="succeeded")

  async def run_job(
    self,
    request_id: str,
    payload: dict,
    headers: dict[str, str],
    upstream_url: str,
  ) -> None:
    self.update_job(request_id, status="running")
    try:
      async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        async with client.stream("POST", upstream_url, headers=headers, json=payload) as response:
          if response.status_code >= 400:
            details = (await response.aread()).decode("utf-8", errors="ignore")
            logger.warning("Upstream error %s: %s", response.status_code, details)
            self.update_job(request_id, status="failed", error=details)
            return

          async for _ in stream_ndjson_lines(
            response,
            on_payload=lambda p: self._handle_payload(request_id, p),
          ):
            pass
      self.complete_job_if_needed(request_id)
    except Exception as exc:
      logger.exception("Job %s failed", request_id)
      self.update_job(request_id, status="failed", error=str(exc))

  def _handle_payload(self, request_id: str, payload: dict) -> None:
    updates = extract_updates(payload, self._result_fields)
    if updates:
      self.update_job(request_id, **updates)


def create_video_job_manager(store: SqliteJobStore) -> JobManager:
  return JobManager(store, VIDEO_RESULT_FIELDS)


def create_image_job_manager(store: SqliteJobStore) -> JobManager:
  return JobManager(store, IMAGE_RESULT_FIELDS)


def build_headers(api_key: str) -> dict[str, str]:
  return {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {api_key}",
  }

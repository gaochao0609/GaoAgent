from fastapi import APIRouter, HTTPException, Request

try:
  from ..app_state import AppState
  from ..chat_state import load_state
except ImportError:  # pragma: no cover
  from app_state import AppState
  from chat_state import load_state

router = APIRouter()


def _get_state(request: Request) -> AppState:
  return request.app.state.context


def _build_job_response(task_id: str, job_type: str, job: dict) -> dict:
  if job_type == "video":
    result = {"url": job.get("result_url"), "pid": job.get("pid")}
  else:
    result = {"url": job.get("result_url"), "content": job.get("result_content")}
  return {
    "id": task_id,
    "type": job_type,
    "status": job.get("status"),
    "progress": job.get("progress"),
    "result": result,
    "failure_reason": job.get("failure_reason"),
    "error": job.get("error"),
  }


@router.get("/api/tasks/{task_id}")
def get_task(task_id: str, request: Request):
  state = _get_state(request)

  job = state.video_store.fetch(task_id)
  if job:
    return _build_job_response(task_id, "video", job)

  job = state.image_store.fetch(task_id)
  if job:
    return _build_job_response(task_id, "image", job)

  chat_state = load_state(task_id)
  if chat_state is not None:
    return {"id": task_id, "type": "chat", "status": "input_required", "state": chat_state}

  raise HTTPException(status_code=404, detail="Task not found.")

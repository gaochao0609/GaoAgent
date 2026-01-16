from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

try:
  from ..chat_service import stream_chat_events
  from ..chat_state import load_state
except ImportError:  # pragma: no cover
  from chat_service import stream_chat_events
  from chat_state import load_state

router = APIRouter()


@router.post("/api/chat")
async def chat(request: Request):
  payload = await request.json()
  prompt = (payload.get("prompt") if isinstance(payload, dict) else None) or ""
  prompt = str(prompt).strip()
  if not prompt:
    raise HTTPException(status_code=400, detail="Prompt is required.")

  conversation_id = ""
  if isinstance(payload, dict):
    conversation_id = str(
      payload.get("conversation_id") or payload.get("conversationId") or "default"
    )
  trace = bool(payload.get("trace") if isinstance(payload, dict) else False)
  stream_delta = bool(payload.get("stream_delta") if isinstance(payload, dict) else False)

  return StreamingResponse(
    stream_chat_events(prompt, conversation_id, trace, stream_delta),
    media_type="application/x-ndjson",
  )


@router.get("/api/chat/state/{conversation_id}")
def get_chat_state(conversation_id: str):
  state = load_state(conversation_id)
  if state is None:
    raise HTTPException(status_code=404, detail="Chat state not found.")
  return {"conversation_id": conversation_id, "state": state}

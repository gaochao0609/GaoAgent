import asyncio
import json
import os
import time
from pathlib import Path
from typing import AsyncIterator, Optional

import httpx

try:
  from .chat_state import clear_state, load_state, save_state
  from .config import logger
except ImportError:  # pragma: no cover
  from chat_state import clear_state, load_state, save_state
  from config import logger

_REPO_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_WEATHER_SCRIPT = _REPO_ROOT / "AgentFramework" / "AttractionAgent.py"
_DEFAULT_CODE_SCRIPT = _REPO_ROOT / "AgentFramework" / "AutoGenHelloAgent.py"

WEATHER_SCRIPT = Path(
  os.environ.get("HELLOAGENT_WEATHER_SCRIPT")
  or os.environ.get("HELLOAGENT_SCRIPT")
  or _DEFAULT_WEATHER_SCRIPT
)
CODE_SCRIPT = Path(
  os.environ.get("HELLOAGENT_CODE_SCRIPT")
  or os.environ.get("HELLOAGENT_SCRIPT")
  or _DEFAULT_CODE_SCRIPT
)
PYTHON_BIN = os.environ.get("HELLOAGENT_PYTHON", "python")
INTENT_MODEL = os.environ.get("HELLOAGENT_INTENT_MODEL", "gpt-4o-mini")
MAX_TURNS = int(os.environ.get("HELLOAGENT_MAX_TURNS", "0") or "0")
CHAT_TIMEOUT_SECONDS = int(os.environ.get("HELLOAGENT_TIMEOUT", "300") or "300")

UNKNOWN_REPLY = (
  "当前仅支持：\n"
  "1) 天气查询 + 旅游景点推荐\n"
  "2) 代码开发与技术实现\n"
  "其他功能正在开发中。你可以说“查询北京天气并推荐景点”，或“帮我写一个XXX功能”。"
)


def _final_event(answer: str) -> bytes:
  payload = {"type": "final", "status": "completed", "answer": answer}
  return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _error_event(message: str) -> bytes:
  payload = {"type": "final", "status": "completed", "answer": message}
  return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _has_keyword(text: str, keywords: list[str]) -> bool:
  return any(keyword in text for keyword in keywords)


def detect_intent_by_keyword(prompt: str) -> str:
  normalized = "".join(prompt.split()).lower()
  weather_keywords = ['天气', '气温', '温度', '降雨', '下雨', '晴天', '阴天', '风力', '空气质量', 'aqi']
  travel_keywords = ['旅游', '景点', '出行', '旅行', '攻略', '推荐', '游玩']
  code_keywords = ['写代码', '写个', '写一个', '实现', '开发', '编程', '代码', '脚本', '报错', 'bug', 'python', 'javascript', 'typescript', 'node', '前端', '后端', 'api']

  if _has_keyword(normalized, weather_keywords) and _has_keyword(normalized, travel_keywords):
    return "weather-travel"
  if _has_keyword(normalized, code_keywords):
    return "code"
  return "unknown"



def _parse_intent_label(text: str) -> Optional[str]:
  normalized = text.strip().lower()
  if not normalized:
    return None
  if "weather-travel" in normalized:
    return "weather-travel"
  if "code" in normalized:
    return "code"
  if "unknown" in normalized:
    return "unknown"
  return None


def _build_openai_url(base_url: str) -> str:
  cleaned = base_url.rstrip("/")
  if not cleaned.endswith("/v1"):
    cleaned = f"{cleaned}/v1"
  return f"{cleaned}/chat/completions"


async def detect_intent_with_model(prompt: str) -> Optional[str]:
  api_key = os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
  if not api_key:
    return None
  base_url = os.environ.get("LLM_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1"
  url = _build_openai_url(base_url)
  system = "你是意图分类器，只能输出以下标签之一：weather-travel, code, unknown。只输出标签本身。"
  payload = {
    "model": INTENT_MODEL,
    "messages": [
      {"role": "system", "content": system},
      {"role": "user", "content": f"用户输入：{prompt}"},
    ],
    "temperature": 0,
    "max_tokens": 16,
  }
  headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
  try:
    async with httpx.AsyncClient(timeout=15) as client:
      resp = await client.post(url, headers=headers, json=payload)
      resp.raise_for_status()
      data = resp.json()
  except Exception as exc:
    logger.warning("Intent model request failed: %s", exc)
    return None
  try:
    content = data["choices"][0]["message"]["content"]
  except (KeyError, IndexError, TypeError):
    return None
  return _parse_intent_label(str(content))


async def detect_intent(prompt: str) -> str:
  model_intent = await detect_intent_with_model(prompt)
  if model_intent:
    return model_intent
  return detect_intent_by_keyword(prompt)


def _build_script_payload(
  prompt: str,
  state: Optional[dict],
  trace: bool,
  stream_delta: bool,
) -> dict:
  if state:
    return {
      "state": state,
      "user_input": prompt,
      "trace": trace,
      "stream_delta": stream_delta,
      "stream": True,
    }
  return {"prompt": prompt, "trace": trace, "stream_delta": stream_delta, "stream": True}


async def _spawn_process(script_path: Path) -> asyncio.subprocess.Process:
  args = [PYTHON_BIN, "-u", str(script_path), "--json"]
  if MAX_TURNS > 0:
    args.extend(["--max-turns", str(MAX_TURNS)])
  return await asyncio.create_subprocess_exec(
    *args,
    stdin=asyncio.subprocess.PIPE,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
    env={**os.environ, "PYTHONIOENCODING": "utf-8"},
  )


async def _stream_process(
  process: asyncio.subprocess.Process,
  payload: dict,
  conversation_id: str,
) -> AsyncIterator[bytes]:
  if process.stdin is None or process.stdout is None:
    yield _error_event("Chat process not available.")
    return

  stderr_task = None
  try:
    process.stdin.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    await process.stdin.drain()
    process.stdin.close()

    stderr_task = asyncio.create_task(process.stderr.read() if process.stderr else asyncio.sleep(0))

    deadline = time.monotonic() + CHAT_TIMEOUT_SECONDS

    while True:
      remaining = deadline - time.monotonic()
      if remaining <= 0:
        raise asyncio.TimeoutError("Chat execution timeout")

      line_bytes = await asyncio.wait_for(process.stdout.readline(), timeout=remaining)
      if not line_bytes:
        break
      line = line_bytes.decode("utf-8", errors="ignore").strip()
      if not line:
        continue
      _handle_event_state(line, conversation_id)
      yield f"{line}\n".encode("utf-8")

    await asyncio.wait_for(process.wait(), timeout=max(1, deadline - time.monotonic()))
    if process.returncode != 0:
      stderr = ""
      if stderr_task:
        try:
          stderr = (await stderr_task).decode("utf-8", errors="ignore").strip()
        except Exception:
          stderr = ""
      message = stderr or f"Chat process exited with code {process.returncode}"
      yield _error_event(message)
  except asyncio.TimeoutError:
    yield _error_event("Chat processing timed out.")
  except Exception as exc:
    logger.exception("Chat process failed")
    yield _error_event(f"Chat processing failed: {exc}")
  finally:
    if process.returncode is None:
      process.kill()
      await process.wait()
    if stderr_task:
      stderr_task.cancel()


def _handle_event_state(line: str, conversation_id: str) -> None:
  try:
    payload = json.loads(line)
  except json.JSONDecodeError:
    return
  if not isinstance(payload, dict):
    return
  if payload.get("type") != "final":
    return
  status = payload.get("status")
  if status == "input_required":
    save_state(conversation_id, payload.get("state") or {})
  else:
    clear_state(conversation_id)


async def stream_chat_events(
  prompt: str,
  conversation_id: str,
  trace: bool,
  stream_delta: bool,
) -> AsyncIterator[bytes]:
  conversation_id = conversation_id or "default"
  state = load_state(conversation_id)
  intent = await detect_intent(prompt)
  active_state = state if (state and intent == "code") else None
  if state and active_state is None:
    clear_state(conversation_id)

  if not active_state and intent == "unknown":
    yield _final_event(UNKNOWN_REPLY)
    return

  script_path = CODE_SCRIPT if active_state or intent == "code" else WEATHER_SCRIPT
  if not script_path.exists():
    yield _error_event(f"Script not found: {script_path}")
    return

  payload = _build_script_payload(prompt, active_state, trace, stream_delta)
  process = await _spawn_process(script_path)
  async for chunk in _stream_process(process, payload, conversation_id):
    yield chunk

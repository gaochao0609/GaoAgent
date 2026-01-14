import json
import sqlite3
import threading
from datetime import datetime
from typing import Optional

try:
  from .config import CHAT_STATE_DB_PATH, logger
except ImportError:  # pragma: no cover
  from config import CHAT_STATE_DB_PATH, logger

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
  global _conn
  if _conn is None:
    _conn = sqlite3.connect(str(CHAT_STATE_DB_PATH), check_same_thread=False)
    _conn.execute(
      """
      CREATE TABLE IF NOT EXISTS chat_state (
        conversation_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
      """
    )
    _conn.commit()
  return _conn


def load_state(conversation_id: str) -> Optional[dict]:
  with _lock:
    conn = _get_conn()
    row = conn.execute(
      "SELECT state_json FROM chat_state WHERE conversation_id = ?",
      (conversation_id,),
    ).fetchone()
  if not row:
    return None
  try:
    return json.loads(row[0])
  except json.JSONDecodeError:
    logger.warning("Invalid chat state JSON for %s", conversation_id)
    return None


def save_state(conversation_id: str, state: object) -> None:
  payload = json.dumps(state or {})
  now = datetime.utcnow().isoformat()
  with _lock:
    conn = _get_conn()
    conn.execute(
      "INSERT INTO chat_state (conversation_id, state_json, updated_at) VALUES (?, ?, ?) "
      "ON CONFLICT(conversation_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
      (conversation_id, payload, now),
    )
    conn.commit()


def clear_state(conversation_id: str) -> None:
  with _lock:
    conn = _get_conn()
    conn.execute("DELETE FROM chat_state WHERE conversation_id = ?", (conversation_id,))
    conn.commit()

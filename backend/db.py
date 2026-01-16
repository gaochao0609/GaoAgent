import sqlite3
import threading
from pathlib import Path
from typing import Mapping, Optional

try:
  from .config import logger
except ImportError:  # pragma: no cover
  from config import logger

VIDEO_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS video_jobs (
  request_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  duration INTEGER NOT NULL,
  size TEXT NOT NULL,
  remix_target_id TEXT,
  pid TEXT,
  result_url TEXT,
  status TEXT,
  progress INTEGER,
  failure_reason TEXT,
  error TEXT
)
"""

IMAGE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS image_jobs (
  request_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  image_size TEXT NOT NULL,
  image_count INTEGER NOT NULL,
  result_url TEXT,
  result_content TEXT,
  status TEXT,
  progress INTEGER,
  failure_reason TEXT,
  error TEXT
)
"""


class SqliteJobStore:
  def __init__(self, db_path: Path, table_name: str, create_sql: str, key_column: str = "request_id"):
    self._db_path = db_path
    self._table_name = table_name
    self._create_sql = create_sql
    self._key_column = key_column
    self._lock = threading.Lock()
    self._conn: sqlite3.Connection | None = None

  def _get_conn(self) -> sqlite3.Connection:
    if self._conn is None:
      self._conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
      self._conn.row_factory = sqlite3.Row
      self._conn.execute(self._create_sql)
      self._conn.commit()
    return self._conn

  def insert(self, fields: Mapping[str, object]) -> None:
    if not fields:
      return
    columns = list(fields.keys())
    placeholders = ", ".join(["?"] * len(columns))
    sql = f"INSERT INTO {self._table_name} ({', '.join(columns)}) VALUES ({placeholders})"
    values = [fields[column] for column in columns]
    with self._lock:
      try:
        conn = self._get_conn()
        conn.execute(sql, values)
        conn.commit()
      except sqlite3.Error:
        logger.exception("Failed to insert job into %s", self._table_name)
        raise

  def update(self, key_value: str, fields: Mapping[str, object]) -> None:
    if not fields:
      return
    assignments = [f"{column} = ?" for column in fields.keys()]
    values = list(fields.values()) + [key_value]
    sql = f"UPDATE {self._table_name} SET {', '.join(assignments)} WHERE {self._key_column} = ?"
    with self._lock:
      try:
        conn = self._get_conn()
        conn.execute(sql, values)
        conn.commit()
      except sqlite3.Error:
        logger.exception("Failed to update job %s in %s", key_value, self._table_name)
        raise

  def fetch(self, key_value: str) -> Optional[dict[str, object]]:
    with self._lock:
      try:
        conn = self._get_conn()
        row = conn.execute(
          f"SELECT * FROM {self._table_name} WHERE {self._key_column} = ?",
          (key_value,),
        ).fetchone()
      except sqlite3.Error:
        logger.exception("Failed to fetch job %s from %s", key_value, self._table_name)
        raise
    if row is None:
      return None
    return dict(row)

  def close(self) -> None:
    with self._lock:
      if self._conn is not None:
        self._conn.close()
        self._conn = None

from dataclasses import dataclass

try:
  from .config import IMAGE_DB_PATH, VIDEO_DB_PATH
  from .db import IMAGE_TABLE_SQL, VIDEO_TABLE_SQL, SqliteJobStore
  from .tasks import JobManager, create_image_job_manager, create_video_job_manager
except ImportError:  # pragma: no cover
  from config import IMAGE_DB_PATH, VIDEO_DB_PATH
  from db import IMAGE_TABLE_SQL, VIDEO_TABLE_SQL, SqliteJobStore
  from tasks import JobManager, create_image_job_manager, create_video_job_manager


@dataclass(frozen=True)
class AppState:
  video_store: SqliteJobStore
  image_store: SqliteJobStore
  video_manager: JobManager
  image_manager: JobManager


def build_app_state() -> AppState:
  video_store = SqliteJobStore(VIDEO_DB_PATH, "video_jobs", VIDEO_TABLE_SQL)
  image_store = SqliteJobStore(IMAGE_DB_PATH, "image_jobs", IMAGE_TABLE_SQL)
  return AppState(
    video_store=video_store,
    image_store=image_store,
    video_manager=create_video_job_manager(video_store),
    image_manager=create_image_job_manager(image_store),
  )

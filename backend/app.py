from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

try:
  from .api.chat import router as chat_router
  from .api.image import router as image_router
  from .api.tasks import router as tasks_router
  from .api.video import router as video_router
  from .app_state import build_app_state
  from .config import UPLOAD_DIR, ensure_upload_dir
except ImportError:  # pragma: no cover
  from api.chat import router as chat_router
  from api.image import router as image_router
  from api.tasks import router as tasks_router
  from api.video import router as video_router
  from app_state import build_app_state
  from config import UPLOAD_DIR, ensure_upload_dir


def create_app() -> FastAPI:
  ensure_upload_dir()

  app = FastAPI(title="Sora2 Proxy API")
  app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
  app.state.context = build_app_state()

  app.include_router(chat_router)
  app.include_router(tasks_router)
  app.include_router(video_router)
  app.include_router(image_router)

  @app.on_event("shutdown")
  def _shutdown() -> None:
    context = app.state.context
    context.video_store.close()
    context.image_store.close()

  return app

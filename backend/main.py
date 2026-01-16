try:
  from .app import create_app
except ImportError:  # pragma: no cover
  from app import create_app

app = create_app()

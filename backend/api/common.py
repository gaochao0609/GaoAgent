import httpx
from fastapi.responses import JSONResponse

try:
  from ..config import logger
except ImportError:  # pragma: no cover
  from config import logger


async def handle_upstream_error(response: httpx.Response) -> JSONResponse:
  details = (await response.aread()).decode("utf-8", errors="ignore")
  logger.warning("Upstream error %s: %s", response.status_code, details)
  return JSONResponse(
    {"error": "Upstream error", "details": details},
    status_code=response.status_code,
  )

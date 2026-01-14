import json
import sys
from typing import Any, Dict, Optional


def _read_input() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def _print(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _parse_local_obs_time(value: str):
    try:
        from datetime import datetime
    except Exception:
        return None
    for fmt in ("%Y-%m-%d %I:%M %p", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _parse_observation_time(value: str):
    try:
        from datetime import datetime
    except Exception:
        return None
    for fmt in ("%I:%M %p", "%H:%M"):
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            continue
    return None


def _infer_utc_offset(local_dt, obs_time_raw: str):
    try:
        from datetime import datetime, timedelta
    except Exception:
        return None
    obs_time = _parse_observation_time(obs_time_raw)
    if not obs_time or not local_dt:
        return None
    candidates = [
        datetime.combine(local_dt.date(), obs_time),
        datetime.combine(local_dt.date() - timedelta(days=1), obs_time),
        datetime.combine(local_dt.date() + timedelta(days=1), obs_time),
    ]
    for utc_dt in candidates:
        offset = local_dt - utc_dt
        hours = offset.total_seconds() / 3600
        if -12 <= hours <= 14:
            return offset
    return None


def _day_period_from_hour(hour: int) -> str:
    return "夜间" if hour < 6 or hour >= 18 else "白天"


def main() -> int:
    try:
        payload = _read_input()
    except json.JSONDecodeError as exc:
        _print({"ok": False, "error": f"invalid input json: {exc}"})
        return 0

    city = str(payload.get("city", "")).strip()
    if not city:
        _print({"ok": False, "error": "missing city"})
        return 0

    try:
        import requests
    except ModuleNotFoundError:
        _print({"ok": False, "error": "missing requests package"})
        return 0

    url = f"https://wttr.in/{city}?format=j1"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        current_condition = data["current_condition"][0]
        local_time_raw = str(current_condition.get("localObsDateTime", "")).strip()
        observation_time_raw = str(current_condition.get("observation_time", "")).strip()
    except requests.exceptions.RequestException as exc:
        _print({"ok": False, "error": f"time request failed: {exc}"})
        return 0
    except (KeyError, IndexError, TypeError) as exc:
        _print({"ok": False, "error": f"invalid time data: {exc}"})
        return 0

    if not local_time_raw:
        _print({"ok": False, "error": "missing local time in response"})
        return 0

    local_dt = _parse_local_obs_time(local_time_raw)
    offset = _infer_utc_offset(local_dt, observation_time_raw) if local_dt else None
    local_now = None
    if offset is not None:
        from datetime import datetime
        local_now = datetime.utcnow() + offset

    local_display = (
        local_now.strftime("%Y-%m-%d %I:%M %p") if local_now else local_time_raw
    )
    if local_now:
        period = _day_period_from_hour(local_now.hour)
    elif local_dt:
        period = _day_period_from_hour(local_dt.hour)
    else:
        period = None
    result = f"{city}本地时间:{local_display}"
    if period:
        result = f"{result}，时段:{period}"
    if local_time_raw and local_time_raw != local_display:
        result = f"{result}，观测时间:{local_time_raw}"

    _print({"ok": True, "result": result})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

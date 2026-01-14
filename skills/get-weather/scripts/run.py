import json
import sys
from typing import Any, Dict

def _read_input() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def _print(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


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
        weather_desc = current_condition["weatherDesc"][0]["value"]
        temp_c = current_condition["temp_C"]
    except requests.exceptions.RequestException as exc:
        _print({"ok": False, "error": f"weather request failed: {exc}"})
        return 0
    except (KeyError, IndexError) as exc:
        _print({"ok": False, "error": f"invalid weather data: {exc}"})
        return 0

    result = f"{city}当前天气:{weather_desc}，气温{temp_c}摄氏度"
    _print({"ok": True, "result": result})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

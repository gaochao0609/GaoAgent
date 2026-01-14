import json
import os
import sys
from typing import Any, Dict

TRAVEL_KEYWORDS = [
    "旅游",
    "景点",
    "景区",
    "游玩",
    "攻略",
    "推荐",
    "夜游",
    "室内",
    "博物馆",
    "公园",
    "attraction",
    "tour",
    "travel",
    "museum",
    "park",
    "night",
]


def _read_input() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def _print(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))

def _normalize_time_period(value: str) -> str:
    normalized = value.strip().lower()
    if not normalized:
        return ""
    if normalized in {"night", "nighttime", "evening"}:
        return "夜间"
    if normalized in {"day", "daytime", "morning", "afternoon"}:
        return "白天"
    return value.strip()


def _looks_relevant(text: str) -> bool:
    if not text:
        return False
    lowered = text.lower()
    for keyword in TRAVEL_KEYWORDS:
        if keyword in text or keyword in lowered:
            return True
    return False


def main() -> int:
    try:
        payload = _read_input()
    except json.JSONDecodeError as exc:
        _print({"ok": False, "error": f"invalid input json: {exc}"})
        return 0

    city = str(payload.get("city", "")).strip()
    weather = str(payload.get("weather", "")).strip()
    local_time = str(payload.get("local_time", "")).strip()
    time_period = _normalize_time_period(str(payload.get("time_period", "")).strip())
    temperature_c = str(payload.get("temperature_c", "")).strip()
    if not city:
        _print({"ok": False, "error": "missing city"})
        return 0
    if not weather:
        _print({"ok": False, "error": "missing weather"})
        return 0
    if not local_time:
        _print({"ok": False, "error": "missing local_time"})
        return 0

    try:
        from tavily import TavilyClient
    except ModuleNotFoundError:
        _print({"ok": False, "error": "missing tavily package"})
        return 0

    tavily_api_key = os.environ.get("TAVILY_API_KEY")
    if not tavily_api_key:
        _print({"ok": False, "error": "missing TAVILY_API_KEY"})
        return 0

    tavily = TavilyClient(api_key=tavily_api_key)
    time_hint = [f"当地时间:{local_time}"]
    if time_period:
        time_hint.append(f"时段:{time_period}")
    if temperature_c:
        time_hint.append(f"气温:{temperature_c}°C")
    query = (
        f"{city} 旅游 景点 景区 推荐 游玩 线路。天气:{weather}。"
        f"{'，'.join(time_hint)}。请优先推荐与时段匹配的景点，夜间更偏向室内或夜游。"
        "请给出2-4个景点和简短理由。"
    )

    try:
        response = tavily.search(query=query, search_depth="basic", include_answer=True)
    except Exception as exc:
        _print({"ok": False, "error": f"tavily search failed: {exc}"})
        return 0

    if response.get("answer") and _looks_relevant(response["answer"]):
        _print({"ok": True, "result": response["answer"]})
        return 0

    formatted_results = []
    for result in response.get("results", []):
        title = result.get("title", "")
        content = result.get("content", "")
        combined = f"{title} {content}"
        if not _looks_relevant(combined):
            continue
        formatted_results.append(f"- {title}: {content}")

    if not formatted_results:
        _print(
            {
                "ok": True,
                "result": "抱歉，没有找到相关的旅游景点推荐。请尝试使用中文城市名或更具体的需求（例如“夜间室内景点”）。",
            }
        )
        return 0

    _print({"ok": True, "result": "根据搜索，为您找到以下信息:\n" + "\n".join(formatted_results)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

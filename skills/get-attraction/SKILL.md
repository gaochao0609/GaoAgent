---
name: get-attraction
description: Recommend attractions for a city based on real weather and local time. Use after a successful get-weather and get-local-time call for the same city when the user asks for travel recommendations.
---

# Get Attraction

## Call
Use `run_skill(name="get-attraction", city="...", weather="...", local_time="...", time_period="...", temperature_c="...")`.

## Requirements
- Ensure the `tavily` package is available.
- Ensure `TAVILY_API_KEY` is set in the environment.

## Steps
1. Ensure you already ran `get-weather` and `get-local-time` for the same city.
2. Pass the same city, weather string, and local time into this skill.
3. Optionally pass `time_period` (e.g., 夜间/白天 or night/day) and `temperature_c` to improve recommendations.
4. Summarize the returned recommendations for the user and align them with the time of day.

## Constraints
- If you do not have a real weather result, call `get-weather` first.
- If you do not have a real local time result, call `get-local-time` first.
- `local_time` is required; do not call this skill without it.
- If the result indicates an error, explain and stop.

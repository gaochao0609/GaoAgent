---
name: get-weather
description: Fetch real-time weather for a city. Use when the user asks about current weather or temperature, or when recommendations depend on real weather.
---

# Get Weather

## Call
Use `run_skill(name="get-weather", city="...")`.

## Requirements
- Ensure the `requests` package is available.

## Steps
1. Use the user's city name as `city`.
2. Call the skill to fetch real weather.
3. Pass the returned weather string as `weather` when calling `get-attraction`.

## Constraints
- Do not guess weather; always run the skill.
- If the result indicates an error, explain and stop.

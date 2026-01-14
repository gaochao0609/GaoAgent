---
name: get-local-time
description: Fetch local time for a city. Use when recommendations depend on time of day or to avoid suggesting outdoor attractions at night.
---

# Get Local Time

## Call
Use `run_skill(name="get-local-time", city="...")`.

## Requirements
- Ensure the `requests` package is available.

## Steps
1. Use the user's city name as `city`.
2. Call the skill to get the local time and time period.
3. Use the returned local time to decide whether it is day or night before recommending attractions.

## Constraints
- Do not guess local time; always run the skill.
- If the result indicates an error, explain and stop.

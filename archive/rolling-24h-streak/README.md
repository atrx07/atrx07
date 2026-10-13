# Rolling 24-hour streak experiment

Status: retired successfully on 2026-10-13.

This was a custom, deliberately harsher GitHub activity streak tracker. Unlike the normal calendar-day contribution streak, a chain only continued when the next qualifying activity arrived within a rolling 24-hour inactivity window. Same-day activity refreshed the window without incrementing the day count.

## Result

- Personal best: **13 days**
- Time zone: `Asia/Kolkata`
- Tracked qualifying GitHub activity such as default-branch pushes, repository creation, issues, pull requests, reviews, discussions, and forks.
- Added a direct default-branch commit fallback after the public Events feed once lagged behind a real Traelyx push.
- Explicitly excluded the `atrx07/atrx07` profile repository so the updater could never extend its own streak.

The experiment worked, including the feed-lag recovery, but it was retired because the public profile now uses the conventional GitHub calendar-style streak. That metric is more recognizable and avoids a valid daily contribution being treated as a broken chain solely because two activities were more than 24 hours apart.

## Historical implementation

The live workflow, generated state, SVG card, scripts, and tests were removed from the current tree when this experiment was retired. The complete implementation remains available in repository history. Useful milestones include:

- `9881943` — hardened push detection
- `b7c61c5` — direct commit fallback
- `b52db29` — profile-repo self-feed exclusion
- `f8ea9d3` — cleanup of accidental profile-repo state

This archive is documentation only. Nothing here runs on a schedule or affects the current profile README.

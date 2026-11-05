# V7.5 — Test Report

- Baseline: V7.4 NPC seat protection full source
- `npm run check`: PASS
- `FORCE_COLOR=0 npm test`: 128 tests, 127 pass, 0 fail, 1 skip
- Added: tests/v75-character-camera-pivot.test.js — standing, seated, moving orbit targets; preserved angle/distance; initial bounds
- Updated camera-specific expectations in existing tests for V5.1/V6.5/V6.6
- No server logic, database schema, auth or rankings modified
- Limitation: Real mobile GPU / Railway runtime validation is required after deployment

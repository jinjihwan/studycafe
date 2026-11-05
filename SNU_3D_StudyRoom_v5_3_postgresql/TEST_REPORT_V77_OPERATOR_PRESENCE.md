# V7.7 test report - Combined presence and operator-only split

## Scope
- Public: compact `학습자 N명` (real online users + virtual attendees)
- Operator: Google account required, matching Railway `STUDYROOM_OPERATOR_FRIEND_CODE`
- Operator panel within existing account dialog: `실제 N명 · 가상 N명 · 합계 N명`
- Disclosure: total includes virtual learners; it must not be described as real connections
- No NPC schedule, seat, ranking, chat or study-timer changes

## Automated checks
- `npm run check`: PASSED
- `FORCE_COLOR=0 npm test`: 133 passed, 0 failed, 1 skipped (PostgreSQL live environment not configured)
- Operator route: rejects non-GET, unauthorized/cross-origin/rate-limited requests, and unconfigured operator
- Operator route: only returns success for an authenticated account matching the configured code
- Public count: numeric total and no visible per-type count

## Responsive visual check
- Static CSS / dialog rendered in Chromium for widths 320, 360, 390, 430, 768, 1280px
- No page-wide horizontal overflow; operator panel remained within the account modal

## Known limits / production validation
- The WebSocket NPC states remain necessary for 3D avatar rendering and may be inspected by a technically knowledgeable client. The operator-only panel is not cryptographic secrecy of the split.
- Real Railway + Firebase Google login and production PostgreSQL tests require deployment validation.
- Operator needs to configure Railway variable `STUDYROOM_OPERATOR_FRIEND_CODE` to the account's own `ST-XXXXXXXXXX` friend code. No operator code was embedded in source.

# V7.4 — NPC occupied seats stay occupied

Base version: V7.3 ranking minimal, no first-visit tutorial.

## Changes

- An occupied NPC chair is now rejected server-side with `seat_occupied`.
- The server **never evicts or relocates an NPC as a consequence of a human seat request**.
- The client immediately shows `이미 사용 중이거나 예약된 좌석입니다.` when an NPC seat lock (or occupied avatar seat) is present.
- Attempting a blocked chair does not cancel the human's existing seat, route, or reservation.
- Empty chairs work as before. After an NPC naturally leaves the room and its lock is released, a chair can be occupied normally.
- The 144 NPC population, study rhythms, ranking, logging, friends, login and 3D appearance are unchanged.

## Implementation

- `server/room.js`: remove the virtual-seat eviction loop; return `seat_occupied` without mutating locks or player state.
- `index.html`: treat `phase:'npc'` seat locks as occupied, the same as a human's seat.
- Regression tests updated to select actually free seats instead of assuming chair #0 is free.
- New `tests/v74-npc-seat-non-eviction.test.js` covers all three campuses and a seated user's unchanged state.

## Deployment

Unzip the PHONE_GITHUB_UPDATE archive into the repository root. The directory inside the archive is `SNU_3D_StudyRoom_v5_3_postgresql`.

Run:

```sh
cd SNU_3D_StudyRoom_v5_3_postgresql
npm run check
FORCE_COLOR=0 npm test
```

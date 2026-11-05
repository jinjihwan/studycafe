# V7.4 Test report

## What is verified

- NPC-occupied seats are rejected with `seat_occupied` (not `seat_granted`) on the server.
- An NPC never leaves its assigned seat due to a human request.
- The server does not broadcast a temporary free-seat update for rejected requests.
- A human already sitting elsewhere retains their occupied chair and study state.
- Main, Korea and Yonsei primary rooms follow the same rule.
- Existing room-isolation and real-human seat locking still work with free seats.
- Client rejects NPC-occupied chairs immediately while retaining the server authority.

## Commands

- `npm run check`
- `FORCE_COLOR=0 npm test`

(Updated results are generated in the execution log before packaging.)

## Limitations

- The PostgreSQL live integration test requires dedicated PG test credentials and is skipped in the normal local suite.
- A full end-to-end mobile WebGL visual test and live Railway deployment are not covered by these tests.

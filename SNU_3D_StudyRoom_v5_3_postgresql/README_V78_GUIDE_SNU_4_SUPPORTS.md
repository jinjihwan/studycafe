# V7.8 — Image guide / Seoul supports / Ranking note

This is a focused patch on V7.7.

## Changes

1. Top-right guide button (question mark) between invite and account. It opens a modal containing the provided portrait JPEG. The `×` control, Escape, and backdrop close the modal; keyboard focus is restored to the guide button. Does not automatically open on first entry.
2. Temporary image stored at `assets/guide.jpg`; server exposes only this exact static path with `image/jpeg` MIME and normal CSP. Replace the contents with a new JPEG under the same filename to update the image later. The original uploaded image is embedded byte-for-byte, without modifying its visible text.
3. Seoul library A-shaped structural supports reduced from eight to four (two z stations on each side: -18 and 20). The authoritative server collision feet are changed in lockstep with the client geometry, preventing invisible obstacles. Seating and library switching are unchanged.
4. Remove "virtual learners included" wording from the ranking heading and footer; other count disclosures in the account area stay in place. Rankings themselves still include the same virtual participants and real users.
5. Mobile header uses a content-flexing room summary so the invite, guide, and account icons remain distinct without horizontal clipping.

## No changes

NPC 144 schedule, rank computation, chair occupancy, guest/Google login, operator-only count, study time, invite link, chat, and first-visit avatar selector.

## Replacing the image

Upload a different JPEG named `guide.jpg` to `SNU_3D_StudyRoom_v5_3_postgresql/assets/guide.jpg` (same path) and push; a Railway redeploy will serve the new image. The app currently displays the exact attached 864×1536 temporary JPEG.

## Testing

`npm run check` and `FORCE_COLOR=0 npm test` plus browser static rendering at 320/360/390/430/768/1280px.

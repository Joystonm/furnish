---
test: ../every-room-can-be-walked-to-2_test.md
status: passed
started: 2026-11-14T08:37:01.900Z
duration_s: 104.5
session_id: e61b461f-9b5f-443a-8e8e-b7a9152cbbd2
---

# Session: every-room-can-be-walked-to — Result

## Step 1 ✓ passed (104.5s)
md5: b7556a855dd1ca8db23a1da918d40977
Open the home-design studio at http://localhost:5199.

Every room must be reachable on foot from the front door, and there must be a front door on the street side. Do exactly this:

1. Read the status bar along the bottom of the screen and record the fraction next to Rooms reachable, for example 4 of 7.
2. Read the findings panel on the right and record every finding that says a room cannot be reached, with the room name it gives.
3. Click the Floor 2 tab, read the findings panel again, and record any room on that storey that cannot be reached.
4. Assert there is a front door drawn on the drawing: an opening on the bottom, street-facing wall of the building, marked as a door with a swing arc.
5. Assert the number of reachable rooms equals the total number of rooms shown in the status bar.

Report every room that cannot be walked to, or state plainly that there were none. Finish with the reachable fraction, the total, and the result of each assertion.

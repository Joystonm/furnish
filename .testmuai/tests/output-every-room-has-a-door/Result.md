---
test: ../every-room-has-a-door_test.md
status: passed
started: 2026-11-13T17:49:54.352Z
duration_s: 79.1
session_id: 2a15466a-dc68-406d-ba0f-2b07ee9ce3c4
---

# Session: every-room-has-a-door — Result

## Step 1 ✓ passed (79.1s)
md5: dc6dfee772e9fdca99f722f7e1f83362
Open the home-design studio at http://localhost:5199.

Every room on the plan must have at least one door. Do exactly this:

1. Read the findings panel on the right side of the screen, on the Ground floor.
2. Look for any finding whose text says a room has no door, and record the room name it gives.
3. Click the Floor 2 tab and read the findings panel again, recording any finding that says a room has no door on that storey.
4. Read the status bar along the bottom of the screen and record the numbers next to Rooms reachable and errors.
5. Assert that no finding anywhere says a room has no door.

Report every room named in such a finding, or state plainly that there were none. Finish with the numbers from the status bar and the result of the assertion.

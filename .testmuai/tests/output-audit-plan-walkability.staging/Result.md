---
test: ../audit-plan-walkability_test.md
status: failed
started: 2026-11-13T09:49:02.615Z
duration_s: 209.4
session_id: 93cc86b5-2165-4dbb-bec0-549db52ed7b9
---

# Session: audit-plan-walkability — Result

## Step 1 ✗ failed (209.4s)
md5: fedf7f20bc14c8a76c115432de3615dd
Reason: Checkpoint assertion failed: "The drawing shows a north point and a scale bar, and the ground floor drawing shows a staircase with treads and a door into it."
Open the home-design studio at http://localhost:5199 and audit the floor plan it draws.

The app's contract, in one line: it turns a brief into a program of rooms, draws them as a plan, then checks its own drawing. Every room must have a door; every room must be reachable on foot from the front door; the staircase must have a door into it and be walkable to; no furniture may stand in the floor in front of a door; the drawing must show a north point and a scale bar.

Do exactly this:
1. Read the storey tabs and the findings panel on the right. Record every finding and the room it names.
2. Read the status bar along the bottom and record the numbers for rooms reachable and errors.
3. Click the 'Floor 2' tab and record the findings for the upper storey.
4. Assert the drawing shows a north point and a scale bar, and that the ground floor drawing shows a staircase with treads and a door into it.
5. Assert every room drawn on the ground floor is one the findings panel says has a door and is reachable.

Finish with a plain list: each room with no door, each room that cannot be reached, whether the staircase has a door, and whether any piece of furniture stands in a doorway.

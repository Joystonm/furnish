---
test: ../opens-on-a-plan_test.md
status: passed
started: 2026-11-13T17:47:41.764Z
duration_s: 65.9
session_id: 0285038e-1120-4aab-b269-b6f4d5a9baa4
---

# Session: opens-on-a-plan — Result

## Step 1 ✓ passed (65.9s)
md5: bcc9deac792b8036c9201fe4d759d188
Open the home-design studio at http://localhost:5199.

The app must open on a drawn floor plan, never on an empty canvas. Do exactly this:

1. Wait for the page to settle. Read the drawing in the middle of the screen.
2. Assert the drawing is not empty. It must show the plot boundary as a dashed line, the building inside it, and at least three rooms with walls between them.
3. Assert the drawing contains a north point, marked N, and a scale bar marked 0 and 2 m.
4. Assert the ground floor drawing contains a staircase: a flight drawn with a series of parallel tread lines and an arrow showing which way it rises.
5. Assert at least one door is drawn with a quarter-circle swing arc and a straight leaf line.
6. Assert every room on the drawing carries a name and an area in square metres.

Report which of these you saw and which you did not. Finish with a plain list of each assertion and whether it held.

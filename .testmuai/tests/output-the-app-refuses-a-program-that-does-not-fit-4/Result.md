---
test: ../the-app-refuses-a-program-that-does-not-fit-4_test.md
status: failed
started: 2026-11-14T09:32:54.225Z
duration_s: 70.9
session_id: c6512125-36f6-4c93-a45f-688b81df3eb3
---

# Session: the-app-refuses-a-program-that-does-not-fit — Result

## Step 1 ✗ failed (70.9s)
md5: b0a6de3bac233779d03176672b21e2e2
Reason: Child agent failed: Final verification failed: "the app must refuse and say by how much it does not fit, and must not draw a plan that does not fit"
Open the home-design studio at http://localhost:5199.

If the program cannot fit the plot, the app must refuse and say by how much it does not fit, and must not draw a plan that does not fit. Do exactly this:

1. Read the current plot width and depth shown in the brief panel on the left.
2. Set the plot width to 6 and the plot depth to 5, using the two number inputs.
3. Click the Generate the plan button.
4. Assert a refusal is shown: a red box saying the program does not fit the plot, with a detail line that gives the area asked for and the area the plot holds.
5. Assert the canvas in the middle no longer shows a drawing of rooms that do not fit.
6. Set the plot width back to 18 and the plot depth back to 14, click Generate the plan, and assert a drawing comes back.

Report the wording of the refusal and the numbers it gives. Finish with the result of each assertion.

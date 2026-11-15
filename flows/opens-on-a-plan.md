# The app opens on a drawn plan

**Covers:** acceptance criteria 1, 3 and 4.

## Objective

Open the home-design studio at {{APP_URL}}.

The app must open on a drawn floor plan, never on an empty canvas. Do exactly this:

1. Open the home page and wait for the page to settle. Read the plan drawn in the card on the page.
2. Assert the drawing is not empty. It must show the plot boundary as a dashed line, the building inside it, and at least three rooms with walls between them.
3. Assert the drawing contains a north point, marked N, and a scale bar marked 0 and 2 m.
4. Assert the ground floor drawing contains a staircase: a flight drawn with a series of parallel tread lines and an arrow showing which way it rises.
5. Assert at least one door is drawn with a quarter-circle swing arc and a straight leaf line.
6. Assert every room on the drawing carries a name and an area in square metres.
7. Open {{APP_URL}}/studio. If the brief dialog is over the canvas, close it with the skip button in its top corner, then read the canvas in the middle of the screen and assert the same thing: a drawn plan, not an empty canvas.

Report which of these you saw and which you did not. Finish with a plain list of each assertion and whether it held.

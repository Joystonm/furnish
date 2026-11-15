# The app says when a program does not fit

**Covers:** acceptance criterion 16.

## Objective

Open the home-design studio at {{APP_URL}}.

If the program cannot fit the plot, the app must say so in words and with numbers, and must not quietly draw a plan that does not fit. Do exactly this:

1. In the brief dialog, raise the number of rooms until the brief asks for more floor area than the plot holds — for example six bedrooms and six bathrooms on one storey. A warning under the room list appears when it does.
2. Click the **Generate the plan** button.
3. Assert that the app says, on screen, what it did about the overflow: either a refusal that gives the area asked for and the area the plot holds, or a statement that the rooms were scaled down, with the numbers in it. Read the sentence in the toast that appears after the plan is drawn, or the note in the Checks tab.
4. Assert that the canvas in the middle shows a drawing whose rooms all sit inside the plot boundary, and that the total of the room areas in the drawing is no more than the buildable area of the plot.
5. Assert the status bar along the bottom shows the chip that says No errors.
6. Click **Load the sample plan** and assert a drawing comes back.

Report the wording the app used and the numbers it gave. Finish with the result of each assertion.

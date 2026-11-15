# Every room can be walked to

**Covers:** acceptance criteria 8 and 9.

## Objective

Open the home-design studio at {{APP_URL}}.

Every room must be reachable on foot from the front door, and there must be a front door on the street side. Do exactly this:

1. Read the status bar along the bottom of the screen and record the numbers next to Net indoor, Footprint, Gross covered, Open site, Coverage and FAR.
2. Click the **Checks** tab in the panel on the right and record every finding that says a room cannot be reached, with the room name it gives.
3. In the **Project navigator** on the left, click the floor row named **First floor**, read the Checks tab again, and record any room on that storey that cannot be reached.
4. Read the room count on each floor row in the Project navigator — for example "Ground floor 10 rooms" — and add them up to get the total number of rooms in the house.
5. Assert there is a front door drawn on the drawing: an opening on the bottom, street-facing wall of the building, marked as a door with a swing arc.
6. Assert that no finding says a room cannot be reached, so every room counted in step 4 is reachable from the front door.

Report every room that cannot be walked to, or state plainly that there were none. Finish with the total number of rooms, the numbers from the status bar, and the result of each assertion.

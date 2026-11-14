---
mode: testing
max_steps: 50
target: chrome
local_context: >-
  # Furnish Verified — what the app is, and what counts as correct


  Furnish Verified is a home-design studio that refuses to hand over a floor
  plan

  nobody has walked.


  You describe the house you want. The app turns that into a **program** — a
  list

  of rooms with areas and storeys — and lays the program out as a drawn floor

  plan. The app then **checks its own drawing** against the rules about how
  houses

  work.


  The plan, the findings and the verification history are all on screen at once.


  ## The rules the checker holds the drawing to


  - Every room in the plan has at least one door.

  - Every room can be reached by walking from the front door — through doors,
  and
    up the stairs to the upper storeys.
  - There is a front door, and it is on the street side.

  - The staircase has a door leading into it, and the foot of it can be walked
  to.

  - No piece of furniture stands in the floor in front of a door.

  - A room smaller than its minimum usable area is reported.

  - No room is smaller than the brief asked for.

  - A room outside the plot is reported.

  - Two rooms sharing floor are reported.


  ## What a finding looks like


  The findings panel on the right lists every defect the checker found. Each

  finding names the room it is about and says how much is wrong. A room with a

  finding is marked in red on the drawing, and the drawing and the findings

  always agree with each other.


  ## The refusal


  If the program cannot fit the plot, the app refuses and says by how much it
  does

  not fit. It does not draw a plan that does not fit. The refusal is a red box
  in

  the brief panel on the left.


  ## The ledger


  The Ledger tab holds the history of the independent checker — that is, the

  history of Kane's own runs against this app. Every run is listed, including
  the

  ones that failed. Each run records what was run, which flows passed and which

  failed, what the app's own checker said at the time, and the commit the app
  was

  at. **Failed runs are kept.** A ledger that only shows passes is not a record

  of anything.


  ## What this is not


  - It is not a construction document, and it does not claim to be.

  - It does not check against the building regulations of any jurisdiction.

  - It does not use a language model to draw the plan. The layout is
    deterministic: the same brief always produces the same drawing, so two runs
    can be compared.
  - It does not replace the independent checker. The app's own findings are one
    opinion; the ledger is the other one.

  ## On screen


  - Left panel: the brief (the paragraph, the plot size, the number of storeys)
    and the program (the editable list of rooms, areas and storeys), and the
    Generate the plan button.
  - Middle: the drawing, with a storey tab above it.

  - Right panel: the findings, or the ledger, on two tabs.

  - Bottom: the status bar — net indoor area, footprint, coverage, how many
  rooms
    are reachable, how many errors.
---

# Session: the-staircase-can-be-walked-to

## Step 1

Open the home-design studio at http://localhost:5199.

The flight of stairs must have a door leading into it, and the foot of it must be walkable to from the front door. Do exactly this:

1. Click the Ground floor tab.
2. Find the staircase in the drawing: a flight of parallel tread lines with an arrow showing the way it rises.
3. Assert that a door is drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc.
4. Read the findings panel on the right and record any finding about the staircase, in particular one that says the staircase has no door or cannot be walked to.
5. Click the Floor 2 tab and confirm the staircase is drawn there too, as the flight arriving at that level.

Report whether the staircase has a door into it, what the findings panel says about it, and whether it is drawn on both storeys. Finish with a plain statement of whether the stair is usable.

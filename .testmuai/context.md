# Furnish — what the app is, and what counts as correct

Furnish is a home-design studio that refuses to hand over a floor plan nobody has
walked. (The hackathon project is Furnish Verified; the app itself is called
Furnish.)

You describe the house you want. The app turns that into a **program** — a list
of rooms with areas and storeys — and lays the program out as a drawn floor
plan. The app then **checks its own drawing** against the rules about how houses
work.

The plan, the findings and the verification history are all on screen at once.

**The app is served at `http://localhost:5173`** by `npm run dev`. Three routes:
`/` (landing page), `/projects` (dashboard), `/studio` (the editor). The editor is
where everything below lives.

## The rules the checker holds the drawing to

- Every room in the plan has at least one door.
- Every room can be reached by walking from the front door — through doors, and
  up the stairs to the upper storeys.
- There is a front door, and it is on the street side.
- The staircase has a door leading into it, and the foot of it can be walked to.
- No piece of furniture stands in the floor in front of a door.
- A room smaller than its minimum usable area is reported.
- No room is smaller than the brief asked for.
- A room outside the plot is reported.
- Two rooms sharing floor are reported.

## What a finding looks like

The **Checks** tab in the right-hand panel lists every defect the checker found.
Each finding names the room it is about and says how much is wrong. A room with
a finding is marked in red on the drawing, and the drawing and the findings
always agree with each other. When there is nothing to report the panel says
*"Everything checks out."*

## When the program does not fit

The app never quietly draws a plan that does not fit the plot. Two things can
happen, and both are stated on screen in words and with numbers:

- **The rooms are scaled down.** If the brief asks for more floor area than the
  plot holds after setbacks, the app scales the rooms to about the percentage
  that fits and says so, with the plot's own dimensions and the percentage in
  the sentence: *"The brief asks for more floor area than the W × D m plot
  allows after setbacks. Rooms were scaled to about N % of their requested size
  — consider fewer rooms, a bigger plot, or a second storey."* (W and D are the
  plot's size; N is the scale.) The brief panel warns before this happens:
  *"That is more than fits comfortably. Furnish will scale the rooms down
  rather than overflow your plot."*
- **The program is refused.** A program that cannot be laid out as a grid at all
  is refused outright, with the reason: *"N rooms will not fit as a grid on a
  W × D m envelope with every room at least N m across."*

Either way, the drawing that appears is one whose rooms all sit inside the
plot.

## The ledger

The **Ledger** tab holds the history of the independent checker — that is, the
history of Kane's own runs against this app. Every run is listed, including the
ones that failed. Each run records what was run, which flows passed and which
failed, what the app's own checker said at the time, and the commit the app was
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

- **Left rail — the Project navigator.** The storeys, as rows (*Ground floor*,
  *First floor*), each with its rooms under it; the buttons to add a storey and
  to change the brief.
- **Middle — the drawing.** The plan itself, in 2D.
- **Right panel — three tabs.** *Properties* (what is selected), *Checks* (the
  findings), *Ledger* (the verification history).
- **The brief** is a dialog that opens on the first visit, and can be reopened
  from the navigator with *Change the brief*. It asks for the plot size, the
  number of storeys and the rooms, and it has **Generate the plan** and **Load
  the sample plan** buttons.
- **Bottom — the status bar.** Net indoor area, footprint, gross covered, open
  site, coverage and floor-area ratio, plus a chip that says *No errors* when
  the checker found nothing.

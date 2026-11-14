# Furnish — product requirements

**Version 2.1 · 14 November 2026**

This document is the contract. The independent checker is given this file and
designs its flows from it, so every acceptance criterion below is something a
browser can confirm or contradict. Nothing here describes how the app is built;
it describes what a person must be able to see.

> The plans this app produces are early-design geometry. They are **not**
> construction-ready and carry no professional or regulatory certification.
> The size limits the checker uses are configurable sanity bounds for early
> design, not the rules of any jurisdiction.

---

## 1. What this is

Furnish is a home-design studio that refuses to hand over a floor plan nobody
has walked.

You describe the house you want. A language model plans the **program** —
which rooms the house has, how big each one is, and which must sit next to
each other — and deterministic layout code places that program as a drawn floor
plan. The model never places a wall and never writes a coordinate; it can only
choose from a fixed list of named operations.

The app then **checks its own drawing** against a list of rules about how
houses work: every room has a door, every room can be walked to from the front
door, the staircase can be reached, nothing is standing in a doorway, no room
is smaller than it can be used for.

The plan, the findings and the verification history are all on screen at once,
and the plan can be walked in 3D from inside it.

## 2. Who it is for

A person with a plot and a rough idea of a house, who wants to see whether the
idea holds together before they pay anyone to draw it properly. They are not
an architect and they do not want to be told the app has found "a violation".
They want to know, in plain words, what is wrong and what to do about it.

## 3. The flows

### 3.1 Open the app

`/` is a landing page that states plainly what the product is and links to the
studio. `/studio` is the studio. The studio must never present an empty grid
with no explanation: there is always either a drawing or a stated reason why
there is not.

### 3.2 Write the brief

The brief is one screen: the plot's width and depth in metres, the number of
storeys, and the rooms wanted with how many of each. Every one of those must be
changeable before the plan is made, and each change must be visible in the
numbers the screen reports.

The screen also offers **Load the sample plan**: one complete house, drawn by
the same layout code with no model involved, so that it is the same plan every
time it is loaded. It is the plan the landing page shows, and the app says
plainly that no model planned it.

### 3.3 Generate the plan

Pressing **Generate the plan** asks the model for the room program and then
places it. The drawing must show:

- the plot boundary and the setback line;
- every room, with its walls;
- doors, drawn with the leaf and the swing of the door;
- windows;
- the staircase, with its treads and the direction it rises;
- furniture;
- each room's name and its area.

If the model cannot be reached, the plan is still produced from catalogue
sizes, and the app says so in a warning — it must never present an undesigned
fallback as a considered design.

### 3.4 Read the measurements

The status bar reports the net indoor area, the footprint, the gross covered
area, the open site, the plot coverage and the floor-area ratio. Every one of
those numbers is computed from the geometry, not estimated.

### 3.5 Walk it

The 3D view has four cameras: orbit, top-down, walk (outside, on the plot) and
inside (first person, in a room). Walking must move the camera through the
building, and every room the plan has must be reachable by walking from the
front door, including the upper storeys via the staircase.

### 3.6 Read the findings

The Checks panel lists every defect the checker found. Each finding must name
the room it is about, say how much is wrong, and say how the person can tell it
apart from the rest.

### 3.7 Correct a finding

Where a correction can be worked out, the app offers it as a button, and
pressing it changes the plan. A correction must not delete a room: the room
count either stays the same or the finding says it has gone.

### 3.8 Ask the assistant

The assistant answers questions about the plan and carries out edits. It may
only use the named operations the app publishes. A destructive operation —
removing a room, a wall or a piece of furniture — must be confirmed by the
person before it happens. If the assistant's request produces no change, the
app must say that nothing changed rather than showing a reply that implies one.

### 3.9 Export

The plan can be exported as the full project (JSON), the floor plan as vector
(SVG), the floor plan as a raster (PNG) and the 3D view as it stands (PNG).

### 3.10 Read the verification ledger

The ledger is the history of the independent checker. It lists every run, in
order, and for each run: what was run, what passed and what failed, what the
app's own checker said at the time, and which commit the app was at. **Failed
runs must be kept.** A ledger that only shows passes is not a record of
anything.

---

## 4. Acceptance criteria

Each one must be confirmable in a browser.

**The plan**

1. The studio opens on a drawn plan or states plainly why it cannot.
2. The brief screen reports the buildable area per floor for the plot that has
   been entered, and changing the plot changes that number.
3. The drawing shows rooms, walls, doors with swings, windows, the staircase
   with its treads, and furniture.
4. Every room on the plan is labelled with its name and its area.
5. The same brief always produces the same plan.
6. The building's footprint is the same on every storey.
7. A plan drawn for a plot shows no room outside the plot.
8. The stairs are drawn on the storey they serve, and rise in one direction.

**The measurements**

9. The status bar reports net indoor area, footprint, gross covered area, open
   site, coverage and floor-area ratio, and the coverage figure is consistent
   with the footprint and the plot.

**The checker**

10. Every room in the plan has at least one door.
11. Every room can be reached by walking from the front door — through doors,
    and up the stairs to the upper storeys.
12. There is a front door, and it is on the street side.
13. The staircase has a door leading into it, and the foot of it can be
    walked to.
14. No piece of furniture stands in the floor in front of a door.
15. A room smaller than its minimum usable area is reported.
16. Two rooms sharing floor are reported.
17. Each finding names the room it is about and quantifies what is wrong.
18. A room with a finding is marked in the drawing, and the drawing and the
    findings agree with each other.
19. The app must not report a plan as sound while a finding says otherwise.

**The walk**

20. Every room drawn on the ground floor can be walked to in the 3D view.
21. The upper storeys can be reached by walking up the staircase.

**The assistant**

22. The assistant can answer a question about the plan using the plan's own
    numbers.
23. The assistant can carry out an edit, and the edit is visible in the plan
    afterwards.
24. The assistant cannot carry out an operation that is not on its published
    list, and a destructive operation is not carried out without confirmation.

**The export**

25. The exported floor plan opens and shows the same rooms as the app.
26. The exported project reopens in the app without loss.

**The ledger**

27. The ledger lists every run of the independent checker, including the ones
    that failed, with each flow's result and the commit it ran against.
28. The ledger distinguishes a run that passed from a run that failed.
29. The ledger records what the app's own checker reported at the time of the
    run.

**The sample plan**
30. The brief screen offers a one-click load of the sample plan, and pressing
    it draws a complete house: rooms, walls, doors with swings, windows, the
    staircase and furniture.
31. The sample plan says that no model planned it, and it is the same plan the
    landing page shows.
32. Loading the sample plan twice produces the same plan: the same rooms, in
    the same places, with the same areas.

---

## 5. What this is not

- It is not a construction document, and it does not claim to be.
- It does not check against the building regulations of any jurisdiction. The
  minimum sizes it uses are configurable sanity bounds.
- It does not use a language model to draw the plan. The layout is
  deterministic, so the same brief always produces the same drawing and a
  checker can compare two runs.
- It does not let the model edit the drawing directly. The model chooses a
  named operation; the app runs it; the app reports what happened.
- It does not replace the independent checker. The app's own findings are one
  opinion; the ledger is the other one.

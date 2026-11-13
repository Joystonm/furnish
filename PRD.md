# Furnish Verified — product requirements

**Version 1.0 · 13 November 2026**

This document is the contract. The independent checker is given this file and
designs its flows from it, so every acceptance criterion below is something a
browser can confirm or contradict. Nothing here describes how the app is
built; it describes what a person must be able to see.

---

## 1. What this is

Furnish Verified is a home-design studio that refuses to hand over a floor
plan nobody has walked.

You describe the house you want. The app turns that into a **program** — a
list of rooms with areas and storeys — and lays the program out as a drawn
floor plan. The app then **checks its own drawing** against a list of rules
about how houses work: every room has a door, every room can be walked to from
the front door, the staircase can be reached, nothing is standing in a
doorway.

The plan, the findings and the verification history are all on screen at once.

> The plans this app produces are early-design geometry. They are **not**
> construction-ready and carry no professional or regulatory certification.
> The size limits used by the checker are configurable sanity bounds for
> early design, not the rules of any jurisdiction.

## 2. Who it is for

A person with a plot and a rough idea of a house, who wants to see whether the
idea holds together before they pay anyone to draw it properly. They are not
an architect and they do not want to be told the app has found "a violation".
They want to know, in plain words, what is wrong and what to do about it.

## 3. The flows

### 3.1 Open the app

The app opens on a plan. It must never present an empty grid or an empty
canvas: there is always either a drawing or a stated reason why there is not.

### 3.2 Describe the house

The brief is a paragraph in the person's own words, plus the size of the plot
and the number of storeys. It must be possible to change all three and see the
program change with them.

### 3.3 Read the program

The program is a list of rooms, each with an area and a storey. It must be
visible, it must be editable — a room's area can be changed and a room can be
added or removed — and the total area must be shown.

### 3.4 Generate the plan

Pressing **Generate the plan** draws the plan. The drawing must show:

- the plot boundary and the setback line;
- every room, with its walls;
- doors, drawn with the leaf and the swing of the door;
- the staircase, with its treads and the direction it rises;
- the furniture;
- each room's name and area;
- a north point and a scale bar.

### 3.5 Read the findings

The findings panel lists every defect the checker found. Each finding must
name the room it is about, say how much is wrong, and say how the person can
tell it apart from the rest.

### 3.6 Correct a finding

Where a correction can be worked out, the app offers it as a button, and
pressing it changes the plan. A correction must not delete a room: the room
count either stays the same or the finding says it has gone.

### 3.7 Read the verification ledger

The ledger is the history of the independent checker. It lists every run, in
order, and for each run: what was run, what passed and what failed, what the
app's own checker said at the time, and which commit the app was at. **Failed
runs must be kept.** A ledger that only shows passes is not a record of
anything.

---

## 4. Acceptance criteria

Each one must be confirmable in a browser.

**The plan**

1. The app opens on a drawn plan or states plainly why it cannot.
2. The program lists every room with its area and its storey, and can be
   edited.
3. The drawing shows rooms, walls, doors with swings, the staircase,
   furniture, a north point and a scale bar.
4. Every room on the plan is labelled with its name and its area.
5. The same brief always produces the same plan.
6. The building's footprint is the same on every storey.

**The checker**

7. Every room in the plan has at least one door.
8. Every room can be reached by walking from the front door — through doors,
   and up the stairs to the upper storeys.
9. There is a front door, and it is on the street side.
10. The staircase has a door leading into it, and the foot of it can be
    walked to.
11. No piece of furniture stands in the floor in front of a door.
12. A room smaller than its minimum usable area is reported.
13. No room is smaller than the brief asked for.
14. A room outside the plot is reported.
15. Two rooms sharing floor are reported.

**The refusal**

16. If the program cannot fit the plot, the app refuses and says by how much
    it does not fit. It does not draw a plan that does not fit.

**The findings**

17. Each finding names the room it is about and quantifies what is wrong.
18. A room with a finding is marked in the drawing, and the drawing and the
    findings agree with each other.
19. The app must not report a plan as sound while a finding says otherwise.

**The ledger**

20. The ledger lists every run of the independent checker, including the ones
    that failed, with each flow's result and the commit it ran against.
21. The ledger distinguishes a run that passed from a run that failed.
22. The ledger records what the app's own checker reported at the time of the
    run.

---

## 5. What this is not

- It is not a construction document, and it does not claim to be.
- It does not check against the building regulations of any jurisdiction. The
  minimum sizes it uses are configurable sanity bounds.
- It does not use a language model to draw the plan. The layout is
  deterministic, so the same brief always produces the same drawing and a
  checker can compare two runs.
- It does not replace the independent checker. The app's own findings are one
  opinion; the ledger is the other one.

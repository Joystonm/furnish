# Furnish — Feature Matrix

What is built, what is verified, and what is not. Every "verified" below was
checked against the running application or by a test that actually executes;
none of it is inferred from a file existing or a build succeeding.

Legend — **Done** (implemented and checked), **Partial** (implemented with a
stated limit), **Not done**.

---

## Verification status at the time of writing

Run on 5 November 2026 against the tree as it stands. Nothing below is a
remembered result from an earlier version of the code.

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | **passed** — `tsc -b` exit 0, no output |
| Unit tests | `npm test` | **passed** — 689 tests across 19 files, 4.7 s |
| Production build | `npm run build` | **passed** — one 1,372 kB chunk (397.0 kB gzipped); CSS 39.4 kB (7.3 kB gzipped) |
| End-to-end | `npm run e2e` | **passed** — 65 of 65, 11.1 min, Chromium against the built bundle |
| All four | `npm run verify` | **passed** — the four above, in that order, as one command |

The staircase work below — a climbable flight, a door at each end of it — is
compiled, tested and walked. It took **four** separate defects to make a
flight climbable, and each one is now covered by a test that fails when the
fix is removed. They are written out in full because the fourth is the kind
that hides: it does not fail on a fast machine.

### The staircase: four defects, each fatal on its own

**1. `walk` mode never had a floor system.** The user was in `walk` mode, and
`walk` mode mounts `FirstPerson`, not `InsideView`. Every fix in the first three
rounds — `floorUnder`, `floorAtElevation`, `hasFloorUnder`, the flight as a
ramp, the solid steps — went into `InsideView` and into `collision.ts`'s surface
helpers. `FirstPerson` called none of them: it wrote `pos.y = EYE_HEIGHT` once
at mount and never again, so the eye stayed at 1.62 m from the pavement to the
top floor and a staircase had nothing it could do about it. The camera was being
tested against code it never ran.

**2. The ground plane passed under the flight and beat its ramp.**
`floorUnder` resolves ties by taking the *highest* candidate at or below the
feet, so one unbroken plane at ground level passes underneath a flight climbing
to 3 m and **wins at the foot**. The camera then walks the length of the
staircase at a constant height, which is the reported symptom exactly. Fixed by
holing `groundSurfaces` — a plane at the ground floor's elevation covering the
plot and the verge — **where each flight is**. The holes are the load-bearing
part, not a detail.

**3. A partition stood across the head of the flight.** The camera's feet reach
the storey height exactly where the wall's top is, so the two meet and the climb
cannot finish: the camera cannot lift its feet above the wall until it is
already through it. The collision code is right — a person climbing that last
step hits that wall. It is the plan that is wrong, because the flight physically
passes through the line its head arrives on. Fixed by `clearFlightHead`
(`src/model/plan.ts`), which removes or splits the partition across the flight's
head, and it runs **before** the doors are punched so that the wall on the
flight's line is not a candidate for a stair door.

**4. The climb depended on the frame rate.** This is the one that survived
three rounds of "it works on my machine". A flight is carried as a ramp, and
the camera follows it by asking how high that ramp is where it now stands —
with a condition attached: the surface under the camera must be no more than
`STEP_UP` (0.3 m) above the feet, or it is a ceiling rather than a step, and
the camera is not allowed onto it.

So a move that rises more than 0.3 m in one go does not climb the flight. It is
refused — and because the camera is then standing over nothing at all, it
counts as *stranded*, which is allowed to move regardless. The result is the
camera gliding up the inside of the staircase at a constant height: the flight
is right there, the camera goes through it, and the storey above is never
reached.

A move has to cover more than 30 cm of rise in one go, which at walking pace is
a frame time of about a fifth of a second — and a machine that renders at four
frames a second does it on **every** frame. The head of the flight is where it
bites hardest: the camera arrives at the top of the ramp still at the height of
the bottom of it, and never gets through the door.

The fix is `advanceWalk` (`src/three/collision.ts`): the movement is integrated
in steps of at most `WALK_SUB_STEP` = 1/60 s, so a step rises at most 4 cm on
the steepest flight this app builds, which no riser can out-run. Both walking
cameras — `FirstPerson` and `InsideView` — now call it. They used to keep their
own copy of the same arithmetic, which is how the two drifted apart in the first
place.

### How that was checked

| Check | What it proves |
|---|---|
| `npx tsc --noEmit` | exit 0, no output |
| `npx vitest run` | 689 tests across 19 files, all passing |
| `src/three/collision.test.ts` → `advanceWalk — climbing a flight, at any frame rate` | the climb works at 120, 60, 30, 15, 8, 4, 2 and 1 fps. **Proven to fail without the fix**: with `WALK_SUB_STEP` set to 1e9 — one step per frame, the old behaviour — two of the three tests fail with `the climb failed at 0.250 s a frame: expected 2.6134…` |
| `src/model/layout.test.ts` → `leaves the head of the flight open, so that the flight can be climbed` | no partition stands across the head of any flight. **Proven to fail without `clearFlightHead`** |
| `node scripts/stairwalk.mjs` | the running application, driven with the keyboard, from the pavement to the first floor. It runs against the Vite dev server, not the built bundle, because it reads the plan out of the app's live store and that store is only reachable as a module URL in dev |

The walkthrough's own output, from the run on 5 November 2026 against the
tree as it stands (the repeated probe tail the script prints after each
waypoint is collapsed into the `feet` figure):

```
start: {"x":0,"y":1.62,"z":-15.99,"h":-0.247} · feet 0.00 m · 1 here · 1 flight of 18 surfaces · on 0 m
  outside the front door: (-2.45, -7.48) · reached · feet 0 m
  through the front door: (-2.89, -4.65) · reached · feet 0 m
  to the living room door: (-1.25, -3.96) · reached · feet 0 m
  through the living room door: (-0.17, -4) · reached · feet 0 m
  to the dining door: (2.49, -4.37) · reached · feet 0 m
  through the dining door: (3.45, -4.32) · reached · feet 0 m
  onto the landing at the foot of the flight: (3.45, -4.31) · reached · feet 0 m
  up the flight: (3.66, -2.15) · reached · feet 1.24 m · 1 here, on a flight
  at the head of the flight: (3.84, -0.31) · reached · feet 2.49 m · 1 here, on a flight
  through the door at the head: (3.86, 0.93) · reached · feet 3 m
final: {"x":3.85,"y":4.62,"z":0.93,"h":0.01} · feet 3.00 m · 3 here · 1 flight of 18 surfaces · on 3 m
```

`feet` is the height under the camera, `here` is how many walkable surfaces
contain it and whether one is a flight, and the third figure is how many flight
ramps exist. The last line is the one that matters: `feet 3.00 m`, on the first
storey, in the corridor beyond the door at the head of the flight. The camera
climbed, changed storey, and came out the other side.

The route is read from the plan the app itself generated — the entrance, the
doors between the rooms, and the flight — so it stays honest when the layout
moves, and it is walked with the keyboard, one press at a time, because that is
the only way to find out what a person would hit. It is not a script that
teleports the camera: every waypoint above is a place the camera had to
*walk* to. The pictures the same run took are in `shots/` —
`stair-09-up-the-flight.png` is the camera part way up with the soffit of the
floor above filling the view, `stair-10-at-the-head-of-the-flight.png` is the
landing at the top, and `stair-11-through-the-door-at-the-head.png` is the
upper corridor.

### Still not done: the stairwell is a hole, not a room

The diagnosis below was right, and it is still true. The stairwell is a
rectangle reserved before packing and subtracted from every other room
(`layout.ts:590-593`, applied at `layout.ts:641`), so **no room is ever packed
into it**. On the ground floor it is given a room of its own — a corridor,
labelled *Stairwell* — so that there is a floor to step off the bottom tread
onto. Upstairs the same rectangle stays open: that is the void the flight comes
up through, and the floor at the head of the flight is the corridor it arrives
at.

On the plan the walkthrough walks:

| | |
|---|---|
| shaft | 1.4 m wide × 5.94 m deep, right flank of the front band |
| flight | 1.2 m wide × 4.42 m long, 17 risers of 0.18 m with 0.26 m goings, centred in width, **pinned to the rear** of the shaft |
| head of the flight | plan y 10.44 — exactly the corridor's front edge |
| landing at the foot | 1.52 m of bare shaft in front of the bottom tread |
| floor inside the shaft, upstairs | **none** — the void the flight climbs through |

The flight's head arrives exactly where the corridor's floor begins, so the
door at the head opens onto a corridor with a slab under it and the climb
works. But the space *around* the flight is not a built place: there is no
landing room at the head of the flight, only the corridor it happens to arrive
at, and nothing upstairs over the shaft but the void.

Building it as a real space is not a one-liner, and two things make it harder
than it looks — both found by reading the code, not guessed:

- `planFloor` walls every exposed edge of every room. A landing abutting the
  flight would therefore be **walled off from it**, so the stairwell has to be
  one room spanning the whole shaft with the flight inside it.
- `roomSlab` (`sceneModel.ts:992`) emits one rectangle per room and does not
  subtract the flight, so a single stairwell room spanning the shaft would lay
  a floor at storey height straight through the staircase and bury it.

That is why this is still open. It is a restructure across `layout.ts`,
`plan.ts` and `sceneModel.ts`, and the slab has to be cut around the flight
before the room can be built at all.

---

## Walking, and what it feels like

Walking is a product surface, not a camera. Six things had to be true of it,
and each of them was false at some point. They are listed with where the fix
lives and how it is checked, because three of them are the kind of defect that
a green test suite does not notice.

**1. W, D and S were the editor's shortcuts while you were walking.** The
keyboard map binds `W` to the Wall tool, `D` to the Door tool and `S` to the
snap toggle, and those listeners sit on `window` with no camera-mode check. So
walking forward armed the wall tool, strafing right armed the door tool, and
backing up flipped snapping — with the toolbar changing under you on every
stride. That is most of what made walk mode feel broken and hard to move, and
no amount of tuning the acceleration curve would have fixed it.

The fix is a gate, not a deletion: the editor shortcuts are live in orbit mode
and dead while a first-person camera is driving, and `Escape` gives them back.
The set of keys that stand aside is derived from the shortcut table rather
than written out, so a tool key added later cannot silently reintroduce the
bug. `Ctrl+S`, `Ctrl+Z`, `Escape` and `Delete` are deliberately not in it —
losing undo or the way out of a camera would be a far worse trade than the
accidental tool change it fixes. `e2e/walkFeel.spec.ts` checks all three keys,
checks that `W` still arms the Wall tool outside a camera, and checks that
leaving the camera restores it.

**2. Typing the brief walked the viewer through their own house.** The camera
controllers asked nothing about where a keystroke came from, so `wasd` typed
into the assistant was also `wasd` walked into the wall. Both camera rigs now
ignore a keystroke whose target is a text field (`isTypingTarget` in
`src/keys.ts`). The editor shortcuts have guarded on this since the start; the
cameras were the other half of the same key and had no way to ask.

The test for it holds the key down rather than tapping it, and counts the
frames the view draws while it is held. On a machine with no GPU the 3D view
draws about four frames a second, so a key pressed and released between two
frames is never seen by the camera at all — a tap would pass even with the bug
this test exists to catch. The test reads the camera's **own key map**, not a
picture of what it did: with the guard removed, it fails with `["KeyW"]` where
it expected `[]`. That was checked by removing the line and running the test,
not assumed.

**3. There was no way to look around.** Walk mode had no look control except
pointer lock, which needs a click and swallows the cursor. `Q` and `E` now
turn, at `TURN_RATE`, on the spot — the camera looks without walking. The
tests measure the camera's **yaw**, which accumulates and never wraps, rather
than its heading, which does: a camera that has turned a full circle looks the
same way as one that never turned, and only the yaw tells those two apart.
Both directions are checked, because "Q works" is also true of a binding that
only ever turns one way and leaves you unable to look back.

**4. The gait was a snap.** Reaching full walking speed took about 190 ms at
31 m/s², which reads as a cursor being dragged rather than as a body setting
off. `approachVelocity` now accelerates at 6 m/s² and decelerates at 11 m/s² —
about 0.28 s from standing to walking pace, and the deceleration is faster
than the acceleration, which is what reads as a body. `advanceWalk`
integrates in sub-steps of at most 1/60 s, so the gait is the same on a
machine drawing one frame a second as on one drawing a hundred and twenty.

**5. Walking diagonally was faster than walking straight.** `wishVector`
normalises a *full* diagonal, so north-east is not 1.41 times the speed of
north. A half diagonal keeps its magnitude, because the inside corner of the
key block is a slow walk, not a fast one.

**The head bob is the sixth, and it is the smallest.** 1.2 cm of vertical dip
and a lateral sway at half that frequency, with a roll of 0.3° — a body sways
once per stride and dips twice. It is tied to the **ground actually covered**,
not to elapsed time: a time-driven bob falls out of step with the gait
whenever the pace changes, keeps rocking after the walker has stopped, and
runs at the wrong frequency on a slow machine. The ground covered is right in
all three cases, and it is zero when the walker is pushing into a wall, which
is why the camera does not shake when it cannot move. The amplitude follows
pace, so a standing camera is a still camera — including during the
deceleration after the key is released, which is what stops the camera from
rocking on the spot while you read a room.

The bob lives in `collision.ts` with the rest of the gait, as `bobPhase` and
`bob`, and is unit-tested there: one full cycle per stride of ground, no
advance at all when no ground is covered, the phase accumulating rather than
restarting each frame, the sway at half the frequency of the dip, the offsets
never exceeding the stated amplitudes, and the whole effect scaling with pace.
The amplitudes are pinned too — 1.2 cm is at the bottom of the range for a real
walk (measured head sway is 1–2 cm), and it is meant to be felt on a long run
down a corridor and not thought about in a room. A design tool whose camera
never quite settles is a tool that is worse at showing you a room.

**What none of this proves.** The acceleration curve and the bob are checked
as numbers, not as sensations. Whether 0.28 s to walking pace *feels* like a
body is a judgement no assertion in this repository can make, and the
amplitude of the bob is a taste decision — `BOB` is a single constant, set to
zero, if the motion ever reads as a gimmick.

---

## The twelve-step demonstration, run end to end — what it found

The demonstration is not a script that has always passed. Run against the
built bundle on 4 November 2026 it found **four defects in the application and
two in the tests themselves**, and it turned up two things about the model
that are recorded below rather than hidden behind a green tick.

### Fixed in the application

**1. The Checks panel could not be read while working on the plan.** The panel
follows the selection, and the effect that drove it listed `rightTab` as a
dependency as well as the selection. Any selection — which is the normal state
of an editor — pulled the panel back to Properties the instant the user
clicked "Checks", so the one panel that reports what is wrong with the plan
could not be read while working on the plan. The effect is now keyed on the
selection alone (`src/App.tsx`).

**2. A toast could die before the user had seen it.** The store dismissed a
toast on a timer that started when the toast was *created*. The browser paints
on its own schedule, and generating a plan keeps the main thread busy long
enough that a toast's own lifetime (2.6 s for a success, 3.2 s for a note)
could expire before the first frame that contained
the toast — so the message that said a model had planned the layout was the
one that vanished, silently, on a loaded machine. The lifetime now belongs to
the toast *row* (`src/ui/Toasts.tsx`), and the row starts its clock on the
first *animation frame* after it is committed — two frames, because the first
rAF callback runs before the paint and the second after it. A toast is
therefore on screen for its lifetime measured from the moment it could be
seen, not from the moment React committed it. A backgrounded tab never paints,
so it never expires a toast either: the message waits for the user to come
back to it.

**3. A graze was reported as an overlap, with no correction that could clear
it.** `rectIntersects` is *tolerant* — it treats rooms within a join tolerance
of touching as touching — while the area that followed it was the *true* one.
Between the two sat a gap: two rooms overlapping by half a millimetre over
three metres were reported as an error worth "0.00 m²", and the only button
offered was to delete one of the rooms, which is a heavy answer to a rounding
artefact. The overlap now has to be real in both directions —
`rectIntersection`, and more than `TOL.join` along each axis
(`src/model/validate.ts`, with two new tests: a 5 mm graze is ignored, and a
50 mm strip is still reported as "overlap by 0.15 m²").

**4. The generator promised a staircase it could not build.** When the plot is
too shallow to hold a flight beside the front rooms, the generator emitted
*"One will be placed in whatever space is left"* — and then, further down,
*"No room was found for a staircase between Ground floor and First floor"*,
which are contradictory sentences about the same thing. The second is the true
one: the packer fills the envelope, so on a shallow plot there is no space
left. The first has been rewritten to say what actually happens — the flight
will go wherever the packing leaves room, and the layout check will report it
until it does (`src/model/layout.ts`).

### Fixed in the tests

**5. The walk test was failing for the wrong reason.** `canvas.screenshot()`
photographs the *composited page region* — the canvas plus the floating hint
cards the application draws over it — so the bytes changed when a hint
appeared even though the camera had not moved, and when the comparison failed
Playwright formatted the message by diffing two multi-megabyte PNG buffers as
text. That diff took the runner twenty minutes to produce and buried the real
failure. The comparison now reads the WebGL drawing buffer itself,
downsampled to 48×30 and hashed, which answers the question the test is
actually asking — did the camera move — and fails with two short numbers
(`e2e/walkFeel.spec.ts`).

**5a. And the hash was not the answer either.** The hash fixed the diff, and
then the test it was in failed for a third time — not because the camera had
moved, but because the *picture* had. A hash of a downsampled frame measures
the renderer, not the camera. This machine has no GPU, so the 3D view draws
about four frames a second, and the frame on screen when the sample is taken
can be seconds old: the first walk-mode frame replacing the last orbit-mode
one, a texture finishing its upload, a shadow map being redrawn. Any of those
changes the picture while the camera stands still. The failing run recorded it
exactly — the "before" hash was `1134566970` and the "after" hash `58876626`,
and sampling the scene every 300 ms showed `58876626` constant from the first
sample onwards, which is the settled walk view.

So the test now asks the application what the camera did, rather than what the
renderer drew. The app already publishes its walk state every frame
(`window.__walk`: position, velocity, heading, yaw, the storey underfoot, and
the map of keys the camera has been told about), and the test reads it: the
camera's key map must never contain a key that was typed into a text field, and
its position must not change. Two things make that honest rather than lucky:
the key is **held down** rather than tapped, because a key pressed and
released between two frames is never seen by the camera at all, so a tap would
pass even with the bug; and the test counts the frames the application drew
while the key was held and requires at least one, so "the camera did not move"
can never be true merely because the camera had no chance to move.

With the guard removed — `isTypingTarget(e.target)`, one line in
`src/three/Scene.tsx` — the test fails with the camera's own key map showing
`KeyW`. That was checked by removing the line and running the test, not
assumed.

**6. The toast assertion asked the browser a question seconds too late.** A
toast is on screen for a few seconds. That is right for a person and awkward
for a test that asks the browser afterwards: the round trips this suite makes
— the generate, the trace's screencast, the read-back — can outlast the
toast's life, and then the assertion reports on a toast that was never wrong.
This was not a flake: `roomProgram.spec.ts` failed on **every** run, with the
toast container empty and the plan on screen, and the failure was in the
test's timing rather than in the application. The observation is now taken
where the toast is — a `MutationObserver` inside the page records the text of
every toast as it is rendered, and the assertion reads that record
(`e2e/toastLog.ts`). What it asserts is what it asserted before: the app told
the user, in a toast, that a model planned the layout.

### The plot the demonstration asks for

The demonstration used to ask for an 18 m × 14 m plot. With the default 4.5 m
front and rear setbacks that leaves a 5 m band, and a 5 m band is too shallow
for the plan the brief describes: the flight needs 4.4 m of run plus a landing
at its foot, so the generator reserved no shaft, the packing left no space
either, and the result was a **two-storey house with no staircase in it**. The
generator said so in four warnings and the layout check caught it as
`floor_disconnected`.

That is the engine working. It is also a poor thing to demonstrate, so the
demonstration now asks for 18 m × 20 m. The step-3 assertion now says the
plan must contain a staircase, and the step-10 assertion counts the errors
left in the panel after the correction, because a button that clears one
problem by creating two others is not a correction.

Here is the whole sequence, measured in the running application, with the
constraint engine's own findings at each stage. The left column is the plot
the demonstration used to ask for; the right is the one it asks for now.

| after | 18 m × 14 m | 18 m × 20 m |
|---|---|---|
| generate | **1 error** — `floor_disconnected`: *"First floor has no staircase arriving from Ground floor"*. **0 staircases.** | **0 findings.** 1 staircase. |
| the inspector's resize (+1.5 m) | the above, plus a warning — `setback_violation`: *"Living room" crosses the buildable envelope on the left by 1.50 m* | the same warning |
| the assistant's study | **4 findings** — the above, plus `room_no_access`: *"Home office" has no door on any of its walls*, and `room_overlap`: *"Living room" and "Home office" overlap by 9.60 m²* | **2 findings** — `room_overlap`, 9.60 m², and the same warning |
| the engine's own correction | the overlap clears, and **an error takes its place**: `room_no_access` — *"Living room" has no door on any of its walls* | **0 errors**, 3 warnings: two `furniture_out_of_room` (*"TV unit … is no longer inside it after the room moved"*) and the setback warning |

The right-hand column is what the demonstration now shows, and it is a house:
one storey of living, dining, kitchen, corridor and a stairwell; three
bedrooms, two bathrooms and a corridor above; a flight with a door at each
end; and nothing wrong with it before the assistant has touched anything.

### Measured, and still open

**A room's walls and doors do not follow it when it changes size.**
`resizeRoom` changes the rectangle and calls `reindex`, which recomputes
*which rooms each wall bounds* — it never *moves* a wall. So the plan has two
sources of truth the moment a room is resized: the room is where its
rectangle says, and the walls and their openings are where they were drawn.

The left-hand column above is that defect, measured. The correction the engine
offers for the overlap does exactly what it says — the overlap is cleared and
no room is deleted — and it moves the living room out from under its own
door, so the room it just fixed is now the one that cannot be reached. The
engine has a repair for this (`rebuildWallsFromRooms`, offered to the user
from the right-click menu), but nothing calls it after a resize, and on its
own it carries a door onto the wall that took the room's place rather than
onto the wall that kept the two rooms adjacent.

It is worth being precise about the severity: this is a **plan that depends on
where the resize happened**. On the 18 m × 20 m plot the same correction
leaves no errors at all, because the door it was going to strand is on the
other side of the room. On the 18 m × 14 m plan it strands the living room.
Neither is the behaviour a plan editor should have, and the difference between
them is the plan's geometry, not the user's intent.

**The overlap correction has nothing to offer when one room is inside
another.** `shrinkFixes` works out how much to trim by subtracting the two
rooms' positions along each axis. When the new room lies wholly inside the
old one, both differences are negative, so no shrink is proposed and the only
correction offered is *Remove*. The demonstration does not hit this — the
stand-in model places its study beside the living room rather than inside it
— but a model that dropped a room in the middle of another would produce a
plan with no repair at all.

**The resize operation's default anchor grows the room the wrong way.** The
default is `bottom-right`, so a room widened from the inspector grows to the
*left* and *up* — into the side and front setbacks rather than into the space
it has. That is visible in the table above: the resize in both columns earns a
`setback_violation` for exactly 1.50 m on the left. `top-left` is the better
default, and is what the operation's own comment and the `resize_room` tool's
description used to claim; the code has always done the other thing, and both
descriptions now say what the code does. Changing the default is not a
one-word edit: on a tightly packed plan it moves the growth onto the
neighbouring room instead — a second overlap in place of the first — which is
why it belongs with the two entries above rather than on its own.

---

## The three routes, and the landing page

There are three screens, and no routing library.

| Route | What it is | How it is reached |
|---|---|---|
| `/` | the landing page | the brand, typed or clicked |
| `/projects` | the dashboard — the saved projects | "Open the studio" |
| `/studio` | the editor | "New project", or a project opened from the dashboard |

`src/router.ts` is a path, a `pushState` and a `popstate` listener, and
nothing else. That is a deliberate choice, and it has one sharp edge:
**`history.pushState` fires no event of its own.** An application that listens
only for `popstate` shows the right URL and the wrong page, so the router
dispatches the event itself after every navigation.

Both ways of moving between the routes are checked in a browser, because
neither can be checked in a unit test — a unit test has no URL and no Back
button (`e2e/routes.spec.ts`).

| What it promises | How it is checked |
|---|---|
| The plan in the hero is drawn by the product, not shipped as a picture | the SVG must carry real geometry — more than eight shapes — and room labels; its `aria-label` must state the plot, the room count and the total area; and the caption under it must agree: *18 × 20 m* |
| It asks nobody else for anything | the spec records every request the page makes whose URL is not this server, and the list must be **empty**: no webfont, no tracker, no third party at all |
| It states its limits instead of hiding them | the headings *"Concept stage, not a permit"* and *"SVG, PNG and JSON — and that is the list"*, and the words *not construction-ready* |
| "Open the studio" goes to the dashboard, not straight into an editor | the URL after the click, and the dashboard's own heading |
| The back button goes back | the URL *and* the page after `goBack()` |
| A new project goes to the editor | the URL, the editor's chrome, and the brief it asks for |
| `/studio` survives a direct visit and a refresh | both |
| The dashboard can be reached and left again | the brand in the header is a real link with an `href`, so it can be copied, opened in a new tab and read by a screen reader, not merely clicked |

The hero plan is produced by the product's own code: `src/home/samplePlan.ts`
calls the shared `src/model/sample.ts` and `planToSvg`, then parses the SVG
that comes out. That is why it cannot drift from what the studio makes — it is
the same plan, drawn by the same code, from the same brief the studio's *Load
the sample plan* button uses. A marketing illustration would have been easier
and would have been wrong the first time the layout engine changed.

---

## The redesign, looked at

The chrome was warm paper and terracotta; it is now cool neutral and one teal
accent, because the 2D plan and the 3D render are both cool and a warm shell
fought both of them.

| Token | Old | New |
|---|---|---|
| `paper` | `#fbfaf9` | `#F7F8FA` |
| `surface` | `#ffffff` | `#FFFFFF` |
| `raised` | *never defined* | `#F1F3F6` |
| `line` | `#e7e5e1` | `#E3E7EC` |
| `lineStrong` | `#d6d3cd` | `#CBD3DD` |
| `ink` | `#1c1b19` | `#0F172A` |
| `inkSoft` | `#57534e` | `#475569` |
| `inkFaint` / `muted` | `#8a8580` | `#94A3B8` |
| `accent` | `#b4622d` | `#0D9488` |
| `accent.soft` / `accent.ink` | `#f3e7de` / `#8a4a20` | `#E6F4F1` / `#0F766E` |
| `ok` / `warn` / `danger` | `#3f7d58` `#b5842b` `#b3402f` | `#059669` `#D97706` `#DC2626` |

Three things in that table are worth stating plainly.

`raised` did not exist. `App.tsx` used `bg-raised` and `text-muted`, and
neither was defined anywhere in the configuration — so that text, and the
selected style row in the popover, were rendering with no colour at all. The
redesign gave them a value; `muted` is kept as an alias of `inkFaint` so the
name that was already in use means something.

The plan's own colours were left alone where they carry meaning. The selected
stroke is still `#2563eb` and the error stroke `#dc2626`, because
`e2e/editor.spec.ts` asserts those two as literal values — a plan that quietly
recoloured "this is the thing you have selected" and "this is wrong" would
have broken the only two signals that mean anything.

The building materials in the 3D view were **not** recoloured to match. Brick,
oak, wool and porcelain are physical finishes, and painting them teal would
make a render look false. They were desaturated slightly towards neutral so
the scene coheres without lying about what the building is made of.

**How it was checked.** `e2e/screens.spec.ts` opens each of the three screens
in a browser and writes the pictures into `shots/`. Each capture is checked to
be a picture and not a blank frame — a 1600 × 1000 PNG of one flat colour is
a few kilobytes, and a screen that rendered something is a good deal larger —
and the browser is asserted to have thrown nothing while it happened. The
pictures are outputs of a run rather than files in the repository, so `shots/`
is gitignored; `npm run e2e` writes the six, and `scripts/stairwalk.mjs` writes
the eleven of the staircase walk.

The pictures were then looked at, because that is the only way to review a
redesign:

| Picture | What it shows |
|---|---|
| `shots/ui-01-home.png` | the landing page: teal accent on cool neutrals, hairline borders, rounded cards, and the hero card carrying the generated plan and its caption — *18 × 20 m · 7 rooms · 132 m²* |
| `shots/ui-02-home-full.png` | the same page whole, 1600 × 3970: the three steps, the six capabilities, the assistant band on its dark ground, the six "straight answers", the closing call to action, and the footer that says the two Devpost projects were studied but nothing was copied |
| `shots/ui-03-projects.png` | the dashboard: *Your projects*, the empty state with a dashed card, and the note that projects live in this browser only and export JSON is the backup |
| `shots/ui-04-studio-2d.png` | the editor in 2D: the tool strip, the floors and plot rail, the assistant, the inspector's room list, poché walls with their door swings, furniture, dimension chains, the north point, a 2 m scale bar, the flight marked *17 risers*, and the status bar reading *Net indoor 154.0 m² · Coverage 21.1% · No errors* |
| `shots/ui-05-studio-checks.png` | the same plan with the Checks tab open: *Everything checks out.* — and beneath it, *"These are geometric checks computed from your model, not rules from a jurisdiction. Setbacks and limits below are configurable and are a starting point, not a compliance certificate."* |
| `shots/ui-06-studio-3d.png` | the same model seen from outside: the two-storey house with its roof, windows, entrance door, path and grass — and, on the left face, the open stairwell shaft, the flight visible inside it. That recess is the limitation recorded below, *"There is no slab over the staircase, on any floor"*, seen rather than described |

Two things the pictures caught that the assertions did not. The landing page
scrolls inside a fixed-height column, so the document itself never scrolls and
a `fullPage` capture was taking the same frame twice — the two files were byte
for byte identical, and the "whole page" picture was the top of the page. The
window is now made tall enough to hold the content, and the picture is
1600 × 3970. And the captions under the pictures in this table are written
from what the images show, which is the only reason they are worth printing.

The pictures are artefacts, not assertions. What `e2e/screens.spec.ts` asserts
is that each screen rendered at all, and that the browser threw nothing; the
rest of that table is what a person saw.

---

## Phase 1 — Reverse engineering

| Requirement | Status | Notes |
|---|---|---|
| Analyse Alza (devpost) | **Done** | `REVERSE_ENGINEERING.md`, 85 KB |
| Analyse ArchMorph (devpost) | **Done** | as above |
| Produce a written document | **Done** | `REVERSE_ENGINEERING.md` |
| Do not reuse their assets | **Done** | no third-party assets shipped; `_research/alza` and `_research/archmorph` are gitignored, not redistributed |
| Do not inspect inaccessible source | **Done** | analysis is from public pages, the demo, and behaviour; nothing is claimed about closed code |

---

## Phase 2 — Canonical model and the 2D editor

| Requirement | Status | Notes |
|---|---|---|
| One canonical model | **Done** | every view is a pure function of `Project`; no sync layer exists |
| Pure operations | **Done** | `(Project, input) => OpResult`, `src/model/ops.ts` |
| `OpResult` with typed errors | **Done** | 6 error codes |
| `reindex()` re-derives relationships | **Done** | including `wall.roomIds` |
| Guided onboarding → real plan | **Done** | `src/ui/Onboarding.tsx` → `generateFromBrief`; one screen, not a questionnaire — plot, storeys and rooms are visible together and everything else takes its default, and all three starts (grid, empty, generate) are always on screen. Street edge, setbacks, room sizes, style, budget and comfort are no longer settable from this screen |
| Plan generated by code, not the model | **Done** | `src/model/layout.ts`, deterministic band packing |
| Interactive 2D editor | **Done** | real SVG, real hit-testing, drag/resize/rotate |
| Objects are project data, not decoration | **Done** | editor and assistant share one operation table |
| Image tracing with calibration | **Done** | `src/trace/` |
| Calibrate from ≥1 known real dimension | **Done** | one point (`scaleFromLength`) or two (`calibrateFromTwoPoints`, solves offset too) |
| Uncertain detections are confirmable | **Done** | per-detection checkbox, "Accept likely" at confidence ≥ 0.5, only rows with a plan are selectable |
| Room types in the toolbar | **Done** | `room-palette` with 17 kinds; the armed kind stays armed so a run of rooms can be dropped, and re-picking the same kind stands the tool down |
| Delete by button, key and right-click | **Done** | `delete-selection`, `Delete`, and a per-element context menu; rooms, walls, doors, windows, furniture, stairs and outdoor spaces all reachable |
| A wall can actually be picked | **Done** | `wallUnderPoint` tests distance to the wall *band*, and wins over the room behind it — rooms used to be tested first, so an interior wall could never be selected, moved or deleted |
| A door or window shows as selected | **Done** | openings had no selected state at all, so Delete after clicking one looked broken |
| CAD drawing conventions | **Done** | wall poché, unhatched floor, overall dimension chains, north point, scale bar, upright room labels in rooms deeper than 1.25× their width (also in the exported SVG) |
| Start from an empty plot | **Done** | `emptyFromBrief` — plot, storeys and brief, nothing else |
| Start from a grid | **Done** | `gridFromBrief` — the brief's rooms tiled edge to edge, with real walls, doors and windows to rearrange |
| A room too small for its kind is reported | **Done** | `MIN_USABLE_AREA` in `validate.ts`; a 2.2 m² bathroom is now flagged with a "grow it" fix instead of passing silently |

---

## Phase 3 — Synchronised 3D

| Requirement | Status | Notes |
|---|---|---|
| 3D view of the same building | **Done** | `buildScene(project)` |
| 2D and 3D update together | **Done** | structurally: one model, two pure renderers |
| Orbit camera | **Done** | |
| Top-down camera | **Done** | |
| First-person walk with collision | **Done** | walls and furniture; `src/three/collision.ts` |
| Walk leaves on Escape | **Done** | |
| Inside camera — drop into a room and look around | **Done** | `roomViewpoint` stands in the corner furthest from the middle of the building, looking across the room; selecting a room flies there |
| Inside camera walks, turns and leaves on Escape | **Done** | W A S D, Q E, scroll; drag to look without the drag reaching the room as a click |
| Inside camera reaches the first floor | **Done** | `floorUnder` in `src/three/collision.ts` resolves what is underfoot every frame from the position of the camera and the surfaces under it, so the eye rises as the floor does; `floorAtElevation` then hands the collider filter and the room readout to the storey above. Colliders also carry a `floorId`, so the ground floor cannot block the floor above it |
| A staircase can be walked up | **Done — walked in the running app** | `flightSurfaces` builds one ramp per staircase **from `project.stairs`**, not from the render boxes, so a flight's height along the run comes from the model's own `run`, `rise` and `direction`. `advanceWalk` (`src/three/collision.ts`) integrates the movement in sub-steps of at most 1/60 s, so the climb does not depend on the frame rate — the failure that survived three earlier rounds, where a move rising more than `STEP_UP` was refused as a ceiling and the camera glided up the inside of the flight at a frozen height. Verified three ways: unit tests at 120 fps down to 1 fps, all passing; the same tests **proven to fail** with the sub-stepping removed; and `scripts/stairwalk.mjs` walking a person off the pavement, in through the front door, through two more doors to the stairwell, up the flight and through the door at its head onto the first floor. See *The staircase: four defects* above |
| The flight is drawn as a staircase, not a stack of slats | **Done** | `stairBoxes` emits each step as a full-height solid from the nosing below it up to its own, plus a stepped balustrade and cap rail on both sides. It used to emit 0.05 m treads a riser apart over one solid core, which you could see between, and which the camera climbed as a row of see-through slabs |
| A staircase has a door at both ends | **Done** | `openStairEnds` in `src/model/plan.ts`, called from the stairs loop in `layout.ts`, after `clearFlightHead` has taken out the partition across the head of the flight so the climb is not stopped at the last tread. `openStairEnds` ranks every candidate wall and tries them in order, falls back to the nearest wall whatever its distance, and will move a window out of the way as well as a door. The walkthrough confirms both ends in the running app: the door at the head is the one the camera comes out of onto the first floor. **Regenerating the plan is what applies this** — a project generated before the change keeps its old openings |
| Procedural PBR surfaces, no image assets | **Done** | canvas-generated colour + bump maps; 13 surface families |
| Roof oversails the wall line with a fascia | **Done** | `EAVES_OVERHANG`; puts the roof in its own shadow |
| Plinth, apron paving and path to the street | **Done** | the path is drawn only when the model has a door facing the street |
| Shadowed sun, PCF soft shadows, generated sky | **Done** | sky is the background, deliberately not `scene.environment` |
| Wall joints with no visible seam | **Partial** | see *known limitations* | |

---

## Phase 4 — The assistant

| Requirement | Status | Notes |
|---|---|---|
| MiniMax M3 Preview via server | **Done** | `server/minimax.ts`, Anthropic-compatible Messages API, exercised live |
| 10-step pipeline | **Done** | `src/ai/orchestrator.ts` |
| Bounded reasoning loops | **Done** | `MAX_ITERATIONS = 6` |
| ≥ 23 typed tools | **Done** | **28** — 13 read, 13 write, 2 destructive |
| Strict plan validation | **Done** | `parsePlan` + `validatePlanShape`; both JSON plans and native `tool_use` answers |
| Preconditions | **Done** | a plan that cannot work is refused, with reasons |
| User approval for destructive tools | **Done** | the 2 destructive tools prompt |
| Areas/FAR computed by formula | **Done** | `src/model/measure.ts`; the model may request a calculation but never supplies a value |
| Never claims unapplied changes | **Done** | step 8 recomputes; the report is built from store state; a design request answered in prose is pressed once for its operations, and if nothing ran the panel states that the plan did not change |
| The work is visible while it happens | **Done** | operations are applied across painted frames and listed as they land, with a "the assistant is drawing" badge over the plan |
| Compact state, not the whole project | **Done** | `compactState()` + `revision` counter |

---

## Phase 5 — Stack

| Requirement | Status | Notes |
|---|---|---|
| React + TypeScript + Vite | **Done** | |
| Three.js / R3F / drei | **Done** | |
| Tailwind | **Done** | |
| Premium, restrained light UI | **Done** | drafting-tool language: hairlines, one accent, no gradients |

---

## Phase 6 — Deterministic checks

| Requirement | Status | Notes |
|---|---|---|
| Architectural checks | **Done** | `src/model/validate.ts` |
| Deterministic, LLM-free | **Done** | pure function of the model |
| Stable codes + numbers + element ids | **Done** | 27 declared, 23 emitted |
| Click-to-fix corrections | **Done** | each executed through `runTool` and re-validated by `src/model/corrections.test.ts` |
| Circulation as a graph | **Done** | `OUTSIDE` node; openings connect opposite sides |
| Constraints configurable, not jurisdictional | **Done** | visible defaults; the panel states it is not a compliance certificate |

---

## Phase 7 — Persistence and exports

| Requirement | Status | Notes |
|---|---|---|
| Projects persist | **Done** | IndexedDB |
| Reload restores the design | **Done** | e2e step 11 |
| JSON export | **Done** | self-describing envelope; **verified to re-import through the app's own reader** |
| SVG export | **Done** | verified: XML header, one `<svg>`, namespace, closes, no `NaN`, geometry in mm |
| Plan PNG export | **Done** | verified: > 1 kB, correct PNG signature |
| 3D capture | **Done** | verified: read back from the live canvas |
| Import | **Done** | `fromJSON` validates format and schema version |

---

## Phase 8 — End-to-end demonstration

All twelve steps, in order, in a real browser against the real built bundle:

| Step | Status |
|---|---|
| 1. Open the application | **Done** |
| 2. Enter plot dimensions and requirements | **Done** |
| 3. Generate a real 2D floor plan | **Done** |
| 4. Select and resize a room | **Done** |
| 5. Ask the assistant to add a room | **Done** — against a scripted stand-in, see §Limits |
| 6. See the change in the 2D plan | **Done** |
| 7. Switch to 3D and inspect | **Done** |
| 8. Walk through the interior | **Done** |
| 9. Run validation, review a real issue | **Done** |
| 10. Correct it and confirm | **Done** |
| 11. Save, reload, confirm persistence | **Done** |
| 12. Export and verify the file | **Done** |

Plus a 13th check that the whole run produced no uncaught page errors.

---

## Known limitations

Listed because they are real. None of them is presented as working.

### Not done

- **No multi-user, cloud sync, or authentication.** Projects live in the
  browser that made them.
- **No PDF/DXF/IFC export.** SVG, PNG and JSON only.
- **No mobile or tablet layout.** The studio is a desktop drafting tool.
- **A one-pixel antialiased line remains at every wall junction.** Where two
  walls meet, `resolveCorners` inserts a corner block so the junction is closed
  by three coplanar faces rather than two. Multisampling covers the boundary
  pixel between them and it reads as a faint vertical hairline down the
  elevation. It is coverage, not a gap: with `antialias: false` it disappears
  entirely, and the float32 gap between two abutting edges measures 2.4 × 10⁻⁷
  m. Making the walls overlap at the junction instead of backing them off would
  remove it, and has not been done.
- **Furniture is parametric massing, not modelled joinery.** A sofa is a seat,
  back, arms and cushions; a bed is a frame, a mattress and a pillow. Nothing
  is a specific product and nothing is a licensed asset.
- **Interior lighting is a stand-in, not bounce light.** three.js has no global
  illumination. The sun is a single directional light and walls shadow it
  completely, so an interior with nothing else in it renders nearly black. A
  global environment map would be the physically honest answer and was rejected:
  an IBL lookup per pixel is the most expensive thing in the frame under the
  software rasteriser this is verified on. What is there instead is one
  hemisphere light, added **only while the inside camera is active**, standing in
  for the light a real room would pick up off its own surfaces. It cannot change
  a single pixel in the three exterior modes. Consequence: the fill is uniform,
  so a ceiling far from a window is lit as well as one beside it, and rooms read
  as evenly lit rather than falling off towards their interior corners.
- **There is no slab over the staircase, on any floor.** The packer subtracts the
  stairwell from every floor's packing, so no room — and therefore no room slab —
  covers the flight. That is why the camera can climb it at all, and it also
  means the floor above the stairs has an unguarded hole where the stairwell is.
  The inside camera refuses to walk into a void (`hasFloorUnder` in
  `collision.ts`), so this cannot be walked off, but nothing is *built* there:
  `Staircase.voidWidth` and `voidDepth` exist, are written by `placeStair` and
  `addStaircase`, and are read by nothing. Cutting the floor properly, and
  guarding the edge, is not done.
- **A staircase placed by hand gets no door.** `openStairEnds` is called from the
  generator's stairs loop only. `addStaircase` in `ops.ts` does not call it —
  it cannot without importing `plan.ts`, which already imports `ops.ts`, and
  introducing that cycle to cover the manual tool was not a trade worth making
  here. The generated path is covered; the manual one is not.
- **Nothing reports a staircase with no door.** `stair_not_connected` asks whether
  a stair *exists* between two floors, not whether anyone can get through it, so
  a hand-placed flight with no opening on either end passes every check. The
  generator's own flights are now doored by exhausting every wall on the storey,
  so this is reachable only in the last case — a storey with no wall the flight
  could plausibly reach. That case is silent, and should not be: making it a
  reported finding is the obvious next piece of work here.
- **A room's walls and doors do not follow it when it changes size.** `resizeRoom`
  changes the rectangle and calls `reindex`, which recomputes *which rooms each
  wall bounds* — it never *moves* a wall. So the plan has two sources of truth
  the moment a room is resized: the room is where its rectangle says, and the
  walls and their openings are where they were drawn. A room can therefore be
  moved out from under its own door, and the door it had is left standing in
  the wall it used to share. The engine has a repair for this
  (`rebuildWallsFromRooms`, offered to the user from the right-click menu), but
  nothing calls it after a resize, and on its own it carries a door onto the
  wall that took the room's place rather than onto the wall that kept the two
  rooms adjacent. Measured: the demonstration's overlap correction clears the
  overlap it was offered and leaves two rooms unreachable — see *The
  demonstration, run end to end* below.
- **The overlap correction has nothing to offer when one room is inside
  another.** `shrinkFixes` works out how much to trim by subtracting the two
  rooms' positions along each axis. When the new room lies wholly inside the
  old one, both differences are negative, so no shrink is proposed and the only
  correction offered is *Remove*. A model that dropped a room in the middle of
  another would produce a plan with no repair at all.
- **The resize operation's default anchor grows the room the wrong way.** The
  default is `bottom-right`, so a room widened from the inspector grows to the
  *left* and *up* — into the side and front setbacks rather than into the
  space it has. `top-left` is the better default and is what the operation's own
  comment and the `resize_room` tool's description used to claim; the code has
  always done the other thing, and the two descriptions now say what the code
  does. Changing the default is not a one-word edit: it moves the growth to
  the other side of the room, which on a tightly packed plan lands it on the
  neighbouring room instead — a second overlap in place of the first. It needs
  doing together with the two entries above.

### The live MiniMax service

It **has** been exercised, end to end, against a real key — text, tool calls,
and whole assistant turns driving the real registry through the real UI. It is
not in the automated suite, because it costs money and needs a key; the e2e
uses `e2e/fake-minimax.mjs` as a stand-in and never touches the network.
`scripts/live-assistant-check.mjs` reproduces the live run on demand.

That exercise found four real defects, all fixed:

| Found by | Defect |
|---|---|
| key present, panel said "no key" | the `.env` loader ran only in `server/main.ts`, so `npm run dev` started with an empty environment |
| live turn returned "did not return a plan in the expected JSON shape" | the model answers a tool-bearing request with `tool_use` blocks, and the client discarded them, keeping only the prose |
| live turn died on `There is no tool called "reply"` | M3 turns the prompt's `{"reply": ...}` step shape into a tool call named `reply`; it is now mapped to a reply step by an explicit five-name list, in the one validator both answer styles pass through |
| one run in three threw `WrongDocumentError` | drei attached the pointer-lock trigger to `document`, so toolbar clicks asked a canvas that React had already detached |

Observed and **not** resolved: on one live turn the model reported a setback
violation of "2.00 m" for a room whose geometry put it flush against the
envelope, and said so itself rather than guessing. Whether that is a real
false positive in `setback_violation` or a misreading by the model was not
determined. It is recorded here rather than quietly dropped.

### Declared but never emitted

Four issue codes are in the `IssueCode` union with no emitting site:
`room_inside_wall`, `wall_not_shared`, `opening_out_of_bounds`,
`door_no_access`. They are documented checks that were specified and not
written. Three others — `opening_overflows_wall`, `door_swing_blocked`,
`stair_not_connected` — are emitted from more than one branch, which is
intentional (distinct causes, distinct sentences) but means the codes are not
one-to-one with fixes.

### Reachable but not exercised

- `Staircase.direction === -1` cannot be created. `addStaircase` requires the
  target floor to be strictly above the one it starts on, so a descending
  flight is refused. The field is stored and rendered, but no operation path
  produces −1.
- `setPlot` types `setbacks` as a complete object while merging whatever
  partial it is given, so a caller can supply two sides and keep the other two.

### Dead code

- `src/model/validate.ts:324` — the corridor-widening correction has
  `anchor: room.width <= room.depth ? 'top-left' : 'top-left'`. Both branches
  are the same value; the ternary is meaningless.
- `src/model/validate.ts:656-659` — `stairsByFloor` is populated and never read.

### Deliberate test accommodations

- One Playwright click in the e2e uses `force: true` (the `view-plan` toolbar
  button). Under software rendering Playwright's hit test reports an
  interception that `document.elementsFromPoint` shows does not exist, and a
  raw mouse click at the same coordinates does switch the view. It is recorded
  with its evidence in a comment rather than worked around silently.
- The e2e runs one worker, serially, because the twelve steps share one page.

### Scope statements, kept honest

- Generated plans are **not** construction-ready and are not professionally
  certified. They are early-design geometry.
- Constraint thresholds are configurable sanity bounds, **not** rules from any
  jurisdiction. Furnish does not know where you are and does not claim otherwise.
- The bundle is a single 1.37 MB chunk (397 kB gzipped) with no code splitting.
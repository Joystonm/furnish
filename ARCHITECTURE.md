# Furnish — Architecture

How the studio is put together, and why. This is a description of the code as
it stands, not an aspiration; where something is unfinished it says so.

---

## 1. The one decision everything else follows from

There is exactly **one** description of a building, and every view is a pure
function of it.

```
                     ┌──────────────────────────────┐
                     │            Project           │
                     │  rooms · walls · openings    │
                     │  stairs · outdoor · furniture │
                     └──────────────┬───────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
        validate()            buildScene()          measureBuilding()
              │                     │                     │
      ProblemsPanel            3D / walk            StatusBar
      get_layout_issues                            calculate_building_areas
```

There is no synchronisation layer, because there is no second copy. When the
assistant adds a room, the store replaces `Project`, and the 2D canvas, the 3D
scene, the measurement strip and the checks panel all re-render from it. The
brief called for "one canonical data model, not two apps connected
superficially" — the test of that is whether a synchronisation bug is even
expressible, and here it is not.

Plan coordinates are metres, with **y growing south (down)**, matching the
convention of a drawing. The 3D scene maps plan `(x, y)` to world
`(x − plotW/2, elevation, y − plotD/2)`. That mapping lives in one place
(`src/three/sceneModel.ts`).

### Geometry

Rooms and outdoor spaces are axis-aligned rectangles. Walls are segments with a
thickness, and derive their frames (`wallFrame`) rather than storing a second
copy. Furniture is an oriented box (OBB) whose `x`/`y` is its **centre** —
every geometry helper agrees on this, which was worth stating once after it had
been got wrong in two places.

Tolerances are explicit (`TOL` in `geometry.ts`): `dimension: 0.15 m`,
`join: 0.02 m`, `clearance: 0.01 m`. Nothing anywhere compares floating point
numbers for equality.

---

## 2. Operations: pure functions, one dispatch table

Every change to a project is a pure function:

```ts
type OpResult<T> =
  | { ok: true; project: Project; data: T; createdIds: Id[]; removedIds: Id[] }
  | { ok: false; error: string; code: ErrorCode; hint?: string };
```

with `code` in `not_found | invalid_input | out_of_range | conflict |
too_small | forbidden`.

Operations live in `src/model/ops.ts`, take `(Project, input)`, and return a
*new* project or an error. They never touch the store, so they are trivially
testable and impossible to half-apply. `reindex()` then re-derives everything
that depends on other things — notably `wall.roomIds`, which is exactly the kind
of field that rots when a room moves.

`src/store/useProject.ts` holds the single `OperationName → OpFn` table. The
mouse, the keyboard, undo/redo and the assistant all go through `run()` on that
one table, so undo, the activity log and persistence cannot be bypassed by any
of them.

History is whole-`Project` snapshots (`MAX_HISTORY = 100`), coalesced by
`coalesceKey` so a drag is one undo step rather than two hundred.

---

## 3. The tool registry is the security boundary

The model can name a tool and pass JSON-shaped arguments. It cannot return
code, invent an id, skip a validation, or touch anything outside the list.

`src/tools/registry.ts` declares **28 tools** — 13 `read`, 13 `write`, 2
`destructive`. Each carries an input schema (sent to the model so it cannot
guess argument names), an output schema, and a permission level. Every handler
resolves through the same `run()` dispatch the mouse uses.

```
model text → parsePlan → validatePlanShape → checkPreconditions
           → for each step: permission check → runTool → structured result
```

**`runTool(name, input, actor)`** is the single point where a named edit
becomes an actual change. The assistant's pipeline uses it; so do the
validation panel's click-to-fix buttons. That shared path matters more than it
sounds — see §6.

The system prompt states the units, forbids inventing ids, and requires the
model to call `calculate_*` for measurements rather than assert them.

**The model answers in one of two styles, and both are read.** The prompt asks
for a JSON plan, but MiniMax-M3 — offered the typed registry — answers in
`tool_use` blocks instead, which was confirmed against the live service, not
assumed. Both are parsed into the same `Plan` and put through the same
`validatePlanShape`, so an unknown tool name or a missing required argument is
refused identically whichever way the model chose to speak. `reply`, `respond`,
`final_answer`, `say` and `answer` are mapped to reply steps in that one
validator, because the model turns the prompt's `{"reply": ...}` shape into a
tool call by that name; the mapping is an explicit list rather than a
catch-all, so a misspelt tool name is still an error and not a shrug.

---

## 4. Measurements are never the model's

`src/model/measure.ts` computes every number with an explicit formula:
net indoor area, footprint, gross floor area, plot coverage, floor-area ratio.
FAR is `grossFloorArea / plotArea`, and a porch counts toward covered area at
the building level before the ground-level test, so the per-floor and whole-
building figures cannot disagree.

The assistant may *request* a calculation (`calculate_room_area`,
`calculate_building_areas`, `get_layout_issues`) but the value that reaches the
report is recomputed from the model after the change. There is no code path by
which a model-authored number becomes a displayed number.

---

## 5. The assistant pipeline

`src/ai/orchestrator.ts`, bounded by `MAX_ITERATIONS = 6` tool-calling rounds.

| # | Step | What it does |
|---|------|--------------|
| 1 | Read | The model is shown a compact summary of the project — **not** the project |
| 2 | Prompt | System prompt fixes units, id discipline and the measurement rule |
| 3 | Plan | The model returns a structured plan of tool calls — as JSON, or as native `tool_use` blocks |
| 4 | Retry | On malformed output, the error goes back as a user turn; bounded |
| 5 | Validate | `parsePlan` + `validatePlanShape` reject anything off-shape |
| 6 | Preconditions | `checkPreconditions` refuses plans that cannot work, with reasons |
| 7 | Apply | Each step through `runTool`; `destructive` steps ask the user |
| 8 | Recalculate | Measurements and checks recomputed from the model |
| 9 | Report | Structured `AssistantReport` — applied / failed / rejected, per step |
| 10 | Reply | A summary written from what actually happened |

Step 8 is why the app can honestly say the model changed something: the report
is built from the store's state after the edit, not from the model's account
of it. A refused plan says so, with the reason.

### 5a. A design request that arrives as prose

The failure this section exists for: asked to "build me the complete design",
the model writes a layout out in words — `Living room: x=3, y=4.5, 4.5 × 4.0` —
and calls no tools. Furnish draws from operations, not from words, so the plan
does not move, and a reply that reads like a description of the finished
building is a claim about a change that never happened.

Two things happen, in this order.

1. **The model is pressed once.** If the turn applied nothing and the request
   reads as a request to change the building (`isDesignRequest`), a correction
   goes back as a user turn naming exactly what went wrong, and the turn runs
   again. One press only — a model that answers in prose twice is answering in
   prose, and a third round would spend money on the same sentence. A turn with
   no round left does not press, because pressing on the last iteration would
   report "reached the step limit", which is a different and untrue thing to
   say.
2. **If it still changes nothing, the app says so.** `TurnReport.changedNothing`
   is set and the panel prints it directly beneath the reply. The prose stays
   visible — it is a real answer — but it is labelled as an intention rather
   than left to read as the plan on screen.

The system prompt carries the same rule as instruction 7, so the press is
usually not needed.

`isDesignRequest` is a keyword heuristic and is biased toward yes: "build",
"design", "add", "move", "fix" and their synonyms always count, while "plan",
"layout", "change" and "make" only count when the sentence is not a question.
"What should I make the bedroom?" must not cost a wasted round trip.

### 5b. Watching the plan arrive

The apply loop used to run to completion inside a single JavaScript task, so
React committed every room together and the design appeared all at once. Two
changes make the work visible:

- the loop awaits `nextFrame()` **before** each operation, so the previous room
  is painted before the next one is created — and so the `aiBusy` flag, set and
  cleared around a synchronous call in the same task, is actually painted
  rather than committed and discarded in one go;
- `onStep` reports each step as it resolves, and the panel lists them live.

While `aiBusy` is set, the canvas carries a badge reading *The assistant is
drawing*. It takes no pointer events, so the canvas stays usable underneath.

The pause is `DEFAULT_STEP_DELAY_MS = 110` and is overridable per turn
(`stepDelayMs`), which is how the unit tests run it at zero.

The model sees `compactState(project, activeFloorId, includeFloorDetail)` — a
summary plus, on request, one floor's detail, with a `revision` counter so a
small drag does not become a model call.

---

## 6. Checks, and the corrections they offer

`src/model/validate.ts` is pure, deterministic, and has nothing to do with the
LLM. It emits issues with a stable `code`, the element ids involved, a sentence
naming the numbers, and — where the engine can compute one — a concrete
correction expressed as a tool call.

27 issue codes are declared; 23 are emitted. Corrections are offered as
buttons, and **each one is executed through `runTool`** and re-validated by
`src/model/corrections.test.ts`. That test exists because every correction
originally did nothing at all: the panel called the store's operation dispatch
with the model's snake_case vocabulary while the dispatch was keyed camelCase,
one correction named a tool that was never registered, and three passed
arguments their tools rejected. Nothing caught it because nothing had ever
applied a suggested fix. A correction that cannot be applied is now not
offered — for example, a room whose brief cannot be placed is reported with no
button rather than a button that fails.

Circulation is a graph, not a heuristic: `OUTSIDE = '__outside__'`, and
openings connect the rooms on *opposite* sides of their wall, not the rooms
along it.

Constraints (setbacks, coverage, FAR, minimum window ratio) are **configurable
numbers with visible defaults**, not rules from any jurisdiction. The panel
says so in those words.

---

## 7. Front end

React 18 + TypeScript + Vite; Three.js via React Three Fiber and drei;
Tailwind for layout. No component library — the visual language is a drafting
tool: hairline rules, no gradients, no hero text, one accent colour, and a
canvas that takes all remaining space.

```
src/ui/            shell, navigator, inspector, problems, toolbar, status bar
src/ui/canvas2d/   the 2D editor — real SVG, real hit-testing, real handles
src/three/         scene model, R3F scene, four cameras, collision, surfaces
src/ai/            assistant panel and orchestrator
src/model/         the canonical model, ops, geometry, measures, validation
src/tools/         the 28-tool registry
src/persist/       IndexedDB library
src/trace/         image tracing, vectorising and calibration
src/export/        SVG, PNG, JSON writers
server/            Express: /api/chat, /api/health, and the MiniMax client
```

The 2D editor is not a preview: rooms, walls, openings and furniture are real
project data, draggable and resizable through the same operations the
assistant uses.

**Four cameras, one scene.** `orbit` for the exterior, `top` for a plan check in
3D, `walk` — first person, pointer-locked, with collision against walls and
furniture — and `inside`, which puts the camera in a room. Walk applies frame
time exactly once when converting velocity to displacement; applying it twice
made the camera move at roughly 1/60th of the speed the HUD advertises, which is
a bug the e2e caught as a walk that could not finish. §7b covers `inside`.

### 7b. The inside camera

Entering the mode is a jump, not a move: `InsideView` mounts fresh and places the
camera. Where it places it is `roomViewpoint(room, frame, opts)` in
`src/three/collision.ts`, and the rule is **stand in a corner, look at the
opposite one** — the framing used to photograph a room. The obvious alternative,
standing on the centre line and facing the far wall, is strictly worse below
about six metres: the frame fills edge to edge with one flat plane and the shot
carries the room's width and nothing else. From a corner, both side walls sweep
back to a vanishing point and the furniture between is spread across the frame
rather than stacked up the middle of it.

The corner is the one furthest from the middle of the building, so the viewer
looks inward with an outside wall behind them. Candidates are then tried in
order — the four corners, then points part-way in from each, then the middle —
and the first clear of every collider wins, because the spot you would like is
routinely occupied by ordinary furniture. A room too small to hold the camera
anywhere but the middle skips straight to the last candidate.

The aim point is a little below eye height on purpose: aiming level frames a band
of blank wall, aiming down a few degrees puts the floor, the furniture standing
on it and the bottom of the windows in the same shot.

Four things this mode needed that nothing else in the project did:

**Storey-aware collision.** Every collider now carries the `floorId` it belongs
to, and the inside camera tests only its own. Collision is 2D on XZ, so without
that filter the ground floor's sofa blocks the first floor — which is exactly
what happened the first time a camera could stand between storeys. The room the
camera opens on is the lowest storey it can stand on, not the one with the most
floor area: you walk into a house at ground level.

**A floor to stand on.** Storey-aware collision is not enough on its own. Both
first-person cameras wrote `pos.y` once at mount and never again, so the eye
stayed at `EYE_HEIGHT` from the pavement to the top floor and a staircase had
nothing it could do about it. Each frame now ends by asking what is underfoot.

There are two cameras and they do not get the same floor, which is the part that
took four rounds of reported failure to establish:

| | `InsideView` (inside) | `FirstPerson` (walk) |
|---|---|---|
| starts | in a room | on the pavement |
| ground floor | room slabs | **and the ground it walks in on** |
| hole in the ground | — | **where every flight is** |

The walk camera needs the ground plane because it starts outside and has to cross
it to reach a room, and `walkableSurfaces` deliberately omits the ground paving —
indoors, counting that paving would float the camera 9 cm above every ground-floor
floor. Outdoors it is not a floor at all; it is the terrain the house stands on.

**The holes are load-bearing, not tidiness.** `floorUnder` resolves ties by
taking the *highest* candidate at or below the feet, so a single unbroken plane
at ground level passes underneath a flight climbing to 2.7 and **beats its ramp at
the foot**. The camera then walks the length of the staircase at a constant
height — the reported symptom, exactly. `groundSurfaces` cuts each flight's
footprint out of the plane for that reason, and `collision.test.ts` asserts the
hole rather than trusting it.

The walkable floor otherwise comes from two sources. `walkableSurfaces` reads the
**boxes** — room slabs and terrace decks. `flightSurfaces` reads the **model** —
one ramp per `Staircase`, positioned through `frameFor` and sized by the
staircase's own `run`, `width` and `direction`, climbing from `floor.elevation` to
`floor.elevation + rise`.

That split is deliberate. An earlier version read the walkable flight out of the
stair boxes as well, which makes climbing conditional on the render boxes
happening to line up — and the flight the renderer actually drew, 0.05 m treads
spaced a riser apart over one solid core, is exactly the one that does not line up
with anything: the treads are see-through and the core's flat top sits 2.5 m above
them. Coupling "can you walk up this" to "how did the 3D builder choose to draw
this" means a rendering decision can silently become a navigation bug. A staircase
*is* a continuous incline, so it is carried as one: `WalkSurface.ramp` gives the
height at the min-Z end and the max-Z end, and `surfaceHeightAt` interpolates. The
boxes are left to look like stairs and are not asked to be floors.

`floorUnder(x, z, feetY, …)` returns the highest candidate at or below the feet
plus `STEP_UP` (0.30 m; the generator's riser is `RISER` = 0.18). Highest rather
than lowest is what keeps the camera on the surface it is on instead of dropping it
through the flight to the slab beneath, and it is symmetric — descending, the
surface behind leaves the footprint and the next one down becomes the highest
candidate. Because the flight is a ramp, there is no frame on which the ground
under the camera is simply missing, and stepping off the head onto the upper
floor's slab is the same query answered on a different surface.

A camera that is *already* over nothing is allowed to move. Refusing every move
there would freeze it in mid-air with no way back onto anything, and a frozen
camera is worse than the void the refusal guards against.

`snapToFloor` already existed and was already unit-tested, and it cannot do this
job: it ignores `(x, z)` entirely, so every surface in the building competes no
matter which one is underfoot — which is harmless while the camera never leaves
one storey and fatal the moment it climbs, because half way up the flight the
first-floor slab is 1.4 m above the treads and belongs to the flight's
destination. It is left alone and still tested; `floorUnder` is a different
question.

`floorAtElevation` then reads the height back as a storey, which is what moves
the collider filter and the room readout upstairs. It matches on elevation rather
than on anything carried on the surface because a flight belongs to no single
storey — it leaves one and arrives at the next, and its upper half is genuinely
between them.

**A refusal.** The packer subtracts the stairwell from every floor, so no room —
and no slab — covers the flight, which leaves a real hole in the floor above it.
`floorUnder` answers "unchanged" when there is nothing beneath, which is right for
a camera already standing somewhere and wrong for one being asked whether it may
go there: unchanged reads as permission, and the camera would walk off the edge
and hover in the void. `hasFloorUnder` is asked before the move is committed, and
a step onto nothing is refused with the velocity zeroed rather than bounced off.

**A click that a drag cannot become.** Dragging to look around and clicking a
room are the same gesture until one of them moves more than four pixels. A
capture-phase `click` listener on the `.furnish-3d-view` wrapper compares the
press position against the click position and swallows the click when they
differ. It is on the wrapper rather than the canvas because the wrapper is an
ancestor: the DOM fires capture listeners outermost-first, so it gets to decide
before the canvas's own handlers see anything. The press position is kept
separately from the last pointer position and deliberately survives `pointerup`,
because the click it will be compared against has not fired yet.

**One unit for angles.** `roomViewpoint` reports degrees — that is how the room
labels and the plan are written — but `camera.rotation`, `PITCH_LIMIT`,
`LOOK_SENSITIVITY` and `TURN_RATE` are all radians. The running camera state is
in radians and every viewpoint is converted on the way in, through a single
`DEG`. Mixing the two silently did not crash: `Math.min(PITCH_LIMIT, -5.7)`
simply returned `-1.50`, so the camera looked at the floor and every screenshot
came back a flat grey plane. Walk mode has no such seam because it reads its yaw
straight back out of `camera.rotation.y` each frame.

Interiors are lit by a hemisphere light added **only while this mode is active**.
See `FEATURE_MATRIX.md` for why that is a stand-in and not bounce light.

### 7a. The 3D scene model

`buildScene(project, options)` is a pure function of the canonical model. It
returns plain boxes — `{ x, y, z, w, h, d, ry, color, kind, surface, … }` — and
the renderer does nothing but turn each box into a mesh. Rooms are axis-aligned
rectangles in metres and the plan's y axis grows southward; the world frame is
`x − plotWidth/2`, `elevation`, `y − plotDepth/2`, so the 2D editor and the 3D
view are the same drawing at two scales rather than two drawings that have to be
kept in step.

**Openings are cut by splitting, not by boolean.** A wall with a door in it
becomes piers, a sill piece, a head piece and the joinery around the hole, all
the full thickness of the wall and all the same plane. There is no CSG anywhere
in the project, so there is no CSG to get wrong, and the elevation is
geometrically continuous from end to end.

**Cut pieces overlap their neighbours rather than abutting.** `JOINT_OVERLAP`
is six millimetres, and it is the one piece of geometry in the model that is
not describing the building. Two boxes that stop exactly at a shared edge tile
perfectly in exact arithmetic — the model puts them at the same coordinate — but
they remain two triangles from two draw calls, and a rasteriser that computes
the shared edge from different vertices can leave a sliver of a pixel covered
by neither. Multisampling does not paper over that: the uncovered samples are
filled from whatever is behind, so the sliver resolves as a hair of dark
interior. Every elevation came out dressed in dashed vertical hairlines at every
opening jamb and every piece joint. Running each piece a couple of millimetres
*under* its neighbours removes the shared edge altogether; six millimetres is
about half a pixel at the distances this is viewed from, and the two faces it
covers are coplanar with the same normal and the same material, so there is
nothing for the depth test to disagree about.

What is left at a wall junction is a single antialiased pixel where three
coplanar faces meet — the wall, the wall behind it, and the corner block
`resolveCorners` inserts to close the junction. Rendering with `antialias: false`
removes those pixels entirely, which is what identifies them as coverage rather
than as a gap in the geometry: the float32 gap between two abutting edges was
measured at 2.4 × 10⁻⁷ m. They are one pixel wide, they sit exactly on a box
boundary, and they are listed under known limitations in the README rather than
papered over.

**Texture scale comes from the two largest dimensions of a box.** A box has
three dimensions but each of its six faces shows two of them, and which two
depends on which way up it is: a wall is drawn as length × height, a floor slab
as length × depth. Taking the two largest picks the right pair in both cases.

This used to take the width and the height, which is exactly right for a wall
and badly wrong for anything flat. The lawn is a 30 m × 26 m slab ten
centimetres thick, so its second dimension came out as 0.1 m: the repeat along
that axis bottomed out at half a tile while the other ran to twelve, and a map
stretched fiftyfold in one direction and tiled twelve times in the other is not
grass — it came out combed into long furrows running away from the camera. The
roof was smeared the same way, and the paving read as long boards rather than
as slabs. All three were one expression.

---

## 8. Persistence

IndexedDB (database `furnish`, stores `projects` and `underlays`) — not
localStorage, because the export includes base64 underlay images and
localStorage would blow its quota.

Writes are debounced and never on the critical path of a drag. `persist()`
skips a redundant write; `saveNow()` — behind "Save now" and Ctrl+S — always
writes, because a user asking for a save should get one.

---

## 9. Server

`server/main.ts` serves the built SPA and mounts `server/api.ts`, which exposes
two routes:

- `GET /api/health` — whether AI is configured, and with what
- `POST /api/chat` — the only path to MiniMax

`server/minimax.ts` speaks MiniMax's Anthropic-compatible Messages API
(`POST {MINIMAX_BASE_URL}/v1/messages`, `Authorization: Bearer`, content blocks
`text | thinking | tool_use`). **The API key is read from a server-side
environment variable and never reaches browser code** — the key is not in the
bundle, not in any client request, and not in the repo. `.env.example` carries
placeholders only.

Run with `node --experimental-strip-types`, which erases types but cannot erase
TypeScript parameter properties — a detail that stopped the production server
from starting until `MiniMaxError` was rewritten without them.

`server/env.ts` loads `.env`, and both entry points call it — the production
server and the Vite dev plugin, which is its own entry point and never runs
`server/main.ts`. When the loader lived only in `main.ts`, `npm run dev` started
with an empty environment and the assistant correctly reported "no key" to
someone who could see one in `.env`. Real environment variables win over the
file, which is what keeps the e2e hermetic: it points `MINIMAX_BASE_URL` at a
local stand-in, and that beats whatever `.env` happens to hold.

---

## 10. Testing

| Suite | What it covers | Count |
|-------|----------------|-------|
| Vitest | model, ops, geometry, validation, registry, orchestrator, trace, exports, 3D | **508** in 14 files |
| Playwright | the twelve-step demonstration, a pointer-lock regression, `e2e/editor.spec.ts` for the editing gestures, `e2e/assistant.spec.ts` for the assistant, and `e2e/inside.spec.ts` for the inside camera | **29** |

`npm run verify` runs typecheck → unit tests → build → e2e.

The e2e suite drives the real application in Chromium: it reads the DOM,
compares rendered pixels (a hash of a downscaled canvas readback), and opens the
files the browser downloaded. Step 5 talks to `e2e/fake-minimax.mjs`, a scripted
stand-in for MiniMax's endpoint; everything downstream of the network call is
real. The live service is exercised separately by
`scripts/live-assistant-check.mjs`, which is not a test — it needs a key and
costs money.

`e2e/editor.spec.ts` exists because the gestures that broke were all of a kind
a passing build cannot catch. Rooms tile the whole envelope, so testing rooms
before walls meant every point on an interior wall was also a point inside a
room: the wall could not be selected, moved or deleted by any route at all.
The room tool staying armed after a placement meant the click meant to pick a
room up added a second one instead. Openings had no selected state, so Delete
after clicking a door looked like nothing had happened. Each of those is now
asserted against what the canvas actually paints, not against application
state.

`e2e/pointer-lock.spec.ts` exists because drei's `PointerLockControls`, given no
`selector`, attaches its lock trigger to `document`. Every click in the studio
therefore asked for pointer lock on the 3D canvas, and the click that left walk
mode had already had that canvas detached by the time the event finished
bubbling — an unhandled rejection the twelve-step run caught about one run in
three. The test asserts the property rather than the symptom: no call to
`requestPointerLock` may name an element that is not connected, and clicking the
toolbar must not request lock at all.

---

## 11. Layout

```
src/            the application
server/         Express API and the MiniMax client
e2e/            the demonstration, the editing-gesture suite and the
                scripted model stand-in
scripts/
_research/      notes from the reverse-engineering pass (third-party
                checkouts are gitignored and not redistributed)
REVERSE_ENGINEERING.md
FEATURE_MATRIX.md
ARCHITECTURE.md
```

---

## 12. The staircase, and why it had no door

`src/model/layout.ts` packs a brief into the buildable envelope in bands, and
`planFloor` builds each floor's walls from the rooms that landed in it. Nothing
in that pipeline ever thought about a staircase, which is why a generated
two-storey house arrived with stairs that could not be climbed and led to a
window.

`placeStair` subtracts the shaft from the packing box and stops there. The walls
around the shaft belong to whichever rooms packed next to it, and
`chooseDoorPartitions` doors a partition only when **both** its rooms wanted it —
which is almost never a stairwell. Meanwhile the same function glazes every
boundary segment that bounds no room, and the shaft's near edge is exactly such a
segment: it sits on the front elevation. So the flight arrived at a glass wall
with nothing beside it, which is the whole of the second bug.

`openStairEnds` in `plan.ts` closes it, and runs from the generator's stairs loop
once every floor's walls exist, because it punches into walls only that loop
created. For each end of the run — the near end on the storey the flight leaves,
the far end on the one it arrives at — it targets the end of the run inset far
enough to clear the first tread, and considers every wall within reach of that
target. All four flanks are candidates, not just the two ends, because which of
them has a wall on it depends entirely on what happened to pack beside the shaft,
and the foot and the head are on *different* flanks.

Two details are not incidental:

- **An exterior wall that already has something at the spot is scored worse than
  an interior one at the same distance.** The candidates sit at a similar
  distance by construction, and without the tiebreak the front elevation gets a
  door punched through it often enough to matter. It is a tiebreak, not a ban: on
  a plan where the stair stands alone in its shaft, that exterior wall is the only
  place for the door.
- **The window moves, or it goes.** If every position over the flight is taken,
  the blocker is almost always that stairwell window. It is relocated along the
  wall if there is room, computed *before* the door so the two cannot overlap, and
  removed if there is not. A staircase you cannot get into is worse than a
  stairwell with no daylight.

The door swings into the flight. The shaft is subtracted from the packing box
before anything is furnished, so the stairwell is the one place on a generated
plan guaranteed to be clear — and a door opening into a room that was furnished
before this door existed is exactly how a new opening turns into a
`door_swing_blocked` finding.

**How the flight is drawn is now a separate question from how it is walked.**
`stairBoxes` used to emit 0.05 m treads spaced a riser apart over one solid core,
and that was wrong twice for the same reason: you could see between every pair of
treads, so it read as a stack of loose slats, and the camera's floor *was* those
see-through slabs, with the core's flat top 2.5 m above them. Each step is now a
full-height solid running from the nosing below it up to its own, which closes
the flight. Because walking no longer reads these boxes, their height is free to
be whatever the picture needs; the balustrade is a panel and a cap stepped one per
tread, because the box primitive has yaw and no pitch and a single raked rail
cannot be expressed — and a flight with no handrail reads as unfinished. Railings
are neither colliders nor walkable surfaces, so drawing them disturbs neither the
walking nor the blocking.

What this does not cover is in *Known limitations* in `FEATURE_MATRIX.md`:
`addStaircase` does not call it, and no check reports a flight with no door.

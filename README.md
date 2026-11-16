# Furnish

**AI Home Design Studio.** Describe a plot and what you need; get a real,
editable 2D floor plan; walk the building in 3D; check it against geometric
constraints; and let a language model propose changes that are validated and
applied through the same code the mouse uses.

Furnish is not a viewer. Every room, wall, opening and piece of furniture is
project data, editable by hand or by the assistant, in one canonical model
that both the 2D plan and the 3D building are derived from.

An app that checks itself does not prove much, so something else checks it.
**Kane CLI**, an independent browser agent, was given the requirements in
[`PRD.md`](PRD.md), designed its own test from them, ran it against the running
app and **failed** — nine errors, three rooms that could not be walked to. The
findings went back into the generator, the same test was re-run and passed, and
the app keeps the whole verification history — every run, passing and failing —
on a **Ledger** tab, because a record that holds only the passes is a
certificate, not a record.

The demo video was made with Kane CLI, out of those runs: the terminal, the
failed audit, the re-run, the ledger — and the app in it, in the shape Kane's
failures forced.

> **Scope.** Furnish produces early-design geometry. Generated plans are **not**
> construction-ready and are not professionally certified. Constraint
> thresholds are configurable sanity bounds, **not** rules from any
> jurisdiction — the app does not know where you are and does not pretend to.

---

## Watch the demo

▶ **[Furnish Verified — a floor plan, and a receipt for it](<YOUTUBE-LINK>)** —
4 min 50 s.

**The demo video was made with Kane CLI.** Three of its shots are Kane's own
work: **its terminal**, running the audit it designed from the PRD and failing
with nine errors; **the same audit, the same test definition, re-run and
passing**; and **the Ledger tab** in the app, holding both with their commits,
their costs and their sealed evidence. The fourth is the PRD it was handed.

The app end to end — brief, plan, the assistant refusing a sofa that does not fit and
placing the one that does, the building in 3D, the checks — and then the Kane CLI runs
that hold it to account: the audit that failed, the same audit re-run and passing, and
the Ledger tab that keeps both with their commits, their costs and their evidence.

And the app it audits is the app as its findings left it. The doors are grown as
a tree from the corridor so no room is a passage to another, the staircase is
lifted out of the footprint before the rooms are partitioned, the furniture is
placed last, clear of every doorway — three repairs that exist only because Kane
failed first, and the nine errors went straight back into the generator.

Nothing in it is a mock-up. The video was cut from one recorded take of the
running app, with Kane's terminal recordings, the PRD and the Ledger tab woven
in; the voice-over is synthesised, and every number it speaks is read out of the
recording's own facts file, so the words cannot disagree with the picture.
Roughly a quarter of the runtime is Kane and its evidence; the rest is the app
the agent held to account.

---

## Quick start

Requires **Node 22.16 or newer** (the production server runs TypeScript
directly via `--experimental-strip-types`).

```bash
npm install
cp .env.example .env      # optional — the studio works with no API key
npm run dev               # http://127.0.0.1:5173
```

Three routes. **`/`** is the landing page, **`/projects`** is the dashboard of
everything saved in this browser, and **`/studio`** is the editor. All three are
served by the same build — Vite's SPA fallback in dev, `app.get('*')` in
`server/main.ts` — so a direct visit or a refresh to any of them works. There is
no router dependency: `src/router.ts` is a path string, a `pushState` and a
`popstate` listener — and because `pushState` fires no event of its own, it
dispatches the event itself after every navigation, or the URL and the page
would disagree.

"Open the studio" goes to `/projects`, not to the editor. Someone arriving from
a link has a project they have never seen, not one in mind, and `/studio` opens
by restoring whatever was last open. From the dashboard you open a specific
project or press **New project**, which is a blank plot plus the brief wizard.

The landing page's hero plan is generated in the browser from the shared
`src/model/sample.ts` brief — the same plan the studio's **Load the sample
plan** button opens — so it cannot drift from the product.

Without a key the studio is fully usable for manual editing; only the assistant
is disabled, and the UI says so rather than failing silently.

One thing in this README needs the network and an account: the Kane CLI ledger.
`node scripts/verify.mjs` needs `kane-cli` signed in with credits on the account.
The recorded runs ship in `public/runs.json` with their sealed evidence in
`.testmuai/evidence/`, so the **Ledger** tab has its history the moment you start
the app — see **Verifying it works**.

To run it the way it is meant to be run — as a production build behind the
Express server, which is what serves the MiniMax API:

```bash
npm start                 # build, then serve on http://localhost:8787
```

### Enabling the assistant

1. Get an API key from <https://platform.minimax.io> (Account → API keys).
2. Put it in `.env`:

   ```
   MINIMAX_API_KEY=your-key-here
   MINIMAX_BASE_URL=https://api.minimax.io/anthropic
   MINIMAX_MODEL=MiniMax-M3
   ```

3. `npm start` (or `npm run dev` — both load `.env`), then look at the **AI**
   indicator in the toolbar.

The key is read from a server-side environment variable and **never reaches
browser code**. It is not in the bundle, not in any client request, and not in
this repository. `.env` is gitignored; `.env.example` contains placeholders
only.

To run the studio with no AI at all, set `FURNISH_DISABLE_AI=true`.

> **Honest status of the integration.** The live service **has** now been
> exercised end to end against a real key: text, tool calls, and full
> assistant turns driving the real registry. What that exercise found was that
> MiniMax-M3, offered the tool registry, answers in `tool_use` blocks rather
> than the JSON plan the prompt asks for — so the client reads both styles and
> validates them identically. See `scripts/live-assistant-check.mjs`, which
> reproduces it. It costs money, so it is a tool rather than a test; the
> automated suite uses a scripted stand-in and never calls the network.

---

## Verifying it works

```bash
npm run verify
```

That runs, in order:

| Step | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | clean |
| Unit tests | `npm test` | **735 passed**, 24 files |
| Production build | `npm run build` | 1,388 kB, 402 kB gzip |
| End-to-end | `npm run e2e` | **65 passed** |

`npm run e2e` drives a real Chromium against the real built bundle: it reads the
DOM, hashes rendered pixels, and opens the files the browser downloaded. Run it
headed with `npm run e2e:headed`.

The sixty-five are:

| Spec | What it covers |
|---|---|
| `demo.spec.ts` (14) | the twelve-step demonstration, end to end |
| `editor.spec.ts` (10) | the editing gestures: picking a wall that sits inside two rooms and deleting it, a door showing as selected, the right-click menu addressing the wall under the cursor, a room placed from the palette and picked up again rather than duplicated, the upright label in a corridor, the empty-plot and grid starts |
| `routes.spec.ts` (8) | the three routes: the landing page, the plan in its hero drawn by the product's own code, no third-party requests at all, the back button, a direct visit to `/studio` and a refresh |
| `walkFeel.spec.ts` (7) | walking: the editor shortcuts standing aside while a camera drives, `Q` and `E` turning on the spot, and typing in the assistant not walking the viewer through their own house |
| `roomProgram.spec.ts` (6) | the model choosing the rooms, the doors it asked for being real doors, and the app saying a model planned it |
| `fallback.spec.ts` (4) | what happens when the model cannot be reached: the Checks panel keeps saying so, and the plan stays valid |
| `newProject.spec.ts` (4) | *File → New project* asking for a brief rather than leaving the previous plot on screen |
| `assistant.spec.ts` (3) | the assistant through the browser and the server to a scripted endpoint: a design request answered in words must say on screen that the plan did not change, and a six-room plan must be *watched* arriving on the canvas one room at a time |
| `screens.spec.ts` (3) | each of the three screens rendering at all, and the browser throwing nothing |
| `inside.spec.ts` (2) | the inside camera: the view opens in a named room, moves to another when a room is chosen, and leaves on Escape; and a drag to look around is not delivered to the room underneath as a click |
| `walkHud.spec.ts` (2) | the walk-through overlay: pointer lock genuinely held, and walking into a wall not unmounting the canvas |
| `doorSwing.spec.ts` (1) | a door's leaf swinging the right way |
| `pointer-lock.spec.ts` (1) | a regression test for an unhandled rejection that came from a third-party control and only appeared in roughly one run in three |

Everything above is the app marking its own homework. The check worth something is
the one allowed to disagree, and that is what Kane CLI is for.

**The acceptance criteria, handed to the agent.** `flows/*.md` are seven criteria
taken from `PRD.md` and written as the objective a browser agent is asked to carry
out — in the words a person would use, with the steps it has to take and the
assertions it has to end on. `node scripts/verify.mjs` reads them, substitutes
`{{APP_URL}}` with the running app's address, and hands each one to `kane-cli run`.
Every run — passing or failing — is written to `public/runs.json`, which the app's
**Ledger** tab reads and shows next to the plan it just drew. The agent is also
given `.testmuai/context.md`, a description of the app as it actually is — the
**Checks** tab, the **Project navigator**, the three routes — so it is not sent
looking for things that have moved.

| The ledger | |
|---|---|
| Runs | **20** — 10 passed, 10 failed |
| Failures | kept, on purpose; a ledger holding only the passes is a certificate, not a record |
| Evidence | **23 sealed packs** in `.testmuai/evidence/` — one for each of the twenty runs, plus three from runs that were made and not recorded |
| Every row carries | its commit, its cost, its duration, and the findings the agent gave |
| The app's own numbers | computed by the app's own code at the commit in question, and stored in `measurements/<commit>.json` |

**The first audit is the one to read.** Kane designed it from the PRD, ran it
against the app, and it came back with **nine errors**: two rooms with nowhere to
go, three rooms that could not be walked to from the front door, the staircase with
no door, and three pieces of furniture standing in doorways. Those findings went
back into the generator — the doors are grown as a tree from the corridor so no
room is a passage to another, the staircase is taken out of the footprint before
the rooms are partitioned, the furniture is placed last, clear of every doorway —
and **the same test, with the same definition hash, was re-run and passed**. Six
more loops were closed the same way after that: a front door nobody could see on
the drawing, a door the staircase painted over, a flight arriving upstairs drawn
as an empty hole, a refusal that gave the plot in metres instead of the two areas
and the gap between them, and the ledger's own completeness. Each one found by the
agent, fixed in the product, re-run until it passed with the same test. The table
of them is in [`SUBMISSION.md`](SUBMISSION.md).

> **Where this stands, honestly.** The Kane CLI credit balance on this account is
> **−4.8781**, so no further run can be made until credits are bought — the flows
> cannot be re-run against the current build today. The twenty runs in the ledger
> are real, sealed and on disk, and the two terminal recordings in the demo video
> are among them. The recorded runs were made against the build of the day; the
> acceptance criteria have since been re-worded to match the app as it now stands
> (see [`flows/README.md`](flows/README.md)) — the criteria themselves did not
> change.

---

## Demo script

Twelve steps, about 45 seconds, end to end. This is also `e2e/demo.spec.ts`,
so the script below and the automated check are the same thing.

**1 · Open the app.** You land on one screen that asks what you want, because a
project with nothing in it should ask rather than show an empty grid. Plot size,
storeys and the rooms you need are all on that screen, with a sensible default
already filled in. There is no Next, no Back and no review step — a plan should
not cost a questionnaire to ask for. Everything else the brief can say —
street edge, setbacks, room sizes, style, budget, comfort — takes the defaults,
and the plan you get says so in the Checks panel.

**2 · Describe the home.** Plot 18 × 14 m, two storeys, one living room and
three bedrooms. Everything here feeds the generator as a structured brief — not
as a prompt.

**3 · Generate.** Press Generate. A real plan appears: rooms, walls, openings,
doors and starting furniture, all as project data. The status strip shows net
indoor area, footprint, coverage and floor-area ratio, each from an explicit
formula.

**4 · Select and resize a room.** Click a room. Handles appear. Drag one. The
net area in the status strip changes as you drag, and the 3D view changes with
it, because there is only one model.

**5 · Ask the assistant.** Open the assistant panel and type:

> Add a small study next to the largest room.

Watch the progress line move through the pipeline: reading the project, asking
for a plan, checking the plan, checking preconditions, applying, recalculating.

**6 · See it land.** The new room is in the 2D plan, selected, with its id and
area in the inspector. Net indoor area has gone up by the room's area.

**7 · Switch to 3D.** The building is there, from the same model. Orbit it.

**8 · Stand inside it.** Click **inside**. The camera drops into a room — the
living room, or whatever room you select in the plan or from the row of chips
along the bottom — standing in a corner and looking across at the opposite one.
Drag to look; W A S D walks; scroll steps forward; Q and E turn; Escape leaves.
Walls and furniture stop you, and so does a hole: the camera works out what is
underfoot from the slab and tread geometry each frame, so on a two-storey plan
you can walk up the staircase and stand on the first floor. Click **walk** instead
and you get the pointer-locked walk on the pavement, which is unchanged.

**9 · Run the checks.** Open the **Checks** tab. The assistant placed the study
over another room, and the engine says so, names both rooms, and quantifies it:

> "Kitchen" and "Home office" overlap by 4.50 m².

Nine other findings appear too — disconnected floors, a room with no door,
furniture in a door swing, setback crossings. Each is computed from the model,
not asserted by the model. The same class of finding is what the Kane CLI audit
turned up against an earlier build — nine of them — and it is what the Ledger
tab keeps.

**10 · Correct it.** Press **Shrink Kitchen to 6.10 m wide**. The overlap
clears, the room count is unchanged (it shrank, it did not delete), and the
area updates. Every correction the panel offers is executed through the same
tool registry the assistant uses and is re-validated by a test.

**11 · Save and reload.** Rename the project, then **File → Save now**.
Reload the page. The design is there — the wizard does not come back, because
the project was loaded, not reset.

**12 · Export and verify.** **Export → JSON**: a self-describing file with a
format tag and schema version, which is checked by putting it back through the
app's own importer. **Export → SVG**: a complete document with real geometry in
millimetres. **Export → PNG**, and a **3D capture** taken from the live canvas.

Then the thirteenth check runs: no uncaught errors anywhere in the run.

Each of these criteria is also written out in `flows/` as an objective for an
independent browser agent, so the same twelve steps can be checked by something
that is allowed to disagree with the app — see **Verifying it works**.

---

## How it works, briefly

Full detail in [ARCHITECTURE.md](ARCHITECTURE.md).

- **One model.** Rooms are rectangles in metres, `y` growing south. Walls are
  segments; openings and furniture are derived. The 2D canvas, the 3D scene,
  the measurements and the checks are all pure functions of it, so there is no
  synchronisation bug to have.
- **Pure operations.** Every edit is `(Project, input) => OpResult` — it returns
  a new project or a typed error, and never touches the store. A single
  dispatch table serves the mouse, the keyboard, undo and the assistant.
- **The tool registry is the boundary.** The model can name one of 28 typed
  tools and pass JSON arguments. It cannot return code, invent an id, or skip a
  validation. Destructive tools ask first.
- **The model never measures.** Areas and FAR come from formulas. The assistant
  can *request* a calculation; the number shown is recomputed afterwards from
  the store.
- **A reply is not a change.** Furnish draws the plan from operations, not from
  words. Asked to build something and handed a layout written in prose, the
  assistant is pressed once for the operations behind it; if it still runs
  nothing, the panel says so under the reply rather than letting a described
  design read as a drawn one.
- **The work is visible.** Operations are applied across painted frames, not in
  one commit, so the canvas builds room by room under a *the assistant is
  drawing* badge, and each step is listed in the panel as it lands.
- **Checks are deterministic.** 23 emitted issue codes with stable names, the
  numbers behind them, and — where one can be computed — a correction you can
  click.
- **The verification history is part of the product.** The Ledger tab is not a
  report about the app; it is a tab in it. Every Kane CLI run against this
  codebase is there — passing and failing, each with its commit, its cost and
  its sealed evidence pack — and the findings the agent gave are shown next to
  the plan they were found in.

---

## Project layout

```
src/
  router.ts   three routes (`/`, `/projects`, `/studio`) and a popstate listener
  home/       the landing page, and the sample plan its hero renders
  projects/   the dashboard of everything saved in this browser
  model/      canonical model, operations, geometry, measures, validation
  store/      the single operation dispatch table, history, persistence hooks
  tools/      the 28-tool registry — the assistant's security boundary
  ai/         orchestrator (10-step pipeline) and the assistant panel
  ui/         shell, navigator, inspector, checks panel, toolbar, status bar
  ui/canvas2d/  the 2D editor and the trace overlay
  three/      scene model, R3F scene, four cameras, collision, surfaces
  trace/      image tracing, vectorising, calibration
  export/     SVG, PNG and JSON writers
  persist/    IndexedDB library
server/       Express: /api/chat, /api/health, MiniMax client, .env loader
e2e/          the twelve-step demonstration, the pointer-lock regression, the
              editing and assistant gesture suites, the scripted model stand-in
flows/        seven acceptance criteria, written to be handed to Kane CLI
scripts/      verify.mjs — runs the flows through kane-cli and writes the ledger
              measure.mjs — the app's own checker, at a given commit
              live-assistant-check.mjs — drives the real service once
public/runs.json   the ledger the Ledger tab reads: every run, passing or failing
measurements/     what the app's checker said at each commit
.testmuai/    Kane CLI's context memory, the sealed evidence packs, the results
```

Every `e2e/*.spec.ts` navigates to **`/studio`**, not `/`. A `goto('/')` would
now land on the landing page and fail on a missing testid.

## Documents

| File | What it is |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | how Furnish is built and why |
| [FEATURE_MATRIX.md](FEATURE_MATRIX.md) | what is done, what is verified, and what is not |
| [PRD.md](PRD.md) | the requirements, written so that a browser can either confirm them or contradict them — this is what Kane was given |
| [flows/README.md](flows/README.md) | the acceptance criteria as they were handed to the agent, and why two of them now say "says" rather than "refuses" |
| [SUBMISSION.md](SUBMISSION.md) | the hackathon entry: the one paragraph, the shot list of the demo, and the table of every loop that was closed |

`_research/alza` and `_research/archmorph` are third-party checkouts made while
studying those projects. They are under their own licences, they are not part
of this deliverable, and they are gitignored. `_research/alza-notes.md` is my
own analysis and is kept.

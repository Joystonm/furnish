# Furnish Verified

**A home-design studio that refuses to hand over a floor plan nobody has walked.**

You describe the house you want. The app turns that into a program of rooms,
draws the program as a floor plan, and then checks its own drawing against
the rules about how houses work: every room has a door, every room can be
walked to from the front door, the staircase can be reached, nothing stands
in a doorway. The plan, the findings and the whole verification history are
on screen at once.

The verification history is the point. An independent browser agent — Kane
CLI — is given the requirements, designs its own test from them, runs it
against the running app, and **fails**. The failures go into the product.
The app is repaired from what the agent found, the same test is run again,
and the ledger in the app holds both runs: the one that found nine errors
and the one that found none.

> The hackathon submission material — the one-paragraph summary, the demo video
> shot list and the launch posts — is in [`SUBMISSION.md`](SUBMISSION.md).

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5199
```

The app opens on a drawn plan. You do not have to press anything to see it.

To run it the way it was tested — as a build, served — use:

```bash
npm run build
npm run preview      # http://localhost:5199
```

Checks, with no browser needed:

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest run — 53 tests
npm run verify       # typecheck + test + build
```

Node 18 or newer. No API key, no account, no network service. The layout is
deterministic — the same brief always produces the same plan.

---

## The closed loop, and how to see it

### 1. The requirement

[`PRD.md`](PRD.md) is the contract. Twenty-two acceptance criteria, each
one written so that a browser can confirm or contradict it. The requirements
were given to Kane CLI with `kane-cli context ingest PRD.md --mode agent`, and
the ingested copy is kept at [`.testmuai/context.md`](.testmuai/context.md).

### 2. The flow

Kane designed the test from the requirement, not by hand. The designed test
is [`.testmuai/tests/audit-plan-walkability_test.md`](.testmuai/tests/audit-plan-walkability_test.md)
— it carries the `assurance:` block that shows it came from the CLI, and it
covers the criteria about doors, reachability, the staircase, furniture in
doorways, the north point and the scale bar.

The seven flows in [`flows/`](flows) are the same idea written as plain
English objectives, one per acceptance criterion group, ready to hand to
`kane-cli run`.

### 3. The failing run

Kane ran the designed test against the app at commit `4061d79` and it
**failed**:

| | |
|-------|-------|
| 🔴 **Result** | Failed |
| 🎯 **Task** | audit the floor plan the app draws |
| ⏱️ **Duration** | 3m 29s |
| 💳 **Credits** | 74.22 used |
| 📝 **What happened** | The staircase had no door, three rooms could not be reached, two rooms had nowhere to go and three pieces of furniture stood in doorways |
| 📁 **Evidence** | `.testmuai/evidence/da896aa0-c909-4360-84af-3b5e8c588a07.evidence` |

Kane read eleven findings off the findings panel and named them: *"Bedroom 3
has nowhere to go"*, *"The staircase has no door"*, *"The sofa blocks a
doorway"*. The run's own record is kept at
[`.testmuai/results/2026-11-13-audit-plan-walkability-run1-4061d79.md`](.testmuai/results/).

### 4. The repair

Commit `275bb49` — *"Repair the plan generator after Kane's audit found nine
errors"*. Three changes to the generator, each answering something the agent
saw:

- **the doors are grown as a tree from the corridor.** Before, the generator
  cut a door into every shared wall, so a bathroom ended up with four
  doorways and its door-clearance zones covered the whole floor. Now every
  room has exactly one way in, and no room is a passage to another. A
  `WAY_IN` table decides which rooms are willing to be the way in to
  another — a bathroom is the last choice, never a bedroom's only way.
- **the staircase gets its own column and a landing.** It was being placed
  where it bit a piece out of a room. It is now taken out of the footprint
  before the rooms are partitioned, so no room is ever left with a staircase
  bitten out of it.
- **the furniture is placed last**, once the doorways are known, and clear
  of the floor in front of every one of them.

### 5. The passing run

The **same** test — same file, same md5 (`fedf7f20…`) — was run again
against the repaired app at commit `275bb49`:

| | |
|-------|-------|
| 🟢 **Result** | Passed |
| 🎯 **Task** | reviewed room access findings on the floor-plan site |
| ⏱️ **Duration** | 2m 48s |
| 💳 **Credits** | 53.42 used |
| 📝 **What happened** | 11 rooms are reachable and there are 0 errors. Rooms with no door — none; rooms that cannot be reached — none; staircase door — yes; furniture in a doorway — no |
| 📁 **Evidence** | `.testmuai/evidence/678d53fd-acd3-4b12-bb71-90cef494b40f.evidence` |

Both sealed packs record the same test definition —
`definition.sha256: 9b55eb0dae37…` — so the passing run is provably the same
test, re-run, and not a different test that happened to pass. The failing
pack's `failure.yaml` names the defect and marks it triaged; the passing
pack's `failure.yaml` is empty.

Both packs still pass `kane-cli evidence validate` (L1, finalized). One
account identifier — the email address of the account that ran the tests — has
been redacted from inside them; the verdict, the definition hash and every
screenshot are as the agent produced them. A third attempt died on a platform
error, the screenshot capture timing out, so its pack does not validate and it
is not in the repository; it cost 1.19 credits and found nothing about the
product.

### 6. The ledger, in the product

Both runs are in the app, on the **Ledger** tab, above the plan and beside
the findings — and so are the seventeen others. The failing run is listed
first, with the eleven findings the checker gave, the commit it ran against,
and what it cost. The passing run is listed second.

The numbers beside each run are not typed in. `scripts/measure.mjs` checks
the sources out at that commit and runs the same checker the browser runs:

```bash
npm run measure 4061d79    # → 9 errors, 1 warnings, 4/7 rooms reachable
npm run measure 275bb49    # → 0 errors, 0 warnings, 11/11 rooms reachable
```

The measurements are kept in [`measurements/`](measurements), and the ledger
itself in [`public/runs.json`](public/runs.json) — plain data, readable with
`cat`.

The commit beside a run is the last commit that was in the tree when the run
happened, worked out from the run's own timestamp. The ledger was audited by
the agent itself: the flow *The ledger keeps the failures* asks it to read
every row and check that each one names the commit it ran against and the
checker's own findings at that moment. It failed the first time, because the
ledger could not be read in one pass; after the rebuild it passed, with every
one of the nineteen rows carrying both.

---

### 7. Three more loops, the same way

The first loop was the loud one — nine errors on the screen. The rest were
quieter: the agent looked for things the checker had no rule about, found
them, and each one was fixed in the product and the same test run again.

| The flow | What the run found | Fixed in | Re-run |
|---|---|---|---|
| `audit-plan-walkability` — the test Kane designed | nine errors: three rooms with no door, three unreachable rooms, the staircase with no door, furniture in doorways | `275bb49` | 🟢 passed, same file, same `definition.sha256` |
| `every-room-has-a-door` | — | — | 🟢 passed first time |
| `the-app-opens-on-a-drawn-plan` | — | — | 🟢 passed first time |
| `every-room-can-be-walked-to` | the front door was in the model but not marked on the drawing | `1cdaaf5` | 🟢 passed |
| `nothing-stands-in-a-doorway` | — | — | 🟢 passed first time |
| `the-staircase-can-be-walked-to` | the flight arriving upstairs was an empty dashed rectangle — no treads, no way up | `472e117` | 🟢 passed at `472e117` |
| `the-app-refuses-a-program-that-does-not-fit` | the refusal gave the plot in metres, not the two areas or the gap | `472e117` | 🟢 passed at `472e117` |
| `the-ledger-keeps-the-failures` | the agent could not read the whole ledger in one pass, so it could not check every row | the ledger was rebuilt so every row carries its commit and the checker's own findings | 🟢 passed — all four assertions |

Nineteen runs are in the ledger: nine passed and ten failed. The failures are
the point, so they are all there, next to the passes, with the reason the
agent gave and the commit it ran against. A run that got stuck rather than
finding a defect is in there too, labelled as what it was — the agent running
out of steps is not the same as the app being wrong, and the ledger says which
was which.

**The front door — commit `1cdaaf5`.** The flow *Every room can be walked to*
asks for the front door to be visible on the drawing. The model knows which
door it is — it is `kind: 'front'` — but the drawing drew every door the
same way, so nothing on the plan said which opening was the way in from the
street. It is now drawn in the accent colour, with an arrow in from the
outside and the words FRONT DOOR beside it. A test locks that in: exactly
one marked front door, on the door the model calls the front one, and no
internal door marked.

**The door into the stairwell — commit `122716b`.** The flight of stairs is
as wide as the shaft it runs in, and it was drawn *after* the doors, so it
painted over the doorway in the shaft's own wall. The checker never noticed —
the door was in the model — but the drawing did not show it, and a person
reading the plan could not see that the stair was not walled off. The flight
is drawn before the doors now, and the door is kept clear of the corner, so
the opening reads as a doorway and has somewhere to swing.

**The flight arriving upstairs — commit `472e117`.** The upper storey drew
the flight that arrives there as an empty dashed rectangle — the opening in
the floor. Honest about the slab, useless to a reader: no treads, no way up.
It is drawn as a flight now, with its treads and its arrow, inside the
dashed edge of the opening.

**The refusal — commit `472e117`.** Criterion 16 says the app *refuses and
says by how much it does not fit*. It refused, but it gave the size of the
plot in metres and left the gap to be worked out — and for a plot too small
to build on it gave no gap at all. Every refusal now quotes the area the
program asks for, the area the plot holds, and how much too much that is:

> **The program does not fit the plot**
>
> A 6 × 5 m plot is too small to build on: inside the 1.5 m setback it leaves
> 3.0 × 2.0 m, so it holds 6.0 m² on each storey and 12.0 m² over 2 storeys.
> The program asks for 105.0 m², so it is 93.0 m² too much.

Every one of those was found by the same test, re-run with the same file, and
the failures are in the ledger next to the passes.

---

## Reproduce the loop

With the app running on port 5199:

```bash
npm run verify:flows                    # run every flow, write the ledger
node scripts/verify.mjs --only every-room-has-a-door
node scripts/verify.mjs --dry-run       # list the flows, spend nothing
node scripts/verify.mjs --rebuild       # rebuild the ledger from the record
```

`verify:flows` runs each flow with `kane-cli run <objective> --agent`, reads
the agent's verdict out of its event stream, and writes the result to
`public/runs.json`. It keeps the failures. A ledger that only holds the
passes is a certificate, not a record.

To design a test from the requirement yourself:

```bash
kane-cli context ingest PRD.md --mode agent
kane-cli design tests --mode agent
kane-cli testmd run .testmuai/tests/audit-plan-walkability_test.md --agent
```

---

## What is in the repository

```
PRD.md                      the requirement, given to the agent
SUBMISSION.md               the one-paragraph summary, the video shot list, the posts
flows/                      seven flow objectives, one per criterion group
.testmuai/context.md        the PRD as the agent ingested it
.testmuai/tests/            the test the agent designed
.testmuai/results/          the agent's own result file for each run
.testmuai/evidence/         the sealed evidence packs
measurements/               what the app's checker said at each commit
public/runs.json            the ledger the app reads
scripts/verify.mjs          runs the flows, writes the ledger
scripts/measure.mjs         measures the checker at a commit
scripts/probe-entry.ts      the entry used to measure older commits
src/model/                  brief → program → plan → findings
src/ui/                     the studio: brief, program, plan, findings, ledger
```

### How it is put together

| | |
|---|---|
| `src/model/program.ts` | the brief in words → a list of rooms with areas and storeys |
| `src/model/generator.ts` | the program → a drawn plan: rooms, doors, stairs, furniture |
| `src/model/checks.ts` | the checker: every finding is computed from the plan |
| `src/model/report.ts` | the checker, runnable outside the browser — used by the ledger |
| `src/ui/ledger.ts` | the ledger's shape, and how it is read |

There is no language model in the layout. The generator is deterministic, so
the same brief always produces the same drawing and a checker can compare
two runs.

---

## What this is not

- It is **not a construction document** and does not claim to be. The plans
  are early-design geometry.
- It does **not** check against the building regulations of any jurisdiction.
  The minimum room sizes it uses are configurable sanity bounds for early
  design.
- It does **not** replace the independent checker. The app's own findings are
  one opinion; the ledger is the other one.
- Nothing here is generated by a language model at run time, and no API key
  is needed or accepted.

---

## The stack

React 18 · TypeScript 5.7 · Vite 6 · Vitest 2. Plain CSS with design tokens.
Two dependencies, both of them React.

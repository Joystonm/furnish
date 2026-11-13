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
npm test             # vitest run — 42 tests
npm run verify       # typecheck + test + build
```

Node 18 or newer. No API key, no account, no network service. The layout is
deterministic — the same brief always produces the same plan.

---

## The closed loop, and how to see it

### 1. The requirement

[`PRD.md`](PRD.md) is the contract. Twenty-two acceptance criteria, each
one written so that a browser can confirm or contradict it. It was given to
Kane CLI with `kane-cli context ingest PRD.md --mode agent`, and the
ingested copy is kept at [`.testmuai/context.md`](.testmuai/context.md).

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

### 6. The ledger, in the product

Both runs are in the app, on the **Ledger** tab, above the plan and beside
the findings. The failing run is listed first, with the eleven findings the
checker gave, the commit it ran against, and what it cost. The passing run
is listed second.

The numbers beside each run are not typed in. `scripts/measure.mjs` checks
the sources out at that commit and runs the same checker the browser runs:

```bash
npm run measure 4061d79    # → 9 errors, 1 warnings, 4/7 rooms reachable
npm run measure 275bb49    # → 0 errors, 0 warnings, 11/11 rooms reachable
```

The measurements are kept in [`measurements/`](measurements), and the ledger
itself in [`public/runs.json`](public/runs.json) — plain data, readable with
`cat`.

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

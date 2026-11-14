# Kane CLI Online Hackathon — the analysis and the plan

Written 4 November 2026, from the rules page, the official winners' post, the two
X posts you linked, and the Kane CLI that is installed on this machine.

---

## 1. The two posts you linked

Both are TestMu AI's own write-ups of the **previous** winners, posted to promote the
online hack day (SF in-person 24 Oct with OpenAI, online 25 Oct – 3 Nov).

**`https://x.com/testmuai/status/2111043753951584395`** — Abhinav Pangaria (PayZoll
founder) and **Guardian Kane**. The post walks the repository and shows Kane CLI
supporting *"workflow verification and real browser testing"* while **linking code,
product requirements, test flows, retries, and evidence**. The top reply, from Keith
Tsang, is the part worth stealing: *"teams often neglect documenting their workflow so
knowledge can be shared and projects do not stall when others take over."*

**`https://x.com/testmuai/status/2109602303967957106`** — SamFelix0512 and **Demo
Studio**. The post shows *"a workflow that turns an AI-generated concept into a
browser-tested product."* It closes with the line that is the whole event in five
words: **"Build it. Ship it. Prove it."**

Read together, the two posts are not really about the projects. They are about the
**linkage**: concept → code → requirement → flow → run → evidence. Every previous
winner is shown with that chain visible, and the chain is what the judges scored.

> I could not open the two X posts in a browser from here (the fetcher is refused by
> x.com), so the above is the rendered text of those posts and their replies, not a
> guess at them.

---

## 2. What the three winners actually did — the playbook to copy

| Winner | Product | Kane's job | The mechanic that won it |
|---|---|---|---|
| **1st — demo.studio** (Sam Felix) | URL + brief → a narrated product-demo video | **Three roles: the build loop, the runtime, the safety net** | Kane fed back *during* the build (each iteration checked in a real browser), then became the product's own browser agent, then tested the product end to end |
| **2nd — GuardianKane** (Abhinav Pangaria) | A Claude Code extension that refuses to accept a task as done | **The conscience** | PRD → phased tasks → `kane-cli context review --approve` → a Stop hook replays the generated test in a local browser → a second defect sweep against the PRD → three failures escalate to a human |
| **3rd — KANE vs ABLE** (Christine Lall) | An adversarial escape room: ABLE builds, Kane independently solves | **The adversary** | Kane's *first run failed*, the evidence exposed a circular dependency, ABLE repaired the room through a coding agent **without being told the objective**, and Kane re-entered and computed the escape code `7294` itself |

### The three things they share — this is the actual strategy

1. **Kane was inside the loop, not after it.** Nobody built for three weeks and then
   "added Kane at the end". The rules explicitly refuse that: *"Merely installing Kane or
   adding a trivial final flow is insufficient."*
2. **The evidence was visible.** GuardianKane has a dashboard; KANE vs ABLE keeps failed
   and successful runs, dependency comparisons, repairs and ABLE's confidence in the UI.
   A judge can *see* the loop, not take your word for it.
3. **A real failure was on camera.** All three had a genuine failing run that found a
   genuine defect. Nobody demonstrated a suite that had always passed.

The judges' own words are the scorecard:

* demo.studio — *"the build loop, the runtime, and the safety net at once."*
* GuardianKane — Kane *"turns every one of those checks from a claim into evidence."*
* KANE vs ABLE — *"closed verification loop in its purest form"* … *"Kane was not
  scripted through the dungeon. It solved it."*

---

## 3. The rules, precisely

From the official page (luma.com/kanecli-online-hackathon) and the Devpost FAQ:

**Dates.** Build window **12–19 November**. ⚠️ The page lists three *different*
submission deadlines (10 Nov 23:59 IST, 2 Nov 10:29 PT, and 19 Nov) — the first two
look like stale calendar fields. **Confirm the real cutoff with TestMu AI before
relying on it.** Repositories lock at the deadline; later fixes cannot be pushed.

**Eligibility — the part that decides everything:**

* 18+, solo or a team of up to four, anywhere in the world. No application or curation.
* Any stack. **Kane CLI is required.**
* *"The app and Kane integration must be created during the event."*
* **The repository must be initialised on or after 12 November. Commit history is
  checked.**
* *"Pre-existing code cannot simply be submitted."* The FAQ allows reusing **an idea**
  but not pushing a codebase written previously.
* Create a TestMu AI account (10,000 Kane credits, one month) and run Kane at least
  once — running a test is an eligibility requirement, not a recommendation.

**What you must submit** (one SurveyMonkey form):

1. Public GitHub repo, with setup instructions in the README.
2. **A three-minute demo video** (YouTube *Unlisted* or Drive) showing **both the working
   app and Kane running**. Strongest material first. Verify the link in an incognito window.
3. One paragraph: the product, its users, the coding agent, and Kane's role.
4. A live URL **or** a runnable command — *"judges should be able to reach a working
   version in under 30 seconds."*

**Judging — four criteria, weighted equally**, three judges scoring independently,
averaged; ties broken by *Verified*, then *Closed loop*:

| Criterion | What it rewards |
|---|---|
| **Ships** | A real, working application and end-to-end flow |
| **Verified** | Kane exercised the app and *meaningfully detected or confirmed* an issue |
| **Closed loop** | The agent built it, Kane tested it, and the result **fed back into the agent** |
| **Craft** | Distinctive enough that a developer might want to install and use it |

Prizes: **$3,000** — $1,500 / $1,000 / $500 — plus a founders meeting, three months of
Kane CLI Pro, a blog post, promotion, and the *"Verified with Kane CLI"* badge for every
eligible team. The organisers *"may investigate fraudulent, automated, duplicated, or
mechanically gamed entries"* — disqualification is a real outcome.

---

## 4. The eligibility finding — read this before anything else

**This repository cannot be the submission.** `github.com/Joystonm/Argon` was created on
**16 October 2026** — a month before the window opens — and carries a codebase written
over that month. The rules say, in as many words, that the repo must be initialised on
or after 12 November, that the app and the Kane integration must be created during the
event, and that pre-existing code cannot be submitted. Submitting Argon as-is would be
ineligible, and the anti-gaming clause gives the organisers grounds to look closely.

**What the rules do allow: reusing an *idea*.** That is the whole opportunity, and it
is bigger than it looks — because *what you have learned is not code*.

Argon has already produced the thing that is hardest to fake and easiest to judge:
**real defects found by walking a real app.** In the last stretch of work alone:

* the front door landed in the dining room instead of the living room, because a
  "does this wall touch this room" test was satisfied by a shared *corner*;
* a dining chair was parked in the only route to the stairs, because the stair's own
  door is punched into the walls *after* the rooms are furnished — so the furniture was
  laid out without knowing the door existed;
* furniture stood in doorways, because a door is three things — a hole, a leaf, and the
  floor a person stands on — and only the first two were respected.

Those are not hypothetical. They are the exact class of defect the previous winners'
projects were built to catch, they are demonstrable on camera, and they are the reason
the "Verified" criterion is winnable: Kane can *find* them, because they are observable
in a browser.

So the strategy is not "submit Argon". It is **rebuild the idea, small and sharp, in a
new repository, during the window, with Kane at its centre** — and use Argon as the
research lab that tells you which defects matter.

---

## 5. Options, with a recommendation

### Option A — *recommended* — "Furnish Verified": a new AI design studio whose output is checked by an independent browser agent

A fresh repository, created on 12 November, containing a genuinely new and much smaller
application than Argon:

* You type a brief ("a 3-bed house on a 12 × 18 m plot").
* The model writes a **room program** (the brief becomes a list of rooms and adjacencies).
* A deterministic generator lays out the **plan** and renders it as a drawn floor plan.
* The app reports what it can find wrong with its own plan.
* **Kane opens the app in a real browser and independently checks the result**: is there
  a front door, is every requested room present and reachable, is the stair connected,
  is any piece of furniture standing in a doorway, can a person walk from the front door
  to every room?
* The findings land in the app's **verification ledger** — every run, what it found, what
  was changed, whether it re-passed.
* The coding agent reads the failing run, changes the generator, and Kane re-runs. The
  ledger shows **fail → fix → pass**.

**Why this shape:**

* *Ships* — a real app, one command, a URL. Small enough to finish and polish.
* *Verified* — the failures are real and demonstrable, not contrived. The ledger is the
  evidence, in the product, where the judge can look.
* *Closed loop* — the shape of KANE vs ABLE, applied to the domain you already know.
* *Craft* — a plan-checking agent is genuinely useful to other developers, and it is
  unlike the other three winners' products.

**And it uses the new Kane CLI, which the previous winners did not have.** 0.10.0 (28
October) adds `explore` (maps an app and turns it into tests, with finding evidence
packs), `context` (ingest a PRD → extract use-cases → review → `design tests`), sealed
`testrun` over many `*_test.md` files, `evidence validate|serve|merge` with policy
gates, and NDJSON `--agent` output on every command. That is a real edge over a field
that competed on 0.9.

### Option B — a Kane-native developer tool (GuardianKane-shaped)

A Claude Code extension that turns a PRD into tasks and blocks "done" until Kane
re-verifies. Lowest build risk — no application to design — but it competes head-on
with the second-place winner on the same idea, and it has no *Ships* story of its own.

### Option C — a game (KANE vs ABLE-shaped)

Maximum entertainment value, and the demo video writes itself. But it abandons
everything Argon taught you, and "Craft" would be judged on a game.

### Option D — submit Argon as it stands

**Ineligible.** Do not do it.

**My recommendation: Option A.** It is the only one that uses what you have actually
built, that is unambiguously eligible, and that has a credible shot at all four criteria
at once.

---

## 6. The build plan — 12 to 19 November

### Before the window opens (now → 11 Nov) — nothing that can be copied

1. **Finish Argon's own bugs** (the walk-up-the-stairs problem, the door placement).
   Every defect you fix here is a defect your new app must not have — and a defect you
   can narrate on camera. *This is research, not submission material.*
2. **Design the new app on paper** — this file is that design. Nothing is copied; an
   idea and a plan are allowed.
3. **Prepare the account.** You are authenticated as `joystonjj7`, but the token
   **expires today, 4 November** — re-login before the window. Check the credit balance
   (10,000 credits are granted per account, valid one month) and get a second account or
   a top-up if it is close to spent.
4. **Rehearse Kane against a real app.** Use Argon as the testbed to learn Kane's
   behaviour: how it drives a WebGL canvas, what it can and cannot read from a 3D view,
   how long a run takes, what an evidence pack contains. Do this **now**, so that on
   12 November you are writing flows, not learning the tool. The *flows themselves* are
   written in the new repo, in the window.

### The window

| Day | Build | Kane |
|---|---|---|
| **12 Nov** | Create the repo. Scaffold the app: brief form → program → plan → drawn plan. One command to run it. | — |
| **13 Nov** | The problems panel and the app's own checks. | `kane-cli explore` the running app; look at the map. |
| **14 Nov** | The verification ledger page. | `kane-cli context ingest` the PRD → extract use-cases → `context review --approve`. |
| **15 Nov** | The repair path: the app records what changed between runs. | `kane-cli design tests --use-case` → author `flows/*_test.md`. |
| **16 Nov** | `scripts/verify.mjs` — runs the flows, parses NDJSON, writes the ledger. | **First real run. Expect it to fail.** Fix the app, not the test. |
| **17 Nov** | The agent↔Kane loop: a Stop hook that runs the flows and refuses to end a turn on a red run. | Second run. Close the loop. |
| **18 Nov** | `evidence validate` / `merge`; the evidence page; polish. | Seal a pack. `testmd export --language js` for judges who prefer Playwright. |
| **19 Nov** | README, the one-paragraph summary, the demo video, the SurveyMonkey form. | Final green run. Record the video **with** Kane running. |

### The deliverables, checked

- [ ] Repo initialised **on or after 12 November**, real commit history, public.
- [ ] `npm install && npm run dev` reaches a working app in **under 30 seconds**.
- [ ] A live URL as well as the command.
- [ ] At least one run in the history is a **genuine failure with a real defect**.
- [ ] The ledger shows fail → repair → pass.
- [ ] The agent demonstrably changed code *because* Kane said so.
- [ ] Three-minute video, Unlisted, showing the app **and** Kane running.
- [ ] The one paragraph: product, users, coding agent, Kane's role.
- [ ] TestMu AI account active, credits available, Kane run at least once.

---

## 7. What to build, in one sentence

> An AI home-design studio that refuses to ship a plan nobody has walked: Kane drives
> the finished app in a real browser, checks the plan the way a person would — is there
> a front door, is every room reachable, is anything blocking the way to the stairs — and
> the app keeps the whole verification history, failures included, on screen.

---

## 8. Honest notes

* The build window is seven days and the plan above is a seven-day plan for one
  developer plus an agent. It is tight but it is not fantasy; it is small on purpose.
* Every defect named in §4 was found in Argon by *walking the running app*, not by
  reasoning about the code. That is the proof that the "Verified" criterion is
  achievable for this product — Kane can find these, because they are visible.
* The app must not claim its plans are construction-ready or code-compliant, and the
  demo should say so out loud. The brief's own rules forbid the over-claim, and an
  honest caveat reads as craft, not weakness.
* Confirm the real submission deadline with TestMu AI — the published page contradicts
  itself three times.

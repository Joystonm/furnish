# Submission — Furnish Verified

Everything the Kane CLI Online Hackathon asks for, in one place.

- **Deadline:** 11:59 PM IST on 19 November (10:29 AM PT). *"No pushes after this."*
- **Repository:** initialised 13 November 2026 — inside the 12–19 November window.
- **Submission form:** <https://www.surveymonkey.com/r/kane-cli-hackathon-submission>

---

## 1. The one paragraph

Copy this into the form's "explain the application, the coding agent, and Kane CLI's
role" field.

> Furnish Verified is a home-design studio that turns a written brief into a drawn
> floor plan and refuses to hand it over unchecked: the app generates the plan
> deterministically, checks its own geometry against the rules about how houses
> actually work — every room has a door, every room can be walked to from the front
> door, the staircase can be reached, nothing stands in a doorway — and shows the
> findings beside the drawing. It is for home builders, architects and buyers who
> need an early-design plan good enough to argue about. Claude Code, the coding
> agent, wrote the generator, the checker and the studio; Kane CLI, the independent
> browser agent, was given the requirements in `PRD.md`, designed its own test from
> them, ran it against the running app and **failed** — nine errors and three
> unreachable rooms — and those findings were fed straight back into the generator:
> the doors were re-grown as a tree from the corridor so no room is a passage to
> another, the staircase was taken out of the footprint before the rooms were
> partitioned so no room is ever bitten by it, and the furniture was moved clear of
> every doorway. The **same** designed test was then re-run and passed, and the app
> keeps the whole verification history — twenty runs, ten of them passing and ten
> of them failing, each with its sealed evidence pack — on a Ledger tab, so the
> verification history is part of the product rather than a claim in a README. Six
> more loops were closed the same way after that: a front door nobody could see on
> the drawing, a door the staircase painted over, a flight arriving upstairs drawn
> as an empty hole, a refusal that gave the plot in metres instead of the two areas
> and the gap between them, and the ledger's own completeness — each one found by
> the agent, fixed in the product, and re-run until it passed with the same test.

---

## 2. The three-to-five minute demo video

The rule: *"showing both the working app and Kane running."* So Kane's terminal is
on screen for more than half the video. YouTube, unlisted.

| Time | Shot | What is on screen |
|---|---|---|
| 0:00 | **Cold open — the app** | The studio running, a floor plan already drawn, the findings panel clean, the status bar reading `Rooms 11/11 reachable · 0 errors`. Say what the app is in one sentence. |
| 0:20 | **Cold open — the ledger** | Click to the **Ledger** tab. Twenty runs, newest first — green and red, with the tally at the top: twenty runs, ten passed, ten failed. Scroll to the very first one: red, and it lists the eleven findings the agent read off the panel. *"This is the point of the project."* |
| 0:45 | **The requirement** | `PRD.md` open in the editor. Then the terminal: `kane-cli context ingest PRD.md --mode agent`, then `kane-cli design tests --mode agent`. The designed test file appears — point out the `assurance:` block. *"Kane wrote the test; nobody did."* |
| 1:15 | **The failing run** | `kane-cli run "<objective>" --agent --name audit-plan-walkability`. The real browser opens and moves on its own. Let the run play — cut to the app window when it starts clicking around. |
| 1:55 | **The failing result card** | The red card. Duration, credits, one line of what happened. Then open the evidence pack: the screenshot of the findings panel with the eleven findings in it. |
| 2:20 | **The repair** | `git show 275bb49 --stat` and the diff of the generator. Name the three changes: doors as a tree, the stair taken out first, furniture placed last. |
| 2:50 | **The passing run** | The **same** test again — same file, same `definition.sha256`. The browser runs. It passes. The green card: 11/11 reachable, 0 errors. |
| 3:20 | **The ledger** | Back in the app, the Ledger tab. Scroll between the red one and the green one: the failing findings still listed, the commit each ran against, the checker's own findings, what each cost. |
| 3:35 | **One more loop, fast** | The **Floor 2** tab: the flight arriving upstairs, with its treads and its arrow — a thing that was a dashed hole until the agent said so. Then the refusal: set the plot to 6 × 5, press **Generate the plan**, and the app refuses and says *"The program asks for 105.0 m² … it is 93.0 m² too much."* |
| 3:55 | **Close** | `npm install && npm run dev`. The URL. One line: *"The plan is checked by someone who did not write it."* |

**Recording notes.** Run the app from the **build** (`npm run build && npm run preview`)
— the dev server's dependency re-optimisation caused one screenshot to time out
during the failing run and that cost a run. Have the terminal and the browser on
one screen. The terminal is the evidence; do not narrate over it.

---

## 3. Launch publicity

At least **two public posts** on Hacker News, X, Reddit or LinkedIn. More posts and
engagement may earn additional points. Post the video link, not a link to a repo
that has not been made public yet.

**Post A — the failure (Reddit / Hacker News, technical audience)**

> I built a floor-plan generator that checks its own output, and then I had an
> independent browser agent try to break it.
>
> It broke it. Nine errors: rooms with no door, three rooms you could not walk to
> from the front door, the staircase with no way in, and three pieces of furniture
> standing in doorways.
>
> The findings went back into the generator, which was rebuilt — doors are now
> grown as a tree from the corridor so no room is ever a passage to another, the
> staircase is taken out of the footprint before the rooms are partitioned, and
> furniture is placed last, clear of every doorway. The same test was re-run and
> passed.
>
> The part I find interesting: the app keeps the failing run on screen next to the
> passing one. A verification history that only holds the passes is a certificate,
> not a record.
>
> [video link] · [repo link]

**Post B — the loop (X / LinkedIn, shorter)**

> Most "AI verified my app" demos show a green tick.
>
> This one shows the red one too. An independent browser agent designed its own test
> from a PRD, failed against my floor-plan generator, and its findings were fed back
> into the code. Same test, re-run, passed. Both runs live in the app.
>
> [video link] · [repo link]

**Post C — the tool (optional, aimed at builders)**

> A floor plan is a claim about a building. Most tools make the claim and stop.
> This one draws the plan, then checks it against the rules that actually matter —
> every room has a door, every room can be walked to, the staircase is reachable,
> nothing stands in a doorway — and shows you what it found.
>
> [video link] · [repo link]

---

## 4. Submission checklist

| Requirement | Status |
|---|---|
| Public GitHub repo, initialised on/after 12 November | ✅ created 13 Nov 2026 · **pushed** |
| Setup instructions in the README | ✅ [`README.md`](README.md) |
| Kane CLI used, at least one run | ✅ twenty runs recorded in the app's ledger — ten passed, ten failed |
| Explanation: app, coding agent, Kane's role | ✅ §1 above |
| YouTube demo, 3–5 min, app **and** Kane running | ⬜ **not uploaded yet** — recorded, 3 min 27 s · shot list in §2 |
| Live URL (optional) | ⬜ not deployed — the runnable command is the fallback |
| Two public launch posts | ⬜ **not posted yet** — drafts in §3 |
| Credentials for any login/paid service | ✅ none — no login, no paid service, no API key |
| Recorded-run / backup-deployment fallback | ✅ twenty sealed evidence packs — one per run, each with its own `run.yaml`, `result.yaml`, step records and screenshots — plus the run's own `Result.md` under `.testmuai/tests/output-*/` for eighteen of them |
| TestMu AI account, same email for credit claim | ✅ the account used for the runs |
| Repo pushed before 11:59 PM IST, 19 Nov | ✅ pushed — `Joystonm/furnish-verified`, `main` |

### Where the repo stands

The repository is public at `Joystonm/furnish-verified` and `main` is pushed.
If anything needs to go up again, the command is:

```bash
cd /f/furnish-verified
git push origin main
```

Repositories lock at the deadline, so push anything remaining before
11:59 PM IST on 19 November.

### The loops, in one table

This is the part the judges are looking for: not one green tick, but a chain of
requirement → agent-designed test → run → failure → repair → the same test again.

| The flow | What the run found | Fixed in | Re-run |
|---|---|---|---|
| `audit-plan-walkability` — the test Kane designed from `PRD.md` | nine errors: three rooms with no door, three unreachable rooms, the staircase with no door, furniture in doorways | `275bb49` | 🟢 passed — same file, same `definition.sha256` |
| `every-room-has-a-door` | — | — | 🟢 passed first time |
| `the-app-opens-on-a-drawn-plan` | — | — | 🟢 passed first time |
| `every-room-can-be-walked-to` | the front door was in the model but not marked on the drawing | `1cdaaf5` | 🟢 passed |
| `nothing-stands-in-a-doorway` | — | — | 🟢 passed first time |
| `the-staircase-can-be-walked-to` | the flight arriving upstairs was an empty dashed rectangle — no treads, no way up | `472e117` | 🟢 passed at `472e117` |
| `the-app-refuses-a-program-that-does-not-fit` | the refusal gave the plot in metres, not the two areas or the gap | `472e117` | 🟢 passed at `472e117` |
| `the-ledger-keeps-the-failures` | the agent could not read the whole ledger in one pass | the ledger was rebuilt so every row carries its commit and the checker's own findings | 🟢 passed — all four assertions |

Ten of the twenty runs failed. Every one of them is in the app's ledger with
the reason the agent gave, and a run where the *agent* ran out of steps is
labelled as that — it is not a defect in the product.

### Optional, if there is time

- A live URL. The app is a static Vite build, so it will deploy to any static host;
  `npm run build` produces `dist/`.
- A YouTube unlisted link is enough; a public one is better.

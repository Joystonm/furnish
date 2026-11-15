# Submission — Furnish Verified

Everything the Kane CLI Online Hackathon asks for, in one place.

- **Deadline:** 11:59 PM IST on 19 November (10:29 AM PT). *"No pushes after this."*
- **Repository:** `Joystonm/furnish-verified`, initialised 13 November 2026 — inside the
  12–19 November window. (The working copy is `F:\Argon`; `Joystonm/Argon` was created
  15 October and is therefore **outside** the window, so it is not the submission repo.)
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

## 2. The demo video

**The file: `F:\demo-build\furnish-demo.mp4`** — 4 min 50 s, 1920×1080, H.264 + stereo
AAC, 23 MB. Recorded from the running app as one continuous take, then cut, narrated in
English and assembled. Every number spoken is read out of the recording's own facts
file, so the words cannot disagree with the picture.

| Time | Shot | What is on screen |
|---|---|---|
| 0:00 | **Cold open — the app** | The landing page, then the studio: *"A floor plan is a claim about a building. This one comes with a receipt."* |
| 0:15 | **The studio** | The real app, running. Nothing in the video is a mock-up. |
| 0:23 | **The brief** | The wizard: 18 × 20 m plot, two storeys, one living room, one kitchen, three bedrooms, two bathrooms, one dining room. No walls are drawn by hand. |
| 0:37 | **Generate** | The model is asked one bounded question — which rooms, how big, which must adjoin. It never chooses a coordinate or an object id; the app mints those. |
| 0:53 | **The model's own sentence** | The toast carries the model's sentence about the house, then the app's note on it: *"7 of 16 requested room connections could not be made … those pairs do not share enough wall for a door."* |
| 1:08 | **The plan** | The drawing, and the status bar: net indoor 255.7 m², coverage 36.7 %, FAR 0.71, **no errors**. 10 rooms on the ground floor. Doors are derived, not typed. |
| 1:27 | **The assistant** | *"Put an L-shaped sofa in the living room."* It measures the room, the swing of the doors, the strip of floor in front of every opening, and the piece itself. |
| 1:42 | **The refusal** | *"I could not finish that: There is no clear space in Living room for a L-shaped sofa (2.60 m × 1.70 m)."* — and it names the piece that **would** fit, with the exact call to make. |
| 2:09 | **The placement, and a second refusal** | The named 3-seat sofa goes in, at coordinates the app chose, under an id the app minted (18 → 19 pieces). The next plan arrives with no intent, and the app refuses that too: *"A plan needs an 'intent'."* |
| 2:26 | **Upstairs** | First floor — 11 rooms, and the flight arriving with the stair it came up. |
| 2:32 | **The house in 3D** | The same plan in three dimensions: walls, door gaps, the stair, the furniture. |
| 2:41 | **Inside** | Stand inside a room and look around. The same geometry, seen from within. |
| 2:53 | **The checks** | Every room has a door · every room can be walked to · nothing stands in a doorway · the footprint sits inside the setbacks. Geometric checks computed from the model — *"not a compliance certificate, and the setbacks are configurable, not a jurisdiction's rules."* |
| 3:14 | **The pivot** | The PRD — every rule phrased so a browser can either confirm it or contradict it — handed to Kane CLI. *"The app checking itself does not prove much. A program marking its own homework."* |
| 3:29 | **The failing run** | Kane's terminal, as it streamed: the agent opens the page, reads the findings panel, reads the numbers off the status bar — and then the stream stops, mid-run, at a screenshot the browser never finished. The run's own conclusion: *not because the plan had a fault, but because the browser could not finish a screenshot inside its time limit.* |
| 3:55 | **The passing run** | The same audit, re-run, with the same test definition. Every assertion holds: the north point, the scale bar, the stair treads and its door, and every room drawn one the findings say can be reached. |
| 4:12 | **The ledger** | Twenty runs. Ten passed, ten failed — the failing ones kept next to the passing ones, each with its commit, its cost and its evidence pack. One failing run is on screen with the reason it gave. |
| 4:31 | **Export** | The model as JSON, the plan as vector or raster, a capture of the 3D view. |
| 4:39 | **Close** | *"That is Furnish. A floor plan, and a receipt for it. The repository is public. Clone it, npm install, npm run dev."* |

**Where Kane is on screen:** its own terminal for 43 s of the 4 min 50 s, the PRD it was
given for 15 s, and the ledger — twenty of its runs with their commits, costs and
sealed evidence packs — for 19 s. Roughly a quarter of the runtime is Kane and its
evidence; the rest is the app the agent held to account.

**Recording notes, for anyone re-recording.** The take was made against the dev server
(`npm run dev`, port 5173). The two Kane terminal recordings in the video are older
runs against ports 5199 and 5200, which is why their URLs differ from the app's — the
test definition and the verdicts are the point of those shots, not the port. The frames
are played back through a pipe rather than a numbered file pattern: the pattern demuxer
short-reads the staged folder and the scene freezes on one still frame, which is a
trap worth keeping out of the next cut.

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
| Public GitHub repo, initialised on/after 12 November | ✅ `Joystonm/furnish-verified`, created 13 Nov 2026, public |
| Setup instructions in the README | ✅ [`README.md`](README.md) |
| Kane CLI used, at least one run | ✅ twenty runs recorded in the app's ledger — ten passed, ten failed |
| Explanation: app, coding agent, Kane's role | ✅ §1 above |
| YouTube demo, 3–5 min, app **and** Kane running | ⬜ **recorded and edited — 4:50, not yet uploaded.** The file is `F:\demo-build\furnish-demo.mp4`; shot list in §2 |
| Live URL (optional) | ⬜ not deployed — the runnable command is the fallback |
| Two public launch posts | ⬜ **not posted yet** — drafts in §3 |
| Credentials for any login/paid service | ✅ none — no login, no paid service, no API key |
| Recorded-run / backup-deployment fallback | ✅ twenty sealed evidence packs — one per run, each with its own `run.yaml`, `result.yaml`, step records and screenshots — plus the run's own `Result.md` under `.testmuai/tests/output-*/` for eighteen of them |
| TestMu AI account, same email for credit claim | ✅ the account used for the runs |
| Repo pushed before 11:59 PM IST, 19 Nov | ✅ pushed — `Joystonm/furnish-verified`, `main` (three commits and the working tree are still local; see §5) |

### Where the repo stands

`Joystonm/furnish-verified` is public and its `main` is pushed — it is at `a2dd15b`.
The working copy lives in `F:\Argon` (the old `furnish-verified` folder was deleted and
its work moved here, per your instruction), and `F:\Argon`'s `origin` still points at
`Joystonm/Argon`, which was created 15 October and is therefore ineligible. The
eligible repo's `main` is three commits behind the local `main`, so pushing it is a
fast-forward.

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

---

## 5. What is left, and who has to do it

Three things need your account or your word. None of them can be done from here.

**1. Upload the video.** The file is `F:\demo-build\furnish-demo.mp4` (4:50, 23 MB).
Upload it to YouTube — unlisted is enough, public is better — and put the link in
`README.md` under the demo heading, and in the two posts in §3. Suggested title:
*"Furnish Verified — a floor plan, and a receipt for it"*.

**2. Post the two launch posts.** The drafts are in §3; they need `[video link]` and
`[repo link]` filled in. Two platforms is the minimum (Hacker News and Reddit for the
technical one, X or LinkedIn for the short one).

**3. Push the remaining commits.** The local `main` is three commits ahead of the
eligible repo's `main`, and the working tree holds the rest — including the assistant
transcript store that the recorded video shows working. From `F:\Argon`:

```bash
git push https://github.com/Joystonm/furnish-verified.git main
```

Nothing has been pushed since you said *"No pushes after this."* — the command is
here for you to run, and it is a fast-forward, so it will not rewrite anything.

**Blocked, and it will not unblock itself:** the Kane CLI credit balance is at
**−4.8781**, so no further Kane run can be made on this account until credits are
bought. Re-running the flows against the final build (to refresh the ledger with
runs from this week's code) is therefore not possible today. The ledger's twenty runs
are real and sealed, and the two terminal recordings in the video are among them.

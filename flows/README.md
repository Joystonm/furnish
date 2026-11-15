# The acceptance criteria, as they were handed to Kane CLI

Each file here is one acceptance criterion from `PRD.md`, written as the
objective a browser agent is asked to carry out — in the words a person would
use, with the steps it has to take and the assertions it has to end on.

`node scripts/verify.mjs` reads these files, substitutes `{{APP_URL}}` with the
running app's address, and hands each objective to `kane-cli run`. The result
of every run — passing or failing — goes into `public/runs.json`, which is
what the app's Ledger tab reads.

**The mechanics were re-targeted on 16 November.** The app has moved on from
the build the recorded runs were made against: the findings panel is now the
**Checks** tab, the floors are rows in the **Project navigator**, and the app
listens on port 5173. The acceptance criteria themselves have not changed —
only the words that say where to look. The runs in the ledger were made
against the build of the day and their evidence packs are sealed: they are a
record of what happened, not a script to be re-run word for word.

**Why the flow about a programme that does not fit now says "says" rather than
"refuses".** The app no longer refuses an over-large programme outright: it
scales the rooms down and says so, with the numbers, in the toast that
appears after the plan is drawn and in the note in the Checks tab. The
criterion is still the one the app has to meet — it must never quietly draw a
plan that does not fit, and it must say what it did — but the wording was
changed to the behaviour that exists, rather than left claiming a refusal the
app no longer makes.

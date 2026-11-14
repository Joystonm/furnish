# The ledger keeps the failures

**Covers:** acceptance criteria 20, 21 and 22.

## Objective

Open the home-design studio at http://localhost:5199 and read its verification ledger.

The ledger is the history of the independent checker. It must list every run, including the ones that failed, with each flow's result, the commit it ran against, and what the app's own checker said at the time. Do exactly this:

1. Click the Ledger tab at the top of the panel on the right.
2. Read every run listed, from the newest to the oldest. For each one, record its status, its commit, and what the app's own checker reported at the time.
3. Assert that at least one run is listed.
4. Assert that every run is marked either passed or failed, and that a failed run is visibly marked as failed rather than hidden.
5. Assert that every run records the commit it ran against and the app's own findings at that moment.
6. Assert that each run lists its individual flows with their results.

Report the runs you found, newest first, with their statuses. Finish with the result of each assertion. If the ledger is empty, say so plainly and stop.

/**
 * The ledger, tested.
 *
 * The tally the panel shows has to agree with the file on disk — and with the
 * number the README and the demo video quote out loud. So these tests read
 * the real ledger rather than a fixture: if a run is added, the count moves,
 * and the docs have to move with it.
 */

import { describe, expect, it } from 'vitest';
import ledgerRaw from '../../public/runs.json?raw';
import { summariseRuns, type LedgerRun } from './ledger';

const file = JSON.parse(ledgerRaw) as { runs: LedgerRun[] };
const runs = file.runs;

describe('the ledger tally', () => {
  it('counts every run on record', () => {
    const tally = summariseRuns(runs);

    expect(tally.total).toBe(runs.length);
    expect(tally.passed + tally.failed).toBe(tally.total);
  });

  it('is the number the README and the video quote', () => {
    // Twenty runs, ten passed, ten failed. A new run breaks this on purpose:
    // the record and the words about it are not allowed to drift apart.
    expect(summariseRuns(runs)).toEqual({ total: 20, passed: 10, failed: 10 });
  });

  it('counts a run that did not pass as failed', () => {
    const tally = summariseRuns([
      { status: 'passed' },
      { status: 'failed' },
      { status: 'failed' },
    ] as LedgerRun[]);

    expect(tally).toEqual({ total: 3, passed: 1, failed: 2 });
  });

  it('is empty rather than wrong when there is nothing yet', () => {
    expect(summariseRuns([])).toEqual({ total: 0, passed: 0, failed: 0 });
  });
});

describe('what the ledger keeps', () => {
  it('keeps every run that failed, with its evidence', () => {
    const failures = runs.filter((run) => run.status === 'failed');

    expect(failures.length).toBeGreaterThan(0);
    for (const run of failures) {
      expect(run.evidence, `run ${run.id} has no evidence pack`).toBeTruthy();
      expect(run.commit, `run ${run.id} names no commit`).toBeTruthy();
    }
  });

  it('shows the same audit failing and then passing', () => {
    const audit = runs.filter((run) => run.name === 'audit-plan-walkability');

    expect(audit.some((run) => run.status === 'failed')).toBe(true);
    expect(audit.some((run) => run.status === 'passed')).toBe(true);
  });

  it("records what the app's own checker said on every run that has it", () => {
    for (const run of runs) {
      if (!run.appFindings) continue;
      expect(typeof run.appFindings.errors).toBe('number');
      expect(typeof run.appFindings.reachable).toBe('number');
      expect(typeof run.appFindings.total).toBe('number');
    }
  });
});

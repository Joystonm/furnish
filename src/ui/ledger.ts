/**
 * The verification ledger.
 *
 * The ledger is the record of every run of the independent checker: what was
 * run, when, what it found, and what the build was at the time. It is read
 * from `public/runs.json`, which `scripts/verify.mjs` writes after it has run
 * the flows.
 *
 * It is deliberately plain data. A judge should be able to read it without
 * running anything, and the file should be readable with `cat`.
 */

export interface LedgerTest {
  /** The flow's name, as the agent ran it. */
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  /** What the agent said, in its own words. */
  detail: string;
}

export interface LedgerFinding {
  code: string;
  severity: 'error' | 'warning' | 'note';
  title: string;
  rooms: string[];
}

export interface LedgerFindings {
  errors: number;
  warnings: number;
  notes: number;
  reachable: number;
  total: number;
  /** What the checker said, one finding at a time. */
  issues?: LedgerFinding[];
}

export interface LedgerRun {
  id: string;
  /** A short name for the run, e.g. `flows-2026-11-13`. */
  name: string;
  /** The flow's own title, when the run was one of the flows. */
  title?: string;
  /** The agent session the run belongs to — one run, one session. */
  session?: string;
  /** ISO 8601. */
  startedAt: string;
  status: 'passed' | 'failed';
  durationS: number;
  credits: number | null;
  /** The commit the app was at when the run happened. */
  commit: string;
  summary: string;
  tests: LedgerTest[];
  /** What the app's own checker reported at that moment. */
  appFindings: LedgerFindings | null;
  /** Where the sealed evidence pack is. */
  evidence: string | null;
}

export interface LedgerFile {
  runs: LedgerRun[];
}

export interface LedgerTally {
  /** Every run on record, passed or not. */
  total: number;
  passed: number;
  failed: number;
}

/**
 * Count the runs.
 *
 * A run that did not pass counts as failed, including the ones where the
 * agent ran out of steps rather than the app being wrong — the ledger says
 * which of those it was, and the tally does not soften the number.
 */
export function summariseRuns(runs: LedgerRun[]): LedgerTally {
  const passed = runs.filter((run) => run.status === 'passed').length;
  return { total: runs.length, passed, failed: runs.length - passed };
}

/**
 * Read the ledger.
 *
 * A missing file is not an error: it means no run has been recorded yet, and
 * the panel says exactly that.
 */
export async function loadLedger(): Promise<LedgerRun[]> {
  try {
    const response = await fetch('runs.json', { cache: 'no-store' });
    if (!response.ok) return [];
    const file = (await response.json()) as LedgerFile;
    return Array.isArray(file.runs) ? file.runs : [];
  } catch {
    return [];
  }
}

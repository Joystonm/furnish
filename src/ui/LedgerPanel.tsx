import { useEffect, useState } from 'react';
import { loadLedger, summariseRuns, type LedgerRun } from './ledger';

/**
 * The verification ledger, in the studio's own right-hand panel.
 *
 * It is the history of the independent checker: every run, what it found, and
 * what the app's own checker said at the time. Failed runs are kept — a
 * ledger that only holds the passes is a certificate, not a record.
 */
export function LedgerPanel() {
  const [runs, setRuns] = useState<LedgerRun[] | null>(null);

  useEffect(() => {
    let live = true;
    loadLedger().then((loaded) => {
      if (live) setRuns(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  if (runs === null) {
    return (
      <div className="p-4 text-[12px] text-inkSoft" data-testid="ledger-loading">
        Reading the ledger…
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="p-4 text-[12px] leading-relaxed text-inkSoft" data-testid="ledger-empty">
        <p className="mb-1 font-semibold text-ink">No runs recorded yet</p>
        <p>Every check the independent agent runs is written here — the failures as well as the passes.</p>
      </div>
    );
  }

  const tally = summariseRuns(runs);

  return (
    <div className="flex flex-col gap-2 p-2" data-testid="ledger" data-run-count={runs.length}>
      <div className="flex items-center gap-2 px-1" data-testid="ledger-tally">
        <span className="text-[12px] text-inkSoft">
          <strong className="text-[13px] text-ink">{tally.total}</strong> runs
        </span>
        <span className="chip border-ok/30 bg-ok/10 text-[10px] text-ok" data-testid="ledger-passed">
          {tally.passed} passed
        </span>
        <span className="chip border-danger/30 bg-danger/10 text-[10px] text-danger" data-testid="ledger-failed">
          {tally.failed} failed
        </span>
      </div>

      {runs.map((run) => (
        <article
          key={run.id}
          className="rounded-control border border-line bg-raised/60 p-2.5"
          data-testid="ledger-run"
          data-run-status={run.status}
        >
          <div className="flex items-start gap-2">
            <span
              className={`chip shrink-0 border-transparent text-[10px] ${
                run.status === 'passed' ? 'bg-ok/12 text-ok' : 'bg-danger/12 text-danger'
              }`}
              data-testid="ledger-run-status"
            >
              {run.status === 'passed' ? 'passed' : 'failed'}
            </span>
            <span className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-ink">{run.title ?? run.name}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-inkFaint">{formatWhen(run.startedAt)}</span>
          </div>

          <p className="mt-1.5 text-[11px] leading-relaxed text-inkSoft">{run.summary}</p>

          {run.appFindings ? (
            <div className="mt-1.5 text-[10px] text-inkFaint" data-testid="ledger-findings">
              The app&apos;s own checker said {run.appFindings.errors} errors · {run.appFindings.warnings} warnings ·{' '}
              {run.appFindings.reachable}/{run.appFindings.total} rooms reachable
            </div>
          ) : null}

          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
            <dt className="text-inkFaint">Commit</dt>
            <dd className="font-mono text-inkSoft">{run.commit || '—'}</dd>
            <dt className="text-inkFaint">Cost</dt>
            <dd className="text-inkSoft">
              {run.durationS ? formatDuration(run.durationS) : '—'}
              {run.credits !== null ? ` · ${round(run.credits)} credits` : ''}
            </dd>
            {run.evidence ? (
              <>
                <dt className="text-inkFaint">Evidence</dt>
                <dd className="truncate font-mono text-inkSoft" title={run.evidence}>
                  {run.evidence}
                </dd>
              </>
            ) : null}
          </dl>

          <ul className="mt-2 flex flex-col gap-0.5">
            {run.tests.map((test) => (
              <li key={test.name} className="flex items-start gap-1.5 text-[10px] leading-snug text-inkSoft">
                <span
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                    test.status === 'passed' ? 'bg-ok' : test.status === 'failed' ? 'bg-danger' : 'bg-inkFaint'
                  }`}
                  aria-hidden
                />
                <span className="min-w-0">
                  {test.name}
                  {test.detail ? <span className="text-inkFaint"> — {test.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

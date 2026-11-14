import { useEffect, useState } from 'react';
import { loadLedger, type LedgerRun } from './ledger';

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
      <div className="empty" data-testid="ledger-loading">
        <div className="empty__title">Reading the ledger…</div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="empty" data-testid="ledger-empty">
        <div className="empty__title">No runs recorded yet</div>
        Run <code>npm run verify:flows</code> and the result of every check is written
        here — the failures as well as the passes.
      </div>
    );
  }

  return (
    <div className="ledger" data-testid="ledger" data-run-count={runs.length}>
      {runs.map((run) => (
        <div className="run" key={run.id} data-testid="ledger-run" data-run-status={run.status}>
          <div className="run__head">
            <span
              className={`badge ${run.status === 'passed' ? 'badge--ok' : 'badge--error'}`}
              data-testid="ledger-run-status"
            >
              {run.status === 'passed' ? 'passed' : 'failed'}
            </span>
            <span className="run__name" title={run.title ?? run.name}>
              {run.title ?? run.name}
            </span>
            <span className="run__when">{formatWhen(run.startedAt)}</span>
          </div>
          <div className="run__body">
            <div>{run.summary}</div>
            {run.appFindings ? (
              <div className="kv">
                <span className="kv__key">The app&apos;s own checker said</span>
                <span className="kv__value">
                  {run.appFindings.errors} errors · {run.appFindings.warnings} warnings ·{' '}
                  {run.appFindings.reachable}/{run.appFindings.total} rooms reachable
                </span>
              </div>
            ) : null}
            {run.appFindings?.issues?.length ? (
              <ul className="run__list run__list--findings" data-testid="ledger-findings">
                {run.appFindings.issues.map((issue) => (
                  <li key={issue.code + issue.title}>
                    <span
                      className={`run__dot run__dot--${issue.severity === 'error' ? 'failed' : 'skipped'}`}
                      style={{ display: 'inline-block', marginRight: 6 }}
                    />
                    {issue.title}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="kv">
              <span className="kv__key">Commit</span>
              <span className="kv__value">{run.commit || '—'}</span>
            </div>
            <div className="kv">
              <span className="kv__key">The run cost</span>
              <span className="kv__value">
                {run.durationS ? formatDuration(run.durationS) : '—'}
                {run.credits !== null ? ` · ${round(run.credits)} credits` : ''}
              </span>
            </div>
            {run.evidence ? (
              <div className="kv">
                <span className="kv__key">Evidence</span>
                <span className="kv__value">{run.evidence}</span>
              </div>
            ) : null}
            <ul className="run__list">
              {run.tests.map((test) => (
                <li key={test.name}>
                  <span
                    className={`run__dot run__dot--${test.status}`}
                    style={{ display: 'inline-block', marginRight: 6 }}
                  />
                  {test.name}
                  {test.detail ? <span className="run__when"> — {test.detail}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
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

import type { CheckSummary, Correction } from '../model/checks';

interface Props {
  summary: CheckSummary | null;
  onFix: (correction: Correction) => void;
}

function severityClass(severity: string): string {
  if (severity === 'error') return 'finding finding--error';
  if (severity === 'warning') return 'finding finding--warning';
  return 'finding finding--note';
}

export function FindingsPanel({ summary, onFix }: Props) {
  if (!summary) {
    return (
      <div className="empty" data-testid="findings-empty">
        <div className="empty__title">No plan yet</div>
        Describe the house and press Generate. The findings appear here.
      </div>
    );
  }

  if (summary.issues.length === 0) {
    return (
      <div className="empty" data-testid="findings-clean">
        <div className="empty__title">Nothing found</div>
        Every room has a door, every door can be reached, and nothing is standing in
        a doorway.
      </div>
    );
  }

  return (
    <div className="findings" data-testid="findings">
      {summary.issues.map((issue, index) => (
        <div
          key={`${issue.code}-${index}`}
          className={severityClass(issue.severity)}
          data-testid="finding"
          data-issue-code={issue.code}
          data-issue-severity={issue.severity}
        >
          <div className="finding__title">{issue.title}</div>
          <div className="finding__detail">{issue.detail}</div>
          {issue.correction ? (
            <div className="finding__fix">
              <button
                type="button"
                className="btn btn--small"
                data-testid="finding-fix"
                onClick={() => onFix(issue.correction as Correction)}
              >
                {issue.correction.label}
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

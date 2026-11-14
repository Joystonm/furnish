/**
 * The validation panel.
 *
 * This is the same engine the assistant reads. Showing the user the identical
 * list — the identical codes, the identical sentences — is what makes the AI
 * trustworthy: it cannot tell the user something is fine when this panel says
 * otherwise, because there is only one answer.
 *
 * Issues are click-to-fix where the engine could produce a deterministic
 * correction, and click-to-select where the fix needs a judgement.
 *
 * It also carries one thing that is not an issue and deliberately not shaped
 * like one: who designed the plan. A clean bill of health says the geometry is
 * sound, which is a different claim from "someone thought about this house".
 * Filing provenance as an `Issue` would put it on the same list as a wall
 * crossing a room, under a severity, with a fix button — none of which apply.
 * So it sits above the list, in its own words, whenever it is worth saying.
 */
import { useMemo, useState } from 'react';
import { useProject } from '../store/useProject.ts';
import { runTool } from '../tools/registry.ts';
import { DEFAULT_RULES, errorsOnly, validate } from '../model/validate.ts';
import { provenanceNotice } from '../model/provenance.ts';
import type { Issue, Severity } from '../model/types.ts';

// The claim itself lives in the model — the drawing and this panel must never
// disagree about who designed the plan — but it is re-exported here because
// this is where people look for it.
export { provenanceNotice } from '../model/provenance.ts';

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * What to say about how this plan came to be, or null when there is nothing
 * worth saying — see `src/model/provenance.ts`, which holds the claim itself.
 */
export function ProblemsPanel({ onOpenRoom }: { onOpenRoom(id: string): void }) {
  const project = useProject((s) => s.project);
  const ruleOverrides = useProject((s) => s.ruleOverrides);
  const [showRules, setShowRules] = useState(false);

  const issues = useMemo(
    () => validate(project, { ...DEFAULT_RULES, ...ruleOverrides }).slice().sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [project, ruleOverrides],
  );
  const errorCount = errorsOnly(issues).length;
  const provenance = provenanceNotice(project);

  return (
    <div className="p-2" data-testid="problems-panel">
      {provenance && (
        <div
          className={`mb-2 rounded-card border px-3 py-2.5 text-[12px] leading-snug shadow-raised ${
            provenance.tone === 'warn' ? 'border-warn/25 bg-warn/[0.07] text-warn' : 'border-ok/25 bg-ok/[0.07] text-ok'
          }`}
          data-testid="provenance-notice"
        >
          {provenance.text}
          {/* Repairs and dropped constraints. Inside the provenance block rather
              than the issue list, because they are not defects in the geometry —
              they are notes about the program that produced it. A user told
              "see the Checks panel" must find the thing they were sent here for. */}
          {project.provenance?.warnings?.map((w, i) => (
            <p key={i} className="mt-1.5 border-t border-current/15 pt-1.5 text-inkSoft" data-testid="provenance-warning">
              {w}
            </p>
          ))}
        </div>
      )}
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[13px] text-inkSoft">
          {issues.length === 0 ? (
            <span className="text-ok">No problems found in this plan.</span>
          ) : errorCount ? (
            <><span className="text-danger">{errorCount} error{errorCount === 1 ? '' : 's'}</span>{issues.length - errorCount > 0 && <>, {issues.length - errorCount} warning{issues.length - errorCount === 1 ? '' : 's'}</>}</>
          ) : (
            <><span className="text-warn">{issues.length} thing{issues.length === 1 ? '' : 's'} to look at</span></>
          )}
        </p>
        <button className="btn btn-ghost ml-auto px-2 text-[12px]" onClick={() => setShowRules((v) => !v)}>
          {showRules ? 'Hide' : 'Constraints'}
        </button>
      </div>

      {showRules && <ConstraintRules />}

      {issues.length === 0 ? (
        <div className="card px-4 py-7 text-center">
          <p className="text-[13px] font-medium text-ink">Everything checks out.</p>
          <p className="mx-auto mt-1 max-w-[38ch] text-[11px] leading-snug text-inkFaint">
            Walls connect, openings fit, every room has a door, nothing overlaps and the footprint sits inside the setbacks.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} onOpenRoom={onOpenRoom} />
          ))}
        </ul>
      )}

      <p className="mt-3 px-1 text-[11px] leading-snug text-inkFaint">
        These are geometric checks computed from your model, not rules from a jurisdiction. Setbacks and limits below are
        configurable and are a starting point, not a compliance certificate.
      </p>
    </div>
  );
}

function IssueCard({ issue, onOpenRoom }: { issue: Issue; onOpenRoom(id: string): void }) {
  const tone =
    issue.severity === 'error' ? 'border-danger/30' : issue.severity === 'warning' ? 'border-warn/30' : 'border-line';

  const focus = () => {
    const roomId = issue.elements.find((id) => useProject.getState().project.rooms.some((r) => r.id === id));
    if (roomId) onOpenRoom(roomId);
    else if (issue.elements.length) useProject.getState().setSelection({ kinds: [], ids: issue.elements });
  };

  return (
    <li className={`issue-row shadow-panel ${tone}`}>
      <button className="block w-full text-left" onClick={focus}>
        <div className="flex items-start gap-2.5">
          <Dot severity={issue.severity} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-snug text-ink">{issue.message}</p>
            <code className="mt-1 inline-block font-mono text-[11px] text-inkFaint">{issue.code}</code>
          </div>
        </div>
      </button>
      {issue.fixes && issue.fixes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
          {issue.fixes.map((fix, i) => (
            <button
              key={`${fix.tool}-${i}`}
              className="btn h-7 border-dashed px-2.5 text-[12px]"
              onClick={() => {
                // Through the registry, not the store directly: these tool names
                // are the model's vocabulary, and the registry is the only place
                // that knows how to turn one into an operation. Going straight
                // to `run` silently did nothing at all.
                const res = runTool(fix.tool, fix.input, 'user');
                if (res.ok) {
                  useProject.getState().toast('success', fix.label);
                } else {
                  // A correction that cannot be applied must say so. Staying
                  // quiet here would tell the user it worked when it did not.
                  useProject.getState().toast('error', res.error ?? 'That correction could not be applied.');
                }
              }}
            >
              {fix.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function Dot({ severity }: { severity: Severity }) {
  const colour =
    severity === 'error' ? 'bg-danger' : severity === 'warning' ? 'bg-warn' : 'bg-inkFaint';
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${colour}`} aria-label={severity} />;
}

/**
 * Constraint overrides.
 *
 * Building regulations are not universal and Furnish does not know the user's
 * jurisdiction, so nothing here is hard-coded as law. Every threshold is a
 * number the user can see and change, and the default is a plain sanity bound
 * rather than a citation.
 */
function ConstraintRules() {
  const overrides = useProject((s) => s.ruleOverrides);
  const setRules = useProject((s) => s.setRules);
  const effective = { ...DEFAULT_RULES, ...overrides };

  const fields: Array<{ key: keyof typeof DEFAULT_RULES; label: string; hint: string; step: number }> = [
    { key: 'maxPlotCoverage', label: 'Maximum plot coverage', hint: 'fraction', step: 0.05 },
    { key: 'maxFloorAreaRatio', label: 'Maximum floor-area ratio', hint: 'ratio', step: 0.1 },
    { key: 'minCorridorWidth', label: 'Minimum corridor width', hint: 'm', step: 0.05 },
    { key: 'minWindowRatio', label: 'Minimum window area per floor area', hint: 'fraction', step: 0.01 },
    { key: 'minBathroomClearance', label: 'Minimum bathroom clearance', hint: 'm', step: 0.05 },
  ];

  return (
    <div className="card mb-2.5 p-2.5 shadow-raised">
      <p className="hint mb-2">
        Defaults are geometric sanity bounds, not a building code. Adjust them to your local rules.
      </p>
      <div className="space-y-1.5">
        {fields.map((f) => (
          <label key={String(f.key)} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[11px] text-inkSoft">{f.label}</span>
            <input
              type="number"
              step={f.step}
              className="field w-20 text-right font-mono"
              value={effective[f.key] as number}
              onChange={(e) => setRules({ [f.key]: Number(e.target.value) } as never)}
            />
            <span className="w-12 shrink-0 text-[11px] text-inkFaint">{f.hint}</span>
          </label>
        ))}
      </div>
      <button className="btn mt-2.5 w-full justify-start text-[12px]" onClick={() => setRules({ ...DEFAULT_RULES })}>
        Reset to defaults
      </button>

      <label className="mt-2.5 flex items-center gap-2">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 shrink-0"
          checked={effective.enforcePlotRules}
          onChange={(e) => setRules({ enforcePlotRules: e.target.checked })}
        />
        <span className="text-[11px] leading-snug text-inkSoft">Check setbacks, coverage and floor-area ratio</span>
      </label>
    </div>
  );
}
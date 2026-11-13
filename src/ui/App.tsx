import { useCallback, useEffect, useMemo, useState } from 'react';
import { BriefPanel } from './BriefPanel';
import { FindingsPanel } from './FindingsPanel';
import { LedgerPanel } from './LedgerPanel';
import { PlanView } from './PlanView';
import { DEFAULT_BRIEF_TEXT, programFromBrief } from '../model/program';
import { generatePlan, indoorArea } from '../model/generator';
import { applyCorrection, checkPlan, type CheckSummary, type Correction } from '../model/checks';
import type { Brief, BriefRoom, Plan, Refusal } from '../model/types';

declare global {
  interface Window {
    /** A machine-readable view of the app, for scripts and agents. */
    __furnish?: {
      plan: Plan | null;
      summary: CheckSummary | null;
    };
  }
}

export function App() {
  const [text, setText] = useState(DEFAULT_BRIEF_TEXT);
  const [plotWidth, setPlotWidth] = useState(18);
  const [plotDepth, setPlotDepth] = useState(14);
  const [storeys, setStoreys] = useState(2);
  const [program, setProgram] = useState<BriefRoom[]>(() =>
    programFromBrief({ text: DEFAULT_BRIEF_TEXT, plotWidth: 18, plotDepth: 14, storeys: 2, rooms: [] }),
  );
  const [plan, setPlan] = useState<Plan | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [floor, setFloor] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'findings' | 'ledger'>('findings');

  // The brief makes the program. Changing the brief changes the program;
  // after that the program is yours to edit.
  useEffect(() => {
    setProgram(programFromBrief({ text, plotWidth, plotDepth, storeys, rooms: [] }));
  }, [text, storeys]);

  const summary = useMemo(() => (plan ? checkPlan(plan) : null), [plan]);

  const generate = useCallback(() => {
    const brief: Brief = { text, plotWidth, plotDepth, storeys, rooms: program };
    const result = generatePlan(brief);
    if (result.ok) {
      setPlan(result.plan);
      setRefusal(null);
      setFloor(0);
      setSelected(null);
    } else {
      setPlan(null);
      setRefusal(result.refusal);
    }
  }, [text, plotWidth, plotDepth, storeys, program]);

  // Draw something the moment the app opens, so it is never an empty grid.
  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fix = useCallback((correction: Correction) => {
    setPlan((current) => (current ? applyCorrection(current, correction) : current));
  }, []);

  useEffect(() => {
    window.__furnish = { plan, summary };
  }, [plan, summary]);

  const flagged = useMemo(() => {
    const set = new Set<string>();
    for (const issue of summary?.issues ?? []) {
      if (issue.severity === 'note') continue;
      for (const id of issue.rooms) set.add(id);
    }
    return set;
  }, [summary]);

  const footprint = useMemo(() => {
    if (!plan) return 0;
    const area = Math.max(0, plan.brief.plotWidth - 3) * Math.max(0, plan.brief.plotDepth - 3);
    return area;
  }, [plan]);

  const net = plan ? indoorArea(plan) : 0;
  const coverage = footprint > 0 ? (net / footprint) * 100 : 0;

  return (
    <div className="app" data-testid="app">
      <header className="app__header">
        <div className="app__mark">
          <span className="app__name">Furnish Verified</span>
          <span className="app__tag">a plan that has been walked</span>
        </div>
        <div className="app__header-spacer" />
        <span className="badge badge--accent" data-testid="checker-state">
          {summary === null
            ? 'no plan'
            : summary.errors === 0 && summary.warnings === 0
              ? 'no findings'
              : `${summary.errors} error${summary.errors === 1 ? '' : 's'} · ${summary.warnings} warning${
                  summary.warnings === 1 ? '' : 's'
                }`}
        </span>
      </header>

      <div className="app__body">
        <aside className="app__side">
          <BriefPanel
            text={text}
            onTextChange={setText}
            plotWidth={plotWidth}
            plotDepth={plotDepth}
            onPlotChange={(width, depth) => {
              setPlotWidth(width);
              setPlotDepth(depth);
            }}
            storeys={storeys}
            onStoreysChange={setStoreys}
            program={program}
            onProgramChange={setProgram}
            onGenerate={generate}
            refusal={refusal}
            canGenerate={program.length > 0}
          />
        </aside>

        <main className="app__canvas">
          <div className="canvas">
            <div className="canvas__bar">
              <div className="tabs" role="tablist" aria-label="Storey">
                {Array.from({ length: storeys }, (_, index) => (
                  <button
                    key={index}
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={floor === index}
                    data-testid={`storey-${index}`}
                    onClick={() => setFloor(index)}
                  >
                    {index === 0 ? 'Ground floor' : `Floor ${index + 1}`}
                  </button>
                ))}
              </div>
              {selected && plan ? (
                <span className="badge" data-testid="selection">
                  {plan.rooms.find((r) => r.id === selected)?.label}
                </span>
              ) : null}
            </div>

            {plan ? (
              <PlanView
                plan={plan}
                floor={floor}
                flagged={flagged}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <div className="empty">
                <div className="empty__title">No plan to draw</div>
                The program does not fit the plot yet. Change the brief and try again.
              </div>
            )}
          </div>
        </main>

        <aside className="app__side app__side--right">
          <section className="panel">
            <h2 className="panel__title">
              <div className="tabs" role="tablist" aria-label="Panels">
                <button
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={tab === 'findings'}
                  data-testid="tab-findings"
                  onClick={() => setTab('findings')}
                >
                  Findings
                </button>
                <button
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={tab === 'ledger'}
                  data-testid="tab-ledger"
                  onClick={() => setTab('ledger')}
                >
                  Ledger
                </button>
              </div>
            </h2>
            {tab === 'findings' ? (
              <FindingsPanel summary={summary} onFix={fix} />
            ) : (
              <LedgerPanel />
            )}
          </section>
        </aside>
      </div>

      <footer className="app__status" data-testid="status">
        <span className="status__item">
          Net indoor <strong data-testid="status-area">{net.toFixed(1)} m²</strong>
        </span>
        <span className="status__item">
          Footprint <strong>{footprint.toFixed(1)} m²</strong>
        </span>
        <span className="status__item">
          Coverage <strong>{coverage.toFixed(1)}%</strong>
        </span>
        <span className="status__item">
          Rooms{' '}
          <strong data-testid="status-reachable">
            {summary ? `${summary.reachable}/${summary.total}` : '0/0'}
          </strong>{' '}
          reachable
        </span>
        <span className="status__item">
          <span
            className="status__dot"
            style={{ background: summary && summary.errors > 0 ? '#dc2626' : '#059669' }}
          />
          <strong data-testid="status-errors">{summary ? summary.errors : 0}</strong> errors
        </span>
      </footer>
    </div>
  );
}

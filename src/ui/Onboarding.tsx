/**
 * Guided onboarding — one screen.
 *
 * It used to be six, and the complaint it drew was fair: every question in it
 * was defensible and none of them was needed in order to *see* a plan. Someone
 * opening this wants a floor plan, not a survey. So the screen now asks the two
 * things that actually change the geometry — how big the plot is and which
 * rooms are wanted — and leaves everything else at its default. The three
 * starts sit on the same screen, because choosing between "generate it", "give
 * me a grid" and "just the plot" is a decision, not a step.
 *
 * There used to be a "More options" disclosure holding units, street edge,
 * setbacks, room sizes, style, budget and comfort. It is gone: every one of
 * those had a default nobody was going to change, and a closed disclosure with
 * an inventory of what is inside it is a promise of a questionnaire. The cost
 * is real and worth stating plainly — on a new project the brief now always
 * arrives with DEFAULT_PLOT's setbacks, `contemporary` style, metric units and
 * ventilation and daylight on. A brief can still carry all of that (the type
 * has the fields, `initialBrief` still seeds them, and "Change the brief"
 * reopens this screen), but nothing on this screen sets them any more.
 *
 * The wizard produces a `DesignBrief`, and `generateFromBrief` turns that into
 * geometry with deterministic code. That part has not changed and never will:
 * the model is given no coordinate, no orientation and no way to place a room.
 *
 * What Generate now does first is ask MiniMax to plan the ROOM PROGRAM — which
 * rooms, how big, and which must be next to each other — and hand that to the
 * same packer. If the assistant is switched off, or MiniMax is unreachable, or
 * the program it returned is unusable, Generate still works: it falls back to
 * the brief's own defaults and says, in a warning toast that is styled like
 * neither success nor error, that no model planned the result.
 */
import { useEffect, useRef, useState } from 'react';
import { useProject } from '../store/useProject.ts';
import { emptyFromBrief, generateFromBrief, gridFromBrief } from '../model/layout.ts';
import { requestRoomProgram } from '../ai/planProgram.ts';
import { DEFAULT_ROOM_AREA, KIND_LABEL } from '../model/catalog.ts';
import { DEFAULT_PLOT } from '../model/ops.ts';
import { sampleProject } from '../model/sample.ts';
import type { DesignBrief, RoomKind } from '../model/types.ts';

/**
 * The rooms on offer, grouped by how much they matter to a house.
 *
 * This was one flat list of thirteen, which put "Garage" next to "Living room"
 * and made a screen anyone skims look like a form to be endured. Four kinds
 * make a house a house, six are a decision, and three happen outdoors — and
 * knowing which group you are in is most of what tells you whether you have
 * filled it in properly.
 *
 * Order within a group is the order a house is usually described.
 */
const GROUPS: Array<{ label: string; note: string; kinds: RoomKind[] }> = [
  {
    label: 'The basics',
    note: 'Start here — a house needs these four.',
    kinds: ['living', 'kitchen', 'bedroom', 'bathroom'],
  },
  {
    label: 'More rooms',
    note: 'Optional. Add only what you actually want.',
    kinds: ['dining', 'guest', 'office', 'prayer', 'storage', 'utility'],
  },
  {
    label: 'Outside the walls',
    note: 'Built on the plot, not inside the house.',
    kinds: ['garage', 'balcony', 'terrace'],
  },
];

/**
 * The brief the wizard opens on.
 *
 * Seeded from `DEFAULT_PLOT`, never from the project being replaced. Carrying
 * the old plot over would make "New project" look like it did nothing at all —
 * the same plot size, the same setbacks — which is precisely the complaint that
 * sent this here: a fresh project had to be told apart from the last one.
 *
 * What *is* carried over is the room list, and only when there is one: someone
 * who asked for three bedrooms and then starts again almost certainly wants
 * three bedrooms, and re-ticking eight boxes is the opposite of a short brief.
 */
function initialBrief(previous?: DesignBrief | null): DesignBrief {
  const rooms =
    previous?.rooms?.length
      ? previous.rooms.map((r) => ({ ...r }))
      : [
          // One of each of the four basics, and every count is 1.
          //
          // Three bedrooms was here because 80 m² of rooms sits neatly inside a
          // 99 m² envelope, so the untouched screen opened with no warning — but
          // it made the first number a stranger has to read on this screen a
          // decision they never made, and three is also the count most likely to
          // be wrong for a particular person. A number they did not type is an
          // opinion; a 1 beside a checkbox they can see is not. More bedrooms is
          // one keystroke in the count box, and nothing here is flagged either
          // way now that fewer rooms can only lower the total.
          { kind: 'living' as RoomKind, count: 1 },
          { kind: 'kitchen' as RoomKind, count: 1 },
          { kind: 'bedroom' as RoomKind, count: 1 },
          { kind: 'bathroom' as RoomKind, count: 1 },
        ];
  return {
    plot: { ...DEFAULT_PLOT, setbacks: { ...DEFAULT_PLOT.setbacks } },
    floorCount: previous?.floorCount ?? 1,
    rooms,
    preferredAreas: {},
    style: previous?.style ?? 'contemporary',
    budgetUsd: undefined,
    preferences: { accessibility: false, ventilation: true, privacy: false, daylight: true },
  };
}

export function Onboarding({ onDone }: { onDone(): void }) {
  const project = useProject((s) => s.project);
  // Lazy initialiser: this reads the project that was current when the wizard
  // opened, which is the one being replaced. Using the previous project's room
  // list is the reuse above; its plot deliberately is not.
  const [brief, setBrief] = useState<DesignBrief>(() => initialBrief(project.brief));
  const [planning, setPlanning] = useState(false);
  /**
   * The refusal, said in the place the user is already looking.
   *
   * It used to be a toast, and a toast is the wrong place for it: this screen
   * is a full-screen dialog, so the toast was painted underneath the scrim and
   * the app refused the plan in silence. Lifting the toast above the scrim
   * fixed the visibility and left the message sitting on top of the very
   * buttons the user is about to press.
   *
   * So the refusal is told here, in the dialog, in the same red as the other
   * things this screen says are wrong with the brief. Changing any answer
   * clears it, because the answer has changed and the sentence no longer
   * describes it.
   */
  const [refusal, setRefusal] = useState<string | null>(null);
  // A ref, not the `planning` state, guards the button: state does not update
  // until the render commits, so a fast double click would still fire two
  // requests and replace the project twice.
  const inFlight = useRef(false);

  useEffect(() => {
    setRefusal(null);
  }, [brief]);

  const patch = (p: Partial<DesignBrief>) => setBrief((b) => ({ ...b, ...p }));
  const sb = brief.plot.setbacks;

  const buildableW = brief.plot.width - sb.left - sb.right;
  const buildableD = brief.plot.depth - sb.front - sb.rear;
  const targetArea = brief.rooms.reduce((sum, r) => sum + (r.targetArea ?? DEFAULT_ROOM_AREA[r.kind] ?? 14) * r.count, 0);
  const storeys = brief.floorCount;
  const tight = buildableW < 4 || buildableD < 4;
  const overBudgetArea = targetArea > buildableW * buildableD * storeys * 0.82;

  /**
   * Generate: ask the model to plan the rooms, then let the packer place them.
   *
   * The model never draws. It returns room sizes and which rooms must be next
   * to each other; `generateFromBrief` still does every piece of geometry, the
   * same way it always has. If the model cannot be reached, the plan is still
   * produced — but the toast says in as many words that nobody designed it,
   * because a deterministic default plan that reads like a considered design is
   * the exact thing this app must not ship.
   */
  const generate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPlanning(true);
    const outcome = await requestRoomProgram(brief);
    inFlight.current = false;
    setPlanning(false);
    const store = useProject.getState();
    // Read out before the generate call, because the generator stamps them and
    // the toast needs the packer's own warnings too.
    const programWarnings = outcome.planned ? outcome.warnings : [];

    // The note is recorded on the project, not just toasted, so the Checks
    // panel keeps saying who chose these rooms for as long as the project
    // exists. Passing it as an option is what keeps the two in step: the
    // generator decides `plannedBy` from the one thing that cannot be faked.
    const res = generateFromBrief(project, brief, {
      ...(outcome.planned ? { program: outcome.program } : {}),
      provenanceNote: outcome.planned
        ? { summary: outcome.summary, warnings: programWarnings }
        : { reason: outcome.reason },
    });
    if (!res.ok) {
      // Said here rather than toasted: this is a full-screen dialog, so a
      // toast lands under the scrim or on top of the buttons, and a refusal
      // nobody can read is not a refusal.
      setRefusal(res.error);
      return;
    }
    store.replace(res.data.project, 'Generate from brief');
    store.setSelection({ kinds: [], ids: [] });
    store.setActiveFloor(res.data.project.floors[0]?.id ?? '');

    const roomCount = res.data.project.rooms.filter((r) => !r.outdoor).length;
    const warnings = [...programWarnings, ...res.data.report.warnings];
    const storeys = storeyCount(brief.floorCount);

    if (!outcome.planned) {
      // Loud, and first. The plan below it is real, but it was not designed.
      // What follows the reason is a plain description of what the fallback
      // does, so the user knows exactly what they are looking at — no
      // ensuite, no guest room, and every room of a kind the same size.
      store.toast(
        'warning',
        `No model planned this layout — ${outcome.reason} Furnish fell back to its catalogue room sizes, so rooms of the same kind came out the same size and none were placed next to each other on purpose. ${roomCount} rooms on ${storeys}.${
          outcome.unconfigured ? ' Set MINIMAX_API_KEY on the server to have the design planned for you.' : ''
        }`,
      );
      onDone();
      return;
    }

    const what = outcome.summary
      ? `MiniMax planned it: ${outcome.summary}`
      : `MiniMax planned ${outcome.program.rooms.length} rooms`;
    store.toast(
      // `warning` when the model left something out: the plan is good, but it
      // is not what the reader will assume, and the message says so at length.
      // A three-second `info` toast cannot be read — the model's summary and
      // the list of connections it could not make is a paragraph, and it was
      // on screen for less time than it takes to read one sentence of it.
      warnings.length ? 'warning' : 'success',
      warnings.length
        ? `${what}. ${warnings[0]}${warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''} See the Checks panel.`
        : `${what}. ${roomCount} rooms on ${storeys} — drag anything you want to change.`,
    );
    onDone();
  };

  /**
   * The two blank starts.
   *
   * Not everyone who opens this wants a plan generated for them. These two
   * take the same answers and use only the parts that are not an opinion about
   * the house: the plot and the rooms you ticked.
   */
  const startGrid = () => {
    const store = useProject.getState();
    const res = gridFromBrief(project, brief);
    if (!res.ok) {
      // Said here rather than toasted: this is a full-screen dialog, so a
      // toast lands under the scrim or on top of the buttons, and a refusal
      // nobody can read is not a refusal.
      setRefusal(res.error);
      return;
    }
    store.replace(res.data.project, 'Start from a room grid');
    store.setSelection({ kinds: [], ids: [] });
    store.setActiveFloor(res.data.project.floors[0]?.id ?? '');
    const r = res.data.report;
    const w = r.warnings;
    store.toast(
      w.length ? 'info' : 'success',
      w.length
        ? `Laid the ${res.data.project.rooms.length} rooms out in a ${r.columns} × ${r.rows} grid — ${w[0]}`
        : `Laid the ${res.data.project.rooms.length} rooms out in a ${r.columns} × ${r.rows} grid. Drag them into whatever shape you want.`,
    );
    onDone();
  };

  /**
   * Load the sample house.
   *
   * The plan the landing page draws, built by the same generator with no model
   * involved — so it is the same plan every time it is loaded, which is what
   * makes it useful for comparing one run with another. It replaces whatever
   * was open, so it is a start, like the other two.
   */
  const loadSample = () => {
    const store = useProject.getState();
    const res = sampleProject();
    if (!res.ok) {
      // Said here rather than toasted: this is a full-screen dialog, so a
      // toast lands under the scrim or on top of the buttons, and a refusal
      // nobody can read is not a refusal.
      setRefusal(res.error);
      return;
    }
    store.replace(res.data.project, 'Load the sample plan');
    store.setSelection({ kinds: [], ids: [] });
    store.setActiveFloor(res.data.project.floors[0]?.id ?? '');
    const floors = res.data.project.floors.length;
    const rooms = res.data.project.rooms.filter((r) => !r.outdoor).length;
    const w = res.data.report.warnings;
    store.toast(
      w.length ? 'info' : 'success',
      w.length
        ? `The sample house — ${rooms} rooms on ${storeyCount(floors)} ${floors === 1 ? 'floor' : 'floors'}. ${w[0]}`
        : `The sample house — ${rooms} rooms on ${storeyCount(floors)} ${floors === 1 ? 'floor' : 'floors'}. No model planned this one: it is the plan the landing page draws.`,
    );
    onDone();
  };

  const startEmpty = () => {
    const store = useProject.getState();
    const res = emptyFromBrief(project, brief);
    if (!res.ok) {
      // Said here rather than toasted: this is a full-screen dialog, so a
      // toast lands under the scrim or on top of the buttons, and a refusal
      // nobody can read is not a refusal.
      setRefusal(res.error);
      return;
    }
    const floors = res.data.floorCount;
    store.replace(res.data.project, 'Start from an empty plot');
    store.setSelection({ kinds: [], ids: [] });
    store.setActiveFloor(res.data.project.floors[0]?.id ?? '');
    store.toast(
      'info',
      `A ${brief.plot.width.toFixed(1)} × ${brief.plot.depth.toFixed(1)} m plot with ${storeyCount(floors)} empty ${floors === 1 ? 'floor' : 'floors'}. Drag a room out of the toolbar to start.`,
    );
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Plan your home">
      <div className="slide-up flex max-h-full w-full max-w-[760px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-pop" data-testid="onboarding">
        {/* ── header ── */}
        <header className="flex shrink-0 items-start gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">Plan your home</h1>
            <p className="hint mt-1">A plot and a list of rooms is enough to start. Everything else has a default.</p>
          </div>
          <button className="btn btn-ghost shrink-0" onClick={onDone} data-testid="onboarding-skip">
            {project.rooms.length ? 'Close' : 'Start empty'}
          </button>
        </header>

        {/* ── body ── */}
        <div className="scroll-y min-h-0 flex-1 px-6 py-5">
          {/* Three cards rather than three fields in a row. What is left after
              the setbacks is a fact about the site, not another thing to type,
              and showing it as a number beside the inputs is what makes the
              tradeoff legible: widen the plot and that number goes up. */}
          <div className="grid gap-3 sm:grid-cols-[1.15fr_0.95fr_0.9fr]">
            <section className="card bg-raised p-4">
              <h2 className="label">Plot</h2>
              <div className="mt-2.5 flex items-end gap-2">
                <span className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] text-inkFaint">Width</span>
                  <Num value={brief.plot.width} units="m" onChange={(v) => patch({ plot: { ...brief.plot, width: v } })} testId="plot-width" />
                </span>
                <span className="pb-2 text-[13px] text-inkFaint">×</span>
                <span className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] text-inkFaint">Depth</span>
                  <Num value={brief.plot.depth} units="m" onChange={(v) => patch({ plot: { ...brief.plot, depth: v } })} testId="plot-depth" />
                </span>
              </div>
            </section>

            <section className="card bg-raised p-4">
              <h2 className="label">Storeys</h2>
              <div className="mt-2.5">
                <Segmented
                  value={String(brief.floorCount)}
                  onChange={(v) => patch({ floorCount: Number(v) })}
                  options={[
                    { id: '1', label: 'One' },
                    { id: '2', label: 'Two' },
                    { id: '3', label: 'Three' },
                  ]}
                />
              </div>
            </section>

            <section className="card bg-raised p-4">
              <h2 className="label">Room to build on</h2>
              <p className="mt-2.5 flex items-baseline gap-1.5">
                <span className="metric text-[17px]">{Math.round(buildableW * buildableD)}</span>
                <span className="text-[12px] text-inkFaint">m² per floor</span>
              </p>
              {tight && (
                <p className="mt-1.5 text-[11px] leading-snug text-danger">
                  {buildableW <= 0 || buildableD <= 0
                    ? 'The setbacks are bigger than the plot. Nothing is left to build on.'
                    : `The setbacks leave only ${buildableW.toFixed(1)} × ${buildableD.toFixed(1)} m to build on.`}
                </p>
              )}
            </section>
          </div>

          {/* ── rooms ── */}
          <section className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">What do you need?</h2>
              <p className="hint">Furnish fits these to your plot. Sizes come afterwards if you want them.</p>
            </div>

            {GROUPS.map((group) => (
              <div key={group.label} className="mt-4">
                <div className="flex items-baseline gap-2">
                  <h3 className="panel-title">{group.label}</h3>
                  <p className="hint">{group.note}</p>
                </div>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {group.kinds.map((kind) => {
                    const entry = brief.rooms.find((r) => r.kind === kind);
                    return (
                      <RoomRow
                        key={kind}
                        kind={kind}
                        count={entry?.count ?? 1}
                        on={Boolean(entry)}
                        onToggle={(checked) =>
                          setBrief((b) => ({
                            ...b,
                            rooms: checked ? [...b.rooms, { kind, count: 1 }] : b.rooms.filter((r) => r.kind !== kind),
                          }))
                        }
                        onCount={(count) =>
                          setBrief((b) => ({ ...b, rooms: b.rooms.map((r) => (r.kind === kind ? { ...r, count } : r)) }))
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="mt-4 space-y-1.5">
              {brief.rooms.length === 0 && (
                <p className="hint text-warn">Pick at least a living room so there is something to plan.</p>
              )}
              {overBudgetArea && (
                <p className="text-[11px] leading-snug text-warn">
                  That is more than fits comfortably. Furnish will scale the rooms down rather than overflow your plot — or add a
                  storey, or drop a room.
                </p>
              )}
            </div>
          </section>

        </div>

        {/* ── footer ──
            The two blank starts sit quiet on the left and the one action
            everyone came for sits lit on the right. Four sentences of hedging
            used to share this row with the buttons, which made the busiest part
            of the screen the least confident. */}
        <footer className="shrink-0 border-t border-line bg-surface px-6 py-4">
          {refusal && (
            // The refusal lives here, above the buttons it is refusing to
            // press, in the same red as every other thing this screen says is
            // wrong with the brief.
            <p
              className="mb-3 flex items-start gap-2 rounded-control border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12px] leading-snug text-danger"
              data-testid="wizard-refusal"
              role="alert"
            >
              {refusal}
            </p>
          )}
          <p className="hint mb-3 leading-relaxed">
            MiniMax picks which rooms this house has and how big they are; Furnish draws every line with deterministic layout code,
            and the model is never given a coordinate. With no model the plan still generates from catalogue sizes, and the app
            says so. Early-design geometry, not a compliance certificate.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={loadSample} data-testid="wizard-sample" title="The plan the landing page draws — the same house every time, drawn with no model involved. A house to look at instead of an empty plot.">
              Load the sample plan
            </button>
            <button className="btn" onClick={startGrid} data-testid="wizard-grid" title="The rooms you ticked, tiled edge to edge on the ground floor. A starting point to rearrange, not a finished layout.">
              Start from a room grid
            </button>
            <button className="btn" onClick={startEmpty} data-testid="wizard-empty" title="The plot, the storeys and the brief. No rooms, walls or furniture — you draw those yourself.">
              Empty plot
            </button>
            <span className="flex-1" />
            <button className="btn btn-accent h-10 px-6 text-[14px] font-semibold shadow-raised" onClick={generate} disabled={planning} data-testid="wizard-generate">
              {planning ? 'MiniMax is planning…' : 'Generate the plan'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────── pieces ───── */

function Segmented({ value, onChange, options }: { value: string; onChange(v: string): void; options: Array<{ id: string; label: string }> }) {
  return (
    <div className="inline-flex overflow-hidden rounded-control border border-line">
      {options.map((o, i) => (
        <button
          key={o.id}
          className={`btn rounded-none border-transparent ${i > 0 ? 'border-l border-line' : ''}`}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One room in the picker.
 *
 * The checkbox is wrapped in a `<label>` so the whole row — the square and the
 * name — is the click target, which is what people actually aim at. The count
 * box sits *outside* that label deliberately: a number input inside one becomes
 * part of the label's click surface, and clicking "3" to change it would toggle
 * the room off instead.
 *
 * The count only exists while the room is on. Showing an inert greyed box for
 * every unselected kind made thirteen rows look like thirteen things to fill in,
 * which is the opposite of how this screen is meant to read.
 */
function RoomRow({
  kind,
  count,
  on,
  onToggle,
  onCount,
}: {
  kind: RoomKind;
  count: number;
  on: boolean;
  onToggle(checked: boolean): void;
  onCount(count: number): void;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-control border px-3 py-1.5 transition-colors ${
        on ? 'border-accent/30 bg-accent-soft' : 'border-line bg-surface hover:border-lineStrong hover:bg-raised'
      }`}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-0.5">
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 cursor-pointer accent-[#0D9488]"
          checked={on}
          data-testid={`room-${kind}`}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className={`truncate text-[13px] ${on ? 'font-medium text-accent-ink' : 'text-inkSoft'}`}>{KIND_LABEL[kind]}</span>
      </label>
      {on && (
        <input
          type="number"
          min={1}
          max={9}
          className="field h-7 w-12 shrink-0 px-1 text-center font-mono text-[12px]"
          value={count}
          data-testid={`room-count-${kind}`}
          aria-label={`How many ${KIND_LABEL[kind].toLowerCase()} rooms`}
          onChange={(e) => onCount(Math.max(1, Math.min(9, Math.round(Number(e.target.value) || 1))))}
        />
      )}
    </div>
  );
}

function Num({ value, units, onChange, testId }: { value: number; units: 'm' | 'ft'; onChange(v: number): void; testId?: string }) {
  return (
    <span className="relative block flex-1">
      <input
        type="number"
        step={0.5}
        min={0}
        className="field pr-9 text-right font-mono"
        value={Number(value.toFixed(2))}
        data-testid={testId}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v > 0) onChange(units === 'm' ? v : v * 0.3048);
        }}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-inkFaint">{units}</span>
    </span>
  );
}

const storeyCount = (n: number): string => ['zero', 'one', 'two', 'three', 'four'][n] ?? String(n);
/**
 * The studio shell.
 *
 * Layout is deliberately conventional — a professional drafting tool, not a
 * landing page. Top toolbar, collapsible navigator on the left, the canvas in
 * the middle taking all remaining space, a contextual inspector on the right,
 * and a status strip along the bottom carrying the live measurements.
 *
 * There is no hero text, no gradient, and no decorative anything. When the
 * canvas is the only thing that moves, the interface should be the quietest
 * thing on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from './store/useProject.ts';
import { PlanCanvas } from './ui/canvas2d/PlanCanvas.tsx';
import { Scene, captureCanvas3D } from './three/Scene.tsx';
import { Toolbar, ContextStrip } from './ui/Toolbar.tsx';
import { Navigator } from './ui/Navigator.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { ProblemsPanel } from './ui/ProblemsPanel.tsx';
import { LedgerPanel } from './ui/LedgerPanel.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { Toasts } from './ui/Toasts.tsx';
import { Onboarding } from './ui/Onboarding.tsx';
import { AssistantPanel } from './ai/AssistantPanel.tsx';
import { downloadPlanSvg, downloadPlanPng, downloadProjectJson, downloadScenePng } from './export/download.ts';
import { measureBuilding } from './model/measure.ts';
import { canViewFromInside, type RoomRect } from './three/collision.ts';
import { DESIGN_STYLES, STYLE_BLURB, STYLE_LABEL } from './model/palette.ts';
import type { CameraMode } from './three/Scene.tsx';

type RightTab = 'inspect' | 'issues' | 'ledger';

export default function App() {
  const project = useProject((s) => s.project);
  const viewMode = useProject((s) => s.viewMode);
  const selection = useProject((s) => s.selection);

  const [rightTab, setRightTab] = useState<RightTab>('inspect');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(true);
  // Whether the brief wizard is up.
  //
  // Driven by the store, not by a `useState` initializer. The initializer runs
  // once, at mount, so a project started later — File → New project — would
  // leave it `false` forever and the user would get an empty plot at a
  // hardcoded 15 × 20 m with no question asked. `newProject` sets the store's
  // flag instead, so every path into a fresh project asks the brief.
  //
  // "Change the brief" still opens it on demand, which is why this is an OR and
  // not a straight read of the flag.
  const awaitingBrief = useProject((s) => s.awaitingBrief);
  const [briefRequested, setBriefRequested] = useState(() => !hasAnything(project));
  const openBrief = () => setBriefRequested(true);
  const onboardingOpen = awaitingBrief || briefRequested;
  const [showFurniture, setShowFurniture] = useState(true);
  const [showRoof, setShowRoof] = useState(true);
  const cameraMode = useProject((s) => s.cameraMode);
  const setCameraMode = useProject((s) => s.setCameraMode);
  const [insideRoom, setInsideRoom] = useState<string | null>(null);
  const [planHandle, setPlanHandle] = useState<{ fit: () => void } | null>(null);
  const sceneHostRef = useRef<HTMLDivElement | null>(null);

  // An AI-driven edit or a load should reveal its target in the inspector
  // rather than leaving the user to wonder where the change went.
  const issueCount = useMemo(() => project.rooms.length + project.walls.length, [project.rooms, project.walls]);

  // The panel follows the selection, but only when the selection changes.
  //
  // This used to list `rightTab` as a dependency as well, and that made the
  // Checks panel unreachable: any selection — which is the normal state of an
  // editor — pulled the panel back to Properties the instant the user clicked
  // "Checks", so the one panel that reports what is wrong with the plan could
  // not be read while working on the plan.
  const selectionKey = selection.ids.join(',');
  useEffect(() => {
    if (selectionKey) setRightTab('inspect');
  }, [selectionKey]);

  const onSelectIn3D = useCallback((ownerId: string, kind: string) => {
    const map: Record<string, string> = {
      wall: 'wall',
      furniture: 'furniture',
      'room-slab': 'room',
      deck: 'outdoor',
      stair: 'stair',
    };
    const element = map[kind];
    if (!element) return;
    useProject.getState().setSelection({ kinds: [element as never], ids: [ownerId] });
  }, []);

  const measurements = useMemo(() => measureBuilding(project), [project]);

  // Switching to 3D with the walk camera would drop the user inside a wall
  // before they have chosen where to stand, so walk is only reachable
  // explicitly. Inside has the same problem and the same answer.
  useEffect(() => {
    if (viewMode !== '3d' && cameraMode !== 'orbit') setCameraMode('orbit');
  }, [viewMode, cameraMode]);

  // The walk HUD tells the user Escape leaves walk mode, so it has to. The
  // walk controller's own key handler deliberately ignores Escape (drei needs
  // it to release pointer lock), so the exit lives here instead. Inside needs
  // it for the same reason and for the simpler one that nothing else claims
  // the key.
  useEffect(() => {
    if (cameraMode !== 'walk' && cameraMode !== 'inside') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCameraMode('orbit');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cameraMode]);

  // Rooms worth standing in, grouped by storey for the inside camera's picker.
  // Recomputed from the model rather than the scene, so the list survives the
  // roof, the furniture toggle and the visible-floor filter.
  const interiorGroups = useMemo(() => {
    const floors = project.floors.slice().sort((a, b) => a.order - b.order);
    return floors
      .map((floor) => ({
        floorId: floor.id,
        label: floor.name,
        rooms: project.rooms.filter((r) => r.floorId === floor.id && canViewFromInside(r)),
      }))
      .filter((g) => g.rooms.length > 0);
  }, [project.floors, project.rooms]);

  const exportScene = async () => {
    const blob = await captureCanvas3D(sceneHostRef.current);
    if (!blob) {
      useProject.getState().toast('info', 'Switch to the 3D view before capturing it.');
      return;
    }
    downloadScenePng(blob, project.name);
    useProject.getState().log({ actor: 'user', label: 'Export 3D capture', ok: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <Toolbar
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        assistantOpen={assistantOpen}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onToggleAssistant={() => setAssistantOpen((v) => !v)}
        onExportJson={() => downloadProjectJson(project)}
        onExportSvg={() => downloadPlanSvg(project, project.floors.find((f) => f.id === useProject.getState().activeFloorId)?.id)}
        onExportPlanPng={() => downloadPlanPng(project, project.floors.find((f) => f.id === useProject.getState().activeFloorId)?.id)}
        onExportScenePng={exportScene}
        onFit={() => planHandle?.fit()}
        issueCount={issueCount}
      />

      <div className="flex min-h-0 flex-1">
        {leftOpen && <Navigator onStartOver={openBrief} />}

        <main className="relative flex min-w-0 flex-1">
          <div
            className={`relative min-w-0 ${viewMode === 'split' ? 'flex' : 'w-full'}`}
            style={{ display: viewMode === 'split' ? 'grid' : 'block', gridTemplateColumns: viewMode === 'split' ? '1fr 1fr' : undefined }}
          >
            {viewMode !== '3d' && (
              <div className={`relative ${viewMode === 'split' ? 'border-r border-line' : 'h-full w-full'}`}>
                <PlanCanvas onRegister={setPlanHandle} />
                <AssistantBusy />
              </div>
            )}
            {viewMode !== 'plan' && (
              <div className={viewMode === 'split' ? 'h-full w-full' : 'h-full w-full'}>
                <SceneHost
                  cameraMode={cameraMode}
                  setCameraMode={setCameraMode}
                  showFurniture={showFurniture}
                  setShowFurniture={setShowFurniture}
                  showRoof={showRoof}
                  setShowRoof={setShowRoof}
                  interiorGroups={interiorGroups}
                  insideRoom={insideRoom}
                  onInsideRoom={setInsideRoom}
                  selectedRoomId={selection.kinds.includes('room') ? selection.ids[0] : undefined}
                  onSelect={onSelectIn3D}
                  hostRef={sceneHostRef}
                />
              </div>
            )}

            {/* Floats over whichever view is up. `pointer-events-none` on the
                wrapper so the canvas underneath stays fully draggable, with the
                strip itself opting back in. */}
            <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4">
              <ContextStrip />
            </div>
          </div>

          {assistantOpen && <AssistantPanel onClose={() => setAssistantOpen(false)} />}
        </main>

        {rightOpen && (
          <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-surface">
            <div className="flex h-10 shrink-0 border-b border-line" role="tablist">
              <button className="tab" role="tab" aria-selected={rightTab === 'inspect'} onClick={() => setRightTab('inspect')}>
                Properties
              </button>
              <button className="tab" role="tab" aria-selected={rightTab === 'issues'} onClick={() => setRightTab('issues')}>
                Checks
              </button>
              <button className="tab" role="tab" aria-selected={rightTab === 'ledger'} onClick={() => setRightTab('ledger')} data-testid="tab-ledger">
                Ledger
              </button>
            </div>
            <div className="scroll-y min-h-0 flex-1">
              {rightTab === 'inspect' ? (
                <Inspector />
              ) : rightTab === 'issues' ? (
                <ProblemsPanel onOpenRoom={(id) => {
                  const room = project.rooms.find((r) => r.id === id);
                  if (room) useProject.getState().setActiveFloor(room.floorId);
                  useProject.getState().setSelection({ kinds: ['room'], ids: [id] });
                  setRightTab('inspect');
                }} />
              ) : (
                <LedgerPanel />
              )}
            </div>
          </aside>
        )}
      </div>

      <StatusBar measurements={measurements} />

      <Toasts />
      {onboardingOpen && (
        // `onDone` clears both: `replace` inside the wizard already cleared
        // `awaitingBrief`, so `briefRequested` is what would otherwise keep the
        // wizard from ever coming back after "Change the brief".
        <Onboarding
          onDone={() => {
            setBriefRequested(false);
            useProject.getState().dismissBriefPrompt();
          }}
        />
      )}
    </div>
  );
}

/**
 * Says plainly that the assistant is the thing changing the plan right now.
 *
 * The operations now land one at a time, so rooms really do appear as they are
 * created — but a plan that takes a few seconds to build would still look like
 * a stall without this, and the cause of the movement should never be a
 * mystery. It sits over the plan and takes no pointer events, so the canvas
 * stays usable underneath.
 */
function AssistantBusy() {
  const busy = useProject((s) => s.aiBusy);
  if (!busy) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
      <span
        className="float-surface flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium text-ink"
        data-testid="assistant-canvas-busy"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
        The assistant is drawing
      </span>
    </div>
  );
}

/** Wraps the canvas so the toolbar can capture it and the camera can be set. */
function SceneHost({
  cameraMode,
  setCameraMode,
  showFurniture,
  setShowFurniture,
  showRoof,
  setShowRoof,
  interiorGroups,
  insideRoom,
  onInsideRoom,
  selectedRoomId,
  onSelect,
  hostRef,
}: {
  cameraMode: CameraMode;
  setCameraMode: (m: CameraMode) => void;
  showFurniture: boolean;
  setShowFurniture: (v: boolean) => void;
  showRoof: boolean;
  setShowRoof: (v: boolean) => void;
  interiorGroups: { floorId: string; label: string; rooms: RoomRect[] }[];
  insideRoom: string | null;
  onInsideRoom: (label: string | null) => void;
  selectedRoomId: string | undefined;
  onSelect: (id: string, kind: string) => void;
  hostRef: React.RefObject<HTMLDivElement>;
}) {
  const [styleOpen, setStyleOpen] = useState(false);
  const briefStyle = useProject((s) => s.project.brief?.style);
  // The camera bar is suppressed in split view. Half-width panes have no room
  // for it: it sat on top of the plan side's working area, and the contextual
  // tool strip already floats over the centre of the pair. Camera modes, roof
  // and furniture stay reachable by switching to the full 3D view.
  const viewMode = useProject((s) => s.viewMode);
  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full">
        {/* The roof stays on inside: from four metres away it is a lid, and
            taking it off would replace the ceiling with open sky. */}
        <Scene cameraMode={cameraMode} showFurniture={showFurniture} showRoof={showRoof && cameraMode !== 'top'} visibleFloorIds={null} onSelect={onSelect} onInsideRoom={onInsideRoom} />
      </div>

      {viewMode !== 'split' && (
      <div className="float-surface absolute left-3 top-3 flex items-center gap-0.5 p-1">
        {(['orbit', 'top', 'walk', 'inside'] as CameraMode[]).map((m) => (
          <button
            key={m}
            className="btn btn-ghost h-7 border-transparent px-2.5 capitalize"
            aria-pressed={cameraMode === m}
            data-testid={`camera-${m}`}
            onClick={() => setCameraMode(m)}
          >
            {m === 'top' ? 'Top' : m}
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px bg-line" />
        <button className="btn btn-ghost h-7 border-transparent px-2.5" aria-pressed={showFurniture} onClick={() => setShowFurniture(!showFurniture)}>
          Furniture
        </button>
        <button
          className={`btn btn-ghost h-7 border-transparent px-2.5 ${cameraMode === 'top' ? 'opacity-45' : ''}`}
          aria-pressed={showRoof}
          title={cameraMode === 'top' ? 'The roof is hidden in the top-down view, so you can see the plan' : undefined}
          onClick={() => setShowRoof(!showRoof)}
        >
          Roof
        </button>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <div className="relative">
          <button
            className="btn btn-ghost h-7 border-transparent px-2.5"
            data-testid="style-menu"
            aria-expanded={styleOpen}
            title="Apply one of the five palettes"
            onClick={() => setStyleOpen((v) => !v)}
          >
            Style
          </button>
          {styleOpen && (
            <div
              className="slide-up absolute left-0 top-9 z-30 w-72 rounded-card border border-line bg-surface p-1.5 shadow-pop"
              data-testid="style-popover"
            >
              <p className="px-2.5 py-2 text-[11px] leading-snug text-muted">
                A palette sets the facade, every floor finish and the joinery in one edit. You can also just ask
                the assistant — “make it japandi”.
              </p>
              {DESIGN_STYLES.map((s) => {
                const current = briefStyle === s;
                return (
                  <button
                    key={s}
                    data-testid={`style-${s}`}
                    aria-current={current}
                    className={`flex w-full flex-col items-start gap-1 rounded-control px-2.5 py-2 text-left transition-colors hover:bg-raised ${current ? 'bg-accent-soft' : ''}`}
                    onClick={() => {
                      // The same operation the assistant's `style_home` tool
                      // runs, so a palette applied from here is undoable, logged
                      // and attributed the same way — and the model can never
                      // reach anything this button cannot.
                      useProject.getState().run('applyStyle', [s], { actor: 'user', label: `Style: ${STYLE_LABEL[s]}` });
                      setStyleOpen(false);
                    }}
                  >
                    <span className="flex w-full items-center gap-1.5 text-[13px] font-medium">
                      {STYLE_LABEL[s]}
                      {current && <span className="chip ml-auto border-accent/30 bg-accent/10 text-[10px] text-accent-ink">current</span>}
                    </span>
                    <span className="text-[11px] leading-snug text-muted">{STYLE_BLURB[s]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      )}

      {cameraMode === 'walk' && (
        <p className="float-surface pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 text-[12px] font-medium text-ink">
          Click the canvas to look around · drag to look · W A S D to walk · Esc to leave
        </p>
      )}

      {cameraMode === 'inside' && (
        // `pointer-events-none` on the wrapper so a drag that starts beside the
        // panel still turns the view; the panel itself is the only thing here
        // that takes clicks.
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
          <div className="float-surface pointer-events-auto flex max-w-[min(44rem,100%)] flex-col items-center gap-2 px-4 py-3">
            <p className="text-[14px] font-semibold text-ink" data-testid="inside-room" aria-live="polite">
              {insideRoom ?? 'In the building'}
            </p>
            <p className="text-[12px] text-inkSoft">
              Drag to look · W A S D to walk · scroll to step · Q E to turn · Esc to leave
            </p>
            <div className="mt-0.5 flex max-h-20 flex-wrap items-center justify-center gap-x-3 gap-y-1 overflow-y-auto">
              {interiorGroups.map((group) => (
                <div key={group.floorId} className="flex flex-wrap items-center justify-center gap-0.5">
                  {interiorGroups.length > 1 && (
                    <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-inkFaint">{group.label}</span>
                  )}
                  {group.rooms.map((room) => (
                    <button
                      key={room.id}
                      data-testid="inside-room-chip"
                      aria-pressed={selectedRoomId === room.id}
                      className="btn btn-ghost h-7 border-transparent px-2 text-[12px]"
                      onClick={() => useProject.getState().setSelection({ kinds: ['room'], ids: [room.id] })}
                    >
                      {room.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A project with nothing in it should open the brief wizard, not an empty grid. */
function hasAnything(project: ReturnType<typeof useProject.getState>['project']): boolean {
  return project.rooms.length > 0 || project.walls.length > 0;
}
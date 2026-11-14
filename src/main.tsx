/**
 * Application entry point.
 *
 * Three jobs, in order: mount React, pick the route, and install the keyboard
 * map. Everything else lives in the store.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { Home } from './home/Home.tsx';
import { isTypingTarget } from './keys.ts';
import { loadProject, requestPersistence } from './persist/library.ts';
import { Projects } from './projects/Projects.tsx';
import { useRoute } from './router.ts';
import { isFirstPerson, useProject } from './store/useProject.ts';
import './index.css';

/**
 * Restores the most recently updated project, if the browser still has it.
 *
 * This is deliberately best-effort and silent on failure: a corrupt or
 * schema-stale record must never stop the studio from opening. The user gets a
 * fresh blank project instead, and the old record stays in the library until
 * they delete it.
 */
function useRestoreSession(): 'loading' | 'ready' {
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Leaving for the landing page and coming back remounts the studio,
        // but the store is a module singleton that never went away — it still
        // holds the design, and every operation writes through to IndexedDB as
        // it lands. Re-reading the saved copy here would therefore accomplish
        // nothing except race the last write, and a restore that overwrites an
        // edit the user can see on screen is the one thing this app must never
        // do. Only reach for storage when there is nothing in memory.
        //
        // `awaitingBrief` is the other half of that. Someone who pressed
        // "New project" has asked for an empty plot and a short brief, and
        // quietly loading yesterday's house over it would be worse than losing
        // an edit: it would look like the app ignored them.
        const state = useProject.getState();
        if (state.project.rooms.length === 0 && state.project.walls.length === 0 && !state.awaitingBrief) {
          const { listProjects } = await import('./persist/library.ts');
          const entries = await listProjects();
          const latest = entries[0];
          if (latest) {
            const restored = await loadProject(latest.id);
            if (restored && !cancelled) useProject.getState().replace(restored, 'Open ' + latest.name, { undoable: false });
          }
        }
        // Ask the browser not to evict us under storage pressure. Silently
        // ignored where the API is unsupported.
        void requestPersistence();
      } catch {
        // Nothing to restore. Start clean.
      } finally {
        if (!cancelled) setPhase('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return phase;
}

/**
 * The keyboard map.
 *
 * Modelled as a lookup rather than a switch so the help sheet and the bindings
 * cannot drift apart — the same table renders the shortcuts list.
 */
export const SHORTCUTS: Array<{ keys: string; label: string; run: () => void }> = [
  { keys: 'Ctrl+Z', label: 'Undo', run: () => useProject.getState().undo() },
  { keys: 'Ctrl+Shift+Z', label: 'Redo', run: () => useProject.getState().redo() },
  { keys: 'Ctrl+S', label: 'Save', run: () => void useProject.getState().saveNow() },
  { keys: 'V', label: 'Select tool', run: () => useProject.getState().setTool('select') },
  { keys: 'R', label: 'Room tool', run: () => useProject.getState().setTool('room') },
  { keys: 'W', label: 'Wall tool', run: () => useProject.getState().setTool('wall') },
  { keys: 'D', label: 'Door tool', run: () => useProject.getState().setTool('door') },
  { keys: 'N', label: 'Window tool', run: () => useProject.getState().setTool('window') },
  { keys: 'F', label: 'Furniture tool', run: () => useProject.getState().setTool('furniture') },
  { keys: 'M', label: 'Measure tool', run: () => useProject.getState().setTool('measure') },
  { keys: 'H', label: 'Pan tool', run: () => useProject.getState().setTool('pan') },
  { keys: 'T', label: 'Trace an underlay', run: () => useProject.getState().setTool('trace') },
  { keys: 'Escape', label: 'Back to select / clear selection', run: () => {
    const s = useProject.getState();
    if (s.selection.ids.length) s.clearSelection();
    else s.setTool('select');
  } },
  { keys: 'Ctrl+A', label: 'Select everything on this floor', run: () => useProject.getState().selectAllOnFloor() },
  { keys: 'Delete', label: 'Delete selection', run: () => useProject.getState().deleteSelection() },
  { keys: '1', label: 'Plan view', run: () => useProject.getState().setViewMode('plan') },
  { keys: '2', label: 'Split view', run: () => useProject.getState().setViewMode('split') },
  { keys: '3', label: '3D view', run: () => useProject.getState().setViewMode('3d') },
  { keys: 'G', label: 'Toggle grid', run: () => useProject.getState().setGrid(!useProject.getState().gridEnabled) },
  { keys: 'S', label: 'Toggle snap', run: () => useProject.getState().setSnap(!useProject.getState().snapEnabled) },
];

/**
 * Single-letter bindings — the tool shortcuts and the two bare number keys.
 *
 * These are the keys a first-person camera needs, so they stand aside while one
 * is driving. Derived from the table above rather than written out, so that
 * adding a tool key later cannot silently reintroduce the bug: a new bare
 * letter is excluded automatically, and a new `Ctrl+…` binding is not.
 *
 * `Ctrl+S`, `Ctrl+Z`, `Escape` and `Delete` are deliberately *not* here, and stay
 * live in walk mode — losing undo or the way out of a camera would be a far
 * worse trade than the accidental tool change it fixes.
 */
const BARE_KEYS: ReadonlySet<string> = new Set(
  SHORTCUTS.filter((s) => /^[a-z0-9]$/i.test(s.keys)).map((s) => s.keys.toLowerCase()),
);

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const match = SHORTCUTS.find((s) => {
        const parts = s.keys.split('+');
        const key = parts[parts.length - 1];
        const wantsMod = parts.length > 1;
        const wantsShift = parts.includes('Shift');
        if (wantsMod !== mod) return false;
        if (parts.includes('Shift') !== e.shiftKey) return false;
        void wantsShift;
        return e.key.toLowerCase() === key.toLowerCase();
      });
      if (!match) return;
      // In a first-person camera these keys are movement, not tools. Walking
      // forward used to arm the Wall tool, strafing right armed the Door tool,
      // and backing up flipped snapping — which is most of what made walking
      // feel broken, since the toolbar changed under you with every stride.
      if (!mod && isFirstPerson(useProject.getState().cameraMode) && BARE_KEYS.has(match.keys.toLowerCase())) {
        return;
      }
      // Never steal a browser binding we do not actually own.
      if (match.keys === 'Ctrl+S' || match.keys === 'Ctrl+Z') e.preventDefault();
      match.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * The landing page, the projects dashboard, or the studio.
 *
 * Split into three components rather than one conditional, because the studio
 * has real hooks behind it — session restore and the keyboard map — and hooks
 * cannot be conditional. Keeping them inside `Studio` means neither of the
 * other two mounts them: they do not wait on IndexedDB to paint, and they do
 * not install single-letter shortcuts that would fire while someone is
 * reading or clicking around a list.
 */
function Root() {
  const route = useRoute();
  if (route === 'home') return <Home />;
  if (route === 'projects') return <Projects />;
  return <Studio />;
}

function Studio() {
  const phase = useRestoreSession();
  useShortcuts();
  if (phase === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-paper">
        <p className="text-[13px] text-inkFaint">Restoring your last project…</p>
      </div>
    );
  }
  return <App />;
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
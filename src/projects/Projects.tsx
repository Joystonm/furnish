/**
 * The projects dashboard — what "Open the studio" actually opens.
 *
 * Three jobs: list what is saved in this browser, open one, or start a new one.
 *
 * It reads the same IndexedDB library the studio's left rail reads, so there is
 * no second source of truth — a project saved in the editor is on this list the
 * next time it is visited, and a project deleted here is gone from the rail.
 *
 * The empty state is a real screen rather than a shrug, because "open the
 * studio" landing on nothing is the moment a visitor decides the product is
 * empty. It says what happens next and puts one button in front of them.
 */
import { useCallback, useEffect, useState } from 'react';
import { deleteProject, listProjects, loadProject, type LibraryEntry } from '../persist/library.ts';
import { navigate, STUDIO_PATH } from '../router.ts';
import { useProject } from '../store/useProject.ts';

export function Projects() {
  // `null` means "still reading", which is a different screen from "there are
  // none" — collapsing them would flash an empty state on every visit.
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);

  const refresh = useCallback(() => {
    void listProjects().then(setEntries);
  }, []);

  useEffect(refresh, [refresh]);

  const open = useCallback(async (entry: LibraryEntry) => {
    const project = await loadProject(entry.id);
    if (!project) {
      // Say which one failed. "Something went wrong" would leave the user
      // wondering whether the house is gone.
      useProject.getState().toast('error', `“${entry.name}” could not be read back from this browser.`);
      return;
    }
    useProject.getState().replace(project, 'Open ' + entry.name);
    navigate(STUDIO_PATH);
  }, []);

  const remove = useCallback(
    (entry: LibraryEntry) => {
      if (!window.confirm(`Delete “${entry.name}”? This cannot be undone.`)) return;
      void deleteProject(entry.id).then(refresh);
    },
    [refresh],
  );

  const create = useCallback(() => {
    // `newProject` puts an empty plot and a short brief in the store. The
    // editor reads both from there, so the wizard opens on arrival — and
    // session restore deliberately stands aside, so this really is a blank
    // sheet rather than yesterday's house wearing a new name.
    useProject.getState().newProject();
    navigate(STUDIO_PATH);
  }, []);

  const count = entries?.length ?? 0;

  return (
    <div className="flex h-full flex-col bg-paper text-ink" data-testid="projects">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line px-6">
        <a href="/" className="flex items-center gap-2.5">
          <LogoMark className="h-5 w-5 text-accent" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Furnish</span>
        </a>
        <button className="btn btn-accent h-9 px-4 text-[13px] font-semibold" data-testid="project-new" onClick={create}>
          New project
        </button>
      </header>

      <div className="scroll-y min-h-0 flex-1">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Your projects</h1>
          <p className="hint mt-1.5">
            {entries === null
              ? 'Reading this browser…'
              : count === 0
                ? 'Nothing saved yet.'
                : `${count} saved in this browser.`}
          </p>

          {entries === null ? (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card h-[132px] animate-pulse bg-raised" />
              ))}
            </div>
          ) : count === 0 ? (
            <EmptyState onCreate={create} />
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {entries.map((entry) => (
                <article key={entry.id} className="card group relative p-5 transition-shadow hover:shadow-panel">
                  <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em]" title={entry.name}>
                    {entry.name}
                  </h2>
                  <p className="hint mt-1.5">
                    {entry.floorCount} floor{entry.floorCount === 1 ? '' : 's'} · {entry.roomCount} room
                    {entry.roomCount === 1 ? '' : 's'} · edited {when(entry.updatedAt)}
                  </p>

                  <div className="mt-4 flex items-center gap-2">
                    <button
                      className="btn h-8 flex-1 text-[13px]"
                      data-testid={`project-open-${entry.id}`}
                      onClick={() => void open(entry)}
                    >
                      Open
                    </button>
                    <button
                      className="btn btn-ghost btn-danger btn-icon"
                      title={`Delete ${entry.name} from this browser`}
                      data-testid={`project-delete-${entry.id}`}
                      onClick={() => remove(entry)}
                    >
                      <svg width="12" height="12" viewBox="0 0 11 11" aria-hidden>
                        <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                      <span className="sr-only">Delete {entry.name}</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <p className="hint mt-10 max-w-2xl leading-relaxed">
            Projects live in this browser only — there is no account and nothing is uploaded. Clearing site data
            erases them, so export JSON from the studio if you want a backup.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate(): void }) {
  return (
    <div
      className="mt-8 flex flex-col items-center rounded-card border border-dashed border-lineStrong bg-surface px-6 py-16 text-center"
      data-testid="project-empty"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-card bg-accent-soft text-accent-ink">
        <LogoMark className="h-6 w-6" />
      </span>
      <h2 className="mt-5 text-[18px] font-semibold tracking-[-0.01em]">No projects yet</h2>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-inkSoft">
        A project is one house on one plot. Start with a short brief — the plot, the storeys and which rooms you
        want — and you will have a real, editable floor plan in a few seconds.
      </p>
      <button className="btn btn-accent mt-7 h-10 px-5 text-[14px] font-semibold shadow-raised" onClick={onCreate}>
        Create your first project
      </button>
      <a href="/" className="mt-4 text-[13px] text-inkFaint underline-offset-4 transition-colors hover:text-ink hover:underline">
        or go back to the overview
      </a>
    </div>
  );
}

/**
 * "3 minutes ago" where that is useful, a date where it is not.
 *
 * Relative time is friendlier for a list you just came back to; a date is
 * friendlier for one you have not touched in a month. Anything past a month is
 * the point where the second wins.
 */
function when(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The house mark, matching the landing page, the toolbar and the favicon. */
function LogoMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" className={className} aria-hidden>
      <path
        d="M4 12.5V8.6l5-3.4 5 3.4v3.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
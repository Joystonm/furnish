/**
 * The assistant transcript.
 *
 * The panel is a child of the studio shell, and the shell comes and goes more
 * often than it looks: a new project, a restored session, a brief that is read
 * again, an operation that rewrites the design. A transcript held in the
 * panel's own state dies with the panel. The answer the user was reading
 * vanishes, and the panel greets them as if nothing had ever been asked —
 * which is not a small thing, because the answer is the receipt for what the
 * model just did to their house.
 *
 * So the turns live here instead, in the same spirit as the project store: a
 * module-level value with subscribers. A remount redraws the same
 * conversation, and a turn that is still running keeps writing into it.
 */
import type { StepReport, TurnReport } from './orchestrator.ts';

export interface Turn {
  id: number;
  request: string;
  report: TurnReport | null;
  /** Steps as they resolve, so the work is visible before the turn is over. */
  liveSteps: StepReport[];
  pending: boolean;
  progress: string;
}

let turns: Turn[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  // Copied first: a listener may unsubscribe while the list is being walked.
  for (const listener of [...listeners]) listener();
}

/** Subscribes to the transcript. Returns the unsubscribe. */
export function subscribeTurns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current transcript. The array identity changes only when it changes. */
export function getTurns(): Turn[] {
  return turns;
}

/** Applies an update to the transcript and tells the panel. */
export function setTurns(update: (t: Turn[]) => Turn[]): void {
  turns = update(turns);
  emit();
}

/**
 * Empties the transcript.
 *
 * A new project is a new conversation: the turns in the log are about a house
 * that no longer exists, and leaving them on screen would be a lie about what
 * the assistant is looking at.
 */
export function clearTurns(): void {
  turns = [];
  emit();
}

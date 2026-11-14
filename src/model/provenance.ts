/**
 * Who designed this plan.
 *
 * Two forms of the same claim, because they are used in different places:
 *
 *   - `provenanceNotice` is the long form, for the Checks panel, where there
 *     is room to explain what "no model planned this" actually means for the
 *     geometry;
 *   - `provenanceLine` is the short form, for the drawing itself, where the
 *     only thing that fits is a line of plain words.
 *
 * Both live in the model rather than in the interface because the claim is
 * about the plan, not about the panel that shows it, and because the drawing
 * and the Checks panel must never disagree about who drew what.
 *
 * A project with no provenance at all is one saved before this existed, or one
 * the user has edited into their own design. Claiming either way would be
 * inventing a history, so absence is silent.
 */
import type { Project } from './types.ts';

export interface ProvenanceClaim {
  tone: 'warn' | 'ok';
  text: string;
}

/**
 * The long form: what to say about how this plan came to be, or null when
 * there is nothing worth saying.
 *
 * `plannedBy` is derived by the generator from the one thing that cannot be
 * lied about — whether a room program was actually handed to the packer — so
 * this function only chooses the words.
 */
export function provenanceNotice(project: Project): ProvenanceClaim | null {
  const p = project.provenance;
  if (!p) return null;
  if (p.plannedBy === 'model') {
    return {
      tone: 'ok',
      text: p.summary
        ? `MiniMax planned these rooms. ${p.summary}`
        : 'MiniMax planned the room program for this plan.',
    };
  }
  if (p.plannedBy === 'empty') {
    return { tone: 'warn', text: 'No one designed this plan — it is an empty plot. The rooms are yours to draw.' };
  }
  if (p.plannedBy === 'grid') {
    return {
      tone: 'warn',
      text: 'No one designed this plan — it is the ticked rooms tiled into a grid to rearrange, not a layout.',
    };
  }
  return {
    tone: 'warn',
    text: `No model planned this layout${p.reason ? ` — ${p.reason}` : ''}. Furnish used its catalogue room sizes, so rooms of the same kind are the same size and no two were placed next to each other on purpose.`,
  };
}

/**
 * The short form, for the drawing.
 *
 * This exists because a statement that only lives in a toast is not a
 * statement: eleven seconds later it is gone, and the plan is still on screen
 * with nothing to say about who drew it. The line that sits on the drawing
 * is the one that cannot be missed — and it is the same claim, from the same
 * field, as the panel's, so the two can never drift apart.
 */
export function provenanceLine(project: Project): ProvenanceClaim | null {
  const p = project.provenance;
  if (!p) return null;
  if (p.plannedBy === 'model') {
    return { tone: 'ok', text: 'MiniMax planned these rooms.' };
  }
  if (p.plannedBy === 'empty') {
    return { tone: 'warn', text: 'No model planned this plan — it is an empty plot.' };
  }
  if (p.plannedBy === 'grid') {
    return { tone: 'warn', text: 'No model planned this plan — the ticked rooms, tiled into a grid.' };
  }
  return {
    tone: 'warn',
    text: `No model planned this plan${p.reason ? ` — ${p.reason}` : ''}.`,
  };
}

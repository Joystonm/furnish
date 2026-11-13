/**
 * The app's own checker, runnable outside the browser.
 *
 * The ledger records what the app's own checker said at the time of each
 * verification run. That number has to come from the same code the app runs,
 * or the ledger would be a record of something else. So this module is the
 * checker, and the browser and the ledger script both go through it.
 */

import { DEFAULT_BRIEF_TEXT, programFromBrief } from './program';
import { generatePlan } from './generator';
import { checkPlan, type CheckSummary } from './checks';
import type { Brief } from './types';

export interface AppReport {
  /** Whether a plan could be drawn at all. */
  plan: 'drawn' | 'refused';
  /** The checker's findings, when there is a plan to check. */
  summary: CheckSummary | null;
}

/** The brief the app opens with — the same one the browser starts on. */
export function defaultBrief(): Brief {
  return {
    text: DEFAULT_BRIEF_TEXT,
    plotWidth: 18,
    plotDepth: 14,
    storeys: 2,
    rooms: programFromBrief({
      text: DEFAULT_BRIEF_TEXT,
      plotWidth: 18,
      plotDepth: 14,
      storeys: 2,
      rooms: [],
    }),
  };
}

/** Check the app's default brief. */
export function report(): AppReport {
  const result = generatePlan(defaultBrief());
  if (!result.ok) return { plan: 'refused', summary: null };
  return { plan: 'drawn', summary: checkPlan(result.plan) };
}

/**
 * The entry point used to measure an older commit.
 *
 * Newer commits have `src/model/report.ts`, which is the module the browser
 * imports — that one is used directly. Older ones do not, so this file
 * stands in for it: the same brief, the same generator, the same checker.
 * It is copied into the worktree before it is bundled.
 */

import { DEFAULT_BRIEF_TEXT, programFromBrief } from './src/model/program';
import { generatePlan } from './src/model/generator';
import { checkPlan } from './src/model/checks';

export function report() {
  const brief = {
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

  const result = generatePlan(brief);
  if (!result.ok) return { plan: 'refused' as const, summary: null };

  const summary = checkPlan(result.plan);
  return {
    plan: 'drawn' as const,
    summary: {
      errors: summary.errors,
      warnings: summary.warnings,
      notes: summary.notes,
      reachable: summary.reachable,
      total: summary.total,
      issues: summary.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        title: issue.title,
        rooms: issue.rooms,
      })),
    },
  };
}

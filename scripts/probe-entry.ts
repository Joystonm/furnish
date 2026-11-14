/**
 * The entry point used to measure a commit.
 *
 * It builds the sample house — the same plan the studio can load and the same
 * plan the landing page draws — and runs the app's own checker over it. The
 * numbers it returns are the numbers the browser showed, because it is the
 * browser's own code being run.
 *
 * This file is copied into the worktree of the commit being measured and
 * bundled there, so the measurement is taken against that commit's model and
 * not against whatever happens to be on the machine.
 */

import { sampleProject } from './src/model/sample';
import { validate } from './src/model/validate';
import { buildCirculation } from './src/model/circulation';
import { measureBuilding } from './src/model/measure';

export function report() {
  const result = sampleProject();
  if (!result.ok) {
    return { plan: 'refused' as const, summary: null };
  }

  const project = result.data.project;
  const issues = validate(project);

  // How many of the rooms that need a door can actually be walked to, counted
  // the way the checker counts them: one graph per floor, and the rooms the
  // circulation graph says are out of reach.
  let reachable = 0;
  let total = 0;
  for (const floor of project.floors) {
    const graph = buildCirculation(project, floor.id);
    const onFloor = project.rooms.filter((room) => room.floorId === floor.id && !room.outdoor);
    total += onFloor.length;
    reachable += onFloor.filter((room) => graph.reachable.has(room.id)).length;
  }

  const measurements = measureBuilding(project);

  return {
    plan: 'drawn' as const,
    summary: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      notes: issues.filter((issue) => issue.severity === 'info').length,
      reachable,
      total,
      rooms: project.rooms.length,
      floors: project.floors.length,
      netIndoorArea: measurements.netIndoorArea,
      footprintArea: measurements.footprintArea,
      plotCoverage: measurements.plotCoverage,
      floorAreaRatio: measurements.floorAreaRatio,
      issues: issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
      })),
    },
  };
}

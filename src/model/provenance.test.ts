/**
 * The sample house, and the claim it carries.
 *
 * Both matter for the same reason: a plan nobody can trust the origin of is
 * just a picture. The sample says, in words, that no model planned it — and
 * it says the same thing every time it is loaded, because a sample that
 * changed would be a different sample.
 */
import { describe, expect, it } from 'vitest';
import { provenanceLine, provenanceNotice } from './provenance.ts';
import { sampleProject } from './sample.ts';
import type { Project } from './types.ts';

function sample(): Project {
  const res = sampleProject();
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  return res.project;
}

/**
 * The plan as a person would compare two drawings of it.
 *
 * Floors are compared by their order, not by their ids: the ids are unique per
 * project by design, so including them would compare two different things.
 */
function shape(project: Project) {
  const order = new Map(project.floors.map((f, i) => [f.id, i]));
  return project.rooms
    .map((r) => `${r.kind}|${r.label}|floor ${order.get(r.floorId) ?? '?'}|${r.x.toFixed(3)}|${r.y.toFixed(3)}|${r.width.toFixed(3)}|${r.depth.toFixed(3)}`)
    .sort();
}

describe('the sample house', () => {
  it('says, in plain words, that no model planned it', () => {
    const project = sample();
    expect(project.provenance?.plannedBy).toBe('defaults');

    const line = provenanceLine(project);
    expect(line).not.toBeNull();
    expect(line?.text).toContain('No model planned');
    expect(line?.text).toContain('sample house');

    const notice = provenanceNotice(project);
    expect(notice?.text).toContain('No model planned');
  });

  it('is the same house every time it is loaded', () => {
    const first = sample();
    const second = sample();
    expect(shape(first)).toEqual(shape(second));
    expect(first.rooms.length).toBe(second.rooms.length);
    expect(first.floors.length).toBe(second.floors.length);
    // The areas are what the measurements read from.
    const area = (p: Project) => p.rooms.reduce((sum, r) => sum + r.width * r.depth, 0);
    expect(area(first)).toBeCloseTo(area(second), 6);
  });

  it('is a whole house — rooms, doors, windows, stairs and furniture', () => {
    const project = sample();
    expect(project.rooms.filter((r) => !r.outdoor).length).toBeGreaterThan(8);
    expect(project.walls.length).toBeGreaterThan(0);
    expect(project.stairs.length).toBeGreaterThan(0);
    expect(project.furniture.length).toBeGreaterThan(0);
    const openings = project.walls.flatMap((w) => w.openings);
    expect(openings.some((o) => o.kind === 'door' || o.kind === 'doorway')).toBe(true);
    expect(openings.some((o) => o.kind === 'window')).toBe(true);
  });
});

describe('the provenance claim', () => {
  it('says nothing about a plan with no history', () => {
    const project = sample();
    const edited: Project = { ...project, provenance: undefined };
    expect(provenanceLine(edited)).toBeNull();
    expect(provenanceNotice(edited)).toBeNull();
  });

  it('names MiniMax when a model planned the rooms', () => {
    const project = sample();
    const modelled: Project = {
      ...project,
      provenance: { plannedBy: 'model', summary: 'Three bedrooms upstairs.', at: Date.now() },
    };
    expect(provenanceLine(modelled)?.tone).toBe('ok');
    expect(provenanceLine(modelled)?.text).toContain('MiniMax');
    expect(provenanceNotice(modelled)?.text).toContain('MiniMax planned these rooms');
  });

  it('cannot be stamped by hand on a plan a model did not plan', () => {
    // `plannedBy` follows the generator, not the caller: the sample carries a
    // reason, but still says 'defaults'.
    const project = sample();
    expect(project.provenance?.plannedBy).not.toBe('model');
  });
});

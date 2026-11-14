/**
 * The style palettes and the operation that applies them.
 *
 * Two separate claims are under test. First, that a palette is *only ever* a
 * selection of materials the catalogue already holds — the palette is the one
 * place a language model's request to "pick a colour" stops at code it cannot
 * reach. Second, that `applyStyle` is atomic and counts honestly: it reports
 * what it actually rewrote, so the assistant can describe the change without
 * overstating it.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { DESIGN_STYLES, paletteFor, previewPalette, STYLE_LABEL } from './palette.ts';
import { DEFAULT_MATERIALS } from './catalog.ts';
import { applyStyle, blankProject } from './ops.ts';
import { buildScene } from '../three/sceneModel.ts';
import { useProject } from '../store/useProject.ts';
import { emptyHistory } from './history.ts';
import type { Project } from './types.ts';

function seed(): Project {
  useProject.getState().project = blankProject('Palette test');
  useProject.setState({ history: emptyHistory(), activity: [], selection: { kinds: [], ids: [] }, dirty: false });
  return useProject.getState().project;
}

/** A project with two rooms of different kinds and both kinds of wall. */
function withGeometry(): Project {
  seed();
  const s = useProject.getState();
  for (const [kind, x] of [['living', 1], ['bathroom', 7]] as const) {
    const r = s.run('createRoom', [{ kind, x, y: 1, width: 5, depth: 4 }]);
    if (!r.ok) throw new Error(r.error);
  }
  const after = useProject.getState();
  for (const type of ['exterior', 'interior'] as const) {
    const r = after.run('createWall', [{ type, a: { x: 1, y: 0.5 }, b: { x: 12, y: 0.5 } }]);
    if (!r.ok) throw new Error(r.error);
  }
  return useProject.getState().project;
}

describe('style palettes', () => {
  it('covers exactly the five declared styles', () => {
    expect([...DESIGN_STYLES].sort()).toEqual(['contemporary', 'japandi', 'minimalist', 'modern', 'traditional']);
    for (const s of DESIGN_STYLES) expect(STYLE_LABEL[s]).toBeTruthy();
  });

  it('names only materials that exist in the catalogue', () => {
    // The whole security argument rests on this. A palette that could name a
    // colour the catalogue has never heard of would be a palette the model
    // could nudge.
    for (const s of DESIGN_STYLES) {
      const p = paletteFor(s);
      expect(p, `${s} has no palette`).toBeTruthy();
      for (const id of [p!.exterior, p!.interior, ...Object.values(p!.floorsByKind)]) {
        expect(DEFAULT_MATERIALS[id], `${s} names unknown material ${id}`).toBeTruthy();
      }
    }
  });

  it('gives every room kind a floor finish', () => {
    const kinds = ['living', 'dining', 'kitchen', 'bedroom', 'bathroom', 'guest', 'office', 'prayer',
      'storage', 'utility', 'pantry', 'corridor', 'hall', 'lobby', 'garage', 'balcony', 'terrace'];
    for (const s of DESIGN_STYLES) {
      for (const k of kinds) {
        expect(paletteFor(s)!.floorsByKind[k], `${s} has no floor for ${k}`).toBeTruthy();
      }
    }
  });

  it('never puts carpet in a wet room', () => {
    for (const s of DESIGN_STYLES) {
      const p = paletteFor(s)!;
      for (const wet of ['bathroom', 'kitchen', 'utility', 'pantry']) {
        expect(p.floorsByKind[wet], `${s} puts ${p.floorsByKind[wet]} in ${wet}`).not.toBe('floor.carpet');
      }
    }
  });

  it('refuses an unknown style rather than falling back', () => {
    expect(paletteFor('brutalist')).toBeNull();
    expect(paletteFor('')).toBeNull();
    expect(previewPalette('brutalist', { walls: [], rooms: [] })).toBeNull();
  });
});

describe('applyStyle', () => {
  beforeEach(() => seed());

  it('refuses an unknown style and changes nothing', () => {
    const p = withGeometry();
    const res = applyStyle(p, 'brutalist');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_input');
    // Nothing may have moved: a refused call must not leave a half-applied palette.
    expect(useProject.getState().project).toBe(p);
  });

  it('applies the facade to every exterior wall', () => {
    withGeometry();
    const res = useProject.getState().run('applyStyle', ['traditional'], { actor: 'user' });
    expect(res.ok).toBe(true);
    const next = useProject.getState().project;
    const exterior = next.walls.filter((w) => w.type === 'exterior');
    expect(exterior.length).toBeGreaterThan(0);
    for (const w of exterior) expect(w.material).toBe('exterior.brick');
  });

  it('leaves boundary walls and railings alone', () => {
    seed();
    const s = useProject.getState();
    for (const type of ['boundary', 'railing'] as const) {
      const r = s.run('createWall', [{ type, a: { x: 1, y: 1 }, b: { x: 10, y: 1 } }]);
      if (!r.ok) throw new Error(r.error);
    }
    const res = useProject.getState().run('applyStyle', ['japandi'], { actor: 'user' });
    expect(res.ok).toBe(true);
    for (const w of useProject.getState().project.walls) {
      if (w.type === 'boundary' || w.type === 'railing') expect(w.material).not.toBe('exterior.timber');
    }
  });

  it('gives each room kind its own finish, and reports what it changed', () => {
    withGeometry();
    const res = useProject.getState().run('applyStyle', ['japandi'], { actor: 'user' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.data;
    const next = useProject.getState().project;
    for (const r of next.rooms) {
      expect(r.floorMaterial).toBe(paletteFor('japandi')!.floorsByKind[r.kind]);
    }
    // The counts must be a partition of the rooms, not a loose estimate.
    const counted = Object.values(data.floors as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(counted).toBe(next.rooms.length);
  });

  it('records the choice on the brief', () => {
    withGeometry();
    useProject.getState().run('applyStyle', ['minimalist'], { actor: 'user' });
    expect(useProject.getState().project.brief?.style).toBe('minimalist');
  });

  it('counts zero the second time, because nothing changed', () => {
    withGeometry();
    useProject.getState().run('applyStyle', ['modern'], { actor: 'user' });
    const again = useProject.getState().run('applyStyle', ['modern'], { actor: 'user' });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.data.exteriorWalls).toBe(0);
    expect(again.data.interiorWalls).toBe(0);
    expect(Object.keys(again.data.floors)).toHaveLength(0);
  });

  it('actually changes what the 3D scene is made of', () => {
    // The point of the whole feature. Applying a material used to rewrite the
    // model correctly and change no pixels, because the scene builder read the
    // wall *type* and ignored the material entirely.
    withGeometry();
    const before = buildScene(useProject.getState().project);
    useProject.getState().run('applyStyle', ['traditional'], { actor: 'user' });
    const after = buildScene(useProject.getState().project);

    const wallColors = (scene: ReturnType<typeof buildScene>) =>
      new Set(scene.boxes.filter((b) => b.kind === 'wall').map((b) => b.color));
    const floorColors = (scene: ReturnType<typeof buildScene>) =>
      new Set(scene.boxes.filter((b) => b.kind === 'room-slab').map((b) => b.color));

    expect([...wallColors(after)]).not.toEqual([...wallColors(before)]);
    expect([...floorColors(after)]).not.toEqual([...floorColors(before)]);
    // And it is the catalogue's colour, not a coincidence.
    expect(wallColors(after).has(DEFAULT_MATERIALS['exterior.brick']!.color)).toBe(true);
  });

  it('is one undo step, not one per surface', () => {
    withGeometry();
    const depth = useProject.getState().history.past.length;
    useProject.getState().run('applyStyle', ['traditional'], { actor: 'user' });
    // One entry, not one per wall and one per room.
    expect(useProject.getState().history.past.length).toBe(depth + 1);
    useProject.getState().run('applyStyle', ['japandi'], { actor: 'user' });
    expect(useProject.getState().history.past.length).toBe(depth + 2);
    useProject.getState().undo();
    expect(useProject.getState().project.brief?.style).toBe('traditional');
  });
});

describe('previewPalette', () => {
  it('agrees with what applyStyle then does', () => {
    const p = withGeometry();
    const preview = previewPalette('traditional', {
      walls: p.walls.map((w) => ({ type: w.type, material: w.material ?? '' })),
      rooms: p.rooms.map((r) => ({ kind: r.kind, floorMaterial: r.floorMaterial ?? '' })),
    })!;
    const res = useProject.getState().run('applyStyle', ['traditional'], { actor: 'user' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(preview.exteriorWalls).toBe(res.data.exteriorWalls);
    expect(preview.interiorWalls).toBe(res.data.interiorWalls);
  });
});
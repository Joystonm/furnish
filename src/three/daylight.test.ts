/**
 * The daylight module is where the interior look is decided, so it is tested
 * without a renderer: the arithmetic either produces the falloff it claims or
 * it does not, and a shader cannot be checked any more honestly than that.
 */
import { describe, expect, it } from 'vitest';
import {
  DECAY,
  INSET,
  MAX_SOURCES,
  REACH,
  chooseSources,
  daylightSources,
  facingGain,
  lightPosition,
  openingGain,
  sourceColor,
  sourceIntensity,
  type DaylightSource,
} from './daylight.ts';
import type { Floor, Opening, Room, Wall } from '../model/types.ts';

const PLOT = { plotWidth: 12, plotDepth: 10 };

function floors(): Floor[] {
  return [
    { id: 'fl_ground0001', label: 'Ground floor', order: 0, elevation: 0, height: 3 },
    { id: 'fl_upper00001', label: 'First floor', order: 1, elevation: 3, height: 3 },
  ] as unknown as Floor[];
}

function windowOpening(over: Partial<Opening> = {}): Opening {
  return {
    id: 'op_window0001',
    kind: 'window',
    offset: 1,
    width: 1.4,
    sill: 0.9,
    height: 1.5,
    ...over,
  } as Opening;
}

function exteriorWall(over: Partial<Wall> = {}): Wall {
  return {
    id: 'wl_north0001',
    floorId: 'fl_ground0001',
    type: 'exterior',
    a: { x: 0, y: 0 },
    b: { x: 12, y: 0 },
    thickness: 0.2,
    height: 3,
    roomIds: ['rm_living001'],
    openings: [windowOpening()],
    ...over,
  } as Wall;
}

function livingRoom(over: Partial<Room> = {}): Room {
  return {
    id: 'rm_living001',
    floorId: 'fl_ground0001',
    kind: 'living',
    label: 'Living room',
    x: 0.5,
    y: 0.5,
    width: 11,
    depth: 9,
    height: 3,
    ...over,
  } as Room;
}

const base = () => ({
  walls: [exteriorWall()],
  floors: floors(),
  rooms: [livingRoom()],
  plot: PLOT,
});

describe('daylightSources', () => {
  it('puts a north window on the north elevation, shining into the building', () => {
    const [s] = daylightSources(base());
    expect(s).toBeDefined();
    // The wall runs along y = 0, so its inward normal points toward +y, which
    // is world +z. A light travelling that way comes in through the north wall.
    expect(s!.nz).toBeGreaterThan(0.9);
    expect(s!.nx).toBeCloseTo(0, 5);
  });

  it('sits the light on the glass, in world coordinates, at mid-height', () => {
    const [s] = daylightSources(base());
    // Opening centre is offset 1 + 1.4/2 = 1.7 m along a wall from (0,0), so
    // plan (1.7, 0); the world origin is the plot centre, hence -6 and -5.
    expect(s!.x).toBeCloseTo(1.7 - 6, 6);
    expect(s!.z).toBeCloseTo(0 - 5, 6);
    // Sill 0.9 + half of 1.5 = 1.65 m up.
    expect(s!.y).toBeCloseTo(1.65, 6);
  });

  it('flips the normal for a wall on the far side of the plot', () => {
    const wall = exteriorWall({ a: { x: 0, y: 10 }, b: { x: 12, y: 10 } });
    const [s] = daylightSources({ ...base(), walls: [wall] });
    expect(s!.nz).toBeLessThan(-0.9);
  });

  it('raises the light to the storey above rather than leaving it at ground', () => {
    const wall = exteriorWall({ id: 'wl_upper0001', floorId: 'fl_upper00001' });
    const [s] = daylightSources({ ...base(), walls: [wall] });
    expect(s!.y).toBeCloseTo(3 + 1.65, 6);
    expect(s!.floorOrder).toBe(1);
  });

  it('ignores an interior partition with a window drawn in it', () => {
    const wall = exteriorWall({ type: 'interior' });
    expect(daylightSources({ ...base(), walls: [wall] })).toHaveLength(0);
  });

  it('ignores doors — a door leaf is not a light source', () => {
    const wall = exteriorWall({ openings: [windowOpening({ kind: 'door', sill: 0 })] });
    expect(daylightSources({ ...base(), walls: [wall] })).toHaveLength(0);
  });

  it('passes a share of the light through a doorway', () => {
    const wall = exteriorWall({ openings: [{ ...windowOpening(), kind: 'doorway' } as Opening] });
    const [s] = daylightSources({ ...base(), walls: [wall] });
    expect(s!.gain).toBeGreaterThan(0);
    expect(s!.gain).toBeLessThan(1);
  });

  it('drops an opening that hangs off the end of its wall', () => {
    const wall = exteriorWall({ openings: [windowOpening({ offset: 99 })] });
    expect(daylightSources({ ...base(), walls: [wall] })).toHaveLength(0);
  });

  it('aims the normal at the rooms the wall bounds, not at the plot centre', () => {
    // A house that fills only the south strip of a long plot, so the plot's
    // centre lies *outside the building*, beyond the far wall. Aiming at the
    // plot centre would light this room through the outside of its own north
    // wall; aiming at the rooms it actually bounds gets it right.
    const plot = { plotWidth: 12, plotDepth: 20 };
    const wall = exteriorWall({ a: { x: 0, y: 9 }, b: { x: 12, y: 9 } });
    const room = livingRoom({ y: 1, depth: 8 });
    expect(plot.plotDepth / 2).toBeGreaterThan(9); // the centre is past the wall

    const [s] = daylightSources({ walls: [wall], floors: floors(), rooms: [room], plot });
    // The room centre is at y = 5, so the light travels from the wall down to it.
    expect(s!.nz).toBeLessThan(-0.9);
  });

  it('falls back to the plot centre for a wall no room has claimed yet', () => {
    const wall = exteriorWall({ roomIds: [] });
    const [s] = daylightSources({ ...base(), walls: [wall] });
    // Plot centre is south of a wall on y = 0, so the light travels +y.
    expect(s!.nz).toBeGreaterThan(0.9);
  });
});

describe('openingGain', () => {
  it('is 1 for a window, a share for a doorway, and nothing for a door', () => {
    expect(openingGain(windowOpening({ kind: 'window' }))).toBe(1);
    expect(openingGain(windowOpening({ kind: 'doorway' }))).toBeGreaterThan(0);
    expect(openingGain(windowOpening({ kind: 'door' }))).toBe(0);
    expect(openingGain(windowOpening({ kind: 'opening' }))).toBeGreaterThan(0);
  });
});

describe('sourceIntensity', () => {
  const source = (over: Partial<DaylightSource> = {}): DaylightSource => ({
    x: 0, y: 1.5, z: 0, nx: 0, nz: 1, w: 1.4, h: 1.5, floorOrder: 0, floorId: 'f', gain: 1,
    ...over,
  });
  const sun = { x: 0, z: -1 };

  it('is brighter for a bigger window', () => {
    const small = sourceIntensity(source({ w: 0.6, h: 1.2 }), sun);
    const large = sourceIntensity(source({ w: 2.4, h: 1.8 }), sun);
    expect(large).toBeGreaterThan(small);
  });

  it('is brighter for a window facing the sun than one in its shade', () => {
    // Inward normal +z: light travels +z, so the sun is at -z behind it.
    const toSun = sourceIntensity(source({ nx: 0, nz: 1 }), { x: 0, z: 1 });
    const away = sourceIntensity(source({ nx: 0, nz: 1 }), { x: 0, z: -1 });
    expect(toSun).toBeGreaterThan(away);
  });

  it('has a usable value at every angle', () => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const g = facingGain(source({ nx: Math.cos(a), nz: Math.sin(a) }), sun);
      expect(g).toBeGreaterThan(0.3);
      expect(g).toBeLessThan(1.3);
    }
  });

  it('does not depend on where the sun is when there is no sun direction', () => {
    expect(facingGain(source(), { x: 0, z: 0 })).toBeCloseTo(0.8, 6);
  });

  it('falls off with distance, which is the whole point of the module', () => {
    // This is the property the interior look depends on: three.js applies the
    // distance term with `decay`, so the constant here has to be fixed while
    // the exponent is not 0.
    expect(DECAY).toBeGreaterThan(1);
    expect(DECAY).toBeLessThan(2);
    const near = 1 / Math.pow(1, DECAY);
    const far = 1 / Math.pow(4, DECAY);
    expect(far).toBeLessThan(near * 0.4);
    expect(REACH).toBeGreaterThan(6);
  });
});

describe('sourceColor', () => {
  it('warms a window the sun comes through and cools one it does not', () => {
    const sunlit = sourceColor({ nx: 0, nz: 1, x: 0, y: 0, z: 0, w: 1, h: 1, floorOrder: 0, floorId: 'f', gain: 1 }, { x: 0, z: 1 });
    const shaded = sourceColor({ nx: 0, nz: 1, x: 0, y: 0, z: 0, w: 1, h: 1, floorOrder: 0, floorId: 'f', gain: 1 }, { x: 0, z: -1 });
    const warmth = (hex: string) => {
      const p = parseInt(hex.slice(1), 16);
      return (p >> 16) & 255;
    };
    expect(warmth(sunlit)).toBeGreaterThan(warmth(shaded));
  });
});

describe('chooseSources', () => {
  const many = (n: number): DaylightSource[] =>
    Array.from({ length: n }, (_, i) => ({
      x: i * 1.5, y: 1.5, z: 0, nx: 0, nz: 1, w: 1.4, h: 1.5, floorOrder: 0, floorId: 'f', gain: 1,
    }));

  it('keeps the nearest ones and no more than the budget', () => {
    const chosen = chooseSources(many(20), { x: 0, y: 1.6, z: 0 }, { x: 0, z: -1 });
    expect(chosen).toHaveLength(MAX_SOURCES);
    expect(chosen[0]!.source.x).toBe(0);
    // And the ones dropped really are the far ones.
    const dropped = many(20).slice(MAX_SOURCES);
    for (const d of dropped) {
      expect(chosen.some((c) => c.source === d)).toBe(false);
    }
  });

  it('honours an explicit budget', () => {
    expect(chooseSources(many(20), { x: 0, y: 1.6, z: 0 }, { x: 0, z: -1 }, 2)).toHaveLength(2);
  });

  it('reports the distance it sorted on', () => {
    const chosen = chooseSources(many(3), { x: 0, y: 1.6, z: 0 }, { x: 0, z: -1 });
    expect(chosen[0]!.distance).toBeLessThan(chosen[2]!.distance);
  });

  it('leaves an unlit project unlit rather than inventing a light', () => {
    expect(chooseSources([], { x: 0, y: 1.6, z: 0 }, { x: 0, z: -1 })).toEqual([]);
  });

  it('gives every source it returns an intensity and a colour', () => {
    for (const c of chooseSources(many(5), { x: 3, y: 1.6, z: 1 }, { x: 1, z: 1 })) {
      expect(c.intensity).toBeGreaterThan(0);
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('lightPosition', () => {
  const source: DaylightSource = {
    x: 2, y: 1.65, z: -3, nx: 0, nz: 1, w: 1.4, h: 1.5, floorOrder: 0, floorId: 'f', gain: 1,
  };

  it('steps the light into the room, along the inward normal', () => {
    const p = lightPosition(source);
    expect(p.z).toBeGreaterThan(source.z);
    expect(p.x).toBeCloseTo(source.x, 6);
    expect(p.y).toBeCloseTo(source.y, 6);
  });

  it('steps the right distance, and can be told not to', () => {
    expect(lightPosition(source).z - source.z).toBeCloseTo(INSET, 6);
    expect(lightPosition(source, 0).z).toBeCloseTo(source.z, 6);
  });

  it('follows the normal on both axes for a diagonal wall', () => {
    const d = lightPosition({ ...source, nx: Math.SQRT1_2, nz: Math.SQRT1_2 });
    expect(d.x - source.x).toBeCloseTo(INSET * Math.SQRT1_2, 6);
    expect(d.z - source.z).toBeCloseTo(INSET * Math.SQRT1_2, 6);
  });
});
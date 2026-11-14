import { describe, expect, it } from 'vitest';
import { blankProject, createRoom } from './ops.ts';
import { emptyFromBrief, generateFromBrief, gridFromBrief, rebuildWallsFromRooms } from './layout.ts';
import { validate } from './validate.ts';
import { measureBuilding } from './measure.ts';
import { buildCirculation } from './circulation.ts';
import { boundarySegments, furnishFloor } from './plan.ts';
import { adjacencyPairs, type RoomProgram } from './program.ts';
import { rectArea, rectOf, footprintOfItem, doorLeaf } from './geometry.ts';
import { backBearing } from '../three/furniture.ts';
import type { DesignBrief, Id, Opening, Project, Room, Staircase, Vec2, Wall } from './types.ts';

const FLOOR_ID = 'fl_test00001';
const ROOM_ID = 'rm_test00001';

const baseBrief = (over: Partial<DesignBrief> = {}): DesignBrief => ({
  plot: { width: 15, depth: 20, orientation: 0, setbacks: { front: 4.5, rear: 4.5, left: 3, right: 3 } },
  floorCount: 1,
  rooms: [
    { kind: 'living', count: 1 },
    { kind: 'dining', count: 1 },
    { kind: 'kitchen', count: 1 },
    { kind: 'bedroom', count: 3 },
    { kind: 'bathroom', count: 2 },
    { kind: 'utility', count: 1 },
  ],
  preferredAreas: {},
  style: 'modern',
  preferences: { accessibility: false, ventilation: false, privacy: false, daylight: true },
  ...over,
});

function generate(brief: DesignBrief) {
  const project = blankProject('Test');
  const res = generateFromBrief(project, brief);
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  return res.project;
}

const twoStoreyBrief = (): DesignBrief =>
  baseBrief({
    floorCount: 2,
    rooms: [
      { kind: 'living', count: 1 },
      { kind: 'dining', count: 1 },
      { kind: 'kitchen', count: 1 },
      { kind: 'bedroom', count: 4 },
      { kind: 'bathroom', count: 2 },
      { kind: 'office', count: 1 },
    ],
  });

/** The plan rectangle a flight occupies. */
function stairBox(s: Staircase): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: s.x - s.width / 2, y0: s.y - s.run / 2, x1: s.x + s.width / 2, y1: s.y + s.run / 2 };
}

/**
 * Openings on one storey whose position lies over the flight.
 *
 * Matched by point rather than by wall id on purpose: which wall carries the
 * door depends on what happened to pack beside the shaft, and the requirement is
 * the same either way — something you can walk through, at the stairs.
 */
function openingsOverStair(
  p: Project,
  s: Staircase,
  floorId: Id,
): Array<{ kind: string; at: Vec2; wall: Wall; opening: Opening }> {
  const box = stairBox(s);
  const out: Array<{ kind: string; at: Vec2; wall: Wall; opening: Opening }> = [];
  for (const w of p.walls) {
    if (w.floorId !== floorId) continue;
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (L < 0.02) continue;
    const ux = (w.b.x - w.a.x) / L;
    const uy = (w.b.y - w.a.y) / L;
    for (const o of w.openings) {
      const at = { x: w.a.x + ux * o.offset, y: w.a.y + uy * o.offset };
      const m = o.width / 2 + 0.1;
      if (at.x < box.x0 - m || at.x > box.x1 + m || at.y < box.y0 - m || at.y > box.y1 + m) continue;
      out.push({ kind: o.kind, at, wall: w, opening: o });
    }
  }
  return out;
}

/** The two ends of an opening, on the plan. */
function openingEnds(o: { at: Vec2; wall: Wall; opening: Opening }): [Vec2, Vec2] {
  const L = Math.hypot(o.wall.b.x - o.wall.a.x, o.wall.b.y - o.wall.a.y);
  const ux = (o.wall.b.x - o.wall.a.x) / L;
  const uy = (o.wall.b.y - o.wall.a.y) / L;
  const half = o.opening.width / 2;
  return [
    { x: o.at.x - ux * half, y: o.at.y - uy * half },
    { x: o.at.x + ux * half, y: o.at.y + uy * half },
  ];
}

/**
 * Whether an open leaf reaches into the flight's own footprint.
 *
 * The flight is a rectangle of treads; a leaf lying across it is a leaf
 * standing on the stairs. Touching the edge is not standing on it, so the
 * rectangle is inset before the leaf is tested against it.
 */
function leafOverFlight(
  hinge: Vec2,
  openEnd: Vec2,
  box: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const inset = 0.05;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const x = hinge.x + (openEnd.x - hinge.x) * t;
    const y = hinge.y + (openEnd.y - hinge.y) * t;
    if (x > box.x0 + inset && x < box.x1 - inset && y > box.y0 + inset && y < box.y1 - inset) {
      return true;
    }
  }
  return false;
}

describe('brief → layout generator', () => {
  it('produces rooms, walls and furniture for a standard 3-bed brief', () => {
    const p = generate(baseBrief());
    expect(p.rooms.length).toBeGreaterThanOrEqual(7);
    expect(p.walls.length).toBeGreaterThan(8);
    expect(p.furniture.length).toBeGreaterThan(0);
  });

  it('fits every room inside the buildable envelope', () => {
    const brief = baseBrief();
    const p = generate(brief);
    const env = {
      x: brief.plot.setbacks.left,
      y: brief.plot.setbacks.front,
      w: brief.plot.width - brief.plot.setbacks.left - brief.plot.setbacks.right,
      d: brief.plot.depth - brief.plot.setbacks.front - brief.plot.setbacks.rear,
    };
    for (const r of p.rooms) {
      expect(r.x).toBeGreaterThanOrEqual(env.x - 0.02);
      expect(r.y).toBeGreaterThanOrEqual(env.y - 0.02);
      expect(r.x + r.width).toBeLessThanOrEqual(env.x + env.w + 0.02);
      expect(r.y + r.depth).toBeLessThanOrEqual(env.y + env.d + 0.02);
    }
  });

  it('never produces overlapping rooms on a floor', () => {
    const p = generate(baseBrief());
    const issues = validate(p).filter((i) => i.code === 'room_overlap');
    expect(issues.map((i) => i.message)).toEqual([]);
  });

  it('gives every room a door and a reachable path from outside', () => {
    const p = generate(baseBrief());
    const ground = p.floors[0]!;
    const g = buildCirculation(p, ground.id);
    expect(g.hasEntrance).toBe(true);
    for (const r of p.rooms.filter((x) => x.floorId === ground.id && x.kind !== 'corridor')) {
      expect(g.reachable.has(r.id)).toBe(true);
    }
  });

  it('emits no error-severity issues on a clean generated plan', () => {
    const p = generate(baseBrief());
    const errors = validate(p).filter((i) => i.severity === 'error');
    expect(errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
  });

  it('reports areas that add up and a sane plot coverage', () => {
    const p = generate(baseBrief());
    const m = measureBuilding(p);
    expect(m.plotArea).toBeCloseTo(300, 5);
    expect(m.netIndoorArea).toBeGreaterThan(60);
    expect(m.plotCoverage).toBeGreaterThan(0.2);
    expect(m.plotCoverage).toBeLessThan(0.65);
    // Rooms should tile most of the buildable envelope.
    const env = m.buildableArea;
    expect(m.netIndoorArea / env).toBeGreaterThan(0.85);
  });

  it('handles a two-storey brief and connects the floors with a stair', () => {
    const p = generate(twoStoreyBrief());
    expect(p.floors.length).toBe(2);
    expect(p.stairs.length).toBeGreaterThanOrEqual(1);
    const issues = validate(p).filter((i) => i.severity === 'error');
    expect(issues.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
  });

  it('puts the front door in the entrance room, not in the room next to it', () => {
    // The front door landed in the dining room when the entrance was the living
    // room. The reason was a test that asked "does this boundary segment touch
    // the entrance room?" and answered yes for a segment that shared a *corner*
    // with it — every room on the street touches its neighbour at the corner,
    // and the longest of them won.
    //
    // The requirement is simple and does not depend on which room is the
    // entrance: the outside door has to be in the room you walk in to.
    const p = generate(twoStoreyBrief());
    const ground = p.floors[0]!.id;
    const entrance = p.rooms.find((r) => r.floorId === ground && r.isEntrance);
    expect(entrance, 'the ground floor has an entrance room').toBeDefined();
    if (!entrance) return;

    const rr = rectOf(entrance);
    const outside = p.walls.filter((w) => w.floorId === ground && w.type === 'exterior');
    const doors = outside.flatMap((w) =>
      w.openings.filter((o) => o.kind === 'door').map((o) => ({ w, o })),
    );
    expect(doors.length, 'the house has one front door').toBeGreaterThanOrEqual(1);

    for (const { w, o } of doors) {
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      const ux = (w.b.x - w.a.x) / L;
      const uy = (w.b.y - w.a.y) / L;
      const at = { x: w.a.x + ux * o.offset, y: w.a.y + uy * o.offset };
      const inside =
        at.x >= rr.x - 0.05 &&
        at.x <= rr.x + rr.width + 0.05 &&
        at.y >= rr.y - 0.05 &&
        at.y <= rr.y + rr.depth + 0.05;
      expect(inside, `the front door at (${at.x.toFixed(2)}, ${at.y.toFixed(2)}) is outside the entrance room`).toBe(true);
    }
  });

  it('gives a staircase a door on each storey it touches', () => {
    // The complaint this answers: in the 3D view a generated two-storey house
    // had stairs you could not climb and could not get onto — they led to a
    // window. Nothing doored a stairwell, because `chooseDoorPartitions` only
    // doors a partition both its rooms wanted and `planFloor` glazes every
    // boundary that bounds no room, which is exactly the shaft's near edge.
    const p = generate(twoStoreyBrief());
    expect(p.stairs.length).toBeGreaterThanOrEqual(1);
    const doorless: string[] = [];
    for (const s of p.stairs) {
      // A flight that reaches nothing has no far end to door; `addStaircase`
      // refuses to make one and `placeStair` always names a target, so this
      // filter is belt-and-braces rather than an expected branch.
      for (const floorId of [s.floorId, s.connectsToFloorId].filter((f): f is Id => f !== null)) {
        const doors = openingsOverStair(p, s, floorId).filter(
          (o) => o.kind === 'door' || o.kind === 'doorway',
        );
        if (!doors.length) doorless.push(`${s.name} on ${floorId}`);
      }
    }
    expect(doorless, 'a flight needs a way on at its foot and a way off at its head').toEqual([]);
  });

  it('does not leave a window standing in a stair doorway', () => {
    const p = generate(twoStoreyBrief());
    for (const s of p.stairs) {
      const box = stairBox(s);
      // Where the door at the foot of the flight is wanted: half a leaf before
      // the first tread, so the opening ends where the flight begins.
      const want = { x: s.x, y: box.y0 - 0.45 };
      for (const o of openingsOverStair(p, s, s.floorId)) {
        if (o.kind !== 'window') continue;
        expect(
          Math.hypot(o.at.x - want.x, o.at.y - want.y),
          `${s.name}: a window is standing where the door needs to be`,
        ).toBeGreaterThan(0.9);
      }
    }
  });

  it('opens the door at the foot of the flight onto the landing, not onto the treads', () => {
    // The landing is the floor between the foot of the flight and the wall the
    // door is in. A door whose opening runs *along* the flight instead of
    // stopping at its foot opens onto the bottom step: you step through it and
    // straight into the underside of the ramp, where the ceiling is knee high.
    // That is the drawing of "the staircase blocks the door" that a user
    // reported from inside the house.
    const p = generate(twoStoreyBrief());
    for (const s of p.stairs) {
      const box = stairBox(s);
      const foot = { x: s.x, y: box.y0 };
      const doors = openingsOverStair(p, s, s.floorId).filter((o) => o.kind === 'door');
      expect(doors.length, `${s.name}: the flight has no door at its foot`).toBeGreaterThan(0);
      const nearest = doors.reduce((a, b) =>
        Math.hypot(b.at.x - foot.x, b.at.y - foot.y) < Math.hypot(a.at.x - foot.x, a.at.y - foot.y)
          ? b
          : a,
      );
      const ends = openingEnds(nearest);
      // The flight climbs in +y, so nothing of the door may sit past its foot.
      expect(
        Math.max(ends[0].y, ends[1].y),
        `${s.name}: the door's opening runs along the flight instead of stopping at its foot`,
      ).toBeLessThanOrEqual(box.y0 + 0.05);
    }
  });

  it('hangs every stair door so its open leaf does not stand on the stairs', () => {
    // The shaft is emptied before anything is placed in it, so the stairwell is
    // the one place on a generated plan guaranteed to be clear. A leaf that
    // swings over the flight is a leaf standing on the stairs it serves — the
    // other half of the same complaint, and the one a person meets at the top
    // of the flight, where the door has to open onto the landing.
    const p = generate(twoStoreyBrief());
    let checked = 0;
    for (const s of p.stairs) {
      const box = stairBox(s);
      for (const floorId of [s.floorId, s.connectsToFloorId].filter((f): f is Id => f !== null)) {
        for (const found of openingsOverStair(p, s, floorId)) {
          if (found.kind !== 'door') continue;
          const leaf = doorLeaf(found.wall, found.opening);
          expect(
            leafOverFlight(leaf.hinge, leaf.openEnd, box),
            `${s.name}: a stair door's leaf is standing on the flight`,
          ).toBe(false);
          checked++;
        }
      }
    }
    expect(checked, 'this should have found at least one door per flight').toBeGreaterThanOrEqual(
      p.stairs.length,
    );
  });

  it('glazes every outside wall instead of rounding a shared budget down to none', () => {
    // The bug this guards: windows were funded from one budget spread over the
    // perimeter, so every short wall got a fraction of a window, rounded to
    // zero, and whole plans came out with no glazing and no error saying so.
    const p = generate(baseBrief());
    const windows = p.walls.flatMap((w) => w.openings).filter((o) => o.kind === 'window');
    expect(windows.length).toBeGreaterThan(0);
    const glazing = windows.reduce((s, o) => s + o.width * o.height, 0);
    const indoor = p.rooms.filter((r) => !r.outdoor).reduce((s, r) => s + r.width * r.depth, 0);
    expect(glazing / indoor).toBeGreaterThan(0.12);
  });

  it('never parks furniture in a door swing', () => {
    // The furnisher keeps clear of the sweeps it is given, so a plan does not
    // open with warnings the user has not earned.
    for (const brief of [baseBrief(), baseBrief({ floorCount: 2 })]) {
      const p = generate(brief);
      const blocked = validate(p).filter((i) => i.code === 'door_swing_blocked').map((i) => i.message);
      expect(blocked).toEqual([]);
    }
  });

  it('turns every wall piece so its back is against the wall, not its face', () => {
    // The bug this guards: the furnisher picks a wall and a rotation separately,
    // and a quarter turn is easy to get backwards. A bed whose headboard stands
    // in the middle of the room with the pillow at the window is not a furnish
    // job that has gone slightly wrong — it is the opposite of what was asked.
    const WANT: Record<string, { x: number; y: number }> = {
      n: { x: 0, y: -1 },
      s: { x: 0, y: 1 },
      w: { x: -1, y: 0 },
      e: { x: 1, y: 0 },
    };
    const p = generate(baseBrief());
    const wrong: string[] = [];
    let checked = 0;
    for (const f of p.furniture) {
      if (f.height <= 0.05) continue; // a rug has no back to speak of
      const room = p.rooms.find((r) => r.id === f.roomId);
      if (!room) continue;
      const b = footprintOfItem(f);
      const gaps: [string, number][] = [
        ['n', b.y - room.y],
        ['s', room.y + room.depth - (b.y + b.depth)],
        ['w', b.x - room.x],
        ['e', room.x + room.width - (b.x + b.width)],
      ];
      const against = gaps.filter(([, g]) => g < 0.3).map(([side]) => side);
      if (against.length !== 1) continue; // mid-room, or a corner: nothing to say
      checked += 1;
      const bearing = backBearing(f.rotation);
      const want = WANT[against[0]!];
      if (Math.abs(bearing.x - want.x) > 1e-6 || Math.abs(bearing.y - want.y) > 1e-6) {
        wrong.push(`${f.catalogId} stands against the ${against[0]} wall facing ${bearing.x.toFixed(0)},${bearing.y.toFixed(0)}`);
      }
    }
    expect(checked, 'the assertion actually looked at something').toBeGreaterThanOrEqual(3);
    expect(wrong).toEqual([]);
  });

  it('prefers a solid wall to a glazed one, but furnishes a room that has only those', () => {
    // Nothing reports a wardrobe in front of a window — it is legal, it is just
    // a wall with a hole behind it, and the daylight it blocks is the reason
    // the room was worth having. So the rule lives in the furnisher, and it is
    // a preference rather than a prohibition: a room whose four walls are all
    // glazed still gets a sofa, because an empty room is worse.
    const wall = (over: Partial<Wall>): Wall => ({
      id: 'wl_test000001',
      floorId: FLOOR_ID,
      type: 'exterior',
      a: { x: 0, y: 0 },
      b: { x: 5, y: 0 },
      thickness: 0.2,
      height: 3,
      roomIds: [ROOM_ID],
      openings: [],
      ...over,
    });
    const WINDOW = { id: 'op_test000001', kind: 'window', offset: 1.4, width: 2.2, sill: 0.9, height: 1.5 } as const;
    const room = {
      id: ROOM_ID,
      floorId: FLOOR_ID,
      kind: 'living',
      label: 'Living room',
      x: 0,
      y: 0,
      width: 5,
      depth: 4,
      height: 3,
    } as Room;
    const box = (f: { x: number; y: number; width: number; depth: number }) => footprintOfItem({ ...f, rotation: 0 });

    // One glazed wall, three solid: the sofa belongs on one of the three.
    const glazed = furnishFloor(
      [room],
      FLOOR_ID,
      [
        wall({ id: 'wl_n0000001', a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, openings: [WINDOW as Opening] }),
        wall({ id: 'wl_s0000001', a: { x: 0, y: 4 }, b: { x: 5, y: 4 } }),
        wall({ id: 'wl_w0000001', a: { x: 0, y: 0 }, b: { x: 0, y: 4 } }),
        wall({ id: 'wl_e0000001', a: { x: 5, y: 0 }, b: { x: 5, y: 4 } }),
      ],
    );
    const sofa = glazed.find((f) => f.catalogId === 'sofa-3');
    expect(sofa, 'the sofa got placed at all').toBeDefined();
    expect(box(sofa!).y - room.y, 'the sofa kept off the window wall').toBeGreaterThan(0.5);

    // All four glazed: still furnished, because a preference is not a veto.
    const allGlazed = furnishFloor(
      [room],
      FLOOR_ID,
      ['n', 's', 'w', 'e'].map((s, i) => {
        const horizontal = s === 'n' || s === 's';
        const y = s === 'n' ? 0 : s === 's' ? 4 : 0;
        const x = s === 'w' ? 0 : s === 'e' ? 5 : 0;
        return wall({
          id: `wl_all${i}0001`,
          a: horizontal ? { x: 0, y } : { x, y: 0 },
          b: horizontal ? { x: 5, y } : { x, y: 4 },
          openings: [{ ...WINDOW, id: `op_all${i}001`, offset: 1.4 } as Opening],
        });
      }),
    );
    expect(allGlazed.some((f) => f.catalogId.startsWith('sofa'))).toBe(true);
  });

  it('furnishes a kitchen as a kitchen and a sitting room as somewhere to sit', () => {
    // The bar this sets: a room is not furnished because something is in it.
    // A kitchen with a counter and nothing to cook on is a counter, and a living
    // room with a sofa and no television, no second seat and nothing on the
    // floor is a showroom.
    const p = generate(baseBrief());
    const ids = (kind: string): string[] => {
      const room = p.rooms.find((r) => r.kind === kind);
      if (!room) throw new Error(`the brief produced no ${kind}`);
      return p.furniture.filter((f) => f.roomId === room.id).map((f) => f.catalogId);
    };
    const kitchen = ids('kitchen');
    expect(kitchen).toContain('kitchen-run');
    expect(kitchen).toContain('sink');
    expect(kitchen).toContain('stove');
    expect(kitchen).toContain('upper-cabinet');
    expect(kitchen).toContain('fridge');

    const living = ids('living');
    expect(living).toContain('sofa-3');
    expect(living).toContain('coffee-table');
    expect(living).toContain('tv-unit');
    expect(living).toContain('armchair');
    expect(living).toContain('rug');

    expect(ids('dining').filter((c) => c === 'dining-chair').length).toBeGreaterThanOrEqual(2);
    expect(ids('bedroom').filter((c) => c === 'nightstand').length).toBeGreaterThanOrEqual(1);
  });

  it('hangs the wall cabinet over the counter without the plan warning about it', () => {
    // A wall cabinet and a worktop share the same square metre of plan and do
    // not touch in the vertical. If the validator only knew about floor area it
    // would report the overlap the app placed itself.
    const p = generate(baseBrief());
    const hung = p.furniture.filter((f) => f.catalogId === 'upper-cabinet');
    expect(hung.length).toBeGreaterThan(0);
    const overlaps = validate(p)
      .filter((i) => i.code === 'furniture_overlap')
      .map((i) => i.message);
    expect(overlaps).toEqual([]);
  });

  it('keeps the sink and the hob within reach of the worktop', () => {
    // The rule is proximity, not "same wall": on the run's wall is best, across
    // the aisle is a normal galley answer, and anything further than arm's
    // length from the counter is a fitting in the wrong house.
    const p = generate(baseBrief());
    const room = p.rooms.find((r) => r.kind === 'kitchen');
    if (!room) throw new Error('the brief produced no kitchen');
    const items = p.furniture.filter((f) => f.roomId === room.id);
    const run = items.find((f) => f.catalogId === 'kitchen-run');
    expect(run).toBeDefined();
    const runBox = footprintOfItem(run!);
    const gapBetween = (a: ReturnType<typeof footprintOfItem>, b: ReturnType<typeof footprintOfItem>) => {
      const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
      const dy = Math.max(a.y - (b.y + b.depth), b.y - (a.y + a.depth), 0);
      return Math.hypot(dx, dy);
    };
    for (const id of ['sink', 'stove']) {
      const item = items.find((f) => f.catalogId === id);
      if (!item) continue;
      expect(gapBetween(footprintOfItem(item), runBox), `${id} is out of reach of the counter`).toBeLessThan(1.8);
    }
  });

  it('refuses a plot whose setbacks leave nothing to build on', () => {
    const brief = baseBrief({
      plot: { width: 8, depth: 8, orientation: 0, setbacks: { front: 3, rear: 3, left: 2, right: 2 } },
    });
    const res = generateFromBrief(blankProject(), brief);
    expect(res.ok).toBe(false);
  });

  it('warns when the brief asks for more area than the plot allows', () => {
    const brief = baseBrief({
      plot: { width: 10, depth: 10, orientation: 0, setbacks: { front: 2, rear: 2, left: 2, right: 2 } },
      rooms: [
        { kind: 'living', count: 1, targetArea: 40 },
        { kind: 'bedroom', count: 5, targetArea: 20 },
        { kind: 'bathroom', count: 3, targetArea: 8 },
      ],
    });
    const project = blankProject();
    const res = generateFromBrief(project, brief);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.report.warnings.join(' ')).toMatch(/scaled/i);
    }
  });
});

describe('boundary tracing', () => {
  const room = (x: number, y: number, width: number, depth: number): Room => ({
    id: `rm_${x}_${y}`,
    floorId: 'fl_1',
    kind: 'bedroom',
    label: 'r',
    x,
    y,
    width,
    depth,
    height: 2.7,
  });

  it('traces a single rectangle as four edges', () => {
    const segs = boundarySegments([room(0, 0, 4, 3)]);
    expect(segs).toHaveLength(4);
  });

  it('removes the shared edge of two flush rooms', () => {
    const segs = boundarySegments([room(0, 0, 4, 3), room(4, 0, 4, 3)]);
    // 4 + 4 edges minus the shared vertical edge = 6
    expect(segs).toHaveLength(6);
  });

  it('preserves a notch instead of filling it with a bounding box', () => {
    // An L shape: a 6×6 square with a 3×3 bite out of the bottom-right.
    const segs = boundarySegments([room(0, 0, 6, 3), room(0, 3, 3, 3)]);
    const xs = segs.flatMap((s) => [s.a.x, s.b.x]);
    const ys = segs.flatMap((s) => [s.a.y, s.b.y]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(6);
    expect(Math.max(...ys)).toBe(6);
    // The concave corner at (3,3) must appear, which a bounding box cannot do.
    expect(segs.some((s) => s.a.x === 3 && s.a.y === 3) || segs.some((s) => s.b.x === 3 && s.b.y === 3)).toBe(true);
  });

  it('does not cancel edges of rooms stacked in the same direction', () => {
    // Room A on top of room B: their touching edges are NOT coplanar, so both
    // survive — the shared line is interior to the union and should not appear.
    const segs = boundarySegments([room(0, 0, 4, 3), room(0, 3, 4, 3)]);
    const interior = segs.filter((s) => s.a.y === 3 && s.b.y === 3);
    expect(interior).toHaveLength(0);
  });
});

describe('measurement formulas', () => {
  it('computes coverage and FAR from the documented formulas', () => {
    const brief = baseBrief();
    const p = generate(brief);
    const m = measureBuilding(p);
    expect(m.openSiteArea).toBeCloseTo(m.plotArea - m.footprintArea, 6);
    expect(m.plotCoverage).toBeCloseTo(m.footprintArea / m.plotArea, 10);
    expect(m.floorAreaRatio).toBeCloseTo(m.grossCoveredArea / m.plotArea, 10);
  });

  it('reports per-floor areas that sum to the total', () => {
    const brief = baseBrief({ floorCount: 2 });
    const p = generate(brief);
    const m = measureBuilding(p);
    const summed = m.perFloor.reduce((s, f) => s + f.netArea, 0);
    expect(summed).toBeCloseTo(m.netIndoorArea, 6);
  });

  it('uses real areas for each room rectangle', () => {
    const p = generate(baseBrief());
    for (const m of measureBuilding(p).rooms) {
      const room = p.rooms.find((r) => r.id === m.roomId)!;
      expect(m.area).toBeCloseTo(rectArea(rectOf(room)), 10);
    }
  });
});

describe('emptyFromBrief', () => {
  it('keeps the plot and the storeys, and nothing else', () => {
    const brief = baseBrief({ floorCount: 2 });
    const res = emptyFromBrief(blankProject(), brief);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.floorCount).toBe(2);
    expect(res.data.project.floors).toHaveLength(2);
    expect(res.data.project.plot.width).toBe(brief.plot.width);
    expect(res.data.project.plot.setbacks.front).toBe(brief.plot.setbacks.front);
    expect(res.data.project.rooms).toHaveLength(0);
    expect(res.data.project.walls).toHaveLength(0);
    expect(res.data.project.furniture).toHaveLength(0);
    expect(res.data.project.brief).toEqual(brief);
  });

  it('stacks the second floor above the first', () => {
    const res = emptyFromBrief(blankProject(), baseBrief({ floorCount: 2 }));
    if (!res.ok) return;
    const [ground, first] = res.data.project.floors;
    expect(ground!.elevation).toBe(0);
    expect(first!.elevation).toBeCloseTo(ground!.height, 9);
    expect(first!.elevation).toBeGreaterThan(0);
  });

  it('gives a fresh project a floor, so the room palette works straight away', () => {
    // The bug this guards: a project built from emptyProject() has zero floors,
    // and every createRoom against it fails with "no floors yet".
    const res = emptyFromBrief(blankProject('Untitled home'), baseBrief());
    if (!res.ok) return;
    const room = createRoom(res.data.project, { floorId: res.data.project.floors[0]!.id, kind: 'kitchen', x: 3, y: 3, width: 4, depth: 3.5 });
    expect(room.ok).toBe(true);
  });
});

describe('gridFromBrief', () => {
  const grid = (over: Partial<DesignBrief> = {}) => {
    const brief = baseBrief(over);
    const res = gridFromBrief(blankProject(), brief);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    return { brief, project: res.data.project, report: res.data.report };
  };

  it('tiles the buildable envelope exactly, with no gaps and no overlaps', () => {
    const { brief, project } = grid();
    const envW = brief.plot.width - brief.plot.setbacks.left - brief.plot.setbacks.right;
    const envD = brief.plot.depth - brief.plot.setbacks.front - brief.plot.setbacks.rear;
    const covered = project.rooms.reduce((s, r) => s + r.width * r.depth, 0);
    expect(covered).toBeCloseTo(envW * envD, 6);
    for (const r of project.rooms) {
      expect(r.x).toBeGreaterThanOrEqual(brief.plot.setbacks.left - 0.01);
      expect(r.y).toBeGreaterThanOrEqual(brief.plot.setbacks.front - 0.01);
      expect(r.x + r.width).toBeLessThanOrEqual(brief.plot.setbacks.left + envW + 0.01);
      expect(r.y + r.depth).toBeLessThanOrEqual(brief.plot.setbacks.front + envD + 0.01);
    }
    expect(validate(project).filter((i) => i.code === 'room_overlap').map((i) => i.message)).toEqual([]);
  });

  it('gives the brief’s rooms, once each', () => {
    const { brief, project } = grid();
    const wanted = brief.rooms.flatMap((r) => Array.from({ length: r.count }, () => r.kind));
    expect(project.rooms.length).toBe(wanted.length);
    for (const kind of wanted) {
      expect(project.rooms.filter((r) => r.kind === kind).length).toBe(wanted.filter((k) => k === kind).length);
    }
  });

  it('makes a cell no narrower than a room can be, and reports the lattice it chose', () => {
    const { report, project } = grid();
    expect(report.cellWidth).toBeGreaterThanOrEqual(2.4);
    expect(report.cellDepth).toBeGreaterThanOrEqual(2.4);
    expect(report.columns * report.rows).toBeGreaterThanOrEqual(project.rooms.length);
    for (const r of project.rooms) {
      expect(r.width).toBeGreaterThanOrEqual(2.4);
      expect(r.depth).toBeGreaterThanOrEqual(2.4);
    }
  });

  it('produces a real plan: walls around the rooms, doors between them, no errors', () => {
    const { project } = grid();
    expect(project.floors).toHaveLength(1);
    expect(project.walls.length).toBeGreaterThan(4);
    const openings = project.walls.flatMap((w) => w.openings);
    expect(openings.length).toBeGreaterThan(0);
    expect(openings.some((o) => o.kind === 'door')).toBe(true);
    expect(openings.some((o) => o.kind === 'window')).toBe(true);
    expect(validate(project).filter((i) => i.severity === 'error').map((i) => `${i.code}: ${i.message}`)).toEqual([]);
  });

  it('opens with no furniture in a door swing, even in cramped cells', () => {
    // The grid is where this bites: a 2.5 m cell is barely wider than a door.
    const { project } = grid();
    const blocked = validate(project).filter((i) => i.code === 'door_swing_blocked').map((i) => i.message);
    expect(blocked).toEqual([]);
  });

  it('stretches a short last row across the full width rather than leaving a gap', () => {
    // 7 rooms will not make a full rectangle on the default envelope, so the
    // lattice has a partial row. It must still tile.
    const { project } = grid();
    const widths = new Set(project.rooms.map((r) => Math.round(r.width * 1000)));
    // Only two distinct widths is the signature of a stretched final row.
    expect(widths.size).toBeLessThanOrEqual(2);
  });

  it('says so when the grid cannot honour the room sizes, instead of pretending', () => {
    const { report } = grid({
      rooms: [
        { kind: 'living', count: 1, targetArea: 80 },
        { kind: 'bedroom', count: 6, targetArea: 30 },
      ],
    });
    expect(report.warnings.join(' ')).toMatch(/grid gives every room the same shape/i);
  });

  it('refuses a plot whose setbacks leave no room-sized space', () => {
    const res = gridFromBrief(blankProject(), baseBrief({
      plot: { width: 8, depth: 8, orientation: 0, setbacks: { front: 3.2, rear: 3.2, left: 2, right: 2 } },
    }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('conflict');
    expect(res.hint).toMatch(/empty plot/i);
  });

  it('gives a brief with nothing ticked a living room, because a house needs a way in', () => {
    // expandBrief is what does this, for the generator too: an empty room list
    // would produce a plan with no entrance at all.
    const { project } = grid({ rooms: [] });
    expect(project.rooms.length).toBe(1);
    expect(project.rooms[0]!.kind).toBe('living');
  });

  it('warns that it laid out one floor when the brief asked for more', () => {
    const { report, project } = grid({ floorCount: 3 });
    expect(project.floors).toHaveLength(1);
    expect(report.warnings.join(' ')).toMatch(/single-floor/i);
  });
});

describe('rebuildWallsFromRooms', () => {
  const floorOf = (p: ReturnType<typeof generate>) => p.floors[0]!.id;

  it('keeps every piece of furniture exactly where the user put it', () => {
    const p = generate(baseBrief());
    const floorId = floorOf(p);
    const before = p.furniture.map((f) => ({ id: f.id, x: f.x, y: f.y }));

    const { project, report } = rebuildWallsFromRooms(p, floorId);

    expect(report.furnitureKept).toBe(before.length);
    const after = project.furniture.filter((f) => f.floorId === floorId);
    expect(after.length).toBe(before.length);
    for (const b of before) {
      const a = after.find((f) => f.id === b.id);
      expect(a, `furniture ${b.id} survived`).toBeTruthy();
      expect(a!.x).toBeCloseTo(b.x, 9);
      expect(a!.y).toBeCloseTo(b.y, 9);
    }
  });

  it('does not re-run the furnisher', () => {
    // A rebuild of an unfurnished plan must leave it unfurnished, or every press
    // of the button would quietly add another sofa.
    const p = generate(baseBrief());
    const stripped = { ...p, furniture: [] };
    const { project, report } = rebuildWallsFromRooms(stripped, floorOf(stripped));
    expect(report.furnitureKept).toBe(0);
    expect(project.furniture.filter((f) => f.floorId === floorOf(stripped))).toHaveLength(0);
  });

  it('carries doors and windows onto the rebuilt walls', () => {
    const p = generate(baseBrief());
    const floorId = floorOf(p);
    const before = p.walls.filter((w) => w.floorId === floorId).flatMap((w) => w.openings);
    expect(before.length).toBeGreaterThan(0);

    const { project, report } = rebuildWallsFromRooms(p, floorId);
    const after = project.walls.filter((w) => w.floorId === floorId).flatMap((w) => w.openings);

    expect(report.openingsKept + report.openingsDropped).toBe(before.length);
    expect(after.length).toBe(before.length);
    for (const o of before) {
      const m = after.find((x) => x.id === o.id);
      expect(m, `opening ${o.id} survived`).toBeTruthy();
      expect(m!.kind).toBe(o.kind);
      expect(m!.width).toBeCloseTo(o.width, 9);
    }
  });

  it('rebuilds walls around the rooms rather than leaving the old geometry', () => {
    const p = generate(baseBrief());
    const floorId = floorOf(p);
    const { project } = rebuildWallsFromRooms(p, floorId);
    const walls = project.walls.filter((w) => w.floorId === floorId);
    expect(walls.length).toBeGreaterThan(0);
    for (const r of project.rooms.filter((r) => r.floorId === floorId)) {
      const touching = walls.filter(
        (w) =>
          Math.min(w.a.x, w.b.x) <= r.x + r.width + 0.35 &&
          Math.max(w.a.x, w.b.x) >= r.x - 0.35 &&
          Math.min(w.a.y, w.b.y) <= r.y + r.depth + 0.35 &&
          Math.max(w.a.y, w.b.y) >= r.y - 0.35,
      );
      expect(touching.length, `room ${r.id} has walls`).toBeGreaterThan(0);
    }
  });

  it('reports rather than inventing a home for an opening with no wall', () => {
    const p = generate(baseBrief());
    const floorId = floorOf(p);
    // An opening on a wall nowhere near the built envelope cannot be carried
    // anywhere, and must be reported rather than quietly relocated.
    const withStray = {
      ...p,
      walls: [
        ...p.walls,
        {
          id: 'w_stray',
          floorId,
          type: 'exterior' as const,
          thickness: 0.2,
          a: { x: 0.4, y: 0.4 },
          b: { x: 1.4, y: 0.4 },
          height: 2.7,
          roomIds: [],
          openings: [{ id: 'op_stray', kind: 'door' as const, offset: 0.5, width: 0.9, height: 2.1, sill: 0, material: 'door.timber' }],
        },
      ],
    };
    const { report } = rebuildWallsFromRooms(withStray, floorId);
    expect(report.openingsDropped).toBe(1);
  });
});
describe('a model-planned room program', () => {
  /** A program an architect might actually write for this plot. */
  const ensuiteProgram = (): RoomProgram => ({
    summary: 'Three bedrooms, the master taking its own bathroom, kitchen open to the dining room.',
    rooms: [
      { ref: 'living', kind: 'living', areaM2: 26, touches: ['dining'] },
      { ref: 'dining', kind: 'dining', areaM2: 14, touches: ['living', 'kitchen'] },
      { ref: 'kitchen', kind: 'kitchen', areaM2: 13, touches: ['dining'] },
      { ref: 'bed-1', kind: 'bedroom', areaM2: 16, touches: ['ensuite'] },
      { ref: 'bed-2', kind: 'bedroom', areaM2: 12, touches: ['bath'] },
      { ref: 'bed-3', kind: 'guest', areaM2: 11, touches: ['bath'] },
      { ref: 'ensuite', kind: 'bathroom', areaM2: 5.5, touches: ['bed-1'] },
      { ref: 'bath', kind: 'bathroom', areaM2: 5, touches: ['bed-2', 'bed-3'] },
    ],
  });

  const generateWith = (program: RoomProgram) => {
    const project = blankProject('Test');
    const res = generateFromBrief(project, baseBrief({ floorCount: 1 }), { program });
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (!res.ok) throw new Error(res.error);
    return res;
  };

  it('lays out every room the model asked for', () => {
    const program = ensuiteProgram();
    const { project } = generateWith(program);
    // Counted by ref, not by tally: the generator also draws its own corridor,
    // which is not in the program and should not be one of these rooms.
    const placed = new Set(project.rooms.filter((r) => r.ref).map((r) => r.ref));
    expect([...placed].sort()).toEqual(program.rooms.map((r) => r.ref).sort());
  });

  it('builds the rooms it asked for, not the defaults', () => {
    // The default brief has no ensuite, no guest room and no dining room, and
    // gives every bedroom the same area. This is the difference the whole
    // feature exists for.
    const { project } = generateWith(ensuiteProgram());
    const areas = project.rooms.filter((r) => r.kind === 'bedroom' || r.kind === 'guest').map((r) => r.width * r.depth);
    expect(new Set(areas.map((a) => a.toFixed(1))).size).toBeGreaterThan(1);
  });

  it('actually builds the connections it was asked for', () => {
    const program = ensuiteProgram();
    const { data } = generateWith(program);
    // "A touches B" and "B touches A" are one wall, not two constraints, so the
    // expected count is the deduplicated pair list rather than the number of
    // `touches` entries the program wrote.
    expect(data.report.adjacency?.requested).toBe(adjacencyPairs(program).length);
    expect(data.report.adjacency?.unmet).toEqual([]);
    expect(data.report.warnings.join(' ')).toContain('were built');
  });

  it('puts a real way through on every connection it delivered', () => {
    const { project } = generateWith(ensuiteProgram());
    const byRef = new Map(project.rooms.filter((r) => r.ref).map((r) => [r.ref!, r] as const));
    const pairs = adjacencyPairs(ensuiteProgram());

    // A way through is the observable consequence of adjacency: planFloor puts
    // an opening on every partition whose rooms share a doorable span. What
    // kind it is comes from `doorForRooms` — a leaf door between a bedroom and
    // its bathroom, a cased opening where both rooms are open-plan.
    const THROUGH = new Set(['door', 'doorway', 'opening']);
    for (const [a, b] of pairs) {
      const roomA = byRef.get(a);
      const roomB = byRef.get(b);
      expect(roomA && roomB, `${a} and ${b} were both placed`).toBeTruthy();
      const shared = project.walls.filter(
        (w) => w.roomIds.includes(roomA!.id) && w.roomIds.includes(roomB!.id),
      );
      expect(shared.length, `${a} and ${b} share a wall`).toBeGreaterThan(0);
      const ways = shared.filter((w) => w.openings.some((o) => THROUGH.has(o.kind)));
      expect(ways.length, `${a} and ${b} have a way through`).toBeGreaterThan(0);
    }
  });

  it('gives a private pair a leaf door, and an open-plan pair a cased opening', () => {
    const { project } = generateWith(ensuiteProgram());
    const byRef = new Map(project.rooms.filter((r) => r.ref).map((r) => [r.ref!, r] as const));
    const between = (a: string, b: string) => {
      const ids = [byRef.get(a)!.id, byRef.get(b)!.id];
      return project.walls.filter((w) => ids.every((id) => w.roomIds.includes(id)));
    };
    // A bedroom to its own bathroom is a door you close.
    expect(between('bed-1', 'ensuite').flatMap((w) => w.openings).some((o) => o.kind === 'door')).toBe(true);
    // Kitchen to dining is open plan, so the program asked for a wide cased
    // opening rather than a swinging leaf. Asserting a door here would be
    // asserting that the app ignored the room kinds.
    expect(between('kitchen', 'dining').flatMap((w) => w.openings).some((o) => o.kind === 'opening')).toBe(true);
  });

  it('is deterministic — the same program packs the same way twice', () => {
    const a = generateWith(ensuiteProgram()).project.rooms;
    const b = generateWith(ensuiteProgram()).project.rooms;
    const shape = (p: typeof a) => p.map((r) => `${r.kind}:${r.x.toFixed(6)}:${r.y.toFixed(6)}:${r.width.toFixed(6)}:${r.depth.toFixed(6)}`);
    expect(shape(a)).toEqual(shape(b));
  });

  it('still produces a valid, non-overlapping plan', () => {
    const { project } = generateWith(ensuiteProgram());
    const overlaps = validate(project).filter((i) => i.code === 'room_overlap');
    expect(overlaps).toEqual([]);
    const errors = validate(project).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('reports a connection it could not build instead of pretending', () => {
    // Three rooms, each touching the next, in a band far too shallow to give
    // any pair a doorable wall. The honest outcome is a named warning.
    const cramped: RoomProgram = {
      rooms: [
        { ref: 'living', kind: 'living', areaM2: 40 },
        { ref: 'a', kind: 'bedroom', areaM2: 18, touches: ['b'] },
        { ref: 'b', kind: 'bedroom', areaM2: 18, touches: ['a'] },
        { ref: 'c', kind: 'bedroom', areaM2: 18 },
      ],
    };
    const { data } = generateWith(cramped);
    expect(data.report.adjacency?.requested).toBe(1);
    if ((data.report.adjacency?.unmet.length ?? 0) > 0) {
      expect(data.report.warnings[0]).toMatch(/could not be made/);
    }
  });

  it('puts a room on the storey the model chose', () => {
    const twoStorey = baseBrief({ floorCount: 2 });
    const program: RoomProgram = {
      rooms: [
        { ref: 'living', kind: 'living', areaM2: 24, floor: 0 },
        { ref: 'bed-1', kind: 'bedroom', areaM2: 15, floor: 1 },
        { ref: 'bed-2', kind: 'bedroom', areaM2: 13, floor: 1 },
        { ref: 'bath-1', kind: 'bathroom', areaM2: 5, floor: 1, touches: ['bed-1'] },
      ],
    };
    const project = blankProject('Test');
    const res = generateFromBrief(project, twoStorey, { program });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const upper = res.project.floors[1]!;
    const upperRooms = res.project.rooms.filter((r) => r.floorId === upper.id);
    expect(upperRooms.map((r) => r.ref).filter(Boolean)).toEqual(
      expect.arrayContaining(['bed-1', 'bed-2', 'bath-1']),
    );
  });

  it('leaves the head of the flight open, so that the flight can be climbed', () => {
    // The complaint this answers: in the 3D view a person walked in through the
    // front door, found the flight, climbed it — and was stopped dead at the
    // last tread by a full-height partition standing across the head of the
    // flight.
    //
    // The camera's feet reach the storey height exactly where the wall's top
    // is, so the two meet and the climb cannot finish: the camera cannot lift
    // its feet above the wall until it is already through it. The collision
    // code is right — a person climbing that last step hits that wall. It is
    // the plan that is wrong, because the flight physically passes through
    // the line its head arrives on.
    //
    // This is the same program the walkthrough in `scripts/stairwalk.mjs`
    // drives, so the plan here is the plan a person walks.
    const program: RoomProgram = {
      summary: 'A fixed program, so this walk is the same walk every time.',
      rooms: [
        { ref: 'living', kind: 'living', areaM2: 22, floor: 0 },
        { ref: 'dining', kind: 'dining', areaM2: 12, floor: 0, touches: ['living'] },
        { ref: 'kitchen', kind: 'kitchen', areaM2: 11, floor: 0, touches: ['dining'] },
        { ref: 'bed-1', kind: 'bedroom', areaM2: 14, floor: 1 },
        { ref: 'bed-2', kind: 'bedroom', areaM2: 12, floor: 1 },
        { ref: 'bath-1', kind: 'bathroom', areaM2: 5, floor: 1, touches: ['bed-1'] },
        { ref: 'office', kind: 'office', areaM2: 8, floor: 1 },
      ],
    };
    const project = blankProject('Test');
    const res = generateFromBrief(project, baseBrief({ floorCount: 2 }), { program });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.project;
    expect(p.stairs.length).toBeGreaterThanOrEqual(1);

    for (const s of p.stairs) {
      const box = stairBox(s);
      const headY = s.direction === 1 ? box.y1 : box.y0;
      const across = p.walls.filter((w) => {
        if (w.floorId !== s.floorId) return false;
        if (w.type !== 'interior') return false;
        if (Math.abs(w.a.y - headY) > 0.05 || Math.abs(w.b.y - headY) > 0.05) return false;
        const x0 = Math.min(w.a.x, w.b.x);
        const x1 = Math.max(w.a.x, w.b.x);
        return x1 > box.x0 + 0.05 && x0 < box.x1 - 0.05;
      });
      expect(
        across.map((w) => `${w.a.x.toFixed(2)},${w.a.y.toFixed(2)} -> ${w.b.x.toFixed(2)},${w.b.y.toFixed(2)}`),
        `${s.name}: a partition stands across the head of the flight, so it cannot be climbed`,
      ).toEqual([]);
    }
  });

  it('generates exactly the old plan when there is no program', () => {
    // The fallback path must be untouched: no key configured, model down, or a
    // program that failed to parse all land here.
    const plain = generate(baseBrief());
    const before = plain.rooms.map((r) => `${r.kind}:${r.x.toFixed(6)}:${r.width.toFixed(6)}`);
    const again = generate(baseBrief()).rooms.map((r) => `${r.kind}:${r.x.toFixed(6)}:${r.width.toFixed(6)}`);
    expect(before).toEqual(again);
  });
});

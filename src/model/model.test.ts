/**
 * The model, tested.
 *
 * These tests are about the two promises the app makes: the same brief always
 * draws the same plan, and every finding is computed from the plan rather
 * than asserted by anything.
 */

import { describe, expect, it } from 'vitest';
import { countIn, has, MINIMUM_AREA, programFromBrief } from './program';
import { envelopeFor, generatePlan, indoorArea, SETBACK } from './generator';
import { applyCorrection, checkPlan, doorZone, reachableRooms } from './checks';
import { overlapArea, sharedEdge, subtract } from './geometry';
import type { Brief, BriefRoom, Door, Furniture, Plan } from './types';

function brief(overrides: Partial<Brief> & { rooms?: BriefRoom[] }): Brief {
  const base: Brief = {
    text: 'A three-bedroom family house with a living room, kitchen and dining room on the ground floor, and bedrooms and a bathroom upstairs.',
    plotWidth: 18,
    plotDepth: 14,
    storeys: 2,
    rooms: [],
  };
  return { ...base, ...overrides, rooms: overrides.rooms ?? base.rooms };
}

function roomsOf(text: string, storeys = 2, plotWidth = 18, plotDepth = 14): BriefRoom[] {
  return programFromBrief({ text, plotWidth, plotDepth, storeys, rooms: [] });
}

/** A hand-built plan, so the checker can be tested without the generator. */
function handPlan(overrides: Partial<Plan> = {}): Plan {
  const base: Plan = {
    brief: brief({
      storeys: 1,
      rooms: [
        { id: 'living-room', label: 'Living room', kind: 'living', area: 30, floor: 0 },
        { id: 'bedroom-1', label: 'Bedroom 1', kind: 'bedroom', area: 30, floor: 0 },
      ],
    }),
    rooms: [
      {
        id: 'living-room',
        label: 'Living room',
        kind: 'living',
        floor: 0,
        requestedArea: 30,
        x: 0,
        y: 0,
        width: 6,
        depth: 5,
      },
      {
        id: 'bedroom-1',
        label: 'Bedroom 1',
        kind: 'bedroom',
        floor: 0,
        requestedArea: 30,
        x: 6,
        y: 0,
        width: 6,
        depth: 5,
      },
    ],
    doors: [
      {
        id: 'd1',
        floor: 0,
        kind: 'door',
        x: 6,
        y: 2.5,
        width: 0.9,
        axis: 'vertical',
        swing: 1,
        joins: ['living-room', 'bedroom-1'],
      },
      {
        id: 'd2',
        floor: 0,
        kind: 'front',
        x: 3,
        y: 5,
        width: 0.9,
        axis: 'horizontal',
        swing: 1,
        joins: ['living-room', null],
      },
    ],
    stairs: [],
    furniture: [],
  };
  return { ...base, ...overrides };
}

function codes(plan: Plan): string[] {
  return checkPlan(plan).issues.map((issue) => issue.code);
}

describe('the brief', () => {
  it('reads a count out of the words', () => {
    expect(countIn('a three-bedroom house', 'bed')).toBe(3);
    expect(countIn('a 4 bed house', 'bed')).toBe(4);
    expect(countIn('two storeys', 'storey')).toBe(2);
    expect(countIn('a bungalow', 'bed')).toBeNull();
  });

  it('finds a phrase whatever its case', () => {
    expect(has('an OPEN PLAN ground floor', 'open plan')).toBe(true);
    expect(has('a separate dining room', 'open plan')).toBe(false);
  });

  it('builds the program the brief describes', () => {
    const rooms = roomsOf('a three-bedroom house over two floors');
    expect(rooms.filter((r) => r.kind === 'bedroom')).toHaveLength(3);
    expect(rooms.filter((r) => r.kind === 'bathroom')).toHaveLength(2);
    expect(rooms.filter((r) => r.kind === 'hall')).toHaveLength(1);
    expect(rooms.every((r) => r.area >= MINIMUM_AREA[r.kind])).toBe(true);
  });

  it('folds the dining room into the living room when the brief is open plan', () => {
    const rooms = roomsOf('an open plan two-bedroom house');
    expect(rooms.some((r) => r.kind === 'dining')).toBe(false);
    expect(rooms.find((r) => r.kind === 'living')?.area).toBe(30);
  });

  it('puts the bedrooms upstairs and the living room downstairs', () => {
    const rooms = roomsOf('a three-bedroom house on two floors');
    expect(rooms.find((r) => r.kind === 'living')?.floor).toBe(0);
    expect(rooms.filter((r) => r.kind === 'bedroom').every((r) => r.floor === 1)).toBe(true);
  });

  it('gives every room a stable id, so the same brief always means the same room', () => {
    const first = roomsOf('a two-bedroom house');
    const second = roomsOf('a two-bedroom house');
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
    expect(new Set(first.map((r) => r.id)).size).toBe(first.length);
  });
});

describe('the generator', () => {
  it('draws the same plan twice from the same brief', () => {
    const rooms = roomsOf('a three-bedroom house on two floors');
    const first = generatePlan(brief({ rooms }));
    const second = generatePlan(brief({ rooms }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(first.plan)).toBe(JSON.stringify(second.plan));
  });

  it('keeps every room inside the plot', () => {
    const rooms = roomsOf('a three-bedroom house on two floors');
    const result = generatePlan(brief({ rooms }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const room of result.plan.rooms) {
      expect(room.x).toBeGreaterThanOrEqual(-0.001);
      expect(room.y).toBeGreaterThanOrEqual(-0.001);
      expect(room.x + room.width).toBeLessThanOrEqual(18.001);
      expect(room.y + room.depth).toBeLessThanOrEqual(14.001);
    }
  });

  it('gives every storey the same footprint', () => {
    const rooms = roomsOf('a three-bedroom house on two floors');
    const result = generatePlan(brief({ rooms }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // One envelope holds every room on every storey, so the building stands
    // on the same footprint on the ground floor as it does upstairs.
    const usable = { x: SETBACK, y: SETBACK, width: 18 - 2 * SETBACK, depth: 14 - 2 * SETBACK };
    const need = Math.max(
      ...[0, 1].map((floor) =>
        rooms.filter((r) => r.floor === floor).reduce((sum, r) => sum + r.area, 0),
      ),
    );
    const envelope = envelopeFor(usable, need);

    for (const room of result.plan.rooms) {
      expect(room.x).toBeGreaterThanOrEqual(envelope.x - 0.05);
      expect(room.y).toBeGreaterThanOrEqual(envelope.y - 0.05);
      expect(room.x + room.width).toBeLessThanOrEqual(envelope.x + envelope.width + 0.05);
      expect(room.y + room.depth).toBeLessThanOrEqual(envelope.y + envelope.depth + 0.05);
    }
  });

  it('keeps the footprint inside the plot and centred in the usable ground', () => {
    const usable = { x: SETBACK, y: SETBACK, width: 15, depth: 11 };
    const envelope = envelopeFor(usable, 50);
    expect(envelope.width * envelope.depth).toBeCloseTo(50, 5);
    expect(envelope.width).toBeLessThanOrEqual(usable.width);
    expect(envelope.depth).toBeLessThanOrEqual(usable.depth);
    expect(envelope.x + envelope.width / 2).toBeCloseTo(usable.x + usable.width / 2, 5);
  });

  it('refuses a program that does not fit the plot, and says by how much', () => {
    const rooms: BriefRoom[] = [
      { id: 'living-room', label: 'Living room', kind: 'living', area: 400, floor: 0 },
    ];
    const result = generatePlan(brief({ rooms, plotWidth: 10, plotDepth: 10 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.shortfall).toBeGreaterThan(0);
    expect(result.refusal.reason).toMatch(/does not fit|too small/i);
    expect(result.refusal.detail).toMatch(/m²/);
  });

  it('refuses a plot too small to build on', () => {
    const result = generatePlan(brief({ plotWidth: 3, plotDepth: 3, rooms: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.reason).toMatch(/too small/i);
  });

  it('never produces a room with a negative side', () => {
    const rooms = roomsOf('a four-bedroom house on two floors');
    const result = generatePlan(brief({ rooms, plotWidth: 16, plotDepth: 13 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const room of result.plan.rooms) {
      expect(room.width).toBeGreaterThan(0);
      expect(room.depth).toBeGreaterThan(0);
    }
  });
});

describe('the checker', () => {
  it('finds nothing wrong with a sound plan', () => {
    const summary = checkPlan(handPlan());
    expect(summary.errors).toBe(0);
    expect(summary.reachable).toBe(2);
  });

  it('says when there is no front door', () => {
    const plan = handPlan({ doors: [plan0Door()] });
    expect(codes(plan)).toContain('no-front-door');
  });

  it('says when a room has no door', () => {
    const plan = handPlan({ doors: [frontDoorOf()] });
    expect(codes(plan)).toContain('room-without-door');
  });

  it('says when a room cannot be walked to', () => {
    const plan = handPlan({ doors: [frontDoorOf()] });
    expect(codes(plan)).toContain('room-unreachable');
  });

  it('says when two rooms stand on top of each other', () => {
    const plan = handPlan({
      rooms: [
        { ...handPlan().rooms[0] },
        { ...handPlan().rooms[1], x: 5, width: 6 },
      ],
    });
    expect(codes(plan)).toContain('rooms-overlap');
  });

  it('says when a room reaches off the plot', () => {
    const plan = handPlan({
      rooms: [{ ...handPlan().rooms[1], x: 14, width: 6 }],
    });
    expect(codes(plan)).toContain('room-outside-plot');
  });

  it('says when a room is smaller than the brief asked for', () => {
    const plan = handPlan({
      rooms: [{ ...handPlan().rooms[1], width: 5 }],
    });
    const issue = checkPlan(plan).issues.find((i) => i.code === 'room-below-brief');
    expect(issue?.severity).toBe('note');
    expect(issue?.detail).toMatch(/m²/);
  });

  it('says when there is no stair to the upper floor', () => {
    const plan = handPlan({ brief: brief({ storeys: 2 }) });
    expect(codes(plan)).toContain('no-stairs-for-two-storeys');
  });

  it('says when the staircase is walled off', () => {
    const plan = handPlan({
      brief: brief({ storeys: 2 }),
      stairs: [
        { id: 's1', floor: 0, toFloor: 1, x: 6, y: 0, width: 1.1, run: 3, direction: -1, risers: 17 },
      ],
    });
    expect(codes(plan)).toContain('stair-without-door');
  });

  it('names the room and quantifies the problem in every finding', () => {
    const plan = handPlan({ doors: [frontDoorOf()] });
    for (const issue of checkPlan(plan).issues) {
      expect(issue.title.length).toBeGreaterThan(4);
      expect(issue.detail.length).toBeGreaterThan(10);
    }
  });

  it('counts a room that cannot be walked to as unreachable', () => {
    const plan = handPlan({ doors: [frontDoorOf()] });
    const summary = checkPlan(plan);
    expect(summary.reachable).toBe(1);
    expect(summary.total).toBe(2);
  });

  it('walks from the front door through the doors', () => {
    const plan = handPlan();
    expect([...reachableRooms(plan)].sort()).toEqual(['bedroom-1', 'living-room']);
  });
});

describe('the furniture in the doorway', () => {
  const sofa: Furniture = {
    id: 'f1',
    label: 'Sofa',
    roomId: 'living-room',
    floor: 0,
    x: 4.6,
    y: 2.05,
    width: 1.4,
    depth: 0.9,
  };

  function withSofa(): Plan {
    return handPlan({ furniture: [sofa] });
  }

  it('is reported when a piece stands in the floor in front of a door', () => {
    expect(codes(withSofa())).toContain('furniture-in-doorway');
  });

  it('is not reported when the piece is clear of the doorway', () => {
    const plan = handPlan({ furniture: [{ ...sofa, x: 2.0 }] });
    expect(codes(plan)).not.toContain('furniture-in-doorway');
  });

  it('is measured on the room side of the wall', () => {
    const plan = handPlan();
    const door = plan.doors[0];
    const zone = doorZone(door, plan);
    expect(zone).not.toBeNull();
    // The living room is west of the wall at x = 6, so the floor in front of
    // the door is west of it.
    expect(zone!.x + zone!.width).toBeLessThanOrEqual(6.001);
  });

  it('offers a repair, and the repair clears the doorway', () => {
    const plan = withSofa();
    const issue = checkPlan(plan).issues.find((i) => i.code === 'furniture-in-doorway');
    expect(issue?.correction?.kind).toBe('move-furniture');
    const repaired = applyCorrection(plan, issue!.correction!);
    expect(codes(repaired)).not.toContain('furniture-in-doorway');
  });

  it('keeps the piece inside its room when it moves it', () => {
    const plan = withSofa();
    const issue = checkPlan(plan).issues.find((i) => i.code === 'furniture-in-doorway');
    const repaired = applyCorrection(plan, issue!.correction!);
    const moved = repaired.furniture[0];
    const room = repaired.rooms.find((r) => r.id === 'living-room')!;
    expect(moved.x).toBeGreaterThanOrEqual(room.x - 0.001);
    expect(moved.x + moved.width).toBeLessThanOrEqual(room.x + room.width + 0.001);
  });
});

describe('the room that stands on another', () => {
  it('offers a repair, and the repair removes the overlap', () => {
    const plan = handPlan({
      rooms: [handPlan().rooms[0], { ...handPlan().rooms[1], x: 5, width: 6 }],
    });
    const issue = checkPlan(plan).issues.find((i) => i.code === 'rooms-overlap');
    expect(issue?.correction?.kind).toBe('shrink-room');
    const repaired = applyCorrection(plan, issue!.correction!);
    const a = repaired.rooms[0];
    const b = repaired.rooms[1];
    expect(overlapArea(a, b)).toBeLessThanOrEqual(0.05);
  });
});

describe('the arithmetic', () => {
  it('finds the wall two rooms share', () => {
    const a = { x: 0, y: 0, width: 4, depth: 4 };
    const b = { x: 4, y: 1, width: 3, depth: 3 };
    const edge = sharedEdge(a, b);
    expect(edge?.axis).toBe('vertical');
    expect(edge?.at).toBe(4);
    expect(edge?.length).toBeCloseTo(3, 5);
  });

  it('says two rooms that only touch at a corner share nothing', () => {
    const a = { x: 0, y: 0, width: 4, depth: 4 };
    const b = { x: 4, y: 4, width: 3, depth: 3 };
    expect(sharedEdge(a, b)).toBeNull();
  });

  it('never cuts a room down past nothing', () => {
    const room = { x: 0, y: 0, width: 2, depth: 2 };
    const cut = { x: 0, y: 0, width: 2, depth: 5 };
    const result = subtract(room, cut);
    expect(result.width).toBeGreaterThanOrEqual(0);
    expect(result.depth).toBeGreaterThanOrEqual(0);
  });

  it('measures the floor area of a plan', () => {
    const result = generatePlan(brief({ rooms: roomsOf('a two-bedroom house') }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(indoorArea(result.plan)).toBeGreaterThan(0);
  });

  it('keeps the building inside the setback', () => {
    const result = generatePlan(brief({ rooms: roomsOf('a two-bedroom house') }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const room of result.plan.rooms) {
      expect(room.x).toBeGreaterThanOrEqual(SETBACK - 0.05);
      expect(room.y).toBeGreaterThanOrEqual(SETBACK - 0.05);
    }
  });
});

function plan0Door(): Door {
  return {
    id: 'd1',
    floor: 0,
    kind: 'door',
    x: 6,
    y: 2.5,
    width: 0.9,
    axis: 'vertical',
    swing: 1,
    joins: ['living-room', 'bedroom-1'],
  };
}

function frontDoorOf(): Door {
  return {
    id: 'd2',
    floor: 0,
    kind: 'front',
    x: 3,
    y: 5,
    width: 0.9,
    axis: 'horizontal',
    swing: 1,
    joins: ['living-room', null],
  };
}

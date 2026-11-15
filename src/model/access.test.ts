/**
 * The regression guard for the door that was promised and never built.
 *
 * A room used to be able to claim a partition too short to hold a door. The
 * planner credited it with a door, the placement step dropped it for want of
 * room, and the room was left with no way in — while the planner believed it
 * had one. The plan said "Pantry", the checker said the pantry has no door,
 * and the app was the only one of the three telling the truth.
 *
 * Two things have to hold for every room on every planned floor:
 *
 *   1. it has a door on one of its walls, and
 *   2. it is wide enough to stand in.
 *
 * The second one is here because the first one used to fail for a silly
 * reason: the packer cut the pantry into a 0.66 m strip, and no door fits in
 * a strip. A room that cannot be made bigger is still a room; a room that is
 * 0.66 m wide is not.
 */
import { describe, expect, it } from 'vitest';
import { blankProject } from './ops.ts';
import { generateFromBrief } from './layout.ts';
import { validate } from './validate.ts';
import type { ProgramRoom, RoomProgram } from './program.ts';
import type { DesignBrief, Project } from './types.ts';

/** The narrowest a room may be, in metres, along either side. */
const MIN_ROOM_SIDE = 1.2;

const BRIEF: DesignBrief = {
  plot: { width: 18, depth: 20, orientation: 0, setbacks: { front: 4.5, rear: 4.5, left: 3, right: 3 } },
  floorCount: 2,
  rooms: [
    { kind: 'living', count: 1 },
    { kind: 'dining', count: 1 },
    { kind: 'kitchen', count: 1 },
    { kind: 'bedroom', count: 3 },
    { kind: 'bathroom', count: 2 },
  ],
  preferredAreas: {},
  style: 'modern',
  preferences: { accessibility: false, ventilation: false, privacy: false, daylight: true },
};

/**
 * The program that produced the shipped failure, verbatim.
 *
 * It came out of a search over real-shaped programs, and this one made the
 * pantry 0.66 m wide against a 3.96 m utility wall — a ribbon with no door.
 * It is kept exactly as the model returned it, because a regression test that
 * uses a tidied-up program no longer reproduces anything.
 */
const FAILING: ProgramRoom[] = [
  { ref: 'r0', kind: 'utility', areaM2: 22.4 },
  { ref: 'r1', kind: 'guest', areaM2: 22.6, floor: 1 },
  { ref: 'r2', kind: 'bathroom', areaM2: 17.4, touches: ['r4', 'r8'] },
  { ref: 'r3', kind: 'guest', areaM2: 22.9, floor: 1 },
  { ref: 'r4', kind: 'pantry', areaM2: 3.8 },
  { ref: 'r5', kind: 'pantry', areaM2: 19.7 },
  { ref: 'r6', kind: 'bedroom', areaM2: 24.3, touches: ['r9'] },
  { ref: 'r7', kind: 'dining', areaM2: 20.9, touches: ['r9'] },
  { ref: 'r8', kind: 'utility', areaM2: 22.7, touches: ['r9'] },
  { ref: 'r9', kind: 'office', areaM2: 13.7, floor: 1 },
];

/** A program the model returned for the same brief, with its own rooms. */
const MODEL: ProgramRoom[] = [
  { ref: 'living', kind: 'living', areaM2: 30, floor: 0, touches: ['dining', 'hall', 'terrace'] },
  { ref: 'dining', kind: 'dining', areaM2: 16, floor: 0, touches: ['kitchen', 'living', 'hall'] },
  { ref: 'kitchen', kind: 'kitchen', areaM2: 16, floor: 0, touches: ['dining', 'pantry', 'utility', 'hall'] },
  { ref: 'pantry', kind: 'pantry', areaM2: 4, floor: 0, touches: ['kitchen'] },
  { ref: 'utility', kind: 'utility', areaM2: 9, floor: 0, touches: ['kitchen', 'hall'] },
  { ref: 'hall', kind: 'hall', areaM2: 15, floor: 0, touches: ['living', 'dining', 'kitchen', 'office', 'utility', 'landing'] },
  { ref: 'office', kind: 'office', areaM2: 12, floor: 0, touches: ['hall'] },
  { ref: 'store-1', kind: 'storage', areaM2: 4, floor: 0, touches: ['utility'] },
  { ref: 'terrace', kind: 'terrace', areaM2: 8, floor: 0, touches: ['living'] },
  { ref: 'bed-master', kind: 'bedroom', areaM2: 18, floor: 1, touches: ['ensuite', 'landing'] },
  { ref: 'bed-2', kind: 'bedroom', areaM2: 16, floor: 1, touches: ['landing', 'bath-shared'] },
  { ref: 'bed-3', kind: 'bedroom', areaM2: 14, floor: 1, touches: ['landing', 'bath-shared'] },
  { ref: 'ensuite', kind: 'bathroom', areaM2: 6, floor: 1, touches: ['bed-master'] },
  { ref: 'bath-shared', kind: 'bathroom', areaM2: 6, floor: 1, touches: ['bed-2', 'bed-3'] },
  { ref: 'landing', kind: 'hall', areaM2: 13, floor: 1, touches: ['bed-master', 'bed-2', 'bed-3', 'laundry', 'balcony', 'hall'] },
  { ref: 'laundry', kind: 'utility', areaM2: 7, floor: 1, touches: ['landing', 'bath-shared'] },
  { ref: 'store-2', kind: 'storage', areaM2: 5, floor: 1, touches: ['landing'] },
  { ref: 'balcony', kind: 'balcony', areaM2: 9, floor: 1, touches: ['landing'] },
];

function plan(rooms: ProgramRoom[]): Project {
  const program: RoomProgram = { summary: 'test', rooms };
  const res = generateFromBrief(blankProject('T'), BRIEF, { program, floorCount: 2 });
  if (!res.ok) throw new Error(res.error);
  return res.project;
}

/**
 * Rooms with no way in.
 *
 * "A way in" is the app's own rule, not a stricter one: a door, a doorway, or
 * a cased opening all count, because an office that opens onto the hall is
 * not a room you cannot get into. The checker counts them the same way — see
 * `buildCirculation` — so this test and the panel in the app agree.
 */
function doorless(project: Project): string[] {
  const out: string[] = [];
  for (const room of project.rooms) {
    if (room.outdoor) continue;
    const walls = project.walls.filter((w) => w.roomIds.includes(room.id));
    const hasWayIn = walls.some((w) =>
      w.openings.some((o) => o.kind === 'door' || o.kind === 'doorway' || o.kind === 'opening'),
    );
    if (!hasWayIn) out.push(`${room.label} (${room.width.toFixed(2)} × ${room.depth.toFixed(2)} m)`);
  }
  return out;
}

/** Rooms too narrow to stand in. A corridor is meant to be narrow. */
function ribbons(project: Project): string[] {
  return project.rooms
    .filter((r) => !r.outdoor && r.kind !== 'corridor')
    .filter((r) => r.width < MIN_ROOM_SIDE - 0.01 || r.depth < MIN_ROOM_SIDE - 0.01)
    .map((r) => `${r.label} (${r.width.toFixed(2)} × ${r.depth.toFixed(2)} m)`);
}

describe('a planned floor', () => {
  it('gives every room a door, on the program that broke it', () => {
    expect(doorless(plan(FAILING))).toEqual([]);
  });

  it('gives every room a door, on a program the model returned', () => {
    expect(doorless(plan(MODEL))).toEqual([]);
  });

  it('reports no room without access, on the program that broke it', () => {
    const issues = validate(plan(FAILING));
    expect(issues.filter((i) => i.code === 'room_no_access')).toEqual([]);
  });

  it('reports no room without access, on a program the model returned', () => {
    const issues = validate(plan(MODEL));
    expect(issues.filter((i) => i.code === 'room_no_access')).toEqual([]);
  });

  it('cuts no room thinner than a person can stand in', () => {
    expect(ribbons(plan(FAILING))).toEqual([]);
    expect(ribbons(plan(MODEL))).toEqual([]);
  });

  it('gives the narrow pantry a door of its own', () => {
    // The room that started all this: 3.8 m² asked for, and the wall it
    // shares with the utility is the one it takes.
    const project = plan(FAILING);
    const pantry = project.rooms.find((r) => r.ref === 'r4');
    expect(pantry).toBeTruthy();
    const walls = project.walls.filter((w) => w.roomIds.includes(pantry!.id));
    expect(walls.some((w) => w.openings.some((o) => o.kind !== 'window'))).toBe(true);
  });
});

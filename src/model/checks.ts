/**
 * The checker.
 *
 * Every finding here is computed from the plan, never asserted by anything
 * else. If the drawing and the findings disagree, the drawing is wrong —
 * and the whole point of the app is that a person, or an agent, can see that
 * without having to trust anybody.
 *
 * A finding is only worth reporting if it names the thing it is about, says
 * how much is wrong, and — where one can be worked out — offers the repair.
 */

import type { Door, Furniture, Plan, Rect, Room } from './types';
import { EPS, overlapArea, sharedEdge } from './geometry';
import { DOOR_APPROACH, DOOR_WIDTH, STAIR_WIDTH } from './generator';
import { MINIMUM_AREA } from './program';

export type IssueCode =
  | 'no-front-door'
  | 'room-without-door'
  | 'room-unreachable'
  | 'rooms-overlap'
  | 'room-outside-plot'
  | 'room-too-small'
  | 'room-too-narrow'
  | 'room-not-placed'
  | 'stair-without-door'
  | 'stair-unreachable'
  | 'no-stairs-for-two-storeys'
  | 'furniture-in-doorway'
  | 'room-below-brief';

export type Severity = 'error' | 'warning' | 'note';

export type Correction =
  | { kind: 'shrink-room'; roomId: string; newX: number; newWidth: number; label: string }
  | { kind: 'move-furniture'; furnitureId: string; dx: number; dy: number; label: string };

export interface Issue {
  code: IssueCode;
  severity: Severity;
  title: string;
  detail: string;
  /** The rooms the finding is about, so the drawing can mark them. */
  rooms: string[];
  /** The furniture the finding is about. */
  furniture: string[];
  correction?: Correction;
}

export interface CheckSummary {
  issues: Issue[];
  errors: number;
  warnings: number;
  notes: number;
  /** How many rooms are reachable from the front door. */
  reachable: number;
  /** How many rooms there are. */
  total: number;
}

function roomById(plan: Plan, id: string | null): Room | undefined {
  if (!id) return undefined;
  return plan.rooms.find((r) => r.id === id);
}

/**
 * The floor a person stands on to use a door.
 *
 * A door is a hole, a leaf and the floor in front of it. The floor in front
 * of it is the part that gets blocked, so it is the part that is measured:
 * a rectangle on the room's side of the wall, one door-width wide and one
 * door-width deep.
 */
export function doorZone(door: Door, plan: Plan): Rect | null {
  const half = door.width / 2;
  const near = roomById(plan, door.joins[0]);
  const far = roomById(plan, door.joins[1]);

  if (door.axis === 'vertical') {
    if (!near) return null;
    const towardsEast = near.x + near.width / 2 >= door.x;
    return {
      x: towardsEast ? door.x : door.x - DOOR_APPROACH,
      y: door.y - half,
      width: DOOR_APPROACH,
      depth: door.width,
    };
  }

  if (!far && near) {
    // The front door: the space in front of it is the path, not the room.
    return null;
  }
  if (!far) return null;
  const towardsSouth = far.y + far.depth / 2 >= door.y;
  return {
    x: door.x - half,
    y: towardsSouth ? door.y : door.y - DOOR_APPROACH,
    width: door.width,
    depth: DOOR_APPROACH,
  };
}

/** The rooms a door joins, ignoring the ones that lead outside. */
function interiorRooms(door: Door): string[] {
  return door.joins.filter((id): id is string => id !== null);
}

/**
 * The rooms you can walk to from the front door.
 *
 * Doors are the only way between rooms, so the walk is a graph walk: from the
 * room with the front door, through every door, as far as it goes.
 */
export function reachableRooms(plan: Plan): Set<string> {
  const front = plan.doors.find((d) => d.kind === 'front');
  const start = front?.joins[0];
  const reached = new Set<string>();
  if (!start) return reached;

  const queue = [start];
  reached.add(start);
  while (queue.length > 0) {
    const here = queue.shift() as string;
    for (const door of plan.doors) {
      if (!interiorRooms(door).includes(here)) continue;
      for (const other of interiorRooms(door)) {
        if (!reached.has(other)) {
          reached.add(other);
          queue.push(other);
        }
      }
    }
  }
  return reached;
}

/** The rooms a flight of stairs touches. */
function roomsAtStair(plan: Plan, stair: { x: number; y: number; width: number; run: number; floor: number }): Room[] {
  const rect: Rect = { x: stair.x, y: stair.y, width: stair.width, depth: stair.run };
  return plan.rooms.filter(
    (r) => r.floor === stair.floor && overlapArea(r, rect) > 0.01 && sharedEdge(r, rect, 0.2) !== null,
  );
}

/**
 * Run every check against a plan.
 */
export function checkPlan(plan: Plan): CheckSummary {
  const issues: Issue[] = [];
  const rooms = plan.rooms;

  // --- the front door -------------------------------------------------
  const front = plan.doors.find((d) => d.kind === 'front');
  if (!front) {
    issues.push({
      code: 'no-front-door',
      severity: 'error',
      title: 'There is no front door',
      detail: 'Nothing on the street side of the building opens, so there is no way in from the street.',
      rooms: [],
      furniture: [],
    });
  }

  // --- rooms the brief asked for that are not on the plan --------------
  for (const wanted of plan.brief.rooms) {
    if (!rooms.some((r) => r.id === wanted.id)) {
      issues.push({
        code: 'room-not-placed',
        severity: 'error',
        title: `${wanted.label} has nowhere to go`,
        detail: `The brief asked for a ${wanted.label.toLowerCase()} of ${wanted.area.toFixed(1)} m² on storey ${wanted.floor + 1}, and the plan does not contain one.`,
        rooms: [],
        furniture: [],
      });
    }
  }

  // --- rooms with no door ---------------------------------------------
  for (const room of rooms) {
    const hasDoor = plan.doors.some((d) => d.joins.includes(room.id));
    if (!hasDoor) {
      issues.push({
        code: 'room-without-door',
        severity: 'error',
        title: `${room.label} has no door`,
        detail: `${room.label} shares no wall with a doorway, so it cannot be entered.`,
        rooms: [room.id],
        furniture: [],
      });
    }
  }

  // --- rooms you cannot walk to ---------------------------------------
  const reached = reachableRooms(plan);
  for (const room of rooms) {
    if (!reached.has(room.id)) {
      issues.push({
        code: 'room-unreachable',
        severity: 'error',
        title: `${room.label} cannot be reached`,
        detail: `Walking from the front door does not arrive at ${room.label}. The doors do not connect it to the house.`,
        rooms: [room.id],
        furniture: [],
      });
    }
  }

  // --- rooms on top of each other -------------------------------------
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (a.floor !== b.floor) continue;
      const overlap = overlapArea(a, b);
      if (overlap > 0.05) {
        issues.push({
          code: 'rooms-overlap',
          severity: 'error',
          title: `${a.label} and ${b.label} overlap`,
          detail: `${a.label} and ${b.label} share ${overlap.toFixed(2)} m² of floor.`,
          rooms: [a.id, b.id],
          furniture: [],
          correction: shrinkAway(a, b, overlap),
        });
      }
    }
  }

  // --- rooms off the plot ---------------------------------------------
  for (const room of rooms) {
    if (
      room.x < -EPS ||
      room.y < -EPS ||
      room.x + room.width > plan.brief.plotWidth + EPS ||
      room.y + room.depth > plan.brief.plotDepth + EPS
    ) {
      issues.push({
        code: 'room-outside-plot',
        severity: 'error',
        title: `${room.label} is outside the plot`,
        detail: `${room.label} reaches past the boundary of the ${plan.brief.plotWidth} × ${plan.brief.plotDepth} m plot.`,
        rooms: [room.id],
        furniture: [],
      });
    }
  }

  // --- rooms too small to be worth having ------------------------------
  for (const room of rooms) {
    const size = room.width * room.depth;
    const minimum = MINIMUM_AREA[room.kind];
    if (size < minimum * 0.6) {
      issues.push({
        code: 'room-too-small',
        severity: 'error',
        title: `${room.label} is ${size.toFixed(1)} m²`,
        detail: `A ${room.kind} needs about ${minimum} m² to be usable. This one is ${size.toFixed(1)} m².`,
        rooms: [room.id],
        furniture: [],
      });
    } else if (size < minimum) {
      issues.push({
        code: 'room-too-small',
        severity: 'warning',
        title: `${room.label} is below its minimum size`,
        detail: `A ${room.kind} needs about ${minimum} m². This one is ${size.toFixed(1)} m².`,
        rooms: [room.id],
        furniture: [],
      });
    }
    if (room.width < 1.2 || room.depth < 1.2) {
      issues.push({
        code: 'room-too-narrow',
        severity: 'warning',
        title: `${room.label} is too narrow to use`,
        detail: `${room.label} measures ${room.width.toFixed(2)} × ${room.depth.toFixed(2)} m. One side is under 1.2 m.`,
        rooms: [room.id],
        furniture: [],
      });
    }
    if (size < room.requestedArea * 0.98) {
      issues.push({
        code: 'room-below-brief',
        severity: 'note',
        title: `${room.label} is smaller than the brief asked for`,
        detail: `The brief asked for ${room.requestedArea.toFixed(1)} m² and the plan gives ${size.toFixed(1)} m².`,
        rooms: [room.id],
        furniture: [],
      });
    }
  }

  // --- the stairs ------------------------------------------------------
  if (plan.brief.storeys > 1 && plan.stairs.length === 0) {
    issues.push({
      code: 'no-stairs-for-two-storeys',
      severity: 'error',
      title: 'There is no stair to the upper floor',
      detail: `The house has ${plan.brief.storeys} storeys and no flight of stairs.`,
      rooms: [],
      furniture: [],
    });
  }

  for (const stair of plan.stairs) {
    const touching = roomsAtStair(plan, stair);
    const stairDoors = plan.doors.filter((door) => {
      if (door.floor !== stair.floor) return false;
      const inside = (id: string | null) =>
        id !== null && touching.some((r) => r.id === id);
      if (!inside(door.joins[0]) && !inside(door.joins[1])) return false;
      // The door must sit on the stair's own wall.
      const edge = touching
        .map((r) => sharedEdge(r, { x: stair.x, y: stair.y, width: stair.width, depth: stair.run }, 0.2))
        .find((e) => e !== null);
      if (!edge) return false;
      const along = edge.axis === 'vertical' ? door.y : door.x;
      return along >= edge.from - 0.4 && along <= edge.to + 0.4;
    });

    if (stairDoors.length === 0) {
      issues.push({
        code: 'stair-without-door',
        severity: 'error',
        title: 'The staircase has no door',
        detail: `The flight from the ${stair.floor === 0 ? 'ground' : 'upper'} floor to the ${stair.toFloor === 1 ? 'first' : 'next'} floor is walled off: no doorway leads into it.`,
        rooms: touching.map((r) => r.id),
        furniture: [],
      });
    } else if (touching.length > 0 && !touching.some((r) => reached.has(r.id))) {
      issues.push({
        code: 'stair-unreachable',
        severity: 'error',
        title: 'The staircase cannot be walked to',
        detail: 'No route from the front door arrives at the foot of the flight.',
        rooms: touching.map((r) => r.id),
        furniture: [],
      });
    }
  }

  // --- furniture in the way -------------------------------------------
  for (const item of plan.furniture) {
    const room = roomById(plan, item.roomId);
    if (!room) continue;
    for (const door of plan.doors) {
      if (door.floor !== item.floor) continue;
      const zone = doorZone(door, plan);
      if (!zone) continue;
      if (overlapArea(item, zone) <= 0.01) continue;
      issues.push({
        code: 'furniture-in-doorway',
        severity: 'error',
        title: `The ${item.label.toLowerCase()} blocks a doorway`,
        detail: `The ${item.label.toLowerCase()} in ${room.label} stands in the ${DOOR_WIDTH.toFixed(2)} m of floor in front of the door.`,
        rooms: [room.id],
        furniture: [item.id],
        correction: correctionForFurniture(item, zone, room, door.axis),
      });
    }
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const notes = issues.filter((i) => i.severity === 'note').length;

  return {
    issues,
    errors,
    warnings,
    notes,
    reachable: reached.size,
    total: rooms.length,
  };
}

/**
 * The repair for two rooms standing on top of each other.
 *
 * The overlap is taken off the room that is on top of the other, on the side
 * the overlap is actually on — so the repair removes the clash rather than
 * moving it somewhere else.
 */
function shrinkAway(a: Room, b: Room, overlap: number): Correction | undefined {
  void overlap;
  const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  if (overlapWidth <= 0.01) return undefined;
  const shrink = Math.min(b.width - 0.6, overlapWidth);
  if (shrink <= 0.01) return undefined;
  const bIsWest = b.x <= a.x;
  const newWidth = Math.round((b.width - shrink) * 1000) / 1000;
  const newX = bIsWest ? b.x : Math.round((b.x + shrink) * 1000) / 1000;
  return {
    kind: 'shrink-room',
    roomId: b.id,
    newX,
    newWidth,
    label: `Shrink ${b.label}`,
  };
}

/**
 * The smallest move that clears a doorway.
 *
 * The piece is pushed out of the floor in front of the door — sideways or
 * backwards, whichever keeps it inside its own room — by whatever it takes to
 * get its edge past the zone, and no further.
 */
function correctionForFurniture(
  item: Furniture,
  zone: Rect,
  room: Room,
  axis: 'vertical' | 'horizontal',
): Correction | undefined {
  const margin = 0.1;
  const overlapsX = Math.min(item.x + item.width, zone.x + zone.width) - Math.max(item.x, zone.x);
  const overlapsY = Math.min(item.y + item.depth, zone.y + zone.depth) - Math.max(item.y, zone.y);
  if (overlapsX <= 0 || overlapsY <= 0) return undefined;

  const candidates: { dx: number; dy: number; across: boolean }[] = [
    { dx: zone.x - margin - (item.x + item.width), dy: 0, across: true },
    { dx: zone.x + zone.width + margin - item.x, dy: 0, across: true },
    { dx: 0, dy: zone.y - margin - (item.y + item.depth), across: false },
    { dx: 0, dy: zone.y + zone.depth + margin - item.y, across: false },
  ];

  const inside = (dx: number, dy: number) => {
    const x = item.x + dx;
    const y = item.y + dy;
    return (
      x >= room.x - EPS &&
      x + item.width <= room.x + room.width + EPS &&
      y >= room.y - EPS &&
      y + item.depth <= room.y + room.depth + EPS
    );
  };

  const workable = candidates.filter((c) => inside(c.dx, c.dy));
  if (workable.length === 0) return undefined;

  // Stepping away from the wall the piece stands against is the repair that
  // reads like a repair; sliding it along the wall leaves it in the swing of
  // the door. So the move across the wall wins, and the shortest one after that.
  const acrossFirst = axis === 'vertical';
  workable.sort((a, b) => {
    const preference = Number(a.across !== acrossFirst) - Number(b.across !== acrossFirst);
    if (preference !== 0) return preference;
    return Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy);
  });

  const best = workable[0];
  return {
    kind: 'move-furniture',
    furnitureId: item.id,
    dx: Math.round(best.dx * 1000) / 1000,
    dy: Math.round(best.dy * 1000) / 1000,
    label: `Move the ${item.label.toLowerCase()} clear`,
  };
}

/** Apply a correction to a plan, returning a new plan. */
export function applyCorrection(plan: Plan, correction: Correction): Plan {
  if (correction.kind === 'shrink-room') {
    return {
      ...plan,
      rooms: plan.rooms.map((r) =>
        r.id === correction.roomId ? { ...r, x: correction.newX, width: correction.newWidth } : r,
      ),
    };
  }
  return {
    ...plan,
    furniture: plan.furniture.map((f) =>
      f.id === correction.furnitureId
        ? {
            ...f,
            x: Math.round((f.x + correction.dx) * 1000) / 1000,
            y: Math.round((f.y + correction.dy) * 1000) / 1000,
          }
        : f,
    ),
  };
}

export { STAIR_WIDTH };

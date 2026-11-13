/**
 * The generator: a brief becomes a plan.
 *
 * The generator is deliberately plain. It partitions the footprint into
 * rectangles in proportion to the areas the brief asked for, cuts a stair
 * well out of one corner, cuts a door into every wall two rooms share, and
 * puts one piece of furniture in each room.
 *
 * It is plain on purpose, because what it produces is what the checker and
 * the agent then argue about. A clever generator would hide the very defects
 * the checker exists to find.
 */

import type {
  Brief,
  Door,
  Furniture,
  GenerateResult,
  Plan,
  Rect,
  Room,
  RoomKind,
  Stair,
} from './types';
import { hashSeed, mulberry32 } from './rng';
import { mm, sharedEdge, subtract } from './geometry';

/** How far the building sits back from the plot boundary. */
export const SETBACK = 1.5;
/** Floor to floor, in metres. */
export const STOREY_HEIGHT = 2.9;
/** A clear opening. */
export const DOOR_WIDTH = 0.9;
/** How much floor a person needs to stand on to use a door. */
export const DOOR_APPROACH = 0.9;
/** The width of a flight. */
export const STAIR_WIDTH = 1.1;
/** The depth of the well the flight occupies in plan. */
export const STAIR_RUN = 3.0;
/** Riser height, in metres. */
export const RISER = 0.175;

interface Placement {
  room: Room;
  rect: Rect;
}

const FURNITURE: Record<RoomKind, { label: string; width: number; depth: number } | null> = {
  living: { label: 'Sofa', width: 2.2, depth: 0.9 },
  kitchen: { label: 'Counter', width: 2.4, depth: 0.6 },
  dining: { label: 'Dining table', width: 1.8, depth: 0.9 },
  bedroom: { label: 'Bed', width: 1.4, depth: 2.0 },
  bathroom: { label: 'Washbasin', width: 0.6, depth: 0.45 },
  study: { label: 'Desk', width: 1.4, depth: 0.7 },
  hall: null,
};

function sumAreas(rooms: { area: number }[]): number {
  return rooms.reduce((sum, r) => sum + r.area, 0);
}

/**
 * Split a list of rooms into two groups of about equal total area.
 *
 * The split is by area, not by count, so a big room and a small one are never
 * put on opposite sides of the building with nothing between them.
 */
function bestSplit(rooms: { area: number }[]): number {
  let best = 1;
  let bestDifference = Infinity;
  for (let k = 1; k < rooms.length; k++) {
    const difference = Math.abs(sumAreas(rooms.slice(0, k)) - sumAreas(rooms.slice(k)));
    if (difference < bestDifference) {
      bestDifference = difference;
      best = k;
    }
  }
  return best;
}

/**
 * Cut a rectangle into rectangles, one per room, in proportion to area.
 *
 * The cut always goes across the longer side, so the pieces stay closer to
 * square than they would if the building were sliced into strips.
 */
function partition(rect: Rect, rooms: { id: string; label: string; kind: RoomKind; area: number; floor: number }[]): Placement[] {
  if (rooms.length === 0) return [];
  if (rooms.length === 1) {
    const only = rooms[0];
    return [
      {
        room: {
          id: only.id,
          label: only.label,
          kind: only.kind,
          floor: only.floor,
          requestedArea: only.area,
          ...rect,
        },
        rect,
      },
    ];
  }

  const k = bestSplit(rooms);
  const first = rooms.slice(0, k);
  const second = rooms.slice(k);
  const firstArea = sumAreas(first);
  const secondArea = sumAreas(second);
  const total = firstArea + secondArea;

  if (rect.width >= rect.depth) {
    const cut = rect.width * (firstArea / total);
    return [
      ...partition({ x: rect.x, y: rect.y, width: cut, depth: rect.depth }, first),
      ...partition(
        { x: rect.x + cut, y: rect.y, width: rect.width - cut, depth: rect.depth },
        second,
      ),
    ];
  }
  const cut = rect.depth * (firstArea / total);
  return [
    ...partition({ x: rect.x, y: rect.y, width: rect.width, depth: cut }, first),
    ...partition(
      { x: rect.x, y: rect.y + cut, width: rect.width, depth: rect.depth - cut },
      second,
    ),
  ];
}

/**
 * The building's footprint: as square as the plot allows, centred in it.
 *
 * One envelope, used for every storey — which is what makes the building's
 * footprint the same on the ground floor as it is upstairs.
 */
export function envelopeFor(usable: Rect, need: number): Rect {
  const aspect = usable.width / usable.depth;
  let width = Math.sqrt(need * aspect);
  let depth = need / width;
  if (width > usable.width) {
    width = usable.width;
    depth = need / width;
  }
  if (depth > usable.depth) {
    depth = usable.depth;
    width = need / depth;
  }
  return {
    x: usable.x + (usable.width - width) / 2,
    y: usable.y + (usable.depth - depth) / 2,
    width,
    depth,
  };
}

/** A door in every wall two rooms share, at the middle of the shared stretch. */
function doorsBetween(rooms: Room[]): Door[] {
  const doors: Door[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (a.floor !== b.floor) continue;
      const edge = sharedEdge(a, b, DOOR_WIDTH + 0.1);
      if (!edge) continue;
      const middle = (edge.from + edge.to) / 2;
      doors.push({
        id: `d${doors.length + 1}`,
        floor: a.floor,
        kind: 'door',
        x: edge.axis === 'vertical' ? edge.at : middle,
        y: edge.axis === 'vertical' ? middle : edge.at,
        width: DOOR_WIDTH,
        axis: edge.axis,
        swing: 1,
        joins: [a.id, b.id],
      });
    }
  }
  return doors;
}

/**
 * The front door: in the south wall of the hall, which is the wall the
 * street is on. If the hall does not reach the street wall, the door goes in
 * the south wall of whichever ground-floor room does.
 */
function frontDoor(rooms: Room[], doors: Door[]): Door | null {
  const ground = rooms.filter((r) => r.floor === 0);
  if (ground.length === 0) return null;
  const onStreet = ground.filter((r) => r.y + r.depth === Math.max(...ground.map((g) => g.y + g.depth)));
  const hall = onStreet.find((r) => r.kind === 'hall') ?? onStreet[0];
  if (!hall) return null;
  const south = hall.y + hall.depth;
  return {
    id: `d${doors.length + 1}`,
    floor: 0,
    kind: 'front',
    x: hall.x + hall.width / 2,
    y: south,
    width: DOOR_WIDTH,
    axis: 'horizontal',
    swing: 1,
    joins: [hall.id, null],
  };
}

/**
 * One piece of furniture per room, set against the north wall.
 *
 * The generator picks the wall without knowing where the doors are, because
 * that is the order the work happens in: the rooms are furnished first, and
 * the doors are cut afterwards.
 */
function furnish(rooms: Room[], random: () => number): Furniture[] {
  const items: Furniture[] = [];
  for (const room of rooms) {
    const spec = FURNITURE[room.kind];
    if (!spec) continue;
    const width = Math.min(spec.width, room.width - 0.2);
    const depth = Math.min(spec.depth, room.depth - 0.2);
    if (width <= 0 || depth <= 0) continue;
    items.push({
      id: `f${items.length + 1}`,
      label: spec.label,
      roomId: room.id,
      floor: room.floor,
      x: mm(room.x + (room.width - width) / 2),
      y: mm(room.y),
      width: mm(width),
      depth: mm(depth),
    });
  }
  void random;
  return items;
}

/**
 * Build a plan from a brief.
 *
 * If the program cannot fit the plot the answer is a refusal, not a plan.
 * A smaller plan is a lie; a refusal is information.
 */
export function generatePlan(brief: Brief): GenerateResult {
  const usableWidth = brief.plotWidth - 2 * SETBACK;
  const usableDepth = brief.plotDepth - 2 * SETBACK;

  if (usableWidth < 3 || usableDepth < 3) {
    return {
      ok: false,
      refusal: {
        reason: 'The plot is too small to build on',
        detail: `A ${brief.plotWidth} × ${brief.plotDepth} m plot leaves ${usableWidth.toFixed(1)} × ${usableDepth.toFixed(1)} m inside the ${SETBACK} m setback.`,
        shortfall: 0,
      },
    };
  }

  const usable: Rect = { x: SETBACK, y: SETBACK, width: usableWidth, depth: usableDepth };
  const capacity = usableWidth * usableDepth;

  for (let floor = 0; floor < brief.storeys; floor++) {
    const onFloor = brief.rooms.filter((r) => r.floor === floor);
    const need = sumAreas(onFloor);
    if (need > capacity) {
      return {
        ok: false,
        refusal: {
          reason: 'The program does not fit the plot',
          detail: `Storey ${floor + 1} asks for ${need.toFixed(1)} m², and the plot holds ${capacity.toFixed(1)} m² inside the ${SETBACK} m setback.`,
          shortfall: need - capacity,
        },
      };
    }
  }

  const random = mulberry32(hashSeed(`${brief.text}|${JSON.stringify(brief.rooms)}`));

  const floorNeeds: number[] = [];
  for (let floor = 0; floor < brief.storeys; floor++) {
    floorNeeds.push(sumAreas(brief.rooms.filter((r) => r.floor === floor)));
  }
  const envelope = envelopeFor(usable, Math.max(...floorNeeds, 1));

  const rooms: Room[] = [];
  for (let floor = 0; floor < brief.storeys; floor++) {
    const onFloor = brief.rooms
      .filter((r) => r.floor === floor)
      .sort((a, b) => b.area - a.area);
    if (onFloor.length === 0) continue;
    rooms.push(...partition(envelope, onFloor).map((p) => p.room));
  }

  // The stair well, in the south-east corner of the footprint. It is cut out
  // of every storey it passes through.
  const stairs: Stair[] = [];
  if (brief.storeys > 1 && envelope.depth >= 2.4) {
    const run = Math.min(STAIR_RUN, envelope.depth * 0.45);
    const well: Rect = {
      x: envelope.x + envelope.width - STAIR_WIDTH,
      y: envelope.y + envelope.depth - run,
      width: STAIR_WIDTH,
      depth: run,
    };
    for (let floor = 0; floor < brief.storeys - 1; floor++) {
      stairs.push({
        id: `s${floor + 1}`,
        floor,
        toFloor: floor + 1,
        x: mm(well.x),
        y: mm(well.y),
        width: STAIR_WIDTH,
        run: mm(run),
        direction: -1,
        risers: Math.ceil(STOREY_HEIGHT / RISER),
      });
    }
    for (const room of rooms) {
      const trimmed = subtract(room, well);
      room.x = mm(trimmed.x);
      room.y = mm(trimmed.y);
      room.width = mm(trimmed.width);
      room.depth = mm(trimmed.depth);
    }
    // A room the well has eaten is not a room. It is left off the plan, and
    // the checker says so rather than the plan pretending it is there.
    for (let i = rooms.length - 1; i >= 0; i--) {
      const room = rooms[i];
      if (room.width < 0.5 || room.depth < 0.5) rooms.splice(i, 1);
    }
  }

  const doors = doorsBetween(rooms);
  const front = frontDoor(rooms, doors);
  if (front) doors.push(front);

  const plan: Plan = {
    brief,
    rooms,
    doors,
    stairs,
    furniture: furnish(rooms, random),
  };
  return { ok: true, plan };
}

/** The usable floor area of the plan, in square metres. */
export function indoorArea(plan: Plan): number {
  return plan.rooms.reduce((sum, r) => sum + Math.max(0, r.width) * Math.max(0, r.depth), 0);
}

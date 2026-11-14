/**
 * The generator: a brief becomes a plan.
 *
 * The generator is deliberately plain. It works out a footprint big enough for
 * the program, keeps a stairwell and a corridor out of it, partitions what is
 * left into rooms in proportion to the areas the brief asked for, cuts a door
 * into each room's way in, and puts one piece of furniture in each room.
 *
 * It is plain on purpose, because what it produces is what the checker and
 * the agent then argue about. A clever generator would hide the very defects
 * the checker exists to find.
 *
 * The order matters, and it is the order the work happens in:
 *
 *   1. the footprint, sized so the program fits;
 *   2. the stairwell and the corridor, taken out first so that no room is
 *      ever left with a stairwell bitten out of it;
 *   3. the rooms, partitioned into what is left;
 *   4. the doors, one per room, grown as a tree from the corridor;
 *   5. the furniture, placed last, because a piece of furniture is only
 *      sensible once you know where the doorways are.
 */

import type {
  Brief,
  BriefRoom,
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
import { EPS, mm, overlapArea, sharedEdge } from './geometry';
import {
  DOOR_WIDTH,
  MIN_CIRCULATION_WIDTH,
  RISER,
  SETBACK,
  STAIR_RUN,
  STAIR_WIDTH,
  STOREY_HEIGHT,
} from './constants';
import { zonesInRoom } from './zones';

export {
  DOOR_APPROACH,
  DOOR_WIDTH,
  RISER,
  SETBACK,
  STAIR_RUN,
  STAIR_WIDTH,
  STOREY_HEIGHT,
} from './constants';

/** The id of the stairwell. It is one space on every storey it passes. */
export const STAIR_ID = 'stair';

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
function partition(
  rect: Rect,
  rooms: { id: string; label: string; kind: RoomKind; area: number; floor: number }[],
): Placement[] {
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

/**
 * The circulation room of a storey.
 *
 * Circulation is what makes a plan walkable, so every storey has one: a hall
 * on the ground floor, a landing above it. If the program has lost its hall,
 * one is put back — a house with no corridor is not a house, it is a set of
 * boxes.
 */
export function circulationFor(brief: Brief, floor: number): BriefRoom {
  const found = brief.rooms.find((r) => r.floor === floor && r.kind === 'hall');
  if (found) return found;
  return {
    id: floor === 0 ? 'hall' : `landing-${floor}`,
    label: floor === 0 ? 'Hall' : `Landing ${floor}`,
    kind: 'hall',
    area: 6,
    floor,
  };
}

/**
 * Size the footprint.
 *
 * The rooms have to fit in what is left of the plot once the stairwell and
 * the corridor have taken their share, so the footprint is worked out from
 * the rooms rather than from the plot: the plot says how big the envelope may
 * be, and the program says how big it has to be.
 */
function fitEnvelope(
  usable: Rect,
  roomsNeed: number,
  circulationArea: number,
): { envelope: Rect; corridor: number; area: number } {
  const aspect = usable.width / usable.depth;
  let area = roomsNeed * 1.04;
  let corridor = MIN_CIRCULATION_WIDTH;

  for (let i = 0; i < 12; i++) {
    const depth = Math.sqrt(area / aspect);
    corridor = Math.max(MIN_CIRCULATION_WIDTH, circulationArea / depth);
    const next = roomsNeed * 1.04 + (STAIR_WIDTH + corridor) * depth;
    if (Math.abs(next - area) < 0.01) {
      area = next;
      break;
    }
    area = next;
  }

  return { envelope: envelopeFor(usable, area), corridor, area };
}

/**
 * One door per room, and the doors form a tree.
 *
 * A door is a hole in a wall, and a house with a door in every wall it shares
 * is a house you walk through sideways: the bedroom through the other
 * bedroom, the bathroom through the second bathroom, the kitchen through the
 * dining room. Four doorways around a 5 m² bathroom is not a generous house —
 * it is a bathroom with no floor left to stand on.
 *
 * So the doors are grown as a tree from the corridor. Every room hangs off
 * exactly one doorway; the tree is walked breadth-first from the corridor, so
 * the rooms nearest it open onto it; and a room is never joined to another
 * room it has no business joining. The two bathrooms never open into one
 * another, and a bedroom is only the way through to the next bedroom when
 * there is nowhere else for it to open.
 */

/**
 * How willing a room is to be the way in to another.
 *
 * A corridor is the way in to everything. A living room will take you into
 * the dining room. A kitchen is a service room, and a bathroom is a dead end
 * — you go through a bathroom on your way to nothing else.
 */
const WAY_IN: Record<RoomKind, number> = {
  hall: 0,
  living: 0,
  dining: 0,
  bedroom: 0,
  study: 1,
  kitchen: 2,
  bathroom: 6,
};

function placeDoors(rooms: Room[]): Door[] {
  const doors: Door[] = [];
  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b);

  for (const floor of floors) {
    const onFloor = rooms.filter((r) => r.floor === floor && r.id !== STAIR_ID);
    const root = onFloor.find((r) => r.kind === 'hall');
    if (!root) continue;
    const kindOf = (id: string) => rooms.find((r) => r.id === id)?.kind;

    // Which rooms each room could open into.
    const neighbours = new Map<string, string[]>();
    for (const room of onFloor) neighbours.set(room.id, []);
    for (let i = 0; i < onFloor.length; i++) {
      for (let j = i + 1; j < onFloor.length; j++) {
        const a = onFloor[i];
        const b = onFloor[j];
        if (!sharedEdge(a, b, DOOR_WIDTH + 0.1)) continue;
        neighbours.get(a.id)!.push(b.id);
        neighbours.get(b.id)!.push(a.id);
      }
    }
    for (const list of neighbours.values()) list.sort();

    // How far each room is from the corridor, counted in doors.
    const distance = new Map<string, number>([[root.id, 0]]);
    const queue = [root.id];
    while (queue.length > 0) {
      const here = queue.shift() as string;
      for (const other of neighbours.get(here) ?? []) {
        if (distance.has(other)) continue;
        distance.set(other, (distance.get(here) as number) + 1);
        queue.push(other);
      }
    }

    // Each room's way in. The nearest neighbour wins, and between two
    // neighbours the one that is more willing to be a way in wins: a dining
    // room opens off the living room, not through the kitchen. A bathroom is
    // only a way in when the room has no other neighbour to open onto.
    const parent = new Map<string, string>();
    const byDistance = onFloor
      .filter((r) => r.id !== root.id && distance.has(r.id))
      .sort(
        (a, b) =>
          (distance.get(a.id) as number) - (distance.get(b.id) as number) ||
          a.id.localeCompare(b.id),
      );

    for (const room of byDistance) {
      const options = neighbours.get(room.id) ?? [];
      const withoutBathroom = options.filter((id) => kindOf(id) !== 'bathroom');
      const pool = withoutBathroom.length > 0 ? withoutBathroom : options;
      const ranked = pool.slice().sort((a, b) => {
        const da = distance.get(a) as number;
        const db = distance.get(b) as number;
        if (da !== db) return da - db;
        const wa = WAY_IN[kindOf(a) as RoomKind];
        const wb = WAY_IN[kindOf(b) as RoomKind];
        if (wa !== wb) return wa - wb;
        return a.localeCompare(b);
      });

      for (const candidate of ranked) {
        // The doors have to form a tree, so a room may not be reached through
        // a room that is already reached through it.
        let cursor: string | undefined = candidate;
        const seen = new Set<string>();
        let loops = false;
        while (cursor !== undefined && !seen.has(cursor)) {
          if (cursor === room.id) {
            loops = true;
            break;
          }
          seen.add(cursor);
          cursor = parent.get(cursor);
        }
        if (loops) continue;
        parent.set(room.id, candidate);
        break;
      }
    }

    for (const room of byDistance) {
      const parentId = parent.get(room.id);
      if (!parentId) continue;
      const parentRoom = rooms.find((r) => r.id === parentId);
      if (!parentRoom) continue;
      const edge = sharedEdge(room, parentRoom, DOOR_WIDTH + 0.1);
      if (!edge) continue;
      const middle = (edge.from + edge.to) / 2;
      doors.push({
        id: `d${doors.length + 1}`,
        floor,
        kind: 'door',
        x: edge.axis === 'vertical' ? edge.at : middle,
        y: edge.axis === 'vertical' ? middle : edge.at,
        width: DOOR_WIDTH,
        axis: edge.axis,
        swing: 1,
        joins: [room.id, parentId],
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
 * The door into the stairwell.
 *
 * One door per storey. On the ground floor it is at the foot of the flight,
 * so you walk in and straight on up. On the storeys above it is at the head
 * of the flight, on the landing you arrive on, so you walk in and out into
 * the corridor.
 *
 * It is in the west wall of the stairwell, which is the wall the corridor
 * shares with it.
 */
function stairDoor(
  stairwell: Rect,
  floor: number,
  at: number,
  id: string,
): Door {
  return {
    id,
    floor,
    kind: 'door',
    x: mm(stairwell.x),
    y: mm(at),
    width: DOOR_WIDTH,
    axis: 'vertical',
    swing: 1,
    joins: [STAIR_ID, null],
  };
}

/**
 * One piece of furniture per room, set against a wall.
 *
 * The generator places the furniture **after** the doors, and keeps it clear
 * of the floor in front of every doorway. A piece of furniture in front of a
 * door is a defect, and a generator that cannot see its own doors will keep
 * producing them.
 */
function furnish(rooms: Room[], doors: Door[], random: () => number): Furniture[] {
  const items: Furniture[] = [];

  for (const room of rooms) {
    const spec = FURNITURE[room.kind];
    if (!spec) continue;
    const width = Math.min(spec.width, room.width - 0.2);
    const depth = Math.min(spec.depth, room.depth - 0.2);
    if (width <= 0.2 || depth <= 0.2) continue;

    const zones = zonesInRoom(room, doors);
    const spot = placeClear(room, width, depth, zones, random);
    if (!spot) continue;

    items.push({
      id: `f${items.length + 1}`,
      label: spec.label,
      roomId: room.id,
      floor: room.floor,
      x: mm(spot.x),
      y: mm(spot.y),
      width: mm(width),
      depth: mm(depth),
    });
  }

  return items;
}

/**
 * Find somewhere for a piece of furniture that is against a wall of its room
 * and clear of every doorway.
 *
 * The walls are tried in order — north, south, east, west — and along each
 * wall the piece is set down at a free stretch of it.
 */
function placeClear(
  room: Room,
  width: number,
  depth: number,
  zones: Rect[],
  random: () => number,
): Rect | null {
  if (width > room.width + EPS || depth > room.depth + EPS) return null;

  const centredX = room.x + (room.width - width) / 2;
  const centredY = room.y + (room.depth - depth) / 2;

  const alongX = [centredX, room.x, room.x + room.width - width];
  const alongY = [centredY, room.y, room.y + room.depth - depth];

  const walls: { rect: Rect; axis: 'x' | 'y' }[] = [];
  for (const x of alongX) {
    walls.push({ rect: { x, y: room.y, width, depth }, axis: 'x' });
  }
  for (const x of alongX) {
    walls.push({ rect: { x, y: room.y + room.depth - depth, width, depth }, axis: 'x' });
  }
  for (const y of alongY) {
    walls.push({ rect: { x: room.x, y, width, depth }, axis: 'y' });
  }
  for (const y of alongY) {
    walls.push({ rect: { x: room.x + room.width - width, y, width, depth }, axis: 'y' });
  }

  const clear = (rect: Rect) => !zones.some((zone) => overlapArea(rect, zone) > 0.01);

  // North wall first, then south, then the two sides — the order a person
  // would furnish a room in.
  const order: number[] = [0, 1, 2, 3].map((wall) => wall * 3);
  for (const start of order) {
    const options = [0, 1, 2].map((offset) => walls[start + offset]).filter((w) => clear(w.rect));
    if (options.length === 0) continue;
    const pick = options[Math.floor(random() * options.length) % options.length];
    return pick.rect;
  }

  return null;
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
  const storeys = Math.max(1, Math.min(4, brief.storeys));

  const circulation: BriefRoom[] = [];
  for (let floor = 0; floor < storeys; floor++) {
    circulation.push(circulationFor(brief, floor));
  }

  const roomsOn = (floor: number) =>
    brief.rooms.filter((r) => r.floor === floor && r.kind !== 'hall');

  for (let floor = 0; floor < storeys; floor++) {
    const need = sumAreas(brief.rooms.filter((r) => r.floor === floor));
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

  const roomsNeed = Math.max(...circulation.map((_, floor) => sumAreas(roomsOn(floor))), 1);
  const circulationArea = Math.max(...circulation.map((c) => c.area), 1);
  const { envelope, corridor: corridorWidth, area } = fitEnvelope(usable, roomsNeed, circulationArea);

  if (area > capacity + EPS) {
    return {
      ok: false,
      refusal: {
        reason: 'The program does not fit the plot',
        detail: `The program needs ${area.toFixed(1)} m² once the stairwell and the corridor are taken out, and the plot holds ${capacity.toFixed(1)} m² inside the ${SETBACK} m setback.`,
        shortfall: area - capacity,
      },
    };
  }

  const random = mulberry32(hashSeed(`${brief.text}|${JSON.stringify(brief.rooms)}`));

  // The stairwell and the corridor are taken out of the footprint first, so
  // that no room is ever left with a piece of the building bitten out of it.
  const stairwell: Rect = {
    x: envelope.x + envelope.width - STAIR_WIDTH,
    y: envelope.y,
    width: STAIR_WIDTH,
    depth: envelope.depth,
  };
  const corridor: Rect = {
    x: stairwell.x - corridorWidth,
    y: envelope.y,
    width: corridorWidth,
    depth: envelope.depth,
  };
  const westArea: Rect = {
    x: envelope.x,
    y: envelope.y,
    width: envelope.width - STAIR_WIDTH - corridorWidth,
    depth: envelope.depth,
  };

  const rooms: Room[] = [];
  const stairs: Stair[] = [];

  for (let floor = 0; floor < storeys; floor++) {
    const circ = circulation[floor];
    rooms.push({
      id: circ.id,
      label: circ.label,
      kind: 'hall',
      floor,
      requestedArea: circ.area,
      ...corridor,
    });

    const onFloor = roomsOn(floor).sort((a, b) => b.area - a.area);
    if (onFloor.length === 0) continue;
    rooms.push(...partition(westArea, onFloor).map((p) => p.room));
  }

  if (storeys > 1) {
    // The stairwell is one space, on every storey it passes through.
    rooms.push({
      id: STAIR_ID,
      label: 'Stairwell',
      kind: 'hall',
      floor: 0,
      spans: Array.from({ length: storeys }, (_, i) => i),
      requestedArea: stairwell.width * stairwell.depth,
      ...stairwell,
    });

    // The flights stack from the south end of the stairwell upwards, so the
    // last one lands on the landing at the north end.
    const flightRun = Math.min(STAIR_RUN, (stairwell.depth - 1.2) / (storeys - 1));
    for (let floor = 0; floor < storeys - 1; floor++) {
      const flightY = stairwell.y + stairwell.depth - (floor + 1) * flightRun;
      stairs.push({
        id: `s${floor + 1}`,
        floor,
        toFloor: floor + 1,
        x: mm(stairwell.x),
        y: mm(stairwell.y),
        width: STAIR_WIDTH,
        run: mm(stairwell.depth),
        flightOffset: mm(flightY - stairwell.y),
        flightRun: mm(flightRun),
        direction: -1,
        risers: Math.ceil(STOREY_HEIGHT / RISER),
      });
    }
  }

  const doors = placeDoors(rooms);

  if (storeys > 1) {
    const flightRun = Math.min(STAIR_RUN, (stairwell.depth - 1.2) / (storeys - 1));
    // One door into the stairwell per storey. The ground floor door is at the
    // foot of the flight, so you walk in and straight on up. Every storey
    // above is at the head of the flight that arrives there, which is the
    // landing you step off onto.
    //
    // The door is kept a little clear of the end of the wall. Flush against
    // the corner the opening stops reading as a doorway — it becomes a nick
    // in the wall, and the swing has nowhere to go.
    for (let floor = 0; floor < storeys; floor++) {
      const at =
        floor === 0
          ? stairwell.y + stairwell.depth - 0.45 - 0.25
          : stairwell.y + stairwell.depth - floor * flightRun - 0.45;
      const door = stairDoor(stairwell, floor, at, `d${doors.length + 1}`);
      door.joins = [STAIR_ID, circulation[floor].id];
      doors.push(door);
    }
  }

  const front = frontDoor(rooms, doors);
  if (front) doors.push(front);

  const plan: Plan = {
    brief,
    rooms,
    doors,
    stairs,
    furniture: furnish(rooms, doors, random),
  };
  return { ok: true, plan };
}

/** The usable floor area of the plan, in square metres. */
export function indoorArea(plan: Plan): number {
  return plan.rooms.reduce((sum, r) => sum + Math.max(0, r.width) * Math.max(0, r.depth), 0);
}

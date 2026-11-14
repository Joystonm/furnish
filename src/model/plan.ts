/**
 * The wall planner.
 *
 * Rooms are the authored facts. Walls, openings, stairs and furniture are
 * DERIVED from room adjacency by this module. That is the single architectural
 * idea that lets Furnish stay consistent: there is no way for a plan to have a
 * room with no walls, or a wall that bounds nothing, because both are computed
 * from the same rectangle set every time the plan is replanned.
 *
 * Pipeline:
 *   1. rooms            → exterior boundary (union outline, notches preserved)
 *   2. room pairs       → interior partitions along every shared edge span
 *   3. entrance         → one exterior door, on the street-facing side
 *   4. boundary segments→ windows, spaced along each outside wall
 *   5. partitions       → interior doors and openings
 *   6. furniture        → one sensible starting piece per room
 *
 * Everything here is deterministic and side-effect free.
 */
import {
  DEFAULT_ROOM_AREA,
  FLOOR_MATERIAL_BY_KIND,
  KIND_LABEL,
  OPENING_DEFAULTS,
  WALL_THICKNESS,
  bandsClear,
  catalogById,
  itemBand,
} from './catalog.ts';
import { newId } from './ids.ts';
import { GOING, RISER } from './ops.ts';
import { TOL, doorSwingPolygon, footprintOfItem, obbOfItem, polygonObbOverlap, rectOf, rectOverlapArea, wallFrame } from './geometry.ts';
import type { RoomProgram } from './program.ts';
import type {
  DesignBrief,
  Floor,
  FurnitureItem,
  Id,
  Opening,
  Orientation,
  Plot,
  Project,
  Room,
  RoomKind,
  Staircase,
  Vec2,
  Wall,
  Rect,
} from './types.ts';

// ─────────────────────────────────────────────────── boundary tracing ────────

/** A straight run of the outer boundary of a set of axis-aligned rectangles. */
export interface BoundarySegment {
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Which plot side this faces: -1 left, 1 right, -2 top, 2 bottom. */
  facing: -1 | 1 | -2 | 2;
}

/**
 * Trace the outline of the union of axis-aligned rectangles.
 *
 * Method: every rectangle contributes four edges. An edge span that another
 * rectangle lies flush against is interior and is subtracted. What survives is
 * the union boundary — including notches and L-shapes, which a bounding box
 * would swallow.
 */
export function boundarySegments(rooms: Room[]): BoundarySegment[] {
  type Edge = {
    owner: Room;
    fixed: number;
    from: number;
    to: number;
    axis: 'x' | 'y';
    facing: -1 | 1 | -2 | 2;
  };
  const edges: Edge[] = [];

  for (const r of rooms) {
    edges.push({ owner: r, fixed: r.y, from: r.x, to: r.x + r.width, axis: 'y', facing: -2 });
    edges.push({ owner: r, fixed: r.y + r.depth, from: r.x, to: r.x + r.width, axis: 'y', facing: 2 });
    edges.push({ owner: r, fixed: r.x, from: r.y, to: r.y + r.depth, axis: 'x', facing: -1 });
    edges.push({ owner: r, fixed: r.x + r.width, from: r.y, to: r.y + r.depth, axis: 'x', facing: 1 });
  }

  const out: BoundarySegment[] = [];

  for (const e of edges) {
    // Spans of this edge cancelled by the facing side of ANOTHER room.
    const covers: Array<[number, number]> = [];
    for (const o of rooms) {
      if (o === e.owner) continue;
      const r = rectOf(o);
      if (e.axis === 'y') {
        const atTop = Math.abs(r.y - e.fixed) < TOL.join;
        const atBottom = Math.abs(r.y + r.depth - e.fixed) < TOL.join;
        if (!atTop && !atBottom) continue;
        // Only an opposite-facing, flush neighbour cancels this edge.
        const opposing = atTop ? r.y + r.depth - e.fixed : r.y - e.fixed;
        if (Math.abs(opposing) < TOL.join) continue;
        const overlap = [Math.max(r.x, e.from), Math.min(r.x + r.width, e.to)];
        if (overlap[1] - overlap[0] > TOL.join) covers.push(overlap as [number, number]);
      } else {
        const atLeft = Math.abs(r.x - e.fixed) < TOL.join;
        const atRight = Math.abs(r.x + r.width - e.fixed) < TOL.join;
        if (!atLeft && !atRight) continue;
        const opposing = atLeft ? r.x + r.width - e.fixed : r.x - e.fixed;
        if (Math.abs(opposing) < TOL.join) continue;
        const overlap = [Math.max(r.y, e.from), Math.min(r.y + r.depth, e.to)];
        if (overlap[1] - overlap[0] > TOL.join) covers.push(overlap as [number, number]);
      }
    }
    covers.sort((p, q) => p[0] - q[0]);

    let cursor = e.from;
    const emit = (from: number, to: number) => {
      if (to - from <= TOL.length) return;
      out.push(
        e.axis === 'y'
          ? { a: { x: from, y: e.fixed }, b: { x: to, y: e.fixed }, facing: e.facing }
          : { a: { x: e.fixed, y: from }, b: { x: e.fixed, y: to }, facing: e.facing },
      );
    };
    for (const [s, t] of covers) {
      if (s - cursor > TOL.length) emit(cursor, s);
      cursor = Math.max(cursor, t);
    }
    emit(cursor, e.to);
  }

  return out.filter((s) => Math.abs(s.a.x - s.b.x) > TOL.length || Math.abs(s.a.y - s.b.y) > TOL.length);
}

/** Total length of the union boundary. */
export const boundaryLength = (segs: BoundarySegment[]): number =>
  segs.reduce((s, seg) => s + Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y), 0);

// ────────────────────────────────────────────────────────────── orientation ────

/**
 * Which plot edge faces the street, given the plot orientation.
 * 0 → north (top edge), 90 → east (right), 180 → south (bottom), 270 → west (left).
 */
export function frontEdges(orientation: Orientation): Array<BoundarySegment['facing']> {
  switch (orientation) {
    case 0: return [-2];
    case 90: return [1];
    case 180: return [2];
    case 270: return [-1];
  }
}

export function sideName(facing: BoundarySegment['facing']): string {
  return facing === -2 ? 'front (north)' : facing === 2 ? 'rear (south)' : facing === -1 ? 'left (west)' : 'right (east)';
}

// ────────────────────────────────────────────────────────────── the planner ────

export interface PlanOptions {
  plot: Plot;
  floor: Floor;
  rooms: Room[];
  /** Which room gets the front door. Default: the living room, else the first. */
  entranceRoomId?: Id | null;
  /** Furnish each room with a starting arrangement. */
  furnish?: boolean;
  /**
   * Connections the room program asked for, as sorted room-id pairs.
   *
   * These outrank every other consideration when choosing which partition is the
   * door into a room. The program's `touches` is the one statement of intent
   * that survives from the model, and a plan that quietly drops a declared
   * adjacency — a bedroom off its own bathroom, the thing an ensuite *is* —
   * is a plan that ignored the brief it was given.
   */
  preferredDoors?: ReadonlySet<string>;
  /**
   * The stairwell reserved on this floor, if any.
   *
   * The planner needs it because a building's outline is the outline of its
   * rooms, and a reserved void is not a room. Without it the walls that bound
   * the stairwell are indistinguishable from the ones that face the street:
   * both are an edge of the union with nothing across it. Glazed, they put a
   * window beside the flight — which is how a staircase comes to arrive at a
   * window — and they are short enough that a door and a window cannot both
   * fit on one.
   */
  shaft?: { x: number; y: number; width: number; depth: number } | null;
}

/** The buildable rectangle: the plot less its setbacks. */
function envelopeOf(plot: Plot): { x: number; y: number; width: number; depth: number } {
  return {
    x: plot.setbacks.left,
    y: plot.setbacks.front,
    width: plot.width - plot.setbacks.left - plot.setbacks.right,
    depth: plot.depth - plot.setbacks.front - plot.setbacks.rear,
  };
}

/** Whether a segment lies along one of the envelope's four sides. */
function segmentOnEnvelope(
  seg: BoundarySegment,
  env: { x: number; y: number; width: number; depth: number },
): boolean {
  const vertical = Math.abs(seg.a.x - seg.b.x) < TOL.join;
  if (vertical) {
    const x = seg.a.x;
    return (
      Math.abs(x - env.x) < TOL.join || Math.abs(x - (env.x + env.width)) < TOL.join
    );
  }
  const y = seg.a.y;
  return Math.abs(y - env.y) < TOL.join || Math.abs(y - (env.y + env.depth)) < TOL.join;
}

/** Whether a segment runs along one of the reserved void's sides. */
function segmentTouchesShaft(
  seg: { a: Vec2; b: Vec2 },
  shaft: { x: number; y: number; width: number; depth: number },
): boolean {
  const sx1 = shaft.x + shaft.width;
  const sy1 = shaft.y + shaft.depth;
  const vertical = Math.abs(seg.a.x - seg.b.x) < TOL.join;
  if (vertical) {
    if (Math.abs(seg.a.x - shaft.x) > TOL.join && Math.abs(seg.a.x - sx1) > TOL.join) return false;
    const lo = Math.min(seg.a.y, seg.b.y);
    const hi = Math.max(seg.a.y, seg.b.y);
    return hi > shaft.y + TOL.join && lo < sy1 - TOL.join;
  }
  if (Math.abs(seg.a.y - shaft.y) > TOL.join && Math.abs(seg.a.y - sy1) > TOL.join) return false;
  const lo = Math.min(seg.a.x, seg.b.x);
  const hi = Math.max(seg.a.x, seg.b.x);
  return hi > shaft.x + TOL.join && lo < sx1 - TOL.join;
}

/** The key two room ids share in a `preferredDoors` set. */
export function doorPairKey(a: Id, b: Id): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface PlannedFloor {
  walls: Wall[];
  furniture: FurnitureItem[];
}

/**
 * How much exterior wall one window serves.
 *
 * Windows are spaced along a wall rather than budgeted across the floor: the
 * budget version handed every short wall a fraction of a window, which rounds
 * down to none — a whole plan can come out of it with no glazing at all and no
 * error to say so. A frequency is also what a house actually looks like.
 */
const WALL_PER_WINDOW = 3.0;

/** Which walls of a room an item prefers, best first. */
type Side = 'n' | 's' | 'e' | 'w';

/** Sofas and tables want the longest run, then whatever is left. */
const LIVING_WALLS: readonly Side[] = ['n', 'w', 'e', 's'];
/** Beds and tubs look for a wall that is not the door's. */
const BED_WALLS: readonly Side[] = ['n', 's', 'w', 'e'];

/**
 * The wall across from `side`, for anything that has to face what is on it.
 */
const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** From the middle of a room, the direction of each wall. */
const OUTWARD: Record<Side, Vec2> = { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 }, e: { x: 1, y: 0 } };

/** Along a wall, rather than into it. */
const ALONG_WALL: Record<Side, Vec2> = { n: { x: 1, y: 0 }, s: { x: 1, y: 0 }, w: { x: 0, y: 1 }, e: { x: 0, y: 1 } };

/**
 * The rotation that puts a piece's back against each wall.
 *
 * `backBearing` in `furniture.ts` reads the same yaw the renderer applies, so
 * a sofa told to face the north wall cannot end up with its backrest standing
 * in the middle of the room.
 */
const BACK_TO_WALL: Record<Side, number> = { n: 0, s: 180, w: 90, e: 270 };

/** Rooms that read as part of the living space rather than as separate cells. */
const OPEN_PLAN: ReadonlySet<RoomKind> = new Set(['kitchen', 'dining', 'living', 'office', 'hall', 'lobby']);

/**
 * Spaces you walk through rather than stay in.
 *
 * This is what makes a door "the" door into a room: a bedroom's door is the
 * partition it shares with a corridor or hall, because that is the wall you
 * arrive from. A room touching nothing but other bedrooms has nowhere to put one.
 */
const CIRCULATION: ReadonlySet<RoomKind> = new Set(['corridor', 'hall', 'lobby']);

/**
 * How many doors a room may have.
 *
 * Two, not one. The normal bedroom has exactly one, but a bedroom with its own
 * bathroom genuinely has two — the door off the corridor and the ensuite — and a
 * cap of one would either strand that bathroom or turn the plan inside out trying
 * to avoid it. Three is where the plan stopped being a room you live in.
 */
const MAX_DOORS = 2;

/**
 * Rooms that are private, and so get exactly one door.
 *
 * Everything that is neither circulation nor open-plan lands here by
 * elimination: a bedroom, bathroom, office, store or utility is a room you go
 * into and stay in, and a second door into one of those makes it a route to
 * somewhere else. The one exception is circulation, which is entered from every
 * room that touches it and so keeps all of them — a corridor with four doors off
 * it is a corridor doing its job.
 *
 * Membership also decides how a partition is *ranked* as the way in: touching
 * circulation is best, touching a public room next, touching another private
 * room last.
 */
const PRIVATE_ROOMS: ReadonlySet<RoomKind> = new Set([
  'bedroom',
  'bathroom',
  'guest',
  'storage',
  'pantry',
  'prayer',
  'utility',
  'garage',
  'office',
]);

function segmentLength(s: BoundarySegment): number {
  return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
}

/**
 * The floor area a catalogue piece covers once it has been turned.
 *
 * A quarter turn swaps width and depth; a half turn — which is all the north
 * and south walls ask for — does not. Reading the unrotated axes for a piece
 * that has been turned measures it against the wrong wall.
 */
function footprintDims(c: { width: number; depth: number }, rotation: number): { w: number; d: number } {
  const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  return quarter ? { w: c.depth, d: c.width } : { w: c.width, d: c.depth };
}

function doorForRooms(kindA: RoomKind, kindB: RoomKind): { kind: Opening['kind']; spec: { width: number; height: number } } | null {
  const servicePair =
    (kindA === 'bathroom' && ['bedroom', 'corridor', 'hall', 'guest'].includes(kindB)) ||
    (kindB === 'bathroom' && ['bedroom', 'corridor', 'hall', 'guest'].includes(kindA));
  if (servicePair) return { kind: 'door', spec: OPENING_DEFAULTS.bathroomDoor };

  const bothOpen = OPEN_PLAN.has(kindA) && OPEN_PLAN.has(kindB);
  if (bothOpen) return { kind: 'opening', spec: { width: 1.5, height: 2.2 } };

  return { kind: 'door', spec: OPENING_DEFAULTS.interiorDoor };
}

interface DoorCandidate {
  wall: Wall;
  rooms: [Room, Room];
  span: number;
}

/**
 * Which partitions become doors, and which stay solid.
 *
 * Every pair of touching rooms has a partition; almost none of them should have
 * a door. This picks the one partition each room is entered through, and leaves
 * the rest solid.
 *
 * The rules, in the order they apply:
 *
 *  1. Two open-plan rooms always get a wide opening. Kitchen into dining is not
 *     a wall with a hole, it is one continuous space, and capping that would
 *     break the thing that makes it a kitchen.
 *  2. A circulation space keeps every door that reaches it. A corridor with four
 *     doors off it is a corridor doing its job — that is where doors go.
 *  3. A private room takes **one** door, preferring the partition it shares
 *     with circulation, then with a public room, and only as a last resort with
 *     another private room.
 *  4. A partition becomes a door when a room claims it. Each roomed-off room
 *     claims exactly one partition, so a bedroom that claimed the corridor gains
 *     a door and gains nothing else, however many bathrooms are pressed against
 *     it. Circulation claims nothing and accepts every claim — that is what
 *     gives a corridor four doors and a bedroom one.
 *
 * Returns the rule for each chosen wall, keyed by wall id. Partitions not in the
 * map stay solid, which is the common case.
 */
function chooseDoorPartitions(
  partitions: readonly DoorCandidate[],
  preferred: ReadonlySet<string>,
  entranceRoomId: Id | null,
): Map<Id, { kind: Opening['kind']; spec: { width: number; height: number } }> {
  const chosen = new Map<Id, { kind: Opening['kind']; spec: { width: number; height: number } }>();
  /** The partition each room will be entered through, keyed by room id. */
  const picked = new Map<Id, DoorCandidate>();

  // Open-plan pairs are decided by everyone, not by any one room's budget.
  const contested: DoorCandidate[] = [];
  for (const p of partitions) {
    if (OPEN_PLAN.has(p.rooms[0].kind) && OPEN_PLAN.has(p.rooms[1].kind)) {
      const rule = doorForRooms(p.rooms[0].kind, p.rooms[1].kind);
      if (rule) chosen.set(p.wall.id, rule);
    } else {
      contested.push(p);
    }
  }

  // How good this partition is as the way into `room`, lower is better.
  const rank = (p: DoorCandidate, room: Room): number => {
    const other = p.rooms[0] === room ? p.rooms[1] : p.rooms[0];
    if (CIRCULATION.has(other.kind)) return 0;
    if (!PRIVATE_ROOMS.has(other.kind)) return 1;
    return 2;
  };

  const candidatesFor = new Map<Id, DoorCandidate[]>();
  for (const p of contested) {
    for (const room of p.rooms) {
      const list = candidatesFor.get(room.id);
      if (list) list.push(p);
      else candidatesFor.set(room.id, [p]);
    }
  }

  const doorCount = new Map<Id, number>();
  const count = (id: Id) => doorCount.get(id) ?? 0;
  /**
   * Put a door on a partition and credit both of its rooms.
   *
   * The one-door cap lives here rather than in the claim loop, because a room's
   * doors do not all come from its own claim: it also picks up a door whenever a
   * neighbour claims the wall between them. Letting every claim land is what
   * produced the bedroom with four doors — three neighbours each claiming a wall
   * that happened to border it. So a claim is declined when the room asking for
   * it already has its door, and the *other* side of the partition is credited
   * regardless, because the door it wanted still exists for them.
   */
  const commit = (roomId: Id, p: DoorCandidate, force = false) => {
    const rule = doorForRooms(p.rooms[0].kind, p.rooms[1].kind);
    if (!rule) return;
    const room = p.rooms.find((r) => r.id === roomId);
    // Circulation is entered from every room that reaches it and is never
    // capped — four doors off a corridor is what a corridor is for. Everything
    // else, open-plan rooms included, is: a living room off a corridor, a hall
    // and a front door is a plan, a living room with four ways in is a lobby.
    //
    // The cap yields to a repair. A room that cannot be walked to is a house
    // that does not work, and a third door is a smaller fault than a bedroom
    // nobody can reach — so the repair below is allowed to exceed the cap
    // rather than leave the room stranded. It used not to be, and a bathroom
    // that claimed a wall with a bedroom left that bedroom with two doors it
    // had not asked for and no way of claiming its own, unreachable.
    if (room && count(room.id) >= MAX_DOORS && !CIRCULATION.has(room.kind) && !force) return;
    if (chosen.has(p.wall.id)) return;
    chosen.set(p.wall.id, rule);
    for (const r of p.rooms) doorCount.set(r.id, count(r.id) + 1);
  };

  // Each room claims its best partition outright. Requiring both rooms to agree
  // was tidier on paper and produced worse plans: circulation never "picks"
  // anything, so no bedroom could ever have a mutual corridor door, and a
  // bathroom boxed in by bedrooms and another bathroom ended up with no door at
  // all — which `validate` rejects outright.
  //
  // Rooms are visited least-contended first, so where two rooms want the same
  // wall the scarcer one gets it: a bathroom with one way in outranks a bedroom
  // that can still fall back on its corridor.
  const order = [...candidatesFor.keys()].sort(
    (a, b) => candidatesFor.get(a)!.length - candidatesFor.get(b)!.length,
  );
  for (const roomId of order) {
    const list = candidatesFor.get(roomId)!;
    const room = list[0]!.rooms.find((r) => r.id === roomId);
    if (!room) continue;
    // Circulation is entered from every room that reaches it: no budget to
    // spend, nothing to choose, and it accepts every claim made at it.
    if (CIRCULATION.has(room.kind)) continue;

    const best = [...list].sort((a, b) => {
      // A connection the program asked for wins outright. Everything else is a
      // default for a plan that was not told.
      const asked = (p: DoorCandidate) =>
        preferred.has(doorPairKey(p.rooms[0].id, p.rooms[1].id)) ? 0 : 1;
      const f = asked(a) - asked(b);
      if (f !== 0) return f;
      // Then circulation, always. A bedroom with a door onto the corridor is
      // the normal plan; the burden term below must never talk it out of that
      // in favour of a neighbouring bedroom just because that bedroom is
      // quieter. Burden only breaks ties *within* a rank, which is where it
      // belongs — spreading rooms that have no corridor to fall back on across
      // different neighbours instead of piling them all onto one.
      const e = rank(a, room) - rank(b, room);
      if (e !== 0) return e;
      // Then the neighbour with fewest doors so far. This is what stops a room
      // collecting three: a partition whose other side already has a door is a
      // second door into someone else, so it ranks behind an equally good wall
      // onto a room that has none.
      const burden = (p: DoorCandidate) => count(p.rooms.find((r) => r.id !== roomId)!.id);
      const d = burden(a) - burden(b);
      if (d !== 0) return d;
      // A tie is broken toward the longer wall: a 2 m partition can hold a door
      // and its jambs, a 0.9 m one barely manages.
      return b.span - a.span;
    })[0];
    if (!best) continue;
    picked.set(roomId, best);
    commit(roomId, best);
  }

  // A claimed door is only a door if it leads somewhere you can walk to.
  //
  // The program's `touches` can chain — a bedroom that touches only its
  // bathroom, and that bathroom touching only the bedroom — and following it
  // literally leaves both rooms sealed off from the entrance. `validate` calls
  // that an error, and it is one: a house whose bedroom opens into a bathroom
  // that opens into nothing is worse than a plan that quietly moved one door.
  //
  // Declared adjacency is therefore honoured where it keeps the house walkable
  // and topped up where it does not, rather than being absolute.
  repairUnreachable(chosen, candidatesFor, entranceRoomId, commit, count);

  return chosen;
}

/**
 * Make sure every room can be walked to from the entrance.
 *
 * Floods from the entrance over the chosen doors, then adds a door to whatever
 * it could not reach, using that room's best unused partition.
 *
 * Adding rather than moving is the point. An earlier version retracted a
 * stranded room's existing door to try a different wall, which cascaded — moving
 * one room's door stranded the room that had been relying on it, four bedrooms
 * ended up with four doors each, and the plan churned between passes. A room is
 * never left with fewer doors than it started with, so the graph can only gain
 * reachability and never lose it, and this settles in a single pass.
 *
 * The one concession to realism: when the only partition left is one another
 * room already claimed, both share it. A bathroom boxed in by two bedrooms with
 * no corridor of its own has no other way in, and one shared wall with one door
 * beats an unreachable room.
 */
function repairUnreachable(
  chosen: Map<Id, { kind: Opening['kind']; spec: { width: number; height: number } }>,
  candidatesFor: Map<Id, DoorCandidate[]>,
  entranceRoomId: Id | null,
  commit: (roomId: Id, p: DoorCandidate, force?: boolean) => void,
  count: (id: Id) => number,
): void {
  // With no known entrance there is nothing to check against; `validate` decides
  // reachability, not this function.
  if (!entranceRoomId) return;

  for (let guard = 0; guard < candidatesFor.size; guard++) {
    const reached = new Set<Id>([entranceRoomId]);
    const queue = [entranceRoomId];
    while (queue.length) {
      const id = queue.pop()!;
      for (const p of candidatesFor.get(id) ?? []) {
        if (!chosen.has(p.wall.id)) continue;
        for (const r of p.rooms) {
          if (reached.has(r.id)) continue;
          reached.add(r.id);
          queue.push(r.id);
        }
      }
    }

    const stranded = [...candidatesFor.keys()].filter((id) => !reached.has(id));
    if (!stranded.length) return;

    let repaired = false;
    for (const id of stranded) {
      const room = (candidatesFor.get(id) ?? [])[0]?.rooms.find((r) => r.id === id);
      const open = (candidatesFor.get(id) ?? []).filter((p) => !chosen.has(p.wall.id));
      if (!room) continue;
      // Prefer a way into circulation over another private room. A stranded
      // bedroom whose only declared connection is the bathroom beside it is in
      // a private chain — bedroom to bathroom to bedroom — and topping that up
      // with the next private wall just makes a longer chain. The partition to
      // the corridor is what actually connects the wing to the house.
      const reachable = (p: DoorCandidate) => {
        const other = p.rooms.find((r) => r.id !== id)!;
        return CIRCULATION.has(other.kind) ? 0 : 1;
      };
      const next = [...open].sort((a, b) => {
        const d = reachable(a) - reachable(b);
        // Then the least-burdened neighbour, so repairs spread out.
        if (d !== 0) return d;
        return count(a.rooms.find((r) => r.id !== id)!.id)
          - count(b.rooms.find((r) => r.id !== id)!.id);
      })[0];
      if (!next) continue;
      commit(id, next, true);
      repaired = true;
    }
    // Nothing left to offer a stranded room: `validate` reports it, which is
    // the honest outcome — there is no door to give it.
    if (!repaired) return;
  }
}

export function planFloor(opts: PlanOptions): PlannedFloor {
  const { plot, floor } = opts;
  const rooms = opts.rooms;
  const walls: Wall[] = [];
  const furniture: FurnitureItem[] = [];
  const wallHeight = floor.height;

  if (rooms.length === 0) return { walls, furniture };

  // ── 1. exterior boundary ────────────────────────────────────────────────
  const indoor = rooms.filter((r) => !r.outdoor);
  const boundary = boundarySegments(rooms);
  const front = frontEdges(plot.orientation);

  const exteriorWallBySegment = new Map<BoundarySegment, Wall>();
  const env = envelopeOf(opts.plot);
  const shaft = opts.shaft ?? null;

  for (const seg of boundary) {
    // A wall that bounds the stairwell is not an outside wall.
    //
    // The building's outline is the outline of its rooms, and the stairwell is
    // reserved rather than built, so the walls that bound it look exactly like
    // the ones that face the street — an edge of the union with nothing across
    // it. Left as they are, they get glazed, and a staircase arrives at a
    // window; and they are short enough that a 0.9 m door and a window cannot
    // both fit on one, which is how the door ended up inside the window.
    //
    // A segment that bounds the stairwell and is not on the envelope is a
    // partition between the room and the stairwell: not glazed, not given the
    // weight of an outside wall, and free to take the door the flight needs.
    const boundsShaft = shaft ? segmentTouchesShaft(seg, shaft) : false;
    const outside = !boundsShaft || segmentOnEnvelope(seg, env);
    const wall: Wall = {
      id: newId('wl'),
      floorId: floor.id,
      type: outside ? 'exterior' : 'interior',
      a: { ...seg.a },
      b: { ...seg.b },
      thickness: outside ? WALL_THICKNESS.exterior : WALL_THICKNESS.interior,
      height: wallHeight,
      roomIds: [],
      openings: [],
      material: outside ? 'exterior.render' : 'interior.partition',
    };
    walls.push(wall);
    exteriorWallBySegment.set(seg, wall);
  }

  // ── 2. interior partitions ──────────────────────────────────────────────
  const partitions: DoorCandidate[] = [];
  const seenPairs = new Set<string>();

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!;
      const b = rooms[j]!;
      if (a.floorId !== b.floorId) continue;
      const key = [a.id, b.id].sort().join('|');
      if (seenPairs.has(key)) continue;

      const ra = rectOf(a);
      const rb = rectOf(b);

      // Shared horizontal edge (a above b, or b above a).
      const horizTouch =
        Math.abs(ra.y + ra.depth - rb.y) < TOL.join || Math.abs(rb.y + rb.depth - ra.y) < TOL.join;
      if (horizTouch) {
        const x0 = Math.max(ra.x, rb.x);
        const x1 = Math.min(ra.x + ra.width, rb.x + rb.width);
        if (x1 - x0 > TOL.length) {
          seenPairs.add(key);
          const y = Math.abs(ra.y + ra.depth - rb.y) < TOL.join ? ra.y + ra.depth : rb.y + rb.depth;
          partitions.push({
            wall: makeWall(floor.id, 'interior', { x: x0, y }, { x: x1, y }, wallHeight),
            rooms: [a, b],
            span: x1 - x0,
          });
        }
        continue;
      }

      const vertTouch =
        Math.abs(ra.x + ra.width - rb.x) < TOL.join || Math.abs(rb.x + rb.width - ra.x) < TOL.join;
      if (vertTouch) {
        const y0 = Math.max(ra.y, rb.y);
        const y1 = Math.min(ra.y + ra.depth, rb.y + rb.depth);
        if (y1 - y0 > TOL.length) {
          seenPairs.add(key);
          const x = Math.abs(ra.x + ra.width - rb.x) < TOL.join ? ra.x + ra.width : rb.x + rb.width;
          partitions.push({
            wall: makeWall(floor.id, 'interior', { x, y: y0 }, { x, y: y1 }, wallHeight),
            rooms: [a, b],
            span: y1 - y0,
          });
        }
      }
    }
  }
  walls.push(...partitions.map((p) => p.wall));

  // ── 3. the entrance ────────────────────────────────────────────────────
  // Placed BEFORE the windows. The door is a given and the glazing is not: a
  // house with no way in is not a house, while a house with one fewer window
  // is only slightly darker. Windows are then laid out around it.
  //
  // The centre of the wall is preferred, because that is where a front door
  // wants to be; the validator flags the plan if nothing is free at all.
  const entranceRoom =
    (opts.entranceRoomId && rooms.find((r) => r.id === opts.entranceRoomId)) ||
    indoor.find((r) => r.isEntrance) ||
    indoor.find((r) => r.kind === 'lobby') ||
    indoor.find((r) => r.kind === 'hall') ||
    indoor.find((r) => r.kind === 'living') ||
    indoor[0];

  if (entranceRoom && floor.order === 0) {
    const frontSegs = boundary.filter((s) => front.includes(s.facing));
    const roomSegs = frontSegs.filter((s) => segmentTouchesRoom(s, entranceRoom));
    const ranked = (roomSegs.length ? roomSegs : frontSegs)
      .filter((s) => segmentLength(s) > 1.6)
      .sort((a, b) => segmentLength(b) - segmentLength(a));
    for (const seg of ranked) {
      const wall = exteriorWallBySegment.get(seg);
      if (!wall) continue;
      const L = segmentLength(seg);
      const width = Math.min(OPENING_DEFAULTS.entranceDoor.width, L - 0.4);
      if (width <= 0.8) continue;

      const taken = openingsOn(wall, L);
      const free = freeCentres(L, width, taken);
      const mid = free.find((c) => Math.abs(c - L / 2) < width / 2) ?? free[0];
      if (mid === undefined) continue;

      wall.openings.push({
        id: newId('op'),
        kind: 'door',
        offset: mid,
        width,
        height: OPENING_DEFAULTS.entranceDoor.height,
        sill: 0,
        hinge: 'start',
        material: 'door.timber',
      });
      break;
    }
  }

  // ── 4. windows on the boundary ──────────────────────────────────────────
  // Each boundary wall is bounded by exactly one room (reindex computes this).
  for (const seg of boundary) {
    const wall = exteriorWallBySegment.get(seg);
    if (!wall) continue;
    // A wall that turned out to be a partition — because it bounds the
    // stairwell rather than the street — is not glazed.
    if (wall.type !== 'exterior') continue;
    const L = segmentLength(seg);
    if (L < 1.2) continue;

    // One window per stretch of wall, never zero.
    let count = Math.min(4, Math.max(1, Math.round(L / WALL_PER_WINDOW)));
    // A service room gets a smaller opening; a living room gets more.
    const bounded = roomAlongSegment(seg, indoor);
    if (bounded && ['bathroom', 'utility', 'storage', 'pantry', 'garage'].includes(bounded.kind)) {
      count = Math.min(count, 1);
    }

    const width = Math.min(1.9, Math.max(0.9, (L - 0.5) / count - 0.3));
    // Take the first free runs along the wall rather than fixed stations, so a
    // window can never land on top of an opening placed earlier (the front
    // door, most often).
    const taken = openingsOn(wall, L);
    const slots = freeCentres(L, width, taken).slice(0, count);
    for (const offset of slots) {
      wall.openings.push({
        id: newId('op'),
        kind: 'window',
        offset,
        width,
        height: 1.4,
        sill: 0.9,
        material: 'glass.clear',
      });
    }
  }

  // ── 5. interior doors and openings ──────────────────────────────────────
  //
  // A door is not a consequence of two rooms touching. It is a decision about
  // which way you walk into a room, and a room has one of those — the wall it
  // shares with the space you arrive from.
  //
  // Putting an opening on every partition made a bedroom touching a corridor, a
  // bathroom and its neighbour collect three doors, and gave a wall between two
  // bedrooms a hole in it. Both are things no plan contains. So doors are now
  // *chosen*: each private room ranks the partitions it touches and takes the
  // best one, and a partition is only a door if it won for both of its rooms.
  const doorFor = chooseDoorPartitions(
    // A partition that bounds the flight is not offered as a way into a room.
    //
    // The stairwell is a room now, so the walls between it and the rooms
    // beside it are ordinary partitions — and a room that touches it will
    // claim one, putting a dining room door straight onto the treads. The
    // only door that belongs on a wall that bounds the flight is the stair's
    // own door, and `openStairEnds` places that once every floor's walls
    // exist.
    shaft ? partitions.filter((p) => !segmentTouchesShaft({ a: p.wall.a, b: p.wall.b }, shaft)) : partitions,
    opts.preferredDoors ?? new Set(),
    entranceRoom?.id ?? null,
  );

  for (const p of partitions) {
    const rule = doorFor.get(p.wall.id);
    if (!rule) continue;
    const L = p.span;
    const width = Math.min(rule.spec.width, L - 0.4);
    if (width < 0.6) continue;
    p.wall.openings.push({
      id: newId('op'),
      kind: rule.kind,
      offset: L / 2,
      width,
      height: rule.spec.height,
      sill: 0,
      hinge: 'start',
      // Swing into the corridor / circulation side where there is one.
      swing: p.rooms[0].kind === 'corridor' || p.rooms[1].kind === 'corridor' ? 'negative' : 'positive',
    });
  }

  // ── 6. a sensible starting arrangement ──────────────────────────────────
  if (opts.furnish !== false) {
    furniture.push(...furnishFloor(rooms, floor.id, walls));
  }

  return { walls, furniture };
}

// ────────────────────────────────────────────────────── opening placement ────

/** The spans already occupied on a wall, as [start, end] along its centreline. */
function openingsOn(wall: Wall, length: number): Array<[number, number]> {
  return wall.openings
    .map((o): [number, number] => [
      Math.max(0, o.offset - o.width / 2),
      Math.min(length, o.offset + o.width / 2),
    ])
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Centres at which an opening of `width` fits on a wall of length `length`
 * without touching `taken` and without running off either end.
 *
 * Real openings need a jamb, so every gap is trimmed by `pad` on each side.
 * Returning the centre of each surviving gap means callers can prefer the
 * middle of a wall and fall back to whatever room is left.
 */
function freeCentres(length: number, width: number, taken: Array<[number, number]>): number[] {
  const pad = 0.15;
  const spans: Array<[number, number]> = [];
  let cursor = pad;
  for (const [s, e] of taken) {
    if (s - cursor >= width) spans.push([cursor, s - pad]);
    cursor = Math.max(cursor, e + pad);
  }
  if (length - pad - cursor >= width) spans.push([cursor, length - pad]);
  return spans.map(([a, b]) => (a + b) / 2);
}

function makeWall(floorId: Id, type: Wall['type'], a: { x: number; y: number }, b: { x: number; y: number }, height: number): Wall {
  return {
    id: newId('wl'),
    floorId,
    type,
    a,
    b,
    thickness: WALL_THICKNESS[type] ?? WALL_THICKNESS.interior,
    height,
    roomIds: [],
    openings: [],
    material: type === 'exterior' ? 'exterior.render' : 'interior.partition',
  };
}

/**
 * How much of a boundary segment a room shares, in metres.
 *
 * A segment is an edge of one room, and the room next door has an edge along
 * part of it. "Touches" has to mean *shares a stretch of wall*, not *meets at
 * a point*: two rooms side by side meet at a corner, and a corner is not a
 * wall. The old test was satisfied by a shared corner, which is how the front
 * door came to be placed on the dining room's wall when the entrance was the
 * living room — both front segments touched the living room at its corner,
 * and the longer one won.
 */
function sharedWallLength(s: BoundarySegment, r: Room): number {
  const rr = rectOf(r);
  const horizontal = Math.abs(s.a.y - s.b.y) < TOL.length;
  const vertical = Math.abs(s.a.x - s.b.x) < TOL.length;
  if (!horizontal && !vertical) return 0;

  // The segment and the room have to lie on the same line.
  const fixed = horizontal ? s.a.y : s.a.x;
  const roomLow = horizontal ? rr.y : rr.x;
  const roomHigh = horizontal ? rr.y + rr.depth : rr.x + rr.width;
  if (Math.abs(fixed - roomLow) > TOL.join && Math.abs(fixed - roomHigh) > TOL.join) return 0;

  // And they have to share a stretch of that line, not merely meet at a point.
  const s0 = horizontal ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y);
  const s1 = horizontal ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y);
  const r0 = horizontal ? rr.x : rr.y;
  const r1 = horizontal ? rr.x + rr.width : rr.y + rr.depth;
  return Math.min(s1, r1) - Math.max(s0, r0);
}

function segmentTouchesRoom(s: BoundarySegment, r: Room): boolean {
  return sharedWallLength(s, r) > TOL.join;
}

/**
 * The room whose wall a boundary segment is.
 *
 * When two rooms sit side by side on the street, each front segment runs from
 * their shared corner to the next corner, and both segments have an edge
 * within a tolerance of the other room's. Taking the first room that matches
 * an edge therefore picks whichever comes first in the list, not the room the
 * segment actually belongs to. The room that shares the longest stretch of
 * the segment is the one it belongs to.
 */
function roomAlongSegment(s: BoundarySegment, rooms: Room[]): Room | undefined {
  let best: Room | undefined;
  let bestLen = TOL.join;
  for (const r of rooms) {
    const len = sharedWallLength(s, r);
    if (len > bestLen) {
      best = r;
      bestLen = len;
    }
  }
  return best;
}

// ──────────────────────────────────────────────────────────── furnishing ─────

/**
 * Furnish a floor as a room someone could actually sit in.
 *
 * The earlier version placed one or two pieces per room — a sofa and a coffee
 * table, a counter run and a fridge — which is enough to stop a plan reading as
 * empty and not nearly enough to read as a home. A kitchen with no sink or
 * hob is a counter; a living room with no television, no rug and nowhere to put
 * a second person is a showroom. This places the pieces a room needs to work:
 * somewhere to sit facing something, something to cook on, somewhere to put a
 * cup of tea.
 *
 * It is still a starting point for the user to change, not a claim about design
 * quality, and `push` refuses anything that would not survive the validator, so
 * a cramped room gets fewer pieces rather than a wrong one.
 */
export function furnishFloor(rooms: Room[], floorId: Id, walls: Wall[] = []): FurnitureItem[] {
  const out: FurnitureItem[] = [];

  /**
   * The floor area each door sweeps, keyed by the room it opens into.
   *
   * A door is not a hole in a wall, it is a quarter-disc of floor nobody may
   * put a sofa in. The validator already reports furniture blocking a swing,
   * but a warning the app generates on its own first load is a warning the
   * user has to clear before they have touched anything — so the furnisher
   * keeps clear of the swings it is given rather than parking a bathtub in
   * one and calling it a starting arrangement.
   *
   * The swing belongs to the room on its open side, found by testing the
   * polygon's centroid: it is inside the hull by construction and always on
   * the same side of the wall as the leaf.
   */
  const swingsByRoom = new Map<Id, Vec2[][]>();
  for (const w of walls) {
    for (const o of w.openings) {
      if (o.kind !== 'door' && o.kind !== 'doorway') continue;
      const poly = doorSwingPolygon(w, o);
      if (poly.length < 3) continue;
      const mid = poly.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
      const cx = mid.x / poly.length;
      const cy = mid.y / poly.length;
      const room = rooms.find((r) => cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.depth);
      if (!room) continue;
      const list = swingsByRoom.get(room.id);
      if (list) list.push(poly);
      else swingsByRoom.set(room.id, [poly]);
    }
  }

  /**
   * The floor a person needs in front of a door, keyed by the room it opens
   * into.
   *
   * A door is three things: a hole in the wall, a leaf that sweeps across it,
   * and the space a person stands in to come through. The first two are the
   * swing, and the swing is already kept clear above. The third is not — and
   * it is the one that matters for a house you can walk through.
   *
   * A dining table pushed up against the wall that carries the stair door is
   * a table in front of a door: the room is split in two by furniture, and
   * nothing in the plan says so. The strip below is as wide as the opening and
   * deep enough for somebody to stand and step through, and it is put on both
   * sides of the wall, because the side the leaf opens into is the side you
   * come *from* as often as the side you go into.
   *
   * Wide cased openings are NOT in this list. A 1.5 m hole between two rooms
   * is a way through, but it is a way through with a metre of slack on either
   * side, and furniture against the wall beside it is normal. Treating it as
   * a doorway took the worktop out of every kitchen that had one, because a
   * kitchen is a small room with a wide opening in it. Those walls are ranked
   * last instead, by `wallPenalty`.
   */
  const DOOR_APPROACH = 0.7;
  const approachesByRoom = new Map<Id, Vec2[][]>();
  for (const w of walls) {
    const f = wallFrame(w);
    for (const o of w.openings) {
      if (o.kind !== 'door' && o.kind !== 'doorway') continue;
      const centre = { x: w.a.x + f.dir.x * o.offset, y: w.a.y + f.dir.y * o.offset };
      const half = o.width / 2 + 0.05;
      for (const side of [1, -1] as const) {
        const depth = DOOR_APPROACH * side;
        const poly: Vec2[] = [
          { x: centre.x - f.dir.x * half, y: centre.y - f.dir.y * half },
          { x: centre.x + f.dir.x * half, y: centre.y + f.dir.y * half },
          {
            x: centre.x + f.dir.x * half + f.normal.x * depth,
            y: centre.y + f.dir.y * half + f.normal.y * depth,
          },
          {
            x: centre.x - f.dir.x * half + f.normal.x * depth,
            y: centre.y - f.dir.y * half + f.normal.y * depth,
          },
        ];
        const mx = centre.x + (f.normal.x * depth) / 2;
        const my = centre.y + (f.normal.y * depth) / 2;
        const room = rooms.find((r) => mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.depth);
        if (!room) continue; // the far side of an exterior wall: outside the house
        const list = approachesByRoom.get(room.id);
        if (list) list.push(poly);
        else approachesByRoom.set(room.id, [poly]);
      }
    }
  }

  /**
   * The usable rectangle inside a room.
   *
   * A wall's centreline lies ON the room's edge, not on its inner face, so a
   * room rectangle is the *structural* outline: half of each bounding wall's
   * thickness projects into the space. Furniture has to be kept out of that
   * band or the validator — correctly — reports it as embedded in a wall.
   */
  const insetCache = new Map<Id, Rect>();
  /** The wall of the room that runs along `side`, if the room has one there. */
  const wallOn = (room: Room, side: Side): Wall | null => {
    for (const w of walls) {
      const horiz = Math.abs(w.b.y - w.a.y) < Math.abs(w.b.x - w.a.x);
      const lo = horiz ? Math.min(w.a.x, w.b.x) : Math.min(w.a.y, w.b.y);
      const hi = horiz ? Math.max(w.a.x, w.b.x) : Math.max(w.a.y, w.b.y);
      const edgeLo = horiz ? room.x : room.y;
      const edgeHi = horiz ? room.x + room.width : room.y + room.depth;
      if (hi <= edgeLo + TOL.join || lo >= edgeHi - TOL.join) continue;
      const pos = horiz ? (w.a.y + w.b.y) / 2 : (w.a.x + w.b.x) / 2;
      const at = side === 'n' ? room.y : side === 's' ? room.y + room.depth : side === 'w' ? room.x : room.x + room.width;
      if (Math.abs(pos - at) <= TOL.join) return w;
    }
    return null;
  };

  const innerRect = (room: Room): Rect => {
    const cached = insetCache.get(room.id);
    if (cached) return cached;
    const ins = { n: 0, s: 0, w: 0, e: 0 };
    for (const w of walls) {
      const horiz = Math.abs(w.b.y - w.a.y) < Math.abs(w.b.x - w.a.x);
      const lo = horiz ? Math.min(w.a.x, w.b.x) : Math.min(w.a.y, w.b.y);
      const hi = horiz ? Math.max(w.a.x, w.b.x) : Math.max(w.a.y, w.b.y);
      // Does this wall actually run along any part of the room's edge?
      const edgeLo = horiz ? room.x : room.y;
      const edgeHi = horiz ? room.x + room.width : room.y + room.depth;
      if (hi <= edgeLo + TOL.join || lo >= edgeHi - TOL.join) continue;
      const pos = horiz ? (w.a.y + w.b.y) / 2 : (w.a.x + w.b.x) / 2;
      const half = w.thickness / 2 + 0.02;
      if (horiz) {
        if (Math.abs(pos - room.y) <= TOL.join) ins.n = Math.max(ins.n, half);
        if (Math.abs(pos - (room.y + room.depth)) <= TOL.join) ins.s = Math.max(ins.s, half);
      } else {
        if (Math.abs(pos - room.x) <= TOL.join) ins.w = Math.max(ins.w, half);
        if (Math.abs(pos - (room.x + room.width)) <= TOL.join) ins.e = Math.max(ins.e, half);
      }
    }
    const box: Rect = {
      x: room.x + ins.w,
      y: room.y + ins.n,
      width: Math.max(0, room.width - ins.w - ins.e),
      depth: Math.max(0, room.depth - ins.n - ins.s),
    };
    insetCache.set(room.id, box);
    return box;
  };

  /**
   * The height band a piece actually occupies, in metres above the floor.
   *
   * A floor-standing piece occupies `0 → height`. A wall-hung one starts at the
   * height it is fixed at, which is what lets a wall cabinet share a stretch of
   * wall with a counter run: they do not intersect in the vertical, so one above
   * the other is correct rather than an overlap.
   *
   * `itemBand` and `bandsClear` live in the catalogue because the validator
   * applies the identical rule — a rug is meant to go under things, and the
   * furnisher and the checker have to agree or the app opens with warnings
   * about its own furniture.
   */

  /**
   * Place an item by its CENTRE point, refusing to place it when the result
   * would be wrong. Two guards, both non-negotiable:
   *
   *  - it must sit entirely inside the room's USABLE rectangle;
   *  - it must not overlap something already placed in that room.
   *
   * Anything that fails is dropped rather than clamped into a wall, because a
   * validator that flags our own furniture would make the generated plan look
   * broken on first load — and the user would be right.
   */
  const push = (room: Room, catalogId: string, x: number, y: number, rotation = 0): boolean => {
    const c = catalogById.get(catalogId);
    if (!c) return false;
    const { w: fw, d: fd } = footprintDims(c, rotation);

    const inner = innerRect(room);
    const minX = inner.x + fw / 2;
    const maxX = inner.x + inner.width - fw / 2;
    const minY = inner.y + fd / 2;
    const maxY = inner.y + inner.depth - fd / 2;
    if (minX > maxX || minY > maxY) return false; // does not fit at all

    const px = Math.min(maxX, Math.max(minX, x));
    const py = Math.min(maxY, Math.max(minY, y));
    const box = { x: px - fw / 2, y: py - fd / 2, width: fw, depth: fd };
    const mine = itemBand(catalogId, c.height);

    for (const other of out) {
      if (other.roomId !== room.id) continue;
      if (bandsClear(mine, itemBand(other.catalogId, other.height))) continue;
      const ob = footprintOfItem(other);
      if (rectOverlapArea(box, ob) > 0.0005) return false;
    }

    // And the door swings that open into this room.
    const swings = swingsByRoom.get(room.id);
    if (swings) {
      // The item's own width/depth with the rotation, exactly as it is stored
      // and as the validator will read it back. Passing the already-swapped
      // footprint here would apply the quarter turn twice, and a sofa would be
      // tested against a mirror image of itself.
      const obb = obbOfItem({ x: px, y: py, width: c.width, depth: c.depth, rotation });
      for (const swing of swings) if (polygonObbOverlap(swing, obb)) return false;
    }

    // And the floor in front of the doors and openings that give this room
    // its way in and out.
    const approaches = approachesByRoom.get(room.id);
    if (approaches) {
      const obb = obbOfItem({ x: px, y: py, width: c.width, depth: c.depth, rotation });
      for (const strip of approaches) if (polygonObbOverlap(strip, obb)) return false;
    }

    out.push({
      id: newId('fu'),
      floorId,
      roomId: room.id,
      catalogId: c.id,
      label: c.label,
      x: px,
      y: py,
      width: c.width,
      depth: c.depth,
      height: c.height,
      rotation,
      color: c.color,
    });
    return true;
  };

  /**
   * Place an item against one wall, `offset` metres along it.
   *
   * The rotation is not chosen here but looked up: every assembly is modelled
   * with its back at local -Z, and `BACK_TO_WALL` turns that back at the wall
   * the piece is being placed against. Getting that backwards is invisible in
   * a plan view and obvious in a photograph, so the mapping is a table rather
   * than an expression.
   */
  const onWall = (room: Room, catalogId: string, side: Side, offset: number): FurnitureItem | null => {
    const c = catalogById.get(catalogId);
    if (!c) return null;
    const inner = innerRect(room);
    const along = ALONG_WALL[side];
    const backGap = 0.06;
    const x =
      side === 'w'
        ? inner.x + backGap + c.depth / 2
        : side === 'e'
          ? inner.x + inner.width - backGap - c.depth / 2
          : room.x + room.width / 2 + along.x * offset;
    const y =
      side === 'n'
        ? inner.y + backGap + c.depth / 2
        : side === 's'
          ? inner.y + inner.depth - backGap - c.depth / 2
          : room.y + room.depth / 2 + along.y * offset;
    if (!push(room, catalogId, x, y, BACK_TO_WALL[side])) return null;
    return inRoom(room).at(-1) ?? null;
  };

  /**
   * The stretch of a wall an opening takes up, measured along the wall.
   *
   * A wall runs from `a` to `b`, and an opening's offset is measured from `a`
   * along that run — so a wall drawn right-to-left puts its openings at the
   * other end from the one the offset suggests. Measuring from the wall's
   * lower end instead would put a window in the wrong place on half the walls
   * in the house.
   */
  const openingSpan = (w: Wall, o: Opening): [number, number] => {
    const f = wallFrame(w);
    const centre = f.dir.x !== 0 ? w.a.x + f.dir.x * o.offset : w.a.y + f.dir.y * o.offset;
    return [centre - o.width / 2, centre + o.width / 2];
  };

  /**
   * How much a wall gets in the way of a piece standing against it.
   *
   *  - 0: nothing there. The piece can have the wall to itself.
   *  - 1: a window. The piece blocks the daylight, which is a matter of taste.
   *  - 2: a door or a cased opening. The piece stands in somebody's way, and
   *    that is not a matter of taste.
   *
   * The two are ranked rather than lumped together because they are not the
   * same complaint. A wardrobe in front of a window is a wall with a hole
   * behind it, and the room loses the daylight that made it worth having; a
   * sofa in front of a door is a room you cannot walk through. Ranking them
   * separately is what lets the dining table go to the windowed wall of the
   * dining room instead of the one with the stair door in it.
   */
  const wallPenalty = (room: Room, side: Side, span: number): number => {
    const w = wallOn(room, side);
    if (!w) return 0;
    const horizontal = side === 'n' || side === 's';
    const centre = horizontal ? room.x + room.width / 2 : room.y + room.depth / 2;
    const from = centre - span / 2;
    const to = centre + span / 2;
    let worst = 0;
    for (const o of w.openings) {
      const [lo, hi] = openingSpan(w, o);
      if (!(lo < to - 0.05 && hi > from + 0.05)) continue;
      if (o.kind === 'window') worst = Math.max(worst, 1);
      else worst = Math.max(worst, 2);
    }
    return worst;
  };

  /**
   * Place an item with its back to a wall, trying each wall in turn.
   *
   * The first wall is the preferred one — the bed goes to the north wall, the
   * sofa wherever it has the longest run. The rest are the fallbacks, and they
   * exist because a living room in a generated plan can have four doors opening
   * into it: once a wall is claimed by a swing, the piece slides along it, and
   * once the whole wall is claimed, the piece moves to the next one. Giving up
   * on the room entirely is the one outcome worth avoiding.
   *
   * Within that preference, the walls are ranked by how much they get in the
   * way: a solid wall first, then a wall with a window in it, then a wall with
   * a door or a cased opening in it. So the default answer is a solid wall and
   * a holed one is the exception rather than the rule.
   *
   * Returns the wall it ended up on, because "put the television opposite the
   * sofa" is not a thing that can be worked out later.
   */
  const against = (room: Room, catalogId: string, sides: Side | readonly Side[]): Side | null => {
    const c = catalogById.get(catalogId);
    if (!c) return null;
    const wanted = typeof sides === 'string' ? [sides] : [...sides];
    // Stable sort by how much the wall gets in the way: the order the caller
    // asked for is kept among walls that are equally good.
    const ranked = wanted
      .map((side, i) => ({
        side,
        i,
        penalty: wallPenalty(room, side, footprintDims(c, BACK_TO_WALL[side])[side === 'n' || side === 's' ? 'w' : 'd']),
      }))
      .sort((a, b) => a.penalty - b.penalty || a.i - b.i);
    for (const { side } of ranked) {
      for (const slide of [0, 0.55, -0.55, 1.1, -1.1, 1.65, -1.65, 2.2, -2.2]) {
        if (onWall(room, catalogId, side, slide)) return side;
      }
    }
    return null;
  };

  /** The pieces already in `room`, in placement order. */
  const inRoom = (room: Room): FurnitureItem[] => out.filter((f) => f.roomId === room.id);

  /**
   * Place a piece on the same wall as `anchor`, immediately beside it.
   *
   * This is how a kitchen gets a sink and a hob *alongside the run* rather than
   * three separate walls: a sink 2 m from the worktop is a sink in the passage.
   * The right-hand side is tried first simply because that is the side people
   * reach for first; when it is taken the other side is nearly as good.
   */
  const beside = (room: Room, catalogId: string, anchor: FurnitureItem, side: Side, gap = 0.02): FurnitureItem | null => {
    const c = catalogById.get(catalogId);
    if (!c) return null;
    const rot = BACK_TO_WALL[side];
    const along = ALONG_WALL[side];
    const mine = footprintDims(c, rot);
    const anchorBox = footprintOfItem(anchor);
    const mineHalf = side === 'n' || side === 's' ? mine.w / 2 : mine.d / 2;
    const theirHalf = side === 'n' || side === 's' ? anchorBox.width / 2 : anchorBox.depth / 2;
    for (const sign of [1, -1]) {
      const off = (theirHalf + mineHalf + gap) * sign;
      const x = anchor.x + along.x * off;
      const y = anchor.y + along.y * off;
      if (push(room, catalogId, x, y, rot)) return inRoom(room).at(-1) ?? null;
    }
    return null;
  };

  /**
   * Put a rug under a group of pieces, centred on where the group actually
   * landed rather than on the room.
   *
   * The rug is turned the same way as the group: a rug laid square to the room
   * under a sofa that stands against the side wall sticks out a metre past the
   * sofa's back. The members are expected to share a rotation, which every
   * group this is called with does — a sofa and what is grouped with it are all
   * placed against the same wall.
   *
   * Last, because a rug is the one thing that is *meant* to go under: placed
   * first it would claim the floor and everything else would be refused. The
   * overlap test exempts anything 5 cm or less tall, so nothing is reported.
   */
  const rugUnder = (room: Room, ...members: FurnitureItem[]) => {
    const rug = catalogById.get('rug');
    if (!rug || members.length === 0) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const m of members) {
      const b = footprintOfItem(m);
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width);
      y1 = Math.max(y1, b.y + b.depth);
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    push(room, 'rug', cx, cy, members[0]!.rotation);
    // Only keep a rug that actually reads as a rug under the group rather than
    // one clipped to the room and sitting half under nothing.
    const placed = inRoom(room).find((f) => f.catalogId === 'rug');
    if (!placed) return;
    const b = footprintOfItem(placed);
    const covered = (x0 >= b.x - 0.01 && y0 >= b.y - 0.01 && x1 <= b.x + b.width + 0.01 && y1 <= b.y + b.depth + 0.01);
    if (!covered) {
      out.splice(out.indexOf(placed), 1);
    }
  };

  for (const room of rooms) {
    switch (room.kind) {
      case 'living': {
        const sofaSide =
          room.width >= 3.4 && room.depth >= 3.4
            ? against(room, 'sofa-3', LIVING_WALLS)
            : room.width >= 2.2 || room.depth >= 2.4
              ? against(room, 'sofa-2', LIVING_WALLS)
              : null;
        const sofa = inRoom(room).find((f) => f.catalogId.startsWith('sofa'));
        if (!sofa || !sofaSide) break;

        // Coffee table: a stride in front of the sofa, on its axis, so it is
        // something you can put a cup on rather than a table in the passage.
        const away = { x: -OUTWARD[sofaSide].x, y: -OUTWARD[sofaSide].y };
        const reach = sofa.depth / 2 + 0.55;
        push(room, 'coffee-table', sofa.x + away.x * reach, sofa.y + away.y * reach, sofa.rotation);

        // Television on the wall the sofa faces. A room where the sofa and the
        // screen are on the same wall is a room nobody has actually sat in.
        // The wall across is tried first and the others are the fallback,
        // because an empty wall is a worse outcome than a television on the
        // wall beside the window — but never the wall behind the sofa.
        const tvSide = OPPOSITE[sofaSide];
        against(room, 'tv-unit', [tvSide, ...LIVING_WALLS.filter((s) => s !== tvSide && s !== sofaSide)]);

        // A second seat at the end of the sofa, and something green in the far
        // corner. Both are dropped without fuss if the room is too small.
        beside(room, 'armchair', sofa, sofaSide, 0.12);
        against(room, 'plant-large', [tvSide, OPPOSITE[tvSide]]);
        rugUnder(room, sofa);
        break;
      }
      case 'dining': {
        const tableSide = room.width >= 1.5 && room.depth >= 1.5 ? against(room, 'dining-table', LIVING_WALLS) : null;
        const table = inRoom(room).at(-1);
        if (!tableSide || !table || !table.catalogId.startsWith('dining-table')) break;

        // Two chairs on the open side, one at each end: a table with nothing at
        // it is a sideboard.
        const wallward = OUTWARD[tableSide];
        const along = ALONG_WALL[tableSide];
        const box = footprintOfItem(table);
        const halfAlong = (tableSide === 'n' || tableSide === 's' ? box.width : box.depth) / 2;
        const halfOut = (tableSide === 'n' || tableSide === 's' ? box.depth : box.width) / 2;
        const seats: [number, number][] = [
          [-halfAlong * 0.5, -(halfOut + 0.28)],
          [halfAlong * 0.5, -(halfOut + 0.28)],
          [-(halfAlong + 0.28), 0],
          [halfAlong + 0.28, 0],
        ];
        for (const [a, o] of seats) {
          push(
            room,
            'dining-chair',
            table.x + along.x * a + wallward.x * o,
            table.y + along.y * a + wallward.y * o,
            table.rotation,
          );
        }
        break;
      }
      case 'kitchen': {
        const wide = room.width >= room.depth;
        const sides: readonly Side[] = wide ? ['n', 'w', 's', 'e'] : ['w', 'n', 's', 'e'];

        // Where the counter goes is worth a search, because a kitchen that is
        // furnished correctly is mostly a question of where the run sits. Three
        // metres of worktop centred in a 4.4 m wall leaves 70 cm at each end,
        // which will not take an 80 cm sink — so the run is nudged along the
        // wall until the appliances fit, and the arrangement that placed the
        // most of them is the one that is kept.
        const mark = out.length;
        let winner: { side: Side; offset: number; count: number } | null = null;
        // An appliance goes on the run's own wall if it fits there, and across
        // the aisle if it does not — which is the galley kitchen every small
        // plan is trying to be anyway. What it must never do is land on a wall
        // the counter is nowhere near, because a sink 4 m from the worktop is a
        // sink in the wrong house.
        const spot = (id: string, anchor: FurnitureItem, side: Side): boolean =>
          beside(room, id, anchor, side, 0.02) !== null || against(room, id, [OPPOSITE[side]]) !== null;
        // The refrigerator is tall and claims a wall end whatever it is near, so
        // it is judged with the rest: in a small kitchen the run and the fridge
        // share one wall and the sink and hob work the other, which is a real
        // answer rather than a compromise.
        const tall = (): boolean => against(room, 'fridge', ['w', 'e', 'n', 's']) !== null;
        for (const offset of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) {
          for (const side of sides) {
            const trial = out.length;
            const placed = onWall(room, 'kitchen-run', side, offset);
            if (!placed) continue;
            const count =
              (spot('sink', placed, side) ? 1 : 0) + (spot('stove', placed, side) ? 1 : 0) + (tall() ? 1 : 0);
            if (!winner || count > winner.count) winner = { side, offset, count };
            if (count === 3) break;
            out.length = trial;
          }
          if (winner?.count === 3) break;
        }
        out.length = mark; // every trial is rolled back; the winner is placed once

        const run = winner ? onWall(room, 'kitchen-run', winner.side, winner.offset) : null;
        const runSide = winner?.side ?? null;
        if (run && runSide) {
          spot('sink', run, runSide);
          spot('stove', run, runSide);
          // Wall cabinets go over the worktop, backs flush with it.
          const wallward = OUTWARD[runSide];
          const inset = (run.depth - catalogById.get('upper-cabinet')!.depth) / 2;
          push(room, 'upper-cabinet', run.x + wallward.x * inset, run.y + wallward.y * inset, run.rotation);
        }
        if (room.width >= 2.2 && room.depth >= 2.2 && !tall()) against(room, 'fridge', ['w', 'e', 'n', 's']);
        // An island needs a walkway on both sides, so it only appears in a
        // kitchen that is genuinely big enough to have one.
        if (room.width >= 3.6 && room.depth >= 3.2 && runSide) {
          push(room, 'kitchen-island', room.x + room.width / 2, room.y + room.depth / 2, BACK_TO_WALL[runSide]);
        }
        break;
      }
      case 'bedroom': {
        const big = room.width >= 3.3 && room.depth >= 3.3;
        const bedSide = against(room, big ? 'bed-queen' : 'bed-double', BED_WALLS);
        const bed = inRoom(room).at(-1);
        if (bedSide && bed && bed.catalogId.startsWith('bed')) {
          // One nightstand each side of the head, if the wall is long enough.
          beside(room, 'nightstand', bed, bedSide, 0.08);
          beside(room, 'nightstand', bed, bedSide, 0.08);
          // The rug goes at the FOOT of the bed rather than under it. A bed is
          // 2 m long and the rug is 1.7 m, so "under the bed" would mean half
          // of it sticking out the sides.
          const away = { x: -OUTWARD[bedSide].x, y: -OUTWARD[bedSide].y };
          const foot = bed.depth / 2 + catalogById.get('rug')!.depth / 2 + 0.2;
          push(room, 'rug', bed.x + away.x * foot, bed.y + away.y * foot, bed.rotation);
        }
        if (room.width >= 3.0) against(room, 'wardrobe', ['w', 'e', 'n', 's']);
        break;
      }
      case 'guest': {
        against(room, 'bed-single', BED_WALLS);
        if (room.width >= 3.0) against(room, 'wardrobe', ['w', 'e', 'n', 's']);
        break;
      }
      case 'bathroom': {
        // A tub needs a wall to lie along; without one the room gets a shower
        // instead, because a bathroom with neither is a WC with a basin in it.
        const tubbed = room.width >= 1.7 && room.depth >= 1.9
          ? against(room, 'bathtub', room.width >= room.depth ? BED_WALLS : ['w', 'n', 'e', 's']) !== null
          : false;
        if (!tubbed) against(room, 'shower-corner', ['w', 'n', 'e', 's']);
        against(room, 'wc', ['e', 'w', 'n', 's']);
        against(room, 'basin', ['s', 'n', 'e', 'w']);
        break;
      }
      case 'office': {
        const deskSide = room.width >= 1.8 ? against(room, 'desk', ['w', 'n', 'e', 's']) : null;
        const desk = inRoom(room).at(-1);
        if (deskSide && desk) {
          // A chair at the desk and something to put books on. Without these an
          // office is a table in an empty room.
          const wallward = OUTWARD[deskSide];
          const reach = desk.depth / 2 + 0.45;
          push(room, 'armchair', desk.x + wallward.x * reach, desk.y + wallward.y * reach, desk.rotation);
          beside(room, 'shelving', desk, deskSide, 0.1);
        }
        break;
      }
      case 'utility': {
        const machineSide = room.width >= 1.2 && room.depth >= 1.2 ? against(room, 'washing-machine', BED_WALLS) : null;
        const machine = inRoom(room).at(-1);
        if (machineSide && machine) {
          beside(room, 'dryer', machine, machineSide, 0.02);
          against(room, 'water-heater', [OPPOSITE[machineSide]]);
        }
        break;
      }
      default:
        break;
    }
  }

  return out;
}

// ────────────────────────────────────────────────────────────── stairs ───────

/**
 * Place a staircase in a free rectangular gap on a floor, sized to the storey
 * height. Returns null when there is nowhere sensible to put it, which the
 * validation engine then reports rather than guessing.
 *
 * `targetRooms` are the rooms on the floor being arrived at. A gap whose landing
 * falls inside one of them puts the stair into that room; without the preference
 * the largest gap wins, which on a typical plan drops the stair head into a
 * bathroom and leaves the corridor to be reached the long way round.
 */
export function placeStair(
  rooms: Room[],
  freeSpace: Array<{ x: number; y: number; width: number; depth: number }>,
  floor: Floor,
  target: Floor,
  targetRooms: Room[] = [],
): Staircase | null {
  void rooms;
  const rise = Math.abs(target.elevation - floor.elevation);
  if (rise <= 0.2) return null;
  const riserCount = Math.max(8, Math.round(rise / RISER));
  const run = riserCount * GOING;

  const landsIn = (f: { x: number; y: number; width: number; depth: number }) =>
    targetRooms.find(
      (r) => f.x + f.width / 2 >= r.x && f.x + f.width / 2 <= r.x + r.width && f.y + f.depth / 2 >= r.y && f.y + f.depth / 2 <= r.y + r.depth,
    );

  // Prefer a gap in a private (upper-floor) context, big enough for the run,
  // and among those prefer one that arrives somewhere usable upstairs.
  const usable = freeSpace.filter((f) => f.width >= 1.1 && f.depth >= run - 0.4);
  const candidates = [...usable].sort((a, b) => {
    const la = landsIn(a) ? 0 : 1;
    const lb = landsIn(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    return b.width * b.depth - a.width * a.depth;
  });

  const spot = candidates[0];
  if (!spot) return null;

  const vertical = spot.depth >= spot.width;
  return {
    id: newId('st'),
    floorId: floor.id,
    name: `${floor.name} → ${target.name}`,
    x: spot.x + spot.width / 2,
    y: spot.y + (vertical ? run / 2 : spot.depth / 2),
    width: Math.min(1.4, spot.width - 0.2),
    run,
    riserCount,
    direction: 1,
    connectsToFloorId: target.id,
    voidWidth: Math.min(1.4, spot.width - 0.2),
    voidDepth: Math.min(run, spot.depth - 0.2),
    topAtStart: true,
  };
}

// ───────────────────────────────────────────────────────────── stair doors ────

/**
 * A plain internal door.
 *
 * Not the entrance door: this is a door into a stairwell, so a 0.9 m leaf is the
 * right size rather than the 1.1 m a front door wants.
 */
const door = OPENING_DEFAULTS.interiorDoor;

/** How far off the end of a flight its door may be and still be the wall we want. */
const STAIR_DOOR_REACH = 1.3;

/** The rectangle a flight occupies, in plan metres. */
function stairFootprint(s: Staircase): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: s.x - s.width / 2, y0: s.y - s.run / 2, x1: s.x + s.width / 2, y1: s.y + s.run / 2 };
}

/**
 * Whether a point along a wall lies over the flight.
 *
 * A door beside the staircase is not a way onto it, so every candidate position
 * is tested against the flight's own footprint. The margin is half a leaf, so a
 * door set flush with the end of a flight still counts — which is the normal way
 * to arrive at a staircase — and one set clear of it does not.
 */
function overFlight(
  wall: Wall,
  ux: number,
  uy: number,
  offset: number,
  box: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const x = wall.a.x + ux * offset;
  const y = wall.a.y + uy * offset;
  const m = door.width / 2 + TOL.join;
  return x >= box.x0 - m && x <= box.x1 + m && y >= box.y0 - m && y <= box.y1 + m;
}

/** Openings on a wall as spans, skipping one by id. */
function openingsExcept(wall: Wall, length: number, skipId?: Id): Array<[number, number]> {
  return wall.openings
    .filter((o) => o.id !== skipId)
    .map((o): [number, number] => [
      Math.max(0, o.offset - o.width / 2),
      Math.min(length, o.offset + o.width / 2),
    ])
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Which way a door in this wall should swing to open into the flight.
 *
 * `doorLeaf` puts the leaf on the wall's `normal` scaled by the swing sign, so
 * the sign is decided by which side of the wall the flight is on. Walls are
 * authored both ways round and there is no consistent handedness to exploit, so
 * this measures: from the wall's midpoint, along its own normal, towards the
 * middle of the flight.
 */
function swingIntoFlight(
  wall: Wall,
  box: { x0: number; y0: number; x1: number; y1: number },
): 'positive' | 'negative' {
  const f = wallFrame(wall);
  const mx = (wall.a.x + wall.b.x) / 2;
  const my = (wall.a.y + wall.b.y) / 2;
  const towards = (box.x0 + box.x1) / 2 - mx;
  const towardsY = (box.y0 + box.y1) / 2 - my;
  // `doorLeaf` puts `openDir` on `normal * side`, so `side > 0` — the flight on
  // the wall's own positive side — is the `'positive'` swing. Getting this the
  // wrong way round swings the leaf at the wall instead of into the flight,
  // which is the one direction that defeats the reason for choosing it.
  const side = towards * f.normal.x + towardsY * f.normal.y;
  return side < 0 ? 'negative' : 'positive';
}

/**
 * Which way a door in this wall should swing to open *away* from the flight.
 *
 * The mirror of `swingIntoFlight`, and for the same reason: a leaf that opens
 * over the flight is a leaf standing on the stairs it serves, which is what
 * "the staircase blocks the door" looks like in a drawing.
 */
function swingAwayFromFlight(
  wall: Wall,
  box: { x0: number; y0: number; x1: number; y1: number },
): 'positive' | 'negative' {
  return swingIntoFlight(wall, box) === 'positive' ? 'negative' : 'positive';
}

/**
 * Whether a straight segment crosses a rectangle.
 *
 * Liang–Barsky: the segment is clipped against the four sides of the box and
 * anything left over is an intersection. Used to ask where a door's leaf
 * lands, which is a question about a line and a rectangle rather than about
 * the door.
 */
function segmentHitsRect(
  a: Vec2,
  b: Vec2,
  r: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x0, r.x1 - a.x, a.y - r.y0, r.y1 - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/**
 * Which jamb a stair door should hang from.
 *
 * An open leaf stands perpendicular to its wall, so where it lands is decided
 * by which end of the opening it is hung from. Hung from the end nearest the
 * flight, the open leaf lies across the bottom of the flight — the door
 * standing in the way of the stairs it serves. Hung from the far end, it lies
 * beside the flight, on the landing, which is where a door belongs.
 *
 * The choice is measured rather than assumed: both leaves are laid out and
 * the one that does not fall across the flight's own footprint wins. When
 * neither does — the leaf opens away from the flight — the jamb further from
 * the flight's centre line takes it, so the leaf stands to one side of the
 * opening rather than in the middle of the way through.
 */
function stairDoorHinge(
  wall: Wall,
  offset: number,
  swing: 'positive' | 'negative',
  box: { x0: number; y0: number; x1: number; y1: number },
): 'start' | 'end' {
  const f = wallFrame(wall);
  const side = swing === 'negative' ? -1 : 1;
  const half = door.width / 2;
  const centre = { x: wall.a.x + f.dir.x * offset, y: wall.a.y + f.dir.y * offset };
  const leaf = (hingeSign: number) => {
    const hinge = { x: centre.x + f.dir.x * half * hingeSign, y: centre.y + f.dir.y * half * hingeSign };
    const openDir = { x: f.normal.x * side * -hingeSign, y: f.normal.y * side * -hingeSign };
    return { hinge, openEnd: { x: hinge.x + openDir.x * door.width, y: hinge.y + openDir.y * door.width } };
  };
  const crosses = (hingeSign: number) => {
    const l = leaf(hingeSign);
    return segmentHitsRect(l.hinge, l.openEnd, box);
  };
  if (!crosses(-1) && crosses(1)) return 'start';
  if (crosses(-1) && !crosses(1)) return 'end';
  const flightOffset =
    ((box.x0 + box.x1) / 2 - wall.a.x) * f.dir.x + ((box.y0 + box.y1) / 2 - wall.a.y) * f.dir.y;
  return Math.abs(offset - half - flightOffset) >= Math.abs(offset + half - flightOffset)
    ? 'start'
    : 'end';
}

/** Where to put one door on one wall, or `null` if that wall cannot take it. */
function stairDoorOn(
  wall: Wall,
  box: { x0: number; y0: number; x1: number; y1: number },
  want: number,
): { offset: number; displaced: Opening | null; displacedOffset: number | null } | null {
  const L = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  if (L < door.width + 0.2) return null;
  const ux = (wall.b.x - wall.a.x) / L;
  const uy = (wall.b.y - wall.a.y) / L;
  const over = (c: number) => overFlight(wall, ux, uy, c, box);
  const nearest = (list: number[], to: number) =>
    list.reduce((a, b) => (Math.abs(b - to) < Math.abs(a - to) ? b : a));

  // The door goes where it was asked for, whenever there is room for it there.
  //
  // The middle of the nearest free stretch is a reasonable guess and a poor
  // instruction. The stair's own door is wanted at one particular spot — on the
  // landing at the foot of the flight, with its opening ending exactly where
  // the treads begin — and the middle of a stretch is wherever that stretch
  // happens to be, which put the door a third of the way up the flight with the
  // treads under half of it.
  const at = Math.max(door.width / 2, Math.min(L - door.width / 2, want));
  const taken = openingsOn(wall, L);
  if (over(at) && !taken.some(([s, e]) => at - door.width / 2 < e && at + door.width / 2 > s)) {
    return { offset: at, displaced: null, displacedOffset: null };
  }

  const free = freeCentres(L, door.width, taken).filter(over);
  if (free.length) return { offset: nearest(free, want), displaced: null, displacedOffset: null };

  // Every spot over the flight is taken. That is nearly always the window on the
  // stairwell's own wall, and it is the reason the flight reads as leading to a
  // window: there is no door at all, so the only thing at the bottom of the
  // stairs is glass.
  //
  // A door counts as a blocker too. It used not to, and refusing here is what
  // left the stair end with nothing at all — silently, because "the wall I picked
  // could not take it" and "there is nowhere for this door" look identical from
  // outside.
  const inTheWay = wall.openings.filter(
    (o) =>
      over(o.offset) &&
      o.offset - o.width / 2 <= want + door.width / 2 &&
      o.offset + o.width / 2 >= want - door.width / 2,
  );
  // A window is offered up before a door. Both are in the way, but losing
  // daylight is a smaller loss than losing a way through, so the door is only
  // touched when there is no window on the wall to move.
  const blocker = inTheWay.find((o) => o.kind === 'window') ?? inTheWay[0];
  if (!blocker) return null;

  // The window goes. It is put back elsewhere on this wall if the wall has room,
  // and only then — computing the door against a window that has not actually
  // moved is how the two end up overlapping. If it cannot move, it is removed
  // rather than left in the way: a stair you cannot get into is worse than a
  // stairwell with no daylight, and the checks will say so if the loss matters.
  const rest = openingsExcept(wall, L, blocker.id);
  const winFree = freeCentres(L, blocker.width, rest).filter(over);
  const displacedOffset = winFree.length ? nearest(winFree, blocker.offset) : null;
  const afterWindow =
    displacedOffset === null
      ? rest
      : ([
          ...rest,
          [displacedOffset - blocker.width / 2, displacedOffset + blocker.width / 2] as [number, number],
        ].sort((a, b) => a[0] - b[0]) as Array<[number, number]>);
  const doorFree = freeCentres(L, door.width, afterWindow).filter(over);
  // Nowhere on this wall fits a door clear of everything already in it.
  //
  // The old fallback put the door at the blocker's own offset, which — when the
  // blocker had nowhere to move, because the wall was barely longer than the
  // window — meant a door and a window in exactly the same place, overlapping
  // by the width of the door. Refusing is better than that: `openStairEnds`
  // tries the next wall, and if there is none it says so rather than leaving
  // two openings on top of each other.
  if (!doorFree.length) return null;
  return { offset: nearest(doorFree, want), displaced: blocker, displacedOffset };
}

/**
 * Give a staircase a way in at its foot and a way out at its head.
 *
 * Nothing else in the generator does this, and its absence is why a generated
 * two-storey house arrives with a staircase that leads to a window. `placeStair`
 * subtracts the shaft from the packing box and stops there; the walls around it
 * belong to whichever rooms packed next to it, and `chooseDoorPartitions` doors a
 * partition on whether *both* its rooms wanted it — which is almost never a
 * stairwell. Meanwhile `planFloor` puts a window on every boundary segment that
 * bounds no room, and the shaft's near edge is exactly such a segment: it sits on
 * the front elevation. So the flight arrives at a glass wall with nothing beside
 * it.
 *
 * Both ends are punched, at the two places that actually matter: the near end on
 * the storey the flight leaves, the far end on the storey it arrives at. Each
 * end is aimed half a leaf *outside* the flight, so the opening ends where the
 * treads begin rather than lying over them, and any wall within
 * `STAIR_DOOR_REACH` of that target is a candidate — the flanks as well as the
 * end wall, because which of the two has a wall on it depends entirely on what
 * packed beside the shaft.
 *
 * An exterior wall that already has something at the spot is scored worse than an
 * interior one at the same distance. The two candidates sit at a similar distance
 * by construction — the target is half a leaf outside the end of the run, so the
 * end wall is that far off it and a flank is up to half the flight's width — and
 * without the penalty the front elevation wins often enough to matter. It is a
 * tiebreak, not a ban: a bare exterior wall is a perfectly good place for this
 * door, and on a plan where the stair stands alone in its shaft it is the only
 * place for it.
 *
 * Returns a new project. A stair whose ends meet no usable wall at all is left
 * alone rather than having a door forced somewhere it does not belong — and
 * nothing in the checks reports that case, because `stair_not_connected` asks
 * whether a stair *exists* between two floors, not whether anyone can get through
 * it. That gap is real and is left visible rather than papered over here. What
 * is *not* left to chance is anything short of that: no wall within reach, or a
 * wall that would not take the door, each used to end the attempt silently, and
 * a staircase with no door is exactly what this function exists to prevent.
 */
export function openStairEnds(
  project: Project,
  stair: Staircase,
): { project: Project; undoored: Id[] } {
  const box = stairFootprint(stair);
  const walls = project.walls;
  /**
   * Floors this flight failed to get a door on.
   *
   * Reported rather than inferred, because the alternative is what this function
   * used to do: give up quietly and leave glass at the bottom of the stairs, for
   * the user to discover by walking into it. A staircase with no door is a
   * building you cannot move around in, and it has to say so on the plan rather
   * than only in the geometry.
   */
  const undoored: Id[] = [];

  // A flight ascends from `floorId` to `connectsToFloorId`, so the near end of
  // the run belongs to the lower storey and the far end to the upper one. Both
  // are measured from the same end `stairBoxes` measures the treads from.
  const up = stair.direction === 1;
  const near = up ? box.y0 : box.y1;
  const far = up ? box.y1 : box.y0;

  // Each end's door is wanted with its opening *ending* where the flight
  // begins.
  //
  // The door at the foot of a flight is not wanted on the flight. It is wanted
  // on the landing in front of it, with its far jamb at the first tread, so
  // that stepping through it puts you at the bottom of the stairs rather than
  // half a metre under them. Aiming at the middle of the landing instead put
  // half the leaf over the treads, under the flight, with the ramp 45 cm above
  // the floor — a door you could open but not walk through.
  //
  // Half a leaf back, because a leaf is half a leaf long: the door's centre
  // sits one half-width before the flight, so the opening ends exactly at it.
  const half = door.width / 2;
  const outwards = up ? 1 : -1;
  const ends: Array<{
    floorId: Id | null | undefined;
    target: Vec2;
    /** Which way the leaf opens: into the flight, or away from it. */
    swing: 'into' | 'away';
  }> = [
    { floorId: stair.floorId, target: { x: stair.x, y: near - half * outwards }, swing: 'into' },
    { floorId: stair.connectsToFloorId, target: { x: stair.x, y: far + half * outwards }, swing: 'away' },
  ];

  const doors = new Map<Id, Opening[]>();
  const moved = new Map<Id, { opening: Opening; offset: number | null }>();

  for (const end of ends) {
    if (!end.floorId) continue;

    // Every wall on this storey that could host the door, ranked, and — in a
    // second pass — the nearest one whatever its distance.
    //
    // The second pass is not a fallback of convenience. A stairwell with no wall
    // beside it within `STAIR_DOOR_REACH` used to get **no door at all, silently**,
    // because "nothing was close enough" and "nothing was there" looked the same
    // from outside: glass at the bottom of the flight, and a staircase you could
    // only reach by climbing it from the first floor.
    const ranked: Array<{ wall: Wall; want: number; score: number }> = [];
    let nearest: { wall: Wall; want: number; score: number } | null = null;
    for (const w of walls) {
      if (w.floorId !== end.floorId) continue;
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (L < door.width + 0.2) continue;
      const ux = (w.b.x - w.a.x) / L;
      const uy = (w.b.y - w.a.y) / L;
      const along = (end.target.x - w.a.x) * ux + (end.target.y - w.a.y) * uy;
      // The aim point along the wall, held inside it.
      const want = Math.max(0, Math.min(L, along));
      // Distance to the wall as a **segment**, not to the line it lies on.
      //
      // The stairwell's flank is three or four separate walls, every one of them
      // the same perpendicular distance from the flight's centre line, so the
      // perpendicular distance alone cannot say which of them the door belongs
      // at — they all tie, and the tie went to whichever came first in the
      // list. What says it is *where the aim point lands*: the wall whose
      // stretch the aim point falls on, rather than the one it falls off the
      // end of.
      //
      // Getting this wrong put the head-of-flight door at the foot of the
      // flight on the floor above, which is the staircase the user reported as
      // standing across the doorway.
      const across = Math.hypot(
        end.target.x - (w.a.x + ux * want),
        end.target.y - (w.a.y + uy * want),
      );
      if (!nearest || across < nearest.score) nearest = { wall: w, want, score: across };
      if (across > STAIR_DOOR_REACH) continue;

      // Penalised, not excluded, and only when something is already in the way —
      // a bare exterior wall is a perfectly good place for this door, and is the
      // only place for it on a plan where the stair stands alone in its shaft.
      const occupied = w.openings.some(
        (o) =>
          overFlight(w, ux, uy, o.offset, box) &&
          o.offset - o.width / 2 <= want + door.width / 2 &&
          o.offset + o.width / 2 >= want - door.width / 2,
      );
      ranked.push({
        wall: w,
        want,
        score:
          across +
          // An outside wall is a last resort, not a first one.
          //
          // The flanks of a stairwell are all the same distance from the
          // flight's centre line, and the flank that happens to be the street
          // frontage is often the one that comes first in the list — so the
          // stair's own door ended up opening onto the road. A door into the
          // house is worth a short walk across the plan for; a door onto the
          // pavement is not worth any.
          (w.type === 'exterior' ? 0.35 : 0) +
          (w.type === 'exterior' && occupied ? 1.5 : 0),
      });
    }
    ranked.sort((a, b) => a.score - b.score);

    const tries = ranked.map((r) => ({ wall: r.wall, want: r.want }));
    const fb = nearest;
    if (fb && !tries.some((t) => t.wall.id === fb.wall.id)) tries.push({ wall: fb.wall, want: fb.want });

    // Tried **in order**, not taken one and given up on. This is the whole of the
    // intermittency: the best-scoring wall is not always the one that can take a
    // door, because `stairDoorOn` refuses a wall whose stretch over the flight is
    // already occupied by something that is not a window, and the runner-up is
    // very often free. Taking only the first candidate is why the flight arrived
    // at a window *sometimes* and not every time.
    let placed = false;
    for (const t of tries) {
      const spot = stairDoorOn(t.wall, box, t.want);
      if (!spot) continue;

      const list = doors.get(t.wall.id) ?? [];
      // Swing into the flight at its foot, and away from it at its head.
      //
      // The foot door opens into the stairwell: the shaft is subtracted from
      // the packing box before anything is furnished, so the stairwell is the
      // one place on the plan guaranteed to have nothing in it — and a door
      // opening into a room that was furnished before this door existed is
      // exactly how a new opening turns into a `door_swing_blocked` finding.
      //
      // The head door opens the other way. A leaf that swings over the flight
      // is a leaf standing on the stairs, which is the drawing of "the
      // staircase blocks the door" that the user reported; at the top of a
      // flight the door belongs on the landing side.
      const swing =
        end.swing === 'into' ? swingIntoFlight(t.wall, box) : swingAwayFromFlight(t.wall, box);
      list.push({
        id: newId('op'),
        kind: 'door',
        offset: spot.offset,
        width: door.width,
        height: door.height,
        sill: door.sill,
        swing,
        // Hung from the jamb that keeps the open leaf off the flight.
        hinge: stairDoorHinge(t.wall, spot.offset, swing, box),
      });
      doors.set(t.wall.id, list);
      if (spot.displaced) moved.set(t.wall.id, { opening: spot.displaced, offset: spot.displacedOffset });
      placed = true;
      break;
    }
    // No wall on this storey could take one. Say so, rather than leaving the
    // flight to arrive at whatever glass the plan already had there.
    if (!placed) undoored.push(end.floorId);
  }

  if (!doors.size) return { project, undoored };

  return {
    project: {
      ...project,
      walls: walls.map((w) => {
        const add = doors.get(w.id);
        const shift = moved.get(w.id);
        if (!add && !shift) return w;
        let kept = w.openings;
        if (shift) {
          const to = shift.offset;
          kept =
            to === null
              ? // No room left on this wall for the window, so it goes.
                w.openings.filter((o) => o.id !== shift.opening.id)
              : w.openings.map((o) => (o.id === shift.opening.id ? { ...o, offset: to } : o));
        }
        return { ...w, openings: kept.concat(add ?? []) };
      }),
    },
    undoored,
  };
}

/**
 * The partition that stands across the head of a flight, taken out.
 *
 * A flight that arrives at a wall cannot be walked up, and no cleverness in the
 * collision code changes that. The camera climbs the treads and reaches the
 * last one at the storey height; the wall it arrives at is also storey height.
 * The two meet exactly, so the camera's shins are against the wall's top
 * corner at the moment it needs to pass over it. The collision code is right
 * about that — a person climbing the last step of that flight hits that wall.
 * It is the *plan* that is wrong, because the flight physically passes
 * through the line the wall is on.
 *
 * So the partition comes out. The stairwell opens onto the storey the flight
 * arrives at, which is what an open stair off a hall looks like anyway.
 *
 * Only interior partitions are touched, and only the stretch of one that lies
 * over the flight. An exterior wall is the building's edge and is never
 * removed. A partition that runs on well past the flight is *split* rather than
 * taken out whole, because it is also the wall between two rooms that have
 * nothing to do with the stair.
 */
export function clearFlightHead(
  project: Project,
  stair: Staircase,
): { project: Project; cleared: Id[] } {
  const box = stairFootprint(stair);
  const up = stair.direction === 1;
  const headY = up ? box.y1 : box.y0;
  /** The shortest stub of wall worth keeping. */
  const MIN_STUB = 0.4;

  const cleared: Id[] = [];
  const walls: Wall[] = [];

  for (const w of project.walls) {
    if (w.floorId !== stair.floorId || w.type !== 'interior') {
      walls.push(w);
      continue;
    }
    // The partition has to lie along the line the flight's head arrives on.
    if (Math.abs(w.a.y - headY) > TOL.join || Math.abs(w.b.y - headY) > TOL.join) {
      walls.push(w);
      continue;
    }
    // ...and it has to reach across the flight.
    const sx0 = Math.min(w.a.x, w.b.x);
    const sx1 = Math.max(w.a.x, w.b.x);
    const cut0 = Math.max(sx0, box.x0);
    const cut1 = Math.min(sx1, box.x1);
    if (cut1 - cut0 <= TOL.length) {
      walls.push(w);
      continue;
    }

    cleared.push(w.id);

    // The wall's own parameter, from `a` to `b`, so the pieces keep their
    // openings' offsets measured from their own start.
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    const ux = (w.b.x - w.a.x) / L;
    const uy = (w.b.y - w.a.y) / L;
    const s0 = (cut0 - w.a.x) / ux;
    const s1 = (cut1 - w.a.x) / ux;

    const piece = (from: number, to: number, openings: Opening[]): Wall | null => {
      if (to - from < MIN_STUB) return null;
      const a = { x: w.a.x + ux * from, y: w.a.y + uy * from };
      const b = { x: w.a.x + ux * to, y: w.a.y + uy * to };
      return {
        ...w,
        id: newId('wl'),
        a,
        b,
        openings,
      };
    };

    // Openings are kept only where they still sit on the piece they belong to.
    // One that straddles the passage is dropped: a door or a window across the
    // flight's throat is not a thing a person can use.
    const before = w.openings.filter((o) => o.offset + o.width / 2 <= s0 + TOL.length);
    const after = w.openings
      .filter((o) => o.offset - o.width / 2 >= s1 - TOL.length)
      .map((o) => ({ ...o, offset: o.offset - s1 }));

    const left = piece(0, s0, before);
    const right = piece(s1, L, after);
    if (left) walls.push(left);
    if (right) walls.push(right);
  }

  if (!cleared.length) return { project, cleared };
  return { project: { ...project, walls }, cleared };
}

// ───────────────────────────────────────────────────── brief → room list ─────

export interface BriefRoomSpec {
  kind: RoomKind;
  count: number;
  targetArea: number;
  /**
   * A name for this room, unique within the list.
   *
   * It exists so a room can be *named* across stages — an adjacency constraint
   * has to say "these two" without saying where they are. It is NOT an object
   * id: ids are minted by `newId` when the room is built, and a caller-supplied
   * string that could address an existing object would be a hole in the model.
   */
  ref?: string;
  /** Refs of rooms this one must share a doorable edge with. */
  touches?: string[];
  /** Storey the model asked for, 0-based. Absent means "wherever it fits". */
  floor?: number;
}

/** Expand a brief into a concrete list of rooms with target areas. */
export function expandBrief(brief: DesignBrief): BriefRoomSpec[] {
  const specs: BriefRoomSpec[] = [];

  for (const entry of brief.rooms) {
    const per = entry.targetArea ?? brief.preferredAreas[entry.kind] ?? DEFAULT_ROOM_AREA[entry.kind];
    if (per <= 0) continue;
    for (let i = 0; i < entry.count; i++) {
      specs.push({ kind: entry.kind, count: 1, targetArea: per, ref: `${entry.kind}-${i + 1}` });
    }
  }

  // A house always needs a way in.
  if (!specs.some((s) => s.kind === 'living')) {
    specs.unshift({ kind: 'living', count: 1, targetArea: DEFAULT_ROOM_AREA.living, ref: 'living-1' });
  }

  return specs;
}

/**
 * Turn a model program into the same spec list `expandBrief` produces.
 *
 * The shapes are identical on purpose: everything downstream — floor
 * allocation, banding, packing — consumes one type, so a program-driven plan
 * and a brief-driven plan go down exactly the same code. The only difference
 * is where the sizes came from, and that these specs carry refs.
 */
export function specsFromProgram(program: RoomProgram): BriefRoomSpec[] {
  return program.rooms.map((r) => ({
    kind: r.kind,
    count: 1,
    targetArea: r.areaM2,
    ref: r.ref,
    touches: r.touches,
    floor: r.floor,
  }));
}

export { KIND_LABEL, FLOOR_MATERIAL_BY_KIND };
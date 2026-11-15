/**
 * Deterministic brief → floor plan generator.
 *
 * This is what turns "a 15 × 20 plot with 3 bedrooms" into an actual plan
 * without asking the model to invent coordinates. The model reasons about the
 * BRIEF; this file does the arithmetic. That division is deliberate: geometry
 * the model produced by eye would be unreproducible and unvalidatable, whereas
 * geometry produced here can be re-derived, diffed, and checked.
 *
 * Layout strategy — a circulation spine with public and private bands:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  front band: living + dining + kitchen      │   ← public, faces the street
 *   ├─────────────────────────────────────────────┤
 *   │  corridor spine, full width                 │   ← everything connects here
 *   ├─────────────────────────────────────────────┤
 *   │  rear band: bedrooms, bathrooms, service    │   ← private wing
 *   └─────────────────────────────────────────────┘
 *
 * Each band is filled by a recursive binary split that respects target areas
 * and alternates the split axis to keep rooms from becoming slivers. The bands
 * together tile the buildable envelope exactly, so coverage is known before a
 * single wall is drawn.
 */
import { DEFAULT_ROOM_AREA, KIND_LABEL } from './catalog.ts';
import { newId } from './ids.ts';
import { TOL, add, cross, dot, scale, sharedEdgeLength, sub, wallFrame } from './geometry.ts';
import { GOING, RISER, reindex, type OpResult } from './ops.ts';
import { clearFlightHead, doorPairKey, expandBrief, furnishFloor, openStairEnds, planFloor, placeStair, specsFromProgram, type BriefRoomSpec } from './plan.ts';
import { freeSpace } from './measure.ts';
import type { RoomProgram } from './program.ts';
import type {
  DesignBrief,
  Floor,
  Id,
  Project,
  Room,
  RoomKind,
  Vec2,
  Wall,
} from './types.ts';

/** Clear width of a domestic stair flight. */
const STAIR_WIDTH = 1.4;
const CORRIDOR_WIDTH = 1.1;
/**
 * The landing at the foot of the flight, in metres.
 *
 * It has to hold the stair's own door standing clear of the first tread: a
 * 0.9 m leaf needs 0.9 m of landing in front of it, and a little more so that
 * the landing is a place to stand and turn rather than a strip to step over.
 */
const STAIR_LANDING = 0.95;

// ─────────────────────────────────────────────────────────── band packing ─────

export interface Box {
  x: number;
  y: number;
  width: number;
  depth: number;
}

interface Weighted {
  kind: RoomKind;
  area: number;
}

/**
 * The narrowest a room may be, in metres, along either side.
 *
 * A room 0.66 m wide is a strip, not a room: there is no door to put in its
 * short walls, and no way to stand in it. The packer used to make one whenever
 * a small room asked for a small share of a band — the area split handed it a
 * slice a few centimetres wide — and the room then had no way in at all.
 *
 * So the split is clamped: no room is cut thinner than this. The space comes
 * out of the neighbour that was asking for more of the band than the band has,
 * which is the only way a small room can be a room.
 */
const MIN_ROOM_SIDE = 1.2;

/**
 * Keep a split from cutting a room thinner than it can be used at.
 *
 * The area ratio is what the program asked for. When one room wants a very
 * small share of a band, that share can be a slice too thin to stand in, so the
 * ratio is pulled back to the narrowest room the packer will build. The band
 * still fills exactly; the small room gets more than it asked for and its
 * neighbour gets less.
 */
function clampSplit(ratio: number, span: number): number {
  // A box too small to honour the rule is split as it was: there is no width
  // to give back, and a room that cannot be made bigger is better than one
  // that is not built at all.
  if (span < 2 * MIN_ROOM_SIDE) return ratio;
  const min = MIN_ROOM_SIDE / span;
  return Math.min(Math.max(ratio, min), 1 - min);
}

/**
 * Fill `box` exactly with `items`, preserving their area proportions.
 *
 * Binary space partition: split the item list into two groups of roughly equal
 * area, split the box along its LONGER axis, recurse. Alternating on the
 * container's own aspect (rather than a fixed pattern) is what stops rooms
 * degenerating into long ribbons.
 *
 * Unchanged since the model-planned program arrived. The adjacency it asks for
 * is satisfied by the ORDER of `items` — `orderByAdjacency` puts rooms that
 * must touch next to each other, and a contiguous split of the list keeps
 * neighbours next to each other — so the split itself did not have to move.
 * Changing the split point was tried and reverted: it made rooms overlap,
 * because this recursion hands a box to exactly one group and any grouping
 * that yields more boxes than the old one re-cuts the envelope differently.
 */
function pack<T extends Weighted>(box: Box, items: T[]): Array<T & { box: Box }> {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ ...items[0]!, box }];

  // Split the list into two halves of near-equal total area.
  const total = items.reduce((s, i) => s + i.area, 0);
  const running = items.map((i) => i.area);
  const target = total / 2;
  let acc = 0;
  let splitAt = 1;
  for (let i = 0; i < items.length - 1; i++) {
    acc += running[i]!;
    splitAt = i + 1;
    if (acc >= target) break;
  }
  const leftItems = items.slice(0, splitAt);
  const rightItems = items.slice(splitAt);
  const leftArea = leftItems.reduce((s, i) => s + i.area, 0);

  // Split the box along its longer axis so children stay close to square.
  const horizontal = box.width >= box.depth;
  const ratio = clampSplit(total > 0 ? leftArea / total : 0.5, horizontal ? box.width : box.depth);

  const [a, b] = horizontal
    ? [
        { ...box, width: box.width * ratio },
        { ...box, x: box.x + box.width * ratio, width: box.width * (1 - ratio) },
      ]
    : [
        { ...box, depth: box.depth * ratio },
        { ...box, y: box.y + box.depth * ratio, depth: box.depth * (1 - ratio) },
      ];

  return [...pack(a, leftItems), ...pack(b, rightItems)];
}

  /**
 * Group specs by the adjacency the model asked for, and order each group so
 * the packer can honour it.
 *
 * Groups are connected components of the `touches` graph: rooms joined by a
 * constraint travel together, so a constraint can never be silently severed by
 * the stair-shaft subtraction splitting a band in two.
 *
 * Within a connected group the order decides which constraints survive. The
 * packer peels contiguous runs, and a run boundary is the only place two rooms
 * can end up apart — so the rooms touching the fewest others go to the ends,
 * where breaking a constraint costs least. Sorting is total (ref breaks every
 * tie), so the same program packs the same way every time.
 *
 * Groups of one keep their incoming order untouched. A brief with no adjacency
 * in it — every room its own group — therefore reaches the packer in exactly
 * the order it always did, and generates exactly the plan it always did.
 */
export function orderByAdjacency(specs: BriefRoomSpec[]): BriefRoomSpec[][] {
  const byRef = new Map(specs.filter((s) => s.ref).map((s) => [s.ref!, s] as const));

  // Union-find over the `touches` edges. A spec with no ref cannot take part in
  // a constraint, so it is its own group from the start.
  const parent = new Map<string, string>();
  const find = (r: string): string => {
    let root = parent.get(r) ?? r;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = r;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const ref of byRef.keys()) parent.set(ref, ref);

  for (const spec of specs) {
    if (!spec.ref) continue;
    for (const other of spec.touches ?? []) {
      if (!byRef.has(other) || other === spec.ref) continue;
      const a = find(spec.ref);
      const b = find(other);
      if (a !== b) parent.set(a, b);
    }
  }

  // First appearance order, so untouched specs keep their place.
  const groups: BriefRoomSpec[][] = [];
  const indexOfRoot = new Map<string, number>();
  for (const spec of specs) {
    if (!spec.ref) {
      groups.push([spec]);
      continue;
    }
    const root = find(spec.ref);
    const at = indexOfRoot.get(root);
    if (at === undefined) {
      indexOfRoot.set(root, groups.length);
      groups.push([spec]);
    } else {
      groups[at]!.push(spec);
    }
  }

  const degree = new Map<string, number>();
  for (const spec of specs) {
    if (!spec.ref) continue;
    degree.set(spec.ref, (spec.touches ?? []).filter((t) => byRef.has(t) && t !== spec.ref).length);
  }

  return groups.map(chainFor(degree));
}

/**
 * Order one connected group into a chain the packer can honour.
 *
 * A chain is the best a recursive binary split can do: rooms come out in list
 * order, so two rooms satisfy their constraint exactly when they end up
 * consecutive in the list. Each room therefore has at most two neighbours, and
 * the two ENDS of the chain have one.
 *
 * That is the whole reason this is a greedy walk rather than a sort. Sorting by
 * degree puts the most-connected room at an END, where it can only ever be
 * adjacent to one thing — a hub with three connections can never have more than
 * one of them satisfied, however the list is sorted. So: start at the least
 * connected room, because an end is the only place a room with a single
 * connection can go, and then repeatedly append whichever remaining room
 * already touches something placed, which keeps every new room attached to the
 * chain instead of stranded.
 *
 * Ties break on `ref`, so the same program always packs the same way. Maximising
 * satisfied edges in a linear arrangement is NP-hard in general; this is the
 * standard greedy approximation, and what it cannot satisfy is reported as an
 * unmet connection rather than quietly dropped.
 */
function chainFor(degree: Map<string, number>): (group: BriefRoomSpec[]) => BriefRoomSpec[] {
  return (group) => {
    if (group.length < 2) return group;

    const byName = new Map(group.map((s) => [s.ref!, s] as const));
    const key = (s: BriefRoomSpec) => s.ref ?? '';
    const neighbours = (s: BriefRoomSpec) => (s.touches ?? []).filter((t) => byName.has(t) && t !== s.ref);

    const left = [...group];
    // A room with the fewest connections has the fewest ways to be satisfied,
    // so it goes where it can lose least: an end.
    left.sort((a, b) => {
      const da = degree.get(key(a)) ?? 0;
      const db = degree.get(key(b)) ?? 0;
      if (da !== db) return da - db;
      if (b.targetArea !== a.targetArea) return b.targetArea - a.targetArea;
      return key(a).localeCompare(key(b));
    });

    const chain: BriefRoomSpec[] = [left.shift()!];
    const placed = new Set<string>([key(chain[0]!)]);
    const rest = left;

    while (rest.length) {
      let bestAt = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < rest.length; i++) {
        const ns = neighbours(rest[i]!);
        // Attached to the chain beats floating. Among attached, the most
        // constrained goes first, so a room that only has one route to its
        // neighbours gets that route before something else can take it.
        const score = ns.filter((t) => placed.has(t)).length * 100 - ns.filter((t) => !placed.has(t)).length;
        if (score > bestScore) {
          bestScore = score;
          bestAt = i;
        }
      }
      const [next] = rest.splice(bestAt, 1);
      chain.push(next!);
      placed.add(key(next!));
    }
    return chain;
  };
}

/**
 * The shared wall two rooms must have before a door can be put between them.
 *
 * Not `TOL.length`. A partition is created for any shared span over 0.02 m, but
 * `planFloor` step 5 then computes `width = min(spec.width, span - 0.4)` and
 * skips anything under 0.6 m — so a pair sharing half a metre gets a solid wall
 * and no way through. Every door spec in the catalogue is at least 0.8 m wide,
 * which makes 1.0 m the uniform threshold: 0.8 + 0.4 - round-off.
 *
 * Verifying against the wall threshold instead would report "they touch" for a
 * pair you cannot walk between.
 */
const DOOR_MIN_SPAN = 1.0;

export interface AdjacencyReport {
  requested: number;
  satisfied: number;
  /** "Bedroom 1 and Bathroom" for each pair that did not get a doorable wall. */
  unmet: string[];
}

/**
 * Which of the requested connections were actually built?
 *
 * Two filters matter, and both are about not claiming more than happened:
 * rooms on different storeys are skipped, because a pair split across floors
 * cannot be a shared wall however well it was intended; and a pair whose span
 * falls short of a door is reported, not counted.
 */
export function verifyAdjacency(specs: BriefRoomSpec[], rooms: Room[]): AdjacencyReport {
  const byRef = new Map(specs.filter((s) => s.ref).map((s) => [s.ref!, s] as const));
  const roomByRef = new Map<string, Room>();
  for (const r of rooms) {
    if (r.ref && !roomByRef.has(r.ref)) roomByRef.set(r.ref, r);
  }

  const seen = new Set<string>();
  const unmet: string[] = [];
  let requested = 0;
  let satisfied = 0;

  for (const spec of specs) {
    if (!spec.ref) continue;
    for (const other of spec.touches ?? []) {
      if (other === spec.ref || !byRef.has(other)) continue;
      const key = [spec.ref, other].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      requested += 1;

      const a = roomByRef.get(spec.ref);
      const b = roomByRef.get(other);
      // Never placed at all, or deliberately split across storeys.
      if (!a || !b || a.floorId !== b.floorId) {
        unmet.push(`${byRef.get(spec.ref)!.kind} and ${byRef.get(other)!.kind}`);
        continue;
      }
      if (sharedEdgeLength(a, b) >= DOOR_MIN_SPAN) satisfied += 1;
      else unmet.push(`${KIND_LABEL[a.kind] ?? a.kind} and ${KIND_LABEL[b.kind] ?? b.kind}`);
    }
  }

  return { requested, satisfied, unmet };
}

// ──────────────────────────────────────────────────────── floor allocation ────

const PUBLIC: ReadonlySet<RoomKind> = new Set(['living', 'dining', 'kitchen', 'lobby', 'hall', 'office', 'prayer']);
const SERVICE: ReadonlySet<RoomKind> = new Set(['utility', 'pantry', 'storage', 'garage']);
const PRIVATE: ReadonlySet<RoomKind> = new Set(['bedroom', 'guest', 'bathroom']);

function bathroomCount(bedrooms: number, floors: number): number {
  return Math.max(1, Math.min(4, Math.ceil(bedrooms / 2) + (floors > 1 ? 1 : 0)));
}

/**
 * Decide which rooms land on which floor.
 *
 * A spec that names a storey is put there — that is the model having an
 * opinion, and the whole reason the program exists. Everything else is decided
 * by kind, as before: public and service rooms on the ground floor, private
 * rooms spread over the upper ones.
 *
 * Every push spreads the spec (`{ ...s, count: 1 }`) rather than rebuilding it
 * from `kind` and `targetArea`. Rebuilding is what this function used to do,
 * and it silently discarded every other field — which would have thrown away
 * the adjacency refs on the way to the packer and produced a plan that ignored
 * the model with no error to say so.
 */
export function allocateFloors(specs: BriefRoomSpec[], floorCount: number): BriefRoomSpec[][] {
  const floors: BriefRoomSpec[][] = Array.from({ length: floorCount }, () => []);
  const pinned = new Set<string>();

  // Rooms the model placed itself, before anything is derived around them.
  for (const s of specs) {
    if (s.floor === undefined) continue;
    const at = Math.min(floorCount - 1, Math.max(0, s.floor));
    floors[at]!.push({ ...s, count: 1, floor: undefined });
    pinned.add(s.ref ?? '');
  }

  // Bathrooms are derived, not asked for: one per two bedrooms, one more if
  // the house is split over floors so each storey can serve itself.
  const unpinned = specs.filter((s) => !pinned.has(s.ref ?? ''));
  const bedrooms = unpinned.filter((s) => s.kind === 'bedroom' || s.kind === 'guest').reduce((n, s) => n + s.count, 0);
  const neededBaths = bathroomCount(bedrooms, floorCount);
  const haveBaths = unpinned.filter((s) => s.kind === 'bathroom').reduce((n, s) => n + s.count, 0);

  const queue: BriefRoomSpec[] = [...unpinned];
  for (let i = 0; i < neededBaths - haveBaths; i++) {
    queue.push({ kind: 'bathroom', count: 1, targetArea: DEFAULT_ROOM_AREA.bathroom });
  }

  // Ground floor takes public + service + the entrance. Private rooms fill up.
  const ground = floors[0]!;
  const rest = queue.filter((s) => PUBLIC.has(s.kind) || SERVICE.has(s.kind));
  for (const s of rest) for (let i = 0; i < s.count; i++) ground.push({ ...s, count: 1 });

  const privateSpecs = queue.filter((s) => !PUBLIC.has(s.kind) && !SERVICE.has(s.kind));

  // Fill floors round-robin from the top down, so the ground floor keeps the
  // rooms people walk through.
  const upper = floors.slice(1);
  if (upper.length === 0) {
    for (const s of privateSpecs) for (let i = 0; i < s.count; i++) ground.push({ ...s, count: 1 });
  } else {
    // Distribute private rooms evenly across the upper floors, with the ground
    // floor taking the overflow only if there are more than 5 of them.
    const upperCount = upper.length;
    privateSpecs.forEach((s) => {
      for (let i = 0; i < s.count; i++) {
        const target = upper[Math.min(upperCount - 1, Math.floor((i / s.count) * upperCount))]!;
        target.push({ ...s, count: 1 });
      }
    });
  }

  return floors.filter((f) => f.length > 0).length ? floors : [ground];
}

// ───────────────────────────────────────────────────────────────── voids ───────

/**
 * `box` with `hole` removed, as up to four boxes.
 *
 * Used to keep rooms out of a reserved rectangle — the stairwell. Splitting
 * rather than shrinking keeps the remaining floor area intact, so coverage
 * still adds up to the buildable envelope minus the void.
 *
 * Exported because the validator needs the same "what is left over" question
 * answered the same way when it offers to place a missing room.
 */
export function subtractRect(box: Box, hole: Box): Box[] {
  const x0 = Math.max(box.x, hole.x);
  const y0 = Math.max(box.y, hole.y);
  const x1 = Math.min(box.x + box.width, hole.x + hole.width);
  const y1 = Math.min(box.y + box.depth, hole.y + hole.depth);
  const slack = 0.05;
  if (x1 <= x0 + slack || y1 <= y0 + slack) return [box];

  const out: Box[] = [];
  if (y0 > box.y + slack) out.push({ x: box.x, y: box.y, width: box.width, depth: y0 - box.y });
  if (y1 < box.y + box.depth - slack) {
    out.push({ x: box.x, y: y1, width: box.width, depth: box.y + box.depth - y1 });
  }
  if (x0 > box.x + slack) out.push({ x: box.x, y: y0, width: x0 - box.x, depth: y1 - y0 });
  if (x1 < box.x + box.width - slack) out.push({ x: x1, y: y0, width: box.x + box.width - x1, depth: y1 - y0 });
  return out;
}

// ───────────────────────────────────────────────────────────── the generator ───

export interface GenerateOptions {
  /** Replace the project's floors with this many storeys. */
  floorCount?: number;
  /** Add starting furniture. Default true. */
  furnish?: boolean;
  /**
   * A room program the model planned, to be used instead of the brief's own
   * room list. This is where the model's opinion enters: it decides the sizes
   * and which rooms must be neighbours, and the packer below places them. Pass
   * nothing and the generator falls back to the brief's defaults exactly as it
   * always has.
   */
  program?: RoomProgram;
  /**
   * Recorded on the project as `provenance` so the Checks panel can say, for as
   * long as the project exists, who chose these rooms. `plannedBy` is derived
   * from whether a program was actually passed — this field carries only the
   * words, so a caller cannot accidentally stamp "model" on a default layout.
   *
   * `warnings` is here for the same reason as the toast that points at the
   * Checks panel: a repair or a dropped constraint has to be readable next to
   * the plan for as long as the plan exists, not only in a notification that
   * disappears after eleven seconds. A toast that says "see the Checks panel"
   * and then a panel that says nothing is worse than no toast.
   */
  provenanceNote?: { summary?: string; reason?: string; warnings?: string[] };
}

export interface GenerateReport {
  warnings: string[];
  /** Target vs delivered area, per room kind. */
  scale: number;
  floorCount: number;
  /** Connections asked for, delivered, and missed. Absent without a program. */
  adjacency?: AdjacencyReport;
  /** What the model said it was planning, shown to the user. */
  summary?: string;
}

/**
 * What is left of the plot once the setbacks are taken off it.
 *
 * The setbacks can add up to more than the plot, and the old message printed
 * the difference as "-4.00 m" — which reads like a bug rather than a refusal.
 */
function envelopeRefusal(envW: number, envD: number): string {
  if (envW <= 0 || envD <= 0) {
    return 'The setbacks leave nothing to build on — they need more room than the plot has.';
  }
  return `The setbacks leave only ${envW.toFixed(2)} m × ${envD.toFixed(2)} m to build on.`;
}

export function generateFromBrief(
  project: Project,
  brief: DesignBrief,
  options: GenerateOptions = {},
): OpResult<{ report: GenerateReport; project: Project }> {
  const plot = brief.plot;
  const floorCount = Math.max(1, Math.min(4, options.floorCount ?? brief.floorCount));

  const envX = plot.setbacks.left;
  const envY = plot.setbacks.front;
  const envW = plot.width - plot.setbacks.left - plot.setbacks.right;
  const envD = plot.depth - plot.setbacks.front - plot.setbacks.rear;

  if (envW < 4 || envD < 4) {
    return {
      ok: false,
      code: 'conflict',
      error: `${envelopeRefusal(envW, envD)} That is too small for a house.`,
      hint: 'Reduce the setbacks or increase the plot size in the plot settings.',
    };
  }

  const warnings: string[] = [];
  // A program replaces the brief's room list outright — including the number of
  // rooms, which is the part that was wrong. The brief still supplies the plot,
  // the storey count and the style, because those are the user's answers and
  // not the model's to overrule.
  const specs = options.program ? specsFromProgram(options.program) : expandBrief(brief);
  if (options.program && !specs.some((s) => s.kind === 'living')) {
    warnings.push('The planned rooms had no living room, so one was added at the street door.');
  }
  const perFloor = allocateFloors(specs, floorCount);
  const actualFloors = Math.max(1, perFloor.length);
  if (actualFloors < floorCount) {
    warnings.push(`Only ${actualFloors} floor${actualFloors === 1 ? '' : 's'} were needed for this brief, so the design is ${actualFloors === 1 ? 'single-storey' : `${actualFloors} storeys`}.`);
  }

  // ── build the floor shells ──────────────────────────────────────────────
  let next: Project = {
    ...project,
    plot,
    brief,
    // Stamped here rather than by the caller, so a project can never end up
    // carrying a program's geometry under a "no model planned this" label.
    // `plannedBy` follows the one thing that cannot be lied about: whether a
    // program was actually handed to the packer.
    provenance: {
      plannedBy: options.program ? 'model' : 'defaults',
      summary: options.program ? options.provenanceNote?.summary : undefined,
      reason: options.program ? undefined : options.provenanceNote?.reason,
      warnings: options.program ? options.provenanceNote?.warnings : undefined,
      at: Date.now(),
    },
    floors: [],
    rooms: [],
    walls: [],
    stairs: [],
    outdoor: [],
    furniture: [],
  };

  for (let i = 0; i < actualFloors; i++) {
    const floor: Floor = {
      id: newId('fl'),
      name: i === 0 ? 'Ground floor' : `First floor`,
      elevation: 0,
      height: i === 0 ? 3.0 : 2.9,
      order: i,
      roomIds: [],
      wallIds: [],
      stairIds: [],
      outdoorIds: [],
    };
    if (i > 0) {
      const below = next.floors[i - 1]!;
      floor.elevation = below.elevation + below.height;
    }
    next.floors.push(floor);
  }

  // ── the shared band structure ─────────────────────────────────────────
  // Every storey uses the same split, so the stairwell lines up floor to floor
  // and the corridors sit one above the other.
  //
  // The front band has to be deep enough for the flight **and** for a landing
  // at its foot. The flight is fixed by the storey height — 3.0 m of rise at a
  // 180 mm riser is 17 treads of 260 mm, which is 4.42 m of run — and a 0.9 m
  // door standing clear of the first tread wants 0.9 m of landing in front of
  // it. At 0.46 the landing was 0.64 m and the door fitted *over* the treads:
  // it opened onto the bottom step, under the flight, with half a metre of
  // headroom over it. A staircase you cannot get onto is worse than a house
  // with a slightly deeper front room.
  //
  // The extra depth is bought only when there is a flight to land at. A
  // single-storey house has no stairwell in its front band, and the depth goes
  // to the private band instead, where the bedrooms want it.
  const frontDepth = Math.min(
    envD - CORRIDOR_WIDTH,
    Math.max(3.2, envD * (actualFloors > 1 ? 0.54 : 0.46)),
  );
  const corridorY = envY + frontDepth;
  const corridorDepth = CORRIDOR_WIDTH;
  const rearY = corridorY + corridorDepth;
  const rearDepth = envD - (rearY - envY);
  const useSpine = frontDepth >= 3 && rearDepth >= 2.2;

  // The stairwell is reserved BEFORE any room is placed. Hunting for leftover
  // space afterwards means the flight lands wherever the packing happened to
  // leave a gap — on a typical brief, at the back of an upstairs bathroom, with
  // the ground floor's rear band sitting empty. Reserving it also gives the
  // floor above a real void, which is what makes the flight walkable in 3D.
  //
  // It runs down the full depth of the front band against one flank, so
  // subtracting it leaves a single clean rectangle rather than slivers.
  const stairRun = actualFloors > 1
    ? Math.max(8, Math.round((next.floors[1]!.elevation - next.floors[0]!.elevation) / RISER)) * GOING
    : 0;
  const shaft: Box | null =
    actualFloors > 1 && useSpine && stairRun + STAIR_LANDING <= frontDepth
      ? { x: envX + envW - STAIR_WIDTH, y: envY, width: STAIR_WIDTH, depth: frontDepth }
      : null;
  if (actualFloors > 1 && !shaft) {
    // It used to say "One will be placed in whatever space is left", and that
    // is only true when there IS space left. The packer fills the envelope, so
    // on a shallow plot there often is not: the flight is then never placed,
    // and the warning further down says exactly that. Two warnings that
    // contradict each other is worse than one honest one, so this no longer
    // promises a staircase the generator may not be able to build.
    warnings.push(
      `The plot is too shallow for a staircase beside the front rooms (a flight needs ${stairRun.toFixed(1)} m). It will have to go wherever the packing leaves room, and the layout check will report it until it does.`,
    );
  }

  // ── lay out each floor ──────────────────────────────────────────────────
  let minScale = Infinity;

  perFloor.slice(0, actualFloors).forEach((floorSpecs, floorIndex) => {
    const floor = next.floors[floorIndex]!;
    const isGround = floorIndex === 0;

    // Public band (front) and private band (rear).
    let frontSpecs = floorSpecs.filter((s) => PUBLIC.has(s.kind));
    let rearSpecs = floorSpecs.filter((s) => !PUBLIC.has(s.kind));

    const totalRequested = floorSpecs.reduce((s, r) => s + r.targetArea, 0);
    const scale = envW * envD > 0 ? (envW * envD) / Math.max(1, totalRequested) : 1;
    minScale = Math.min(minScale, scale);

    const rooms: Room[] = [];

    const makeRoom = (kind: RoomKind, box: Box, isEntrance: boolean, ref?: string): Room => ({
      id: newId('rm'),
      floorId: floor.id,
      kind,
      label: KIND_LABEL[kind],
      x: box.x,
      y: box.y,
      width: Math.max(TOL.dimension, box.width),
      depth: Math.max(TOL.dimension, box.depth),
      height: 0,
      outdoor: kind === 'balcony' || kind === 'terrace',
      floorMaterial: undefined,
      isEntrance,
      ref,
    });
    const spine = useSpine && floorSpecs.length > 1;

    /** Pack a set of specs into a box, preserving their area proportions. */
    const fill = (box: Box, specs: BriefRoomSpec[], isEntranceBand: boolean) => {
      if (specs.length === 0) return;

      // The stairwell is off limits; packing happens around it, not through it.
      // Slivers are dropped here rather than later: a 0.1 m strip is not a room,
      // and letting one through turns into a room that overlaps the corridor.
      const boxes = (shaft ? subtractRect(box, shaft) : [box]).filter((b) => b.width >= 1.2 && b.depth >= 1.2);
      if (boxes.length === 0) return;

      // Rooms the model said must touch are grouped and ordered so the most
      // connected room ends up mid-chain. The packer peels contiguous runs, so
      // the only constraints that can break are at a run boundary — and those
      // land at the ends of a chain, which is why the ends are the rooms that
      // touch the fewest others.
      //
      // The groups are then CONCATENATED back into one list. They are a
      // re-ordering of the same rooms, not separate boxes: packing each group
      // into the box on its own would hand every group the entire box and put
      // every room on top of every other.
      const chains = orderByAdjacency(specs);

      /** One list of weighted specs for a box, in the order the packer wants. */
      const weighed = (list: BriefRoomSpec[], box: Box) => {
        const groupArea = list.reduce((s, r) => s + r.targetArea, 0);
        if (groupArea <= 0) return [];
        return list.map((o) => ({ ...o, area: (o.targetArea / groupArea) * box.width * box.depth }));
      };

      // The entrance band pins the living room to the street corner, so the
      // front door lands on the part of the house people actually approach.
      const living = isEntranceBand ? chains.flat().find((s) => s.kind === 'living') : undefined;
      const [first, ...rest] = boxes;

      if (living && first) {
        // Only the living room itself is pinned to the corner. Its neighbours
        // are exactly the rooms it asked to touch, so removing its whole chain
        // would delete the constraints it came with — the living room would
        // sit alone against the street with no way through to the dining room.
        // Drop the one room, keep the rest of the component.
        const others = chains.map((c) => c.filter((s) => s !== living));

        // The pinned room takes its PROPORTIONAL share of the band, not the
        // whole of its request.
        //
        // Everything else in the band is packed into what is left and scaled
        // to fit it, so pinning the living room at its unscaled request makes
        // it the only room in the house that gets what it asked for: on a
        // 15 × 20 m plot a living room that wants 34 m² took 34, and the
        // dining room and kitchen that asked for 12 and 11 got 5.9 and 5.4 —
        // two rooms too narrow to hold a table and a worktop. The band is
        // shared, so the share is proportional: the living room keeps the
        // fraction of the band it asked for, and everything is scaled by the
        // same factor.
        const bandWanted = specs.reduce((s, r) => s + r.targetArea, 0);
        const share = bandWanted > 0 ? living.targetArea / bandWanted : 1;
        const proportionalW = share * first.width;
        const clampedW = Math.min(Math.max(proportionalW, 2.6), first.width * 0.75);
        rooms.push(makeRoom('living', { x: first.x, y: first.y, width: clampedW, depth: first.depth }, isGround, living.ref));

        const restBox: Box = { ...first, x: first.x + clampedW, width: first.width - clampedW };
        const targets = restBox.width >= 1.2 ? [restBox] : [];
        for (const t of [...targets, ...rest]) {
          for (const p of pack(t, weighed(others.flat(), t))) {
            rooms.push(makeRoom(p.kind, p.box, false, p.ref));
          }
        }
        return;
      }

      // Otherwise spread the groups across the sub-boxes in proportion to how
      // many there are, so neither side of the stairwell is left bare. Groups
      // are dealt out whole, never split across a box boundary.
      const remaining = chains.slice();
      boxes.forEach((b, i) => {
        const share =
          remaining.length > boxes.length - i
            ? remaining.splice(0, Math.max(1, Math.round(remaining.length / (boxes.length - i))))
            : remaining.splice(0);
        for (const p of pack(b, weighed(share.flat(), b))) {
          rooms.push(makeRoom(p.kind, p.box, isGround && isEntranceBand && rooms.length === 0, p.ref));
        }
      });
    };

    if (spine) {
      // An upper floor is all private rooms. Split them across both bands
      // rather than leaving the whole frontage empty.
      if (frontSpecs.length === 0 && rearSpecs.length > 1) {
        const half = Math.ceil(rearSpecs.length / 2);
        frontSpecs = rearSpecs.slice(0, half);
        rearSpecs = rearSpecs.slice(half);
      }

      fill({ x: envX, y: envY, width: envW, depth: frontDepth }, frontSpecs, true);
      fill({ x: envX, y: rearY, width: envW, depth: rearDepth }, rearSpecs, false);
      rooms.push(makeRoom('corridor', { x: envX, y: corridorY, width: envW, depth: corridorDepth }, false));

      // The stairwell is a space on the ground floor, not a hole in it.
      //
      // The shaft was reserved before anything was packed, so no room was ever
      // placed in it — which left the ground floor with a 1.4 × 5.1 m hole
      // beside the front door, with no floor at the foot of the flight to step
      // off onto. Upstairs the shaft stays open: that is the void the flight
      // comes up through, and the floor at the head of the flight is the
      // corridor it arrives at.
      if (isGround && shaft) {
        rooms.push({ ...makeRoom('corridor', shaft, false), label: 'Stairwell' });
      }
    } else {
      if (floorSpecs.length > 1) {
        warnings.push(
          `${floor.name} is only ${envW.toFixed(1)} × ${envD.toFixed(1)} m, which is too shallow for a corridor and two bands — its ${floorSpecs.length} rooms were laid out as one block, so they open into each other.`,
        );
      }
      fill({ x: envX, y: envY, width: envW, depth: envD }, floorSpecs, true);
    }

    next.rooms.push(...rooms);
  });

  next = reindex(next);

  // ── did the geometry actually come out the way the program asked? ───────
  // Checked against the built rooms, not against the program, because the
  // program is a request and the rooms are the result. Anything unmet is
  // reported rather than quietly dropped: a constraint the model believes it
  // satisfied and the packer did not is exactly the kind of thing this app
  // must not let a user discover for themselves.
  const adjacency = verifyAdjacency(specs, next.rooms);
  if (adjacency.requested > 0) {
    if (adjacency.unmet.length) {
      const named = adjacency.unmet.slice(0, 3).join('; ');
      warnings.unshift(
        `${adjacency.unmet.length} of ${adjacency.requested} requested room connections could not be made — ${named}${
          adjacency.unmet.length > 3 ? `, and ${adjacency.unmet.length - 3} more` : ''
        }. Those pairs do not share enough wall for a door, so drag them together if it matters.`,
      );
    } else {
      warnings.push(`All ${adjacency.requested} requested room connections were built, with a door between each pair.`);
    }
  }

  // ── walls, doors and windows ────────────────────────────────────────────
  // The connections the program asked for, as id pairs, so `planFloor` puts the
  // door where the model wanted it rather than wherever the geometry made
  // easiest. Rooms carry the program's refs, so this is the same statement of
  // intent `verifyAdjacency` checks — one input, used twice rather than a
  // request the planner never sees.
  const roomByRef = new Map(next.rooms.filter((r) => r.ref).map((r) => [r.ref!, r.id] as const));
  const preferredDoors = new Set<string>();
  for (const spec of specs) {
    if (!spec.ref) continue;
    const a = roomByRef.get(spec.ref);
    if (!a) continue;
    for (const other of spec.touches ?? []) {
      const b = roomByRef.get(other);
      if (b) preferredDoors.add(doorPairKey(a, b));
    }
  }

  const walls = [];
  const furniture = [];
  for (const floor of next.floors) {
    const floorRooms = next.rooms.filter((r) => r.floorId === floor.id);
    if (!floorRooms.length) continue;
    const planned = planFloor({
      plot,
      floor,
      rooms: floorRooms,
      furnish: options.furnish !== false,
      preferredDoors,
      shaft,
    });
    walls.push(...planned.walls);
    furniture.push(...planned.furniture);
  }
  next = reindex({ ...next, walls, furniture });

  // ── stairs ──────────────────────────────────────────────────────────────
  for (let i = 0; i < next.floors.length - 1; i++) {
    const lower = next.floors[i]!;
    const upper = next.floors[i + 1]!;
    // The flight is pinned to the **rear** of the shaft, so its head lands
    // exactly on the shaft's back edge — which is the corridor's front wall.
    //
    // Head at the front instead and the flight arrives at the street with a
    // window across the top of it and nothing to step onto; head at the back
    // and it arrives at a wall with a door in it, opening straight onto the
    // corridor floor. What is left at the front of the shaft becomes the
    // landing at the foot of the flight.
    const gaps = shaft
      ? [{ x: shaft.x, y: shaft.y + shaft.depth - stairRun, width: shaft.width, depth: stairRun }]
      : freeSpace({ ...next, rooms: next.rooms.filter((r) => r.floorId === lower.id) });
    const stair = placeStair(
      next.rooms.filter((r) => r.floorId === lower.id),
      gaps,
      lower,
      upper,
      next.rooms.filter((r) => r.floorId === upper.id),
    );
    if (stair) next.stairs.push(stair);
    else warnings.push(`No room was found for a staircase between ${lower.name} and ${upper.name}. Place one manually — the layout check will report it until you do.`);
  }
  // The partition across the head of each flight, on the storey the flight
  // leaves, is taken out: the flight arrives there at the storey height, and a
  // full-height wall on that line stops the climb dead at the last tread. The
  // stairwell opens onto the storey the flight arrives at.
  //
  // This runs **before** the doors are punched, so the wall that is on the
  // flight's line is not in the list of walls the foot door can be put in.
  for (const stair of next.stairs) {
    const cleared = clearFlightHead(next, stair);
    next = cleared.project;
  }
  // Doors for the stairways, once every floor's walls exist — they are punched
  // into walls that only the `planFloor` loop above created.
  //
  // A flight that could not be doored is reported rather than left to be found by
  // walking into the glass. A staircase with no door on a storey is a building
  // you cannot move around on that level, and it used to be silent: the attempt
  // simply gave up, and the only evidence was a window at the bottom of the
  // stairs.
  for (const stair of next.stairs) {
    const doored = openStairEnds(next, stair);
    next = doored.project;
    for (const floorId of doored.undoored) {
      const floor = next.floors.find((f) => f.id === floorId);
      warnings.push(
        `The staircase ${stair.name} has no door on ${floor?.name ?? 'one storey'}, so it cannot be entered from there. No wall on that storey could take one.`,
      );
    }
  }
  next = reindex(next);

  // ── the furniture, now that every door exists ───────────────────────────
  //
  // The flight's own doors are punched into walls that only existed once the
  // stairs had been placed, which is after the rooms were furnished. So the
  // first pass of furniture was laid out without knowing there was a door at
  // the foot of the flight — and put a dining chair in it. The chair did not
  // overlap the leaf, so nothing complained; it just made the only route from
  // the front door to the stairs a gap too narrow to walk through.
  //
  // The furniture is laid out again here, against the final walls. It is the
  // same deterministic arrangement, so the difference is only in the rooms
  // that gained a door: the pieces that stood in the new door's way are put
  // somewhere else, and everything else lands where it did before.
  const refurnished = [];
  for (const floor of next.floors) {
    const floorRooms = next.rooms.filter((r) => r.floorId === floor.id);
    if (!floorRooms.length) continue;
    const floorWalls = next.walls.filter((w) => w.floorId === floor.id);
    refurnished.push(...furnishFloor(floorRooms, floor.id, floorWalls));
  }
  next = reindex({ ...next, furniture: refurnished });

  // ── report ──────────────────────────────────────────────────────────────
  if (minScale < 0.7) {
    warnings.push(
      `The brief asks for more floor area than the ${plot.width.toFixed(1)} × ${plot.depth.toFixed(1)} m plot allows after setbacks. Rooms were scaled to about ${(minScale * 100).toFixed(0)}% of their requested size — consider fewer rooms, a bigger plot, or a second storey.`,
    );
  } else if (minScale > 1.5) {
    warnings.push(
      `This plot has room to spare: the generated rooms use only about ${(100 / minScale).toFixed(0)}% of the buildable area. Consider adding a room, a bigger kitchen, or a garden room.`,
    );
  }

  const result = reindex(next);
  return {
    ok: true,
    project: result,
    data: {
      report: {
        warnings,
        scale: minScale,
        floorCount: next.floors.length,
        ...(adjacency.requested > 0 ? { adjacency } : {}),
        ...(options.program?.summary ? { summary: options.program.summary } : {}),
      },
      project: result,
    },
    createdIds: [],
    removedIds: [],
  };
}

// ────────────────────────────────────────────────────────── blank starts ─────

/**
 * The smallest cell a grid room may be. Anything narrower is a cupboard.
 */
const MIN_GRID_CELL = 2.4;

/**
 * The blank-plot start: the plot, the storeys and the brief, and nothing else.
 *
 * A person who wants to draw their own house does not want a generator's idea
 * of a house — they want a sheet with the plot drawn on it. This returns
 * exactly that: the plot the wizard was just asked about, one floor per storey
 * requested, and no rooms, walls or furniture to argue with.
 */
export function emptyFromBrief(project: Project, brief: DesignBrief): OpResult<{ project: Project; floorCount: number }> {
  const floorCount = Math.max(1, Math.min(4, brief.floorCount));
  const floors: Floor[] = [];
  for (let i = 0; i < floorCount; i++) {
    floors.push({
      id: newId('fl'),
      name: i === 0 ? 'Ground floor' : `First floor`,
      elevation: 0,
      height: i === 0 ? 3.0 : 2.9,
      order: i,
      roomIds: [],
      wallIds: [],
      stairIds: [],
      outdoorIds: [],
    });
  }
  for (let i = 1; i < floors.length; i++) {
    const below = floors[i - 1]!;
    floors[i]!.elevation = below.elevation + below.height;
  }

  const result = reindex({
    ...project,
    plot: brief.plot,
    brief,
    provenance: { plannedBy: 'empty', at: Date.now() },
    floors,
    rooms: [],
    walls: [],
    stairs: [],
    outdoor: [],
    furniture: [],
  });
  return { ok: true, project: result, data: { project: result, floorCount }, createdIds: [], removedIds: [] };
}

export interface GridReport {
  warnings: string[];
  /** Cells across and down. The last row may be short, and is stretched to fit. */
  columns: number;
  rows: number;
  cellWidth: number;
  cellDepth: number;
  floorCount: number;
}

/**
 * The room-grid start: the brief's rooms tiled edge to edge across the
 * buildable envelope, ready to be dragged around.
 *
 * This is deliberately the crudest layout there is. It has no circulation
 * spine and no band structure — it is a lattice, which is a starting point to
 * rearrange rather than a plan to live in. That is the point of offering it:
 * the generator gives you a house, this gives you a floor you can argue with.
 *
 * The lattice is chosen, not fixed. Every cell is as square as the envelope
 * allows and none is narrower than MIN_GRID_CELL. A last row that cannot be
 * filled is stretched across the full width, because leaving a gap or padding
 * it with an invented room would both be lies about the brief.
 */
export function gridFromBrief(
  project: Project,
  brief: DesignBrief,
  options: { furnish?: boolean } = {},
): OpResult<{ report: GridReport; project: Project }> {
  const plot = brief.plot;
  const warnings: string[] = [];

  const envX = plot.setbacks.left;
  const envY = plot.setbacks.front;
  const envW = plot.width - plot.setbacks.left - plot.setbacks.right;
  const envD = plot.depth - plot.setbacks.front - plot.setbacks.rear;

  const specs = expandBrief(brief);

  if (envW < MIN_GRID_CELL || envD < MIN_GRID_CELL) {
    return {
      ok: false,
      code: 'conflict',
      error: `${envelopeRefusal(envW, envD)} That is too small for a grid of rooms.`,
      hint: 'Reduce the setbacks on the Plot step, or start from an empty plot instead.',
    };
  }

  // Pick the lattice: square-ish cells, no cell below the minimum, fewest rows
  // that satisfy both. Ties go to the shallower grid, which reads more like a
  // plan than a tower.
  let best: { columns: number; rows: number; score: number } | null = null;
  for (let cols = 1; cols <= specs.length; cols++) {
    const rows = Math.ceil(specs.length / cols);
    const columns = Math.ceil(specs.length / rows);
    const cellW = envW / columns;
    const cellD = envD / rows;
    if (cellW < MIN_GRID_CELL || cellD < MIN_GRID_CELL) continue;
    const score = Math.abs(Math.log(cellW / cellD)) + rows * 0.02;
    if (!best || score < best.score) best = { columns, rows, score };
  }
  if (!best) {
    return {
      ok: false,
      code: 'conflict',
      error: `${specs.length} rooms will not fit as a grid on a ${envW.toFixed(1)} × ${envD.toFixed(1)} m envelope with every room at least ${MIN_GRID_CELL} m across.`,
      hint: 'Tick fewer rooms, enlarge the plot, or start from an empty plot and draw the rooms yourself.',
    };
  }

  const floor: Floor = {
    id: newId('fl'),
    name: 'Ground floor',
    elevation: 0,
    height: 3.0,
    order: 0,
    roomIds: [],
    wallIds: [],
    stairIds: [],
    outdoorIds: [],
  };

  const rowDepth = envD / best.rows;
  const rooms: Room[] = [];
  let placed = 0;
  for (let row = 0; row < best.rows; row++) {
    const inRow = specs.slice(row * best.columns, (row + 1) * best.columns);
    const cellWidth = envW / inRow.length;
    // Column position restarts in every row: the short last row has wider
    // cells, so a running total across rows would push it off the plot.
    inRow.forEach((s, col) => {
      rooms.push({
        id: newId('rm'),
        floorId: floor.id,
        kind: s.kind,
        label: KIND_LABEL[s.kind],
        x: envX + col * cellWidth,
        y: envY + row * rowDepth,
        width: cellWidth,
        depth: rowDepth,
        height: 0,
        outdoor: s.kind === 'balcony' || s.kind === 'terrace',
        floorMaterial: undefined,
        isEntrance: placed === 0,
      });
      placed++;
    });
  }

  const shortest = rooms.reduce((min, r) => Math.min(min, r.width * r.depth), Infinity);
  const wanted = specs.reduce((s, r) => s + r.targetArea, 0);
  if (wanted > 0 && shortest / (wanted / specs.length) < 0.75) {
    warnings.push(
      'A grid gives every room the same shape, so the small rooms are cramped and the large ones are short of the area you asked for. Drag them to whatever proportions you want.',
    );
  }
  if (brief.floorCount > 1) {
    warnings.push(
      'A grid is a single-floor starting point. Add the storeys you need and lay them out the same way.',
    );
  }

  const planned = planFloor({ plot, floor, rooms, furnish: options.furnish !== false });
  const result = reindex({
    ...project,
    plot,
    brief,
    provenance: { plannedBy: 'grid', at: Date.now() },
    floors: [floor],
    rooms,
    walls: planned.walls,
    stairs: [],
    outdoor: [],
    furniture: planned.furniture,
  });

  return {
    ok: true,
    project: result,
    data: {
      report: {
        warnings,
        columns: best.columns,
        rows: best.rows,
        cellWidth: envW / best.columns,
        cellDepth: rowDepth,
        floorCount: 1,
      },
      project: result,
    },
    createdIds: [],
    removedIds: [],
  };
}

/** Rooms on a floor that still need a wall, used by the re-planner. */
export function replanFloor(project: Project, floorId: Id): Project {
  const floor = project.floors.find((f) => f.id === floorId);
  if (!floor) return project;
  const rooms = project.rooms.filter((r) => r.floorId === floorId);
  const planned = planFloor({ plot: project.plot, floor, rooms });
  const next = reindex({
    ...project,
    rooms,
    walls: [...project.walls.filter((w) => w.floorId !== floorId), ...planned.walls],
    furniture: [...project.furniture.filter((f) => f.floorId !== floorId), ...planned.furniture],
  });
  return next;
}

export interface RebuildReport {
  floorId: Id;
  wallsCreated: number;
  wallsRemoved: number;
  /** Doors and windows that found a home on the new walls. */
  openingsKept: number;
  /** Openings whose wall no longer exists after the rebuild. */
  openingsDropped: number;
  furnitureKept: number;
}

/**
 * Rebuild a floor's walls from its rooms, without throwing the floor away.
 *
 * `replanFloor` is the generator's own re-run: it re-furnishes and replaces
 * every wall, which is right immediately after generation and wrong the moment
 * you have touched anything. This is the version a person uses after they have
 * moved a wall or dragged a room — it keeps the furniture exactly where they put
 * it and carries every door and window onto the wall that took its place.
 *
 * An opening is carried when a new wall runs along the same line and is long
 * enough to hold it. One that cannot be placed is reported rather than
 * silently relocated somewhere the user did not ask for: a door that has moved
 * a metre is a door you would not open that way.
 */
export function rebuildWallsFromRooms(project: Project, floorId: Id): { project: Project; report: RebuildReport } {
  const floor = project.floors.find((f) => f.id === floorId);
  if (!floor) {
    return {
      project,
      report: { floorId, wallsCreated: 0, wallsRemoved: 0, openingsKept: 0, openingsDropped: 0, furnitureKept: 0 },
    };
  }

  const rooms = project.rooms.filter((r) => r.floorId === floorId);
  const oldWalls = project.walls.filter((w) => w.floorId === floorId);
  const furniture = project.furniture.filter((f) => f.floorId === floorId);

  // No furniture: the rooms already have it, and re-running the furnisher would
  // duplicate every piece.
  const planned = planFloor({ plot: project.plot, floor, rooms, furnish: false });
  const newWalls = planned.walls;

  // The planner places its own doors and windows. They are thrown away before
  // the old ones are carried across: the previous openings ARE the design —
  // for a freshly generated floor they are the planner's own, and for a floor
  // you have edited they are yours. Keeping both sets gives every wall two
  // doors in the same place.
  for (const w of newWalls) w.openings = [];

  let kept = 0;
  let dropped = 0;
  const claimed = new Set<string>();

  for (const old of oldWalls) {
    const f = wallFrame(old);
    for (const o of old.openings) {
      const centre = add(old.a, scale(f.dir, o.offset));
      const host = pickHostWall(newWalls, centre, f.dir, o.width, claimed);
      if (!host) {
        dropped += 1;
        continue;
      }
      const hf = wallFrame(host);
      // Leave a hand's breadth at each end so a door is never flush with a
      // corner, which the planner would refuse on the next pass anyway.
      const offset = dot(sub(centre, host.a), hf.dir);
      const lo = o.width / 2 + 0.1;
      host.openings.push({ ...o, offset: Math.min(Math.max(offset, lo), hf.length - lo) });
      claimed.add(host.id);
      kept += 1;
    }
  }

  const next = reindex({
    ...project,
    rooms,
    walls: [...project.walls.filter((w) => w.floorId !== floorId), ...newWalls],
    // Furniture is left exactly where the user put it. If a wall now runs
    // through a wardrobe that is a fact about the design, and `validate` will
    // say so — which is more use than the furniture quietly disappearing.
    furniture: [...project.furniture.filter((f) => f.floorId !== floorId), ...furniture],
  });

  return {
    project: next,
    report: {
      floorId,
      wallsCreated: newWalls.length,
      wallsRemoved: oldWalls.length,
      openingsKept: kept,
      openingsDropped: dropped,
      furnitureKept: furniture.length,
    },
  };
}

/**
 * The new wall that best carries an opening: parallel, overlapping it, and long
 * enough. Returns null when the rebuild removed the wall the opening was in.
 *
 * `claimed` lists walls already given an opening this pass. They stay eligible
 * — two doors in one wall is normal — but a wall nobody has claimed is
 * preferred, so carrying the front door does not land it on top of the window
 * the planner put in the same wall.
 */
function pickHostWall(walls: Wall[], centre: Vec2, dir: Vec2, width: number, claimed: Set<string>): Wall | null {
  let best: Wall | null = null;
  let bestScore = Infinity;
  for (const w of walls) {
    const f = wallFrame(w);
    if (f.length < width + 0.2) continue;
    // Parallel: the opening's wall direction and the candidate must agree.
    if (Math.abs(cross(dir, f.dir)) > 0.2) continue;
    const along = dot(sub(centre, w.a), f.dir);
    if (along < -0.3 || along > f.length + 0.3) continue;
    const across = Math.abs(dot(sub(centre, w.a), f.normal));
    if (across > w.thickness + 0.35) continue;

    const offset = Math.min(Math.max(dot(sub(centre, w.a), f.dir), width / 2 + 0.1), f.length - width / 2 - 0.1);
    const clash = w.openings.some((x) => Math.abs(x.offset - offset) < (x.width + width) / 2 + 0.05);
    // Distance from the opening to the wall line decides first; a clash with an
    // opening already there is what decides between otherwise equal candidates.
    const score = across + (clash ? 1 : 0) + (claimed.has(w.id) ? 0.25 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = w;
    }
  }
  return best;
}

export { SERVICE, PRIVATE, PUBLIC };
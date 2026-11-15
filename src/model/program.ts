/**
 * The room program: what the model decides, and the only thing it decides.
 *
 * Until now the model had no say in layout at all. The Generate button ran
 * `generateFromBrief`, a deterministic packer, and the wizard's own footer
 * said so: *"Generating runs deterministic layout code, no model involved."*
 * The assistant could not route around it either — `regenerate_floor` calls
 * `replanFloor`, which is the same generator re-run. So the model could talk
 * about the house in words and change nothing, which is exactly the failure
 * the project brief forbids: claiming a design the application never applied.
 *
 * This file is the seam. The model answers a bounded question — *what rooms,
 * how big, and which must be next to each other* — and the answer arrives as
 * this shape. The packer then places the rooms deterministically. The model
 * never emits a coordinate, an object id, or a validation override; it cannot,
 * because none of those are fields here.
 *
 * Why adjacency is enough. Doors are not placed by rule; they are *derived*.
 * `planFloor` step 5 (src/model/plan.ts) walks the interior partitions, and
 * step 2 builds a partition for every pair of rooms that share an edge span.
 * So if two rooms are rectangles that touch along more than `TOL.length`, a
 * door appears between them, with its width and swing chosen from the two
 * room kinds by `doorForRooms`. The model therefore does not ask for doors —
 * it asks for rooms to be neighbours, and the door is a consequence.
 *
 * `ref` is deliberately NOT an Furnish id. It is a name the model invented so it
 * can refer to a room twice ("bedroom-2 touches bathroom-1"). Real object ids
 * are minted by `newId` when the room is built, because ids that a model can
 * write are ids a model can forge.
 */
import { DEFAULT_ROOM_AREA, KIND_LABEL } from './catalog.ts';
import type { Plot, RoomKind } from './types.ts';

/**
 * The model's judgement about one room.
 *
 * `areaM2` is a *target*, not a measurement. The packer fills the box it is
 * given, so the delivered area follows the envelope; this value decides the
 * proportion each room is asking for relative to its neighbours.
 */
export interface ProgramRoom {
  /** Model-chosen name, unique within one program. Resolved, never trusted as an id. */
  ref: string;
  kind: RoomKind;
  /** Target area in m². */
  areaM2: number;
  /** Which storey, 0-based. Omit to let the allocator decide. */
  floor?: number;
  /**
   * Refs of rooms this one must share a wall with.
   *
   * This is the whole point of the program. `"bed-1": ["bath-1"]` is a request
   * for an ensuite; expressed as geometry it would be a coordinate.
   */
  touches?: string[];
  /** Why this room is the size it is. Shown to the user; never acted on. */
  note?: string;
}

export interface RoomProgram {
  rooms: ProgramRoom[];
  /** One line on the shape of the design, shown to the user. */
  summary?: string;
}

/** Why a program's use of the envelope is wrong, in the user's terms. */
export interface ProgramReview {
  ok: boolean;
  /** Fatal: the program cannot be laid out as asked. */
  error?: string;
  /** Non-fatal: laid out, but something was dropped or clamped. */
  warnings: string[];
  /** Total target area across all rooms. */
  requestedM2: number;
  /** What the envelope can actually hold, allowing for circulation. */
  availableM2: number;
}

/** A single room is nonsense below this, and a waste of envelope above it. */
const MIN_ROOM_M2 = 1.8;
const MAX_ROOM_M2 = 90;

/** Circulation, stairs and structure eat this much of the envelope. */
const HAZARD_RATIO = 0.82;

/**
 * The point below which rooms are scaled so far that they are no longer rooms.
 *
 * The packer treats a room's area as a *share* of the box it is given, not as
 * a size: the rooms are scaled to fit whatever envelope they land in. A
 * programme that asks for a little more than the envelope holds therefore
 * comes out a little smaller than asked — it does not produce overlapping
 * rooms, because there is nothing to overlap. `generateFromBrief` already
 * draws that line, at this number, and warns when it has had to scale below
 * it.
 *
 * So the line between "a little smaller than asked" and "not a plan at all"
 * belongs here too, in the same place. Refusing every overshoot threw away
 * good plans over a square metre: on 2026-11-15 the model asked for 217 m² in
 * an envelope of 216 and the whole programme was dropped for one.
 */
const SCALE_FLOOR = 0.7;

/**
 * Rooms that are drawn by the generator rather than asked for.
 *
 * The band structure in `generateFromBrief` places a corridor across the full
 * depth (`src/model/layout.ts:392`) and reserves a stair shaft before packing.
 * A model that also asks for a corridor would either get two or, worse, get
 * the corridor packed into a corner and routed through a bedroom.
 */
const GENERATOR_OWNED = new Set<RoomKind>(['corridor']);

/**
 * Check a program against the plot it has to fit.
 *
 * This runs before anything is drawn, on purpose. A program is checked against
 * the envelope twice: once for the size of the rooms it asked for, and once for
 * the things it must not do — put a room on a storey that does not exist, or
 * leave a room too small to use.
 *
 * The size check has a tolerance, and the tolerance is the point. The packer
 * scales a program's rooms into the envelope, so a program that asks for a
 * little too much comes out a little smaller than asked rather than broken.
 * Only a program that would have to be scaled past `SCALE_FLOOR` is refused,
 * because at that point the rooms are no longer the rooms that were asked for.
 */
export function reviewProgram(program: RoomProgram, plot: Plot, floorCount: number): ProgramReview {
  const warnings: string[] = [];
  const sb = plot.setbacks;
  const envW = plot.width - sb.left - sb.right;
  const envD = plot.depth - sb.front - sb.rear;

  if (envW < 4 || envD < 4) {
    return {
      ok: false,
      error: `The setbacks leave only ${envW.toFixed(1)} m × ${envD.toFixed(1)} m to build on, which is too small to plan rooms into.`,
      warnings,
      requestedM2: 0,
      availableM2: 0,
    };
  }

  const floors = Math.max(1, Math.min(4, floorCount));
  const availableM2 = envW * envD * floors * HAZARD_RATIO;
  const requestedM2 = program.rooms.reduce((s, r) => s + r.areaM2, 0);

  if (program.rooms.length === 0) {
    return { ok: false, error: 'The program did not contain any rooms.', warnings, requestedM2: 0, availableM2 };
  }

  if (requestedM2 > availableM2) {
    // Not a refusal: the packer scales. What is refused is a programme so far
    // over the envelope that the rooms would come out as a fraction of what
    // was asked for — see `SCALE_FLOOR`.
    warnings.push(
      `The rooms it planned come to ${requestedM2.toFixed(0)} m², more than the ${availableM2.toFixed(0)} m² the envelope holds once circulation is taken out, so they came out a little smaller than asked.`,
    );
  }

  const ceilingM2 = (envW * envD * floors) / SCALE_FLOOR;
  if (requestedM2 > ceilingM2) {
    const scale = (envW * envD * floors) / requestedM2;
    return {
      ok: false,
      error: `The rooms it planned come to ${requestedM2.toFixed(0)} m², but the buildable envelope holds about ${availableM2.toFixed(0)} m² across ${floors} storey${floors === 1 ? '' : 's'} once circulation is taken out — the rooms would have been scaled to ${(scale * 100).toFixed(0)}% of the size asked for. It would not fit, so it was not used.`,
      warnings,
      requestedM2,
      availableM2,
    };
  }

  // A `touches` edge naming a ref that is not in the program is a dangling
  // constraint. It is dropped rather than rejected: the rooms around it are
  // still a good design, and the alternative is throwing away a whole plan
  // over one misspelt ref. But the user is told.
  const refs = new Set(program.rooms.map((r) => r.ref));
  for (const room of program.rooms) {
    if (!room.touches?.length) continue;
    const known = room.touches.filter((t) => refs.has(t) && t !== room.ref);
    const dropped = room.touches.length - known.length;
    if (dropped > 0) {
      warnings.push(
        `${KIND_LABEL[room.kind] ?? room.kind} asked to touch ${dropped} room${dropped === 1 ? '' : 's'} that ${
          dropped === 1 ? 'is' : 'are'
        } not in the plan (${room.touches.filter((t) => !refs.has(t) || t === room.ref).join(', ')}), so ${dropped === 1 ? 'it' : 'those'} ${
          dropped === 1 ? 'was' : 'were'
        } left out.`,
      );
    }
  }

  const lastFloor = floors - 1;
  for (const room of program.rooms) {
    if (room.floor !== undefined && (room.floor < 0 || room.floor > lastFloor || !Number.isInteger(room.floor))) {
      warnings.push(`${KIND_LABEL[room.kind] ?? room.kind} was put on storey ${room.floor}, which does not exist; it was moved to an upper floor.`);
    }
  }

  const small = program.rooms.filter((r) => r.areaM2 < MIN_ROOM_M2);
  if (small.length) {
    warnings.push(
      `${small.length} room${small.length === 1 ? '' : 's'} came out under ${MIN_ROOM_M2} m² (${small
        .map((r) => KIND_LABEL[r.kind] ?? r.kind)
        .join(', ')}), which is below the size a room can be used in.`,
    );
  }

  const oversized = program.rooms.filter((r) => r.areaM2 > MAX_ROOM_M2);
  for (const r of oversized) {
    warnings.push(`${KIND_LABEL[r.kind] ?? r.kind} was planned at ${r.areaM2.toFixed(0)} m², more than ${MAX_ROOM_M2} m², which is larger than the envelope can hold.`);
  }

  return { ok: true, warnings, requestedM2, availableM2 };
}

/**
 * Room kinds the model asks for that this studio knows under another name.
 *
 * The real model asked for a "study" — a perfectly ordinary word for a room
 * this catalogue calls an office. Throwing away a twelve-room programme
 * because of one word is a bad trade for the person who asked for the house:
 * they get a plan nobody wrote instead of the one they did.
 *
 * So a named near-miss is repaired, and the repair is reported — the toast
 * says which room was renamed and to what. A kind with no honest alias is
 * still a refusal, because guessing would put a room on the plan that nobody
 * asked for.
 */
const KIND_ALIASES: Record<string, RoomKind> = {
  study: 'office',
  'home office': 'office',
  'guest bedroom': 'guest',
  'guest room': 'guest',
  'kids bedroom': 'bedroom',
  'kids room': 'bedroom',
  'child bedroom': 'bedroom',
  'master bedroom': 'bedroom',
  'main bedroom': 'bedroom',
  'double bedroom': 'bedroom',
  'single bedroom': 'bedroom',
  'family room': 'living',
  'family lounge': 'living',
  'living area': 'living',
  'living room': 'living',
  lounge: 'living',
  den: 'living',
  'dining area': 'dining',
  'dining room': 'dining',
  kitchenette: 'kitchen',
  'utility room': 'utility',
  'laundry room': 'utility',
  'laundry': 'utility',
  'wash room': 'utility',
  ensuite: 'bathroom',
  'en-suite': 'bathroom',
  'powder room': 'bathroom',
  'guest bathroom': 'bathroom',
  'main bathroom': 'bathroom',
  wc: 'bathroom',
  foyer: 'lobby',
  'entrance hall': 'hall',
  'entrance foyer': 'lobby',
  'walk-in closet': 'storage',
  'walk in wardrobe': 'storage',
  'cloak room': 'storage',
  'store room': 'storage',
  'covered patio': 'terrace',
  veranda: 'terrace',
  deck: 'terrace',
  porch: 'terrace',
  'car port': 'garage',
  'double garage': 'garage',
  'single garage': 'garage',
};

/**
 * Coerce whatever the model returned into a program, or explain why not.
 *
 * Every field is checked against a closed set. A kind the catalogue does not
 * have is a refusal, not a default: silently turning an invented room kind
 * into "storage" would put a room on the plan that nobody asked for and that
 * the model would then describe as something else. A kind with an honest
 * alias — see `KIND_ALIASES` — is repaired, and the repair is reported.
 */
export function parseProgram(
  raw: unknown,
): { ok: true; program: RoomProgram; repairs: string[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'The room program was not a JSON object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.rooms)) {
    return { ok: false, error: 'The room program had no "rooms" array.' };
  }

  const rooms: ProgramRoom[] = [];
  const seen = new Set<string>();
  const repairs: string[] = [];

  // What other rooms call this kind. Used only to repair a missing `ref`, and
  // only where the model has already named the room itself somewhere else.
  const namedByOthers = new Set<string>();
  for (const entry of obj.rooms as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const touches = (entry as Record<string, unknown>).touches;
    if (!Array.isArray(touches)) continue;
    for (const t of touches) if (typeof t === 'string') namedByOthers.add(t.trim());
  }

  for (const entry of obj.rooms) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: 'Every program room must be an object.' };
    }
    const r = entry as Record<string, unknown>;

    let kind: RoomKind;
    if (typeof r.kind !== 'string') {
      return { ok: false, error: `"${r.kind as string}" is not a room kind this studio knows.` };
    } else if (r.kind in DEFAULT_ROOM_AREA) {
      kind = r.kind as RoomKind;
    } else {
      const alias = KIND_ALIASES[r.kind.trim().toLowerCase()];
      if (!alias) {
        return { ok: false, error: `"${r.kind}" is not a room kind this studio knows.` };
      }
      kind = alias;
      repairs.push(
        `The model asked for a "${r.kind}" room. This studio calls that ${(KIND_LABEL[alias] ?? alias).toLowerCase()}, and that is what is on the plan.`,
      );
    }

    let ref = typeof r.ref === 'string' ? r.ref.trim().slice(0, 40) : '';
    if (!ref) {
      // A room that named its kind as a key instead of a `ref` — observed from
      // the real model, not invented. The program is then only usable if the
      // model referred to that same name elsewhere, which is what makes the
      // repair a recovery rather than a guess: its own `touches` attest that
      // "kitchen" is the name it is using for this room.
      //
      // Without that corroboration there is no way to know whether a missing
      // ref means "call me kitchen" or "call me whatever", and inventing a name
      // would silently break every `touches` edge that referred to it. So this
      // is a refusal, not a default.
      if (typeof r.kind === 'string' && namedByOthers.has(r.kind) && !seen.has(r.kind)) {
        ref = r.kind;
        repairs.push(`One room left out its name, so it has been called "${r.kind}" — a name the rest of the plan already used for it.`);
      } else {
        return { ok: false, error: 'A program room was missing its "ref", and no other room names it, so it could not be identified.' };
      }
    }
    // Ids are minted by `newId` and belong to the app. A ref wearing an id's
    // shape is either a stale reference from an earlier turn or an attempt to
    // name an object that does not exist; either way it is refused rather than
    // quietly treated as a room name.
    if (/^[a-z]{2}_[0-9a-z]{6,}$/.test(ref)) {
      return { ok: false, error: `"${ref}" is an object id, not a room name. The model does not choose ids.` };
    }
    if (seen.has(ref)) return { ok: false, error: `The program used the room name "${ref}" twice.` };
    seen.add(ref);

    // The generator draws the corridor and reserves the stairs. This is checked
    // before the area, because a corridor is *sized* by the generator — asking
    // for one at 0 m² is not a bad number, it is a redundant request.
    if (GENERATOR_OWNED.has(kind)) continue;

    const areaM2 = Number(r.areaM2);
    if (!Number.isFinite(areaM2) || areaM2 <= 0) {
      return { ok: false, error: `${ref} has no usable area (${JSON.stringify(r.areaM2)}).` };
    }

    const touches = Array.isArray(r.touches)
      ? r.touches.filter((t): t is string => typeof t === 'string').map((t) => t.trim().slice(0, 40))
      : undefined;

    rooms.push({
      ref,
      kind,
      areaM2,
      floor: Number.isInteger(r.floor) ? (r.floor as number) : undefined,
      touches: touches?.length ? touches : undefined,
      note: typeof r.note === 'string' ? r.note.trim().slice(0, 240) : undefined,
    });
  }

  if (rooms.length === 0) {
    return { ok: false, error: 'The room program contained no rooms Furnish can build.' };
  }

  return {
    ok: true,
    program: {
      rooms,
      summary: typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 400) : undefined,
    },
    // Repairs are reported, never silent. A program that arrived altered has
    // to say so, or the user is reasoning about a plan the model never wrote.
    repairs,
  };
}

/**
 * Reduce adjacency to the pairs the packer must actually honour.
 *
 * Constraints are written once per room and read both ways, so a pair is
 * returned once regardless of which side named the other. The relation is
 * undirected: "A touches B" and "B touches A" are the same wall.
 */
export function adjacencyPairs(program: RoomProgram): Array<[string, string]> {
  const byRef = new Map(program.rooms.map((r) => [r.ref, r] as const));
  const pairs = new Map<string, [string, string]>();
  for (const room of program.rooms) {
    for (const other of room.touches ?? []) {
      if (other === room.ref || !byRef.has(other)) continue;
      // Sorted, not just deduped: the pair is stored sorted so that the list a
      // packer receives does not depend on which room happened to name the
      // other first. Two programs that say the same thing must place the same
      // rooms, whichever end of the wall wrote it down.
      const [first, second] = room.ref < other ? [room.ref, other] : [other, room.ref];
      pairs.set(`${first}|${second}`, [first, second]);
    }
  }
  return [...pairs.values()];
}
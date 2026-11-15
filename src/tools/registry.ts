/**
 * The assistant's tool surface.
 *
 * This is the security boundary. The model can choose a *name* from this list
 * and supply arguments that are checked here, against the current project. It
 * cannot return code, cannot invent an id, cannot bypass a validation failure,
 * and cannot touch anything that is not one of these operations. Every handler
 * resolves through the same `run` dispatch the mouse uses, so there is exactly
 * one path from "an edit should happen" to "the edit happened" — and that path
 * enforces undo, the activity log and persistence.
 *
 * Each tool carries:
 *   · an input schema, sent to the model so it cannot guess argument names
 *   · an output schema, used to validate what the handler returns
 *   · a permission level, which decides whether the user must approve first
 *
 * Permission levels:
 *   read         — cannot change anything; runs freely
 *   write        — changes geometry; runs freely, but is logged and undoable
 *   destructive  — deletes or replaces; always confirmed by the user first
 */
import { CATALOG, KIND_LABEL } from '../model/catalog.ts';
import { DEFAULT_MATERIALS } from '../model/catalog.ts';
import { catalogById } from '../model/catalog.ts';
import { formatArea, formatLength, wallLength } from '../model/geometry.ts';
import { measureBuilding, measureRoom } from '../model/measure.ts';
import { findFreeSpot } from '../model/plan.ts';
import { errorsOnly, validate } from '../model/validate.ts';
import { DESIGN_STYLES, STYLE_BLURB, STYLE_LABEL, paletteFor } from '../model/palette.ts';
import { buildScene } from '../three/sceneModel.ts';
import { useProject, type OperationName } from '../store/useProject.ts';
import type { DesignStyle, Issue, Project, Room } from '../model/types.ts';
import type { ResizeRoomInput } from '../model/ops.ts';

export type Permission = 'read' | 'write' | 'destructive';

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolOutcome<T = unknown> {
  ok: boolean;
  /** Compact, model-readable summary. This is what the model sees next turn. */
  summary: string;
  data?: T;
  /** Present when ok is false. */
  error?: string;
  errorCode?: string;
  hint?: string;
  /** Ids created or removed, so the UI can highlight them and undo can work. */
  createdIds?: string[];
  removedIds?: string[];
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  permission: Permission;
  input: JsonSchema;
  /** Declared for documentation and for the client's response validation. */
  output: JsonSchema;
  handler(input: Record<string, unknown>): ToolOutcome;
}

/* ────────────────────────────────────────────────────────────── helpers ─────── */

/**
 * Who is running the tool currently in flight.
 *
 * The same handler is reached from the assistant and from the validator's
 * click-to-fix buttons, and the activity feed has to say which. It is ambient
 * for the duration of one synchronous `runTool` call — there is no concurrency
 * here, the store's run is synchronous — and restored afterwards.
 */
let currentActor: 'assistant' | 'user' = 'assistant';

/**
 * Runs an operation through the store and normalises the result.
 *
 * The actor is what makes the activity feed show who did what, and it is the
 * reason the app can honestly say the model changed something: the log entry
 * only exists because this call actually succeeded.
 */
function apply<A extends unknown[]>(
  op: OperationName,
  args: A,
  summary: (data: unknown) => string,
): ToolOutcome {
  const res = useProject.getState().run(op, args, { actor: currentActor });
  if (!res.ok) return { ok: false, summary: '', error: res.error, errorCode: res.code, hint: res.hint };
  return {
    ok: true,
    summary: summary(res.data),
    data: res.data,
    createdIds: res.createdIds,
    removedIds: res.removedIds,
  };
}

const project = (): Project => useProject.getState().project;
const activeFloorId = (): string => useProject.getState().activeFloorId || project().floors[0]?.id || '';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const bool = (v: unknown): boolean => v === true;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function bad(message: string, hint?: string): ToolOutcome {
  return { ok: false, summary: '', error: message, errorCode: 'invalid_input', hint };
}

/** The envelope the model gets for reads: small, and never the whole project. */
function envelope(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const p = project();
  const floorId = activeFloorId();
  const floor = p.floors.find((f) => f.id === floorId);
  return {
    project: {
      name: p.name,
      units: p.displayUnits ?? 'm',
      plot: { width: p.plot.width, depth: p.plot.depth, orientation: p.plot.orientation, setbacks: p.plot.setbacks },
      activeFloor: floor ? { id: floor.id, name: floor.name, order: floor.order, elevation: floor.elevation, height: floor.height } : null,
      counts: {
        floors: p.floors.length,
        rooms: p.rooms.filter((r) => r.floorId === floorId).length,
        walls: p.walls.filter((w) => w.floorId === floorId).length,
        furniture: p.furniture.filter((f) => f.floorId === floorId).length,
      },
    },
    ...extra,
  };
}

const ROOM_SUMMARY: JsonSchema = { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string' }, area: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, depth: { type: 'number' } } };

/**
 * Turn what a person said into a real catalogue id.
 *
 * The model is told to use catalogue ids, and mostly does. But "a sofa" is a
 * thing people say, and refusing to place one because the model wrote "sofa"
 * instead of "sofa-3" is pedantry in the wrong place.
 *
 * So a friendly name is resolved to a REAL id — never invented. Exact id
 * first, then an exact label, then a name that appears inside a label. When
 * several labels contain it ("sofa" is inside three of them) the plainest
 * wins: the shortest label, and the catalogue's own order to break a tie.
 * Whatever is chosen, the reply names the item that was actually placed, so
 * the user is never told about a sofa they did not get.
 */
function resolveCatalogId(raw: string): { id: string; label: string } | { error: string; hint: string } {
  const q = raw.trim().toLowerCase();
  if (!q) return { error: 'No catalogue item was named.', hint: 'Call list_catalog for the ids.' };
  const exact = catalogById.get(q);
  if (exact) return { id: exact.id, label: exact.label };
  const byLabel = CATALOG.filter((c) => c.label.toLowerCase() === q);
  if (byLabel.length === 1) return { id: byLabel[0].id, label: byLabel[0].label };
  const contains = CATALOG.filter(
    (c) => c.label.toLowerCase().includes(q) || c.id.toLowerCase().startsWith(q) || q.startsWith(c.id.toLowerCase()),
  );
  if (contains.length === 1) return { id: contains[0].id, label: contains[0].label };
  if (contains.length > 1) {
    const best = [...contains].sort((a, b) => a.label.length - b.label.length)[0]!;
    return { id: best.id, label: best.label };
  }
  return {
    error: `No catalogue item called "${raw}".`,
    hint: `Call list_catalog for the valid ids. Close names: ${CATALOG.slice(0, 6).map((c) => c.id).join(', ')}.`,
  };
}

/**
 * Which items of the same kind the room can actually take.
 *
 * This is the app answering a question the model cannot: "the room is full of
 * sofas — is there one that fits?" The answer is found by asking the same
 * question the placement asks, item by item, and keeping the ones with a clear
 * spot.
 *
 * They come back biggest first. The person asked for a sofa, so the useful
 * answer is the largest sofa the room can take — not the smallest chair in the
 * catalogue, which technically fits and answers a question nobody asked.
 */
function alternativesThatFit(
  p: Project,
  room: Room,
  category: string,
  excludeId: string,
): { id: string; label: string; width: number; depth: number }[] {
  const pool = CATALOG.filter((c) => c.category === category && c.id !== excludeId).sort(
    (a, b) => b.width * b.depth - a.width * a.depth,
  );
  const out: { id: string; label: string; width: number; depth: number }[] = [];
  for (const c of pool) {
    if (!findFreeSpot(p, room, c.id, 0)) continue;
    out.push({ id: c.id, label: c.label, width: c.width, depth: c.depth });
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Find the room the user meant.
 *
 * A room can be named three ways: by its id (which the model has been shown),
 * by its label ("Living room"), or by the kind of room it is ("bedroom"). All
 * three resolve here, and the search is over the ACTIVE floor — a plan has two
 * storeys, and "the bedroom" on the ground floor is not the bedroom upstairs.
 */
function resolveRoom(floorId: string, roomId: string, named: string): Room | null {
  const p = project();
  const onFloor = p.rooms.filter((r) => r.floorId === floorId);
  const pool = onFloor.length ? onFloor : p.rooms;

  if (roomId) {
    const byId = p.rooms.find((r) => r.id === roomId);
    if (byId) return byId;
  }
  if (named) {
    const q = named.trim().toLowerCase();
    const exact = pool.find((r) => r.label.toLowerCase() === q);
    if (exact) return exact;
    const byKind = pool.find((r) => (KIND_LABEL[r.kind] ?? '').toLowerCase() === q);
    if (byKind) return byKind;
    const contains = pool.filter((r) => r.label.toLowerCase().includes(q) || q.includes(r.label.toLowerCase()));
    if (contains.length === 1) return contains[0]!;
    if (contains.length > 1) return contains[0]!;
  }
  const selected = useProject.getState().activeRoomId;
  if (selected) {
    const room = p.rooms.find((r) => r.id === selected);
    if (room) return room;
  }
  return null;
}


/* ─────────────────────────────────────────────────────────────── the tools ───── */

export const TOOLS: ToolSpec[] = [
  {
    name: 'inspect_project',
    title: 'Inspect the whole project',
    description:
      'Read the project summary: plot size and setbacks, which floor is active, and how many rooms, walls and furniture items are on it. Start here — it is the cheapest way to find out what exists.',
    permission: 'read',
    input: { type: 'object', properties: {} },
    output: { type: 'object', properties: { project: { type: 'object' } } },
    handler: () => ({ ok: true, summary: 'Read the project summary.', data: envelope() }),
  },

  {
    name: 'get_floor_details',
    title: 'Get one floor',
    description: 'Full detail for a specific floor: its elevation, height, and every room, wall, opening and stair on it.',
    permission: 'read',
    input: { type: 'object', properties: { floorId: { type: 'string', description: 'Floor id. Defaults to the active floor.' } } },
    output: { type: 'object', properties: { floor: { type: 'object' }, rooms: { type: 'array' }, walls: { type: 'array' } } },
    handler: (input) => {
      const p = project();
      const floorId = str(input.floorId) || activeFloorId();
      const floor = p.floors.find((f) => f.id === floorId);
      if (!floor) return bad(`There is no floor with id "${floorId}".`, `Valid floors: ${p.floors.map((f) => f.id).join(', ')}`);
      const rooms = p.rooms.filter((r) => r.floorId === floorId);
      const walls = p.walls.filter((w) => w.floorId === floorId);
      return {
        ok: true,
        summary: `${floor.name}: ${rooms.length} rooms, ${walls.length} walls.`,
        data: envelope({
          floor,
          rooms: rooms.map((r) => ({ id: r.id, label: r.label, kind: r.kind, x: r.x, y: r.y, width: r.width, depth: r.depth, area: +(r.width * r.depth).toFixed(2) })),
          walls: walls.map((w) => ({ id: w.id, type: w.type, a: w.a, b: w.b, length: +wallLength(w).toFixed(3), thickness: w.thickness, openings: w.openings.map((o) => ({ id: o.id, kind: o.kind, offset: o.offset, width: o.width })) })),
        }),
      };
    },
  },

  {
    name: 'list_rooms',
    title: 'List the rooms on this floor',
    description: 'Every room on the active floor with its real id, kind, position and area. Use this before editing a room — the ids here are the only valid ones.',
    permission: 'read',
    input: { type: 'object', properties: { floorId: { type: 'string' } } },
    output: { type: 'object', properties: { rooms: { type: 'array', items: ROOM_SUMMARY } } },
    handler: (input) => {
      const p = project();
      const floorId = str(input.floorId) || activeFloorId();
      const rooms = p.rooms.filter((r) => r.floorId === floorId);
      if (!rooms.length) return { ok: true, summary: `No rooms on this floor yet.`, data: { rooms: [] } };
      return {
        ok: true,
        summary: `${rooms.length} rooms: ${rooms.map((r) => `${r.label} (${r.id}, ${(r.width * r.depth).toFixed(1)} m²)`).join('; ')}`,
        data: { rooms: rooms.map((r) => ({ id: r.id, label: r.label, kind: r.kind, x: r.x, y: r.y, width: r.width, depth: r.depth, area: +(r.width * r.depth).toFixed(2) })) },
      };
    },
  },

  {
    name: 'inspect_room',
    title: 'Inspect one room',
    description: 'Everything about a single room: size, area, which walls bound it, which doors reach it, and what furniture is inside.',
    permission: 'read',
    input: { type: 'object', properties: { roomId: { type: 'string' } }, required: ['roomId'] },
    output: { type: 'object', properties: { room: ROOM_SUMMARY, walls: { type: 'array' }, furniture: { type: 'array' }, doors: { type: 'array' } } },
    handler: (input) => {
      const p = project();
      const room = p.rooms.find((r) => r.id === str(input.roomId));
      if (!room) return bad(`No room has id "${str(input.roomId)}".`, 'Call list_rooms for the real ids.');
      const m = measureRoom(p, room.id);
      const walls = p.walls.filter((w) => w.roomIds.includes(room.id));
      const furniture = p.furniture.filter((f) => f.roomId === room.id);
      const doors = walls.flatMap((w) => w.openings.filter((o) => o.kind === 'door' || o.kind === 'doorway').map((o) => ({ wallId: w.id, openingId: o.id, offset: o.offset })));
      return {
        ok: true,
        summary: `${room.label} — ${room.width.toFixed(2)} × ${room.depth.toFixed(2)} m, ${m ? m.area.toFixed(1) : '0'} m², ${walls.length} bounding walls, ${furniture.length} items, ${doors.length} doors.`,
        data: { room, area: m?.area ?? null, walls: walls.map((w) => w.id), furniture, doors },
      };
    },
  },

  {
    name: 'inspect_wall',
    title: 'Inspect one wall',
    description: 'A wall by id: its endpoints, length, thickness, and the doors and windows already in it with their offsets.',
    permission: 'read',
    input: { type: 'object', properties: { wallId: { type: 'string' } }, required: ['wallId'] },
    output: { type: 'object', properties: { wall: { type: 'object' } } },
    handler: (input) => {
      const wall = project().walls.find((w) => w.id === str(input.wallId));
      if (!wall) return bad(`No wall has id "${str(input.wallId)}".`, 'Call get_floor_details for the real ids.');
      return {
        ok: true,
        summary: `Wall ${wall.id}: ${wall.type}, ${wallLength(wall).toFixed(2)} m long, ${wall.thickness} m thick, ${wall.openings.length} openings.`,
        data: { wall, length: wallLength(wall), openings: wall.openings },
      };
    },
  },

  {
    name: 'create_room',
    title: 'Create a room',
    description:
      'Add an axis-aligned rectangular room in metres. x,y is its top-left corner, width and depth run right and down. It must sit inside the plot and must not overlap an existing room.',
    permission: 'write',
    input: {
      type: 'object',
      properties: {
        floorId: { type: 'string' },
        kind: { type: 'string', enum: Object.keys(KIND_LABEL) },
        label: { type: 'string' },
        x: { type: 'number', description: 'Left edge, metres from the plot origin' },
        y: { type: 'number', description: 'Top edge, metres from the plot origin' },
        width: { type: 'number' },
        depth: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['kind', 'x', 'y', 'width', 'depth'],
    },
    output: ROOM_SUMMARY,
    handler: (input) =>
      apply(
        'createRoom',
        [{ floorId: str(input.floorId) || activeFloorId(), kind: str(input.kind) as never, label: str(input.label) || undefined, x: num(input.x), y: num(input.y), width: num(input.width), depth: num(input.depth), height: num(input.height) || undefined }],
        (d) => `Created ${(d as { label: string }).label} with id ${(d as { id: string }).id}.`,
      ),
  },

  {
    name: 'resize_room',
    title: 'Resize a room',
    description:
      'Change a room\'s width and/or depth. anchor fixes which corner stays put: bottom-right (default), top-left, top-right, bottom-left or center. The default keeps the bottom-right corner of the room fixed, so a room made wider grows to the left and a room made deeper grows upwards — pass anchor when the room has to stay against a particular wall.',
    permission: 'write',
    input: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        width: { type: 'number' },
        depth: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
        anchor: { type: 'string', enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] },
      },
      required: ['roomId'],
    },
    output: ROOM_SUMMARY,
    handler: (input) => {
      const p: ResizeRoomInput = { roomId: str(input.roomId) };
      for (const k of ['width', 'depth', 'x', 'y'] as const) if (input[k] !== undefined) p[k] = num(input[k]);
      if (input.anchor) p.anchor = str(input.anchor) as ResizeRoomInput['anchor'];
      return apply('resizeRoom', [p], (d) => `Resized ${(d as { label: string }).label} to ${(d as { width: number }).width.toFixed(2)} × ${(d as { depth: number }).depth.toFixed(2)} m.`);
    },
  },

  {
    name: 'move_room',
    title: 'Move a room',
    description: 'Move a room\'s top-left corner to an absolute x,y in metres. Its size does not change.',
    permission: 'write',
    input: { type: 'object', properties: { roomId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['roomId', 'x', 'y'] },
    output: ROOM_SUMMARY,
    handler: (input) => apply('moveRoom', [str(input.roomId), num(input.x), num(input.y)], (d) => `Moved ${(d as { label: string }).label}.`),
  },

  {
    name: 'create_wall',
    title: 'Create a wall',
    description: 'Add a wall between two plan points. Walls are what 3D, doors and windows are built on, so a room without walls is a diagram, not a building.',
    permission: 'write',
    input: {
      type: 'object',
      properties: {
        floorId: { type: 'string' },
        type: { type: 'string', enum: ['exterior', 'interior', 'parapet', 'railing'] },
        a: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        b: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        thickness: { type: 'number' },
      },
      required: ['a', 'b'],
    },
    output: { type: 'object', properties: { id: { type: 'string' }, length: { type: 'number' } } },
    handler: (input) => {
      const a = obj(input.a);
      const b = obj(input.b);
      return apply(
        'createWall',
        [{ floorId: str(input.floorId) || activeFloorId(), type: (str(input.type) || 'interior') as never, a: { x: num(a.x), y: num(a.y) }, b: { x: num(b.x), y: num(b.y) }, thickness: num(input.thickness) || undefined }],
        (d) => `Created ${(d as { type: string }).type} wall ${(d as { id: string }).id}, ${wallLength(d as never).toFixed(2)} m.`,
      );
    },
  },

  {
    name: 'move_wall',
    title: 'Move or reshape a wall',
    description: 'Move a whole wall with dx/dy in metres, or set an absolute new endpoint with a or b. Thickness and type can be changed here too.',
    permission: 'write',
    input: {
      type: 'object',
      properties: {
        wallId: { type: 'string' },
        dx: { type: 'number' },
        dy: { type: 'number' },
        a: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        b: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        thickness: { type: 'number' },
        type: { type: 'string' },
      },
      required: ['wallId'],
    },
    output: { type: 'object', properties: { id: { type: 'string' } } },
    handler: (input) => {
      const payload: Record<string, unknown> = { wallId: str(input.wallId) };
      if (input.dx !== undefined) payload.dx = num(input.dx);
      if (input.dy !== undefined) payload.dy = num(input.dy);
      if (input.a) payload.a = { x: num(obj(input.a).x), y: num(obj(input.a).y) };
      if (input.b) payload.b = { x: num(obj(input.b).x), y: num(obj(input.b).y) };
      if (input.thickness !== undefined) payload.thickness = num(input.thickness);
      if (input.type) payload.type = str(input.type);
      return apply('moveWall', [payload], (d) => `Wall ${(d as { id: string }).id} is now ${wallLength(d as never).toFixed(2)} m, ${(d as { thickness: number }).thickness} m thick.`);
    },
  },

  {
    name: 'add_door',
    title: 'Add a door',
    description: 'Put a door into an existing wall. offset is the distance in metres from the wall\'s start point; omit it for the middle. The opening must fit inside the wall and must not collide with another opening.',
    permission: 'write',
    input: {
      type: 'object',
      properties: { wallId: { type: 'string' }, offset: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, swing: { type: 'string', enum: ['positive', 'negative'] } },
      required: ['wallId'],
    },
    output: { type: 'object', properties: { wallId: { type: 'string' }, openingId: { type: 'string' } } },
    handler: (input) =>
      apply(
        'addOpening',
        [{ wallId: str(input.wallId), kind: 'door', offset: input.offset === undefined ? undefined : num(input.offset), width: num(input.width) || 0.9, height: num(input.height) || 2.1, swing: str(input.swing) || undefined }],
        (d) => `Door ${(d as { opening: { id: string } }).opening.id} added to wall ${(d as { wall: { id: string } }).wall.id}.`,
      ),
  },

  {
    name: 'add_window',
    title: 'Add a window',
    description: 'Put a window into an existing wall. sill is the height of the bottom of the glass above the floor; omit it for the standard 0.9 m.',
    permission: 'write',
    input: {
      type: 'object',
      properties: { wallId: { type: 'string' }, offset: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, sill: { type: 'number' } },
      required: ['wallId'],
    },
    output: { type: 'object', properties: { wallId: { type: 'string' }, openingId: { type: 'string' } } },
    handler: (input) =>
      apply(
        'addOpening',
        [{ wallId: str(input.wallId), kind: 'window', offset: input.offset === undefined ? undefined : num(input.offset), width: num(input.width) || 1.2, height: num(input.height) || 1.4, sill: num(input.sill) || 0.9 }],
        (d) => `Window ${(d as { opening: { id: string } }).opening.id} added to wall ${(d as { wall: { id: string } }).wall.id}.`,
      ),
  },

  {
    name: 'move_opening',
    title: 'Move an opening',
    description:
      'Slide an existing door or window along its wall, or resize it. offset is the distance in metres from the wall\'s start point to the opening\'s centre; omit any field to leave it alone. The opening must still fit inside the wall and must not collide with another opening.',
    permission: 'write',
    input: {
      type: 'object',
      properties: { wallId: { type: 'string' }, openingId: { type: 'string' }, offset: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, sill: { type: 'number' }, swing: { type: 'string', enum: ['positive', 'negative'] } },
      required: ['wallId', 'openingId'],
    },
    output: { type: 'object', properties: { wallId: { type: 'string' }, openingId: { type: 'string' }, offset: { type: 'number' } } },
    handler: (input) => {
      const payload: Record<string, unknown> = { wallId: str(input.wallId), openingId: str(input.openingId) };
      for (const k of ['offset', 'width', 'height', 'sill'] as const) if (input[k] !== undefined) payload[k] = num(input[k]);
      if (input.swing) payload.swing = str(input.swing);
      return apply('moveOpening', [payload], (d) => {
        const o = d as { offset: number; kind: string };
        return `The ${o.kind} on ${str(input.wallId)} now sits ${o.offset.toFixed(2)} m along the wall.`;
      });
    },
  },

  {
    name: 'add_staircase',
    title: 'Add a staircase',
    description: 'Add a straight flight. direction 1 climbs from this floor to the one above; -1 descends. The flight must actually reach the floor it claims to connect to.',
    permission: 'write',
    input: {
      type: 'object',
      properties: { floorId: { type: 'string' }, connectsToFloorId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, riserCount: { type: 'number' }, direction: { type: 'number', enum: [-1, 1] }, name: { type: 'string' } },
      required: ['floorId', 'x', 'y'],
    },
    output: { type: 'object', properties: { id: { type: 'string' }, riserCount: { type: 'number' } } },
    handler: (input) =>
      apply(
        'addStaircase',
        [{ floorId: str(input.floorId) || activeFloorId(), connectsToFloorId: str(input.connectsToFloorId) || undefined, x: num(input.x), y: num(input.y), width: num(input.width) || undefined, riserCount: num(input.riserCount) || undefined, direction: (num(input.direction) === -1 ? -1 : 1) as -1 | 1, name: str(input.name) || undefined }],
        (d) => `Staircase ${(d as { id: string }).id} added with ${(d as { riserCount: number }).riserCount} risers.`,
      ),
  },

  {
    name: 'add_furniture',
    title: 'Add a piece of furniture',
    description:
      'Place a catalogue item in a room. Give the catalogue id (list_catalog has them all) and the room — by id, or by name such as "Living room". Furnish finds a clear spot for it: inside the room, clear of the furniture already there, clear of every door swing and of the floor in front of every door. You do NOT need to work out coordinates, and you must not guess them — leave x and y out and the app will find the position.',
    permission: 'write',
    input: {
      type: 'object',
      properties: {
        catalogId: { type: 'string', description: 'A catalogue id, e.g. bed-double or sofa-3' },
        room: { type: 'string', description: 'The room to put it in, by name: "Living room", "Bedroom 2". Use roomId if you have the id.' },
        roomId: { type: 'string', description: 'The room id, if you know it.' },
        x: { type: 'number', description: 'Optional. The centre point in metres. Omit it and Furnish finds a clear spot.' },
        y: { type: 'number', description: 'Optional. The centre point in metres. Omit it and Furnish finds a clear spot.' },
        rotation: { type: 'number' },
        color: { type: 'string' },
      },
      required: ['catalogId'],
    },
    output: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, room: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } },
    handler: (input) => {
      const p = project();
      const floorId = activeFloorId();

      const cat = resolveCatalogId(str(input.catalogId));
      if ('error' in cat) return bad(cat.error, cat.hint);

      const room = resolveRoom(floorId, str(input.roomId), str(input.room));
      if (!room) {
        const rooms = p.rooms.filter((r) => r.floorId === floorId).map((r) => r.label);
        return bad(
          'No room was named, and no room is selected.',
          `Name the room (for example "Living room") or give its id. Rooms on this floor: ${rooms.join(', ') || 'none'}.`,
        );
      }

      const rotation = num(input.rotation) || 0;
      const hasX = typeof input.x === 'number' && Number.isFinite(input.x);
      const hasY = typeof input.y === 'number' && Number.isFinite(input.y);

      let x: number;
      let y: number;
      let turn = rotation;
      if (hasX && hasY) {
        x = num(input.x);
        y = num(input.y);
      } else {
        const spot = findFreeSpot(p, room, cat.id, rotation);
        if (!spot) {
          const entry = catalogById.get(cat.id)!;
          // A refusal that only says "no" is a dead end: the model is told the
          // item does not fit and has no way to find out what does. The app
          // knows — it can ask the same question about every other item in the
          // same category and see which one the room has room for. So the
          // refusal names one, and the assistant can place that instead.
          const fits = alternativesThatFit(p, room, entry.category, cat.id);
          const hint = fits.length
            ? `The ${fits[0].label} (${fits[0].width.toFixed(2)} m × ${fits[0].depth.toFixed(2)} m) does fit in ${room.label} — call add_furniture with catalogId "${fits[0].id}" and room "${room.label}" instead.`
            : 'Pick a different room, or a smaller item.';
          return bad(
            `There is no clear space in ${room.label} for a ${entry.label} (${entry.width.toFixed(2)} m × ${entry.depth.toFixed(2)} m).`,
            hint,
          );
        }
        x = spot.x;
        y = spot.y;
        turn = spot.rotation;
      }

      return apply(
        'addFurniture',
        [{ floorId: room.floorId, roomId: room.id, catalogId: cat.id, x, y, rotation: turn || undefined, color: str(input.color) || undefined }],
        (d) => {
          const item = d as { id: string; label: string; x: number; y: number };
          return `Placed ${item.label} in ${room.label} at ${item.x.toFixed(2)}, ${item.y.toFixed(2)} (id ${item.id}).`;
        },
      );
    },
  },

  {
    name: 'move_furniture',
    title: 'Move a piece of furniture',
    description: 'Move, rotate or resize an existing item by id. Omit any field to leave it alone. The item re-homes to whichever room now contains it.',
    permission: 'write',
    input: {
      type: 'object',
      properties: { itemId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, rotation: { type: 'number' }, width: { type: 'number' }, depth: { type: 'number' }, color: { type: 'string' } },
      required: ['itemId'],
    },
    output: { type: 'object', properties: { id: { type: 'string' } } },
    handler: (input) => {
      const payload: Record<string, unknown> = { itemId: str(input.itemId) };
      for (const k of ['x', 'y', 'rotation', 'width', 'depth'] as const) if (input[k] !== undefined) payload[k] = num(input[k]);
      if (input.color) payload.color = str(input.color);
      return apply('moveFurniture', [payload], (d) => `${(d as { label: string }).label} is now at ${(d as { x: number }).x.toFixed(2)}, ${(d as { y: number }).y.toFixed(2)}.`);
    },
  },

  {
    name: 'remove_element',
    title: 'Delete something',
    description: 'Delete a room, wall, opening, stair, outdoor space or furniture item by id. This is destructive: the user is asked to confirm before it happens.',
    permission: 'destructive',
    input: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['room', 'wall', 'opening', 'stair', 'outdoor', 'furniture'], description: 'Required for openings, which need their parent wall.' }, wallId: { type: 'string' } }, required: ['id'] },
    output: { type: 'object', properties: { removedIds: { type: 'array' } } },
    handler: (input) => {
      const p = project();
      const id = str(input.id);
      const explicit = str(input.kind);
      const kind =
        explicit ||
        (p.rooms.some((r) => r.id === id) ? 'room'
        : p.walls.some((w) => w.id === id) ? 'wall'
        : p.furniture.some((f) => f.id === id) ? 'furniture'
        : p.outdoor.some((o) => o.id === id) ? 'outdoor'
        : p.stairs.some((s) => s.id === id) ? 'stair'
        : p.walls.some((w) => w.openings.some((o) => o.id === id)) ? 'opening'
        : null);
      if (!kind) return bad(`Nothing in this project has id "${id}".`, 'Call list_rooms or get_floor_details for the real ids.');
      const label = p.rooms.find((r) => r.id === id)?.label ?? kind;
      if (kind === 'opening') {
        const wall = p.walls.find((w) => w.openings.some((o) => o.id === id));
        if (!wall) return bad(`Opening "${id}" is not in any wall.`);
        return apply('removeOpening', [wall.id, id], () => `Deleted the opening in ${wall.id}.`);
      }
      const op = `remove${kind[0]!.toUpperCase()}${kind.slice(1)}` as OperationName;
      return apply(op, [id], () => `Deleted ${label}.`);
    },
  },

  {
    name: 'calculate_room_area',
    title: 'Measure one room',
    description: 'Exact area, perimeter and dimensions of one room, computed from the model — never estimated.',
    permission: 'read',
    input: { type: 'object', properties: { roomId: { type: 'string' } }, required: ['roomId'] },
    output: { type: 'object', properties: { area: { type: 'number' }, perimeter: { type: 'number' } } },
    handler: (input) => {
      const m = measureRoom(project(), str(input.roomId));
      if (!m) return bad(`No room has id "${str(input.roomId)}".`);
      return { ok: true, summary: `${m.label} is ${m.area.toFixed(2)} m² (${m.width.toFixed(2)} × ${m.depth.toFixed(2)} m, perimeter ${m.perimeter.toFixed(2)} m).`, data: m };
    },
  },

  {
    name: 'calculate_building_areas',
    title: 'Measure the whole building',
    description: 'Plot area, buildable area, net indoor area, footprint, gross covered area, open site area, plot coverage and floor-area ratio — each computed from real geometry with its formula.',
    permission: 'read',
    input: { type: 'object', properties: {} },
    output: { type: 'object', properties: { netIndoorArea: { type: 'number' }, plotCoverage: { type: 'number' }, floorAreaRatio: { type: 'number' } } },
    handler: () => {
      const m = measureBuilding(project());
      return {
        ok: true,
        summary:
          `Plot ${m.plotArea.toFixed(1)} m² · net indoor ${m.netIndoorArea.toFixed(1)} m² · footprint ${m.footprintArea.toFixed(1)} m² · ` +
          `gross covered ${m.grossCoveredArea.toFixed(1)} m² · open site ${m.openSiteArea.toFixed(1)} m² · coverage ${(m.plotCoverage * 100).toFixed(1)}% · FAR ${m.floorAreaRatio.toFixed(2)}`,
        data: m,
      };
    },
  },

  {
    name: 'validate_floor_plan',
    title: 'Check the plan for problems',
    description: 'Run the deterministic checks: overlaps, walls that do not meet, openings that do not fit, doors that cannot be reached, rooms with no way in, stairs that do not connect, furniture through walls, setbacks and coverage.',
    permission: 'read',
    input: { type: 'object', properties: { severity: { type: 'string', enum: ['all', 'errors'] } } },
    output: { type: 'object', properties: { issues: { type: 'array' } } },
    handler: (input) => {
      const list = str(input.severity) === 'errors' ? errorsOnly(validate(project())) : validate(project());
      const n = errorsOnly(list).length;
      return {
        ok: true,
        summary: list.length === 0 ? 'The plan is clean — 0 issues.' : `${n} error(s), ${list.length - n} warning(s): ${list.slice(0, 12).map((i) => i.message).join(' ')}`,
        data: { issues: list, errorCount: n },
      };
    },
  },

  {
    name: 'get_layout_issues',
    title: 'List the current problems',
    description: 'The same issue list the Checks panel shows, with each problem\'s code, the objects involved and any suggested corrections. Call this after editing, and fix what it reports.',
    permission: 'read',
    input: { type: 'object', properties: {} },
    output: { type: 'object', properties: { issues: { type: 'array' } } },
    handler: () => {
      const list = validate(project());
      return {
        ok: true,
        summary: list.length === 0 ? 'No issues. The plan is clean.' : list.map((i) => `[${i.severity}] ${i.code}: ${i.message}`).join('\n'),
        data: { issues: list as Issue[] },
      };
    },
  },

  {
    name: 'apply_material',
    title: 'Apply a material',
    description: 'Apply a named material to a room, a wall, every exterior wall, or every floor finish. Use list_materials for valid ids.',
    permission: 'write',
    input: { type: 'object', properties: { materialId: { type: 'string' }, target: { type: 'string', enum: ['room', 'wall', 'exterior', 'floor'] }, elementId: { type: 'string' } }, required: ['materialId', 'target'] },
    output: { type: 'object', properties: { ok: { type: 'boolean' } } },
    handler: (input) =>
      apply(
        'applyMaterial',
        [{ kind: (str(input.target) || 'room') as never, id: str(input.elementId) || undefined }, str(input.materialId)],
        () => `Applied ${str(input.materialId)}.`,
      ),
  },

  {
    name: 'style_home',
    title: 'Choose the style and apply its palette',
    description:
      'Apply one of the five named palettes to the whole house at once: the facade, the internal walls, and every room floor (matched to how that room is actually used). The only input is which style — the colours are fixed in the app, so this never changes geometry and never picks an arbitrary colour. Also records the choice on the brief. Use list_styles to see the options and what each one is.',
    permission: 'write',
    input: { type: 'object', properties: { style: { type: 'string', enum: DESIGN_STYLES } }, required: ['style'] },
    output: {
      type: 'object',
      properties: {
        style: { type: 'string' },
        exteriorWalls: { type: 'number' },
        interiorWalls: { type: 'number' },
        floors: { type: 'object' },
      },
    },
    handler: (input) => {
      const style = str(input.style);
      // Refused before anything runs. A fallback palette here would let the
      // assistant report a style the user did not ask for.
      if (!paletteFor(style)) {
        return {
          ok: false,
          summary: '',
          error: `"${style}" is not one of the available styles.`,
          errorCode: 'invalid_input',
          hint: `Call list_styles. The options are: ${DESIGN_STYLES.join(', ')}.`,
        };
      }
      return apply('applyStyle', [style], (data) => {
        const r = data as { exteriorWalls: number; interiorWalls: number; floors: Record<string, number> };
        const floorParts = Object.entries(r.floors).map(([id, n]) => `${n}× ${id}`);
        const parts = [
          r.exteriorWalls ? `${r.exteriorWalls} exterior wall(s)` : null,
          r.interiorWalls ? `${r.interiorWalls} internal wall(s)` : null,
          floorParts.length ? `${floorParts.length} floor finish(es) (${floorParts.join(', ')})` : null,
        ].filter(Boolean);
        return parts.length
          ? `Applied the ${STYLE_LABEL[style as DesignStyle]} palette: ${parts.join('; ')}.`
          : `The ${STYLE_LABEL[style as DesignStyle]} palette was already applied — nothing changed.`;
      });
    },
  },

  {
    name: 'list_styles',
    title: 'List the available style palettes',
    description: 'The five named styles and the materials each one applies. Read this before style_home if the user has not named a style.',
    permission: 'read',
    input: { type: 'object', properties: {} },
    output: { type: 'object', properties: { styles: { type: 'array' } } },
    handler: () => {
      const styles = DESIGN_STYLES.map((s) => {
        const p = paletteFor(s)!;
        return {
          style: s,
          label: STYLE_LABEL[s],
          blurb: STYLE_BLURB[s],
          exterior: DEFAULT_MATERIALS[p.exterior]?.label ?? p.exterior,
          interior: DEFAULT_MATERIALS[p.interior]?.label ?? p.interior,
        };
      });
      return {
        ok: true,
        summary: styles
          .map((s) => `${s.label} (${s.style}): ${s.blurb} Facade: ${s.exterior}. Internal walls: ${s.interior}.`)
          .join('\n'),
        data: { styles },
      };
    },
  },

  {
    name: 'get_3d_scene_state',
    title: 'Read what the 3D view is showing',
    description: 'How many boxes the 3D build produced, the building bounds, and how many collision volumes the walk camera has. Useful for confirming that an edit actually reached 3D.',
    permission: 'read',
    input: { type: 'object', properties: {} },
    output: { type: 'object', properties: { boxCount: { type: 'number' }, bounds: { type: 'object' } } },
    handler: () => {
      const scene = buildScene(project());
      const byKind: Record<string, number> = {};
      for (const b of scene.boxes) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
      return {
        ok: true,
        summary: `3D: ${scene.boxes.length} meshes (${Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(', ')}), ${scene.colliders.length} colliders, ${scene.bounds.height.toFixed(2)} m tall.`,
        data: { boxCount: scene.boxes.length, byKind, colliders: scene.colliders.length, bounds: scene.bounds },
      };
    },
  },

  {
    name: 'list_catalog',
    title: 'List furniture catalogue',
    description: 'Every catalogue item with its id and real footprint in metres. Use these ids for add_furniture and move_furniture. Narrow it with a category if you want: seating, sleeping, storage, table, kitchen, bath, appliance, decor.',
    permission: 'read',
    input: { type: 'object', properties: { category: { type: 'string' } } },
    output: { type: 'object', properties: { items: { type: 'array' } } },
    handler: (input) => {
      const category = str(input.category);
      const asked = category ? CATALOG.filter((c) => c.category === category) : CATALOG;
      // A filter that matches nothing used to answer "0 items" — and that is the
      // one answer the model cannot do anything with. It asked for "sofas", the
      // catalogue calls them "seating", and the turn ended with nothing placed
      // and no way to find out why. So a filter that matches nothing returns
      // the whole catalogue, with the real category names spelled out, and the
      // model can place the sofa it wanted on the next round.
      const items = (asked.length ? asked : CATALOG).map((c) => ({ id: c.id, label: c.label, width: c.width, depth: c.depth, height: c.height, category: c.category }));
      const categories = [...new Set(CATALOG.map((c) => c.category))];
      const note = asked.length
        ? ''
        : ` Nothing is filed under "${category}" — showing every item instead.`;
      const head = asked.length
        ? `${items.length} items:`
        : `${items.length} items (categories: ${categories.join(', ')}):`;
      return { ok: true, summary: `${head} ${items.map((i) => `${i.id} (${i.width}×${i.depth}m)`).join('; ')}.${note}`, data: { items } };
    },
  },

  {
    name: 'list_materials',
    title: 'List materials',
    description: 'Every material Furnish knows, with its id and role.',
    permission: 'read',
    input: { type: 'object', properties: {} },
    output: { type: 'object', properties: { materials: { type: 'array' } } },
    handler: () => {
      const materials = Object.entries(DEFAULT_MATERIALS).map(([id, m]) => ({ id, label: m.label, kind: m.kind }));
      return { ok: true, summary: `${materials.length} materials: ${materials.map((m) => `${m.id} (${m.kind})`).join('; ')}`, data: { materials } };
    },
  },

  {
    name: 'undo_last_operation',
    title: 'Undo the last change',
    description: 'Step back one edit in the shared undo history, whatever made it.',
    permission: 'write',
    input: { type: 'object', properties: {} },
    output: { type: 'object', properties: { undone: { type: 'boolean' } } },
    handler: () => {
      const before = project();
      useProject.getState().undo();
      const after = project();
      return { ok: true, summary: after === before ? 'Nothing was left to undo.' : 'Undid the last change.', data: { undone: after !== before } };
    },
  },

  {
    name: 'export_project',
    title: 'Export the project',
    description: 'Produce the project as JSON text. This is the lossless format Furnish can import back, and it is the only honest way to hand a project to someone else.',
    permission: 'read',
    input: { type: 'object', properties: { pretty: { type: 'boolean' } } },
    output: { type: 'object', properties: { json: { type: 'string' } } },
    handler: (input) => {
      void import('../model/serialize.ts').then(({ toJSON }) => {
        const p = project();
        const json = toJSON(p, bool(input.pretty));
        useProject.getState().toast('success', `Exported ${formatArea(p.rooms.length ? 1 : 0, 'm')} of project JSON (${json.length.toLocaleString()} characters). Download it from the Export menu.`);
      });
      const p = project();
      return { ok: true, summary: `Project "${p.name}" has ${p.floors.length} floors, ${p.rooms.length} rooms, ${p.walls.length} walls. Use the Export menu for the file itself.`, data: { name: p.name, floors: p.floors.length, rooms: p.rooms.length, walls: p.walls.length } };
    },
  },

  {
    name: 'regenerate_floor',
    title: 'Re-plan a floor from the brief',
    description: 'Throw away the current layout of one floor and lay it out again from the stored brief. This is destructive — every room, wall and opening on that floor is replaced.',
    permission: 'destructive',
    input: { type: 'object', properties: { floorId: { type: 'string' } } },
    output: { type: 'object', properties: { floorId: { type: 'string' } } },
    handler: (input) => {
      const floorId = str(input.floorId) || activeFloorId();
      return apply('replanFloor', [floorId], () => `Re-planned ${floorId} from the brief.`);
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * The tool list as sent to the model.
 *
 * Read tools are advertised first and edits later: the model should look before
 * it leaps, and ordering is the cheapest way to nudge that without a longer
 * prompt. `input_schema` is the property name MiniMax's Anthropic-compatible
 * endpoint expects.
 */
export function toolDefinitionsForModel(): Array<{ name: string; description: string; input_schema: JsonSchema }> {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input }));
}

/** Every tool name, as a union. `SuggestedFix.tool` is typed with it. */
export type ToolName = (typeof TOOLS)[number]['name'];

/**
 * Run one tool by name against the live project.
 *
 * The single place a named edit becomes an actual change. The assistant's
 * pipeline, the validator's click-to-fix buttons and the tests all come through
 * here, so a correction the validation panel offers is executed by exactly the
 * same code path — with the same argument checking, the same activity log and
 * the same undo history — that the model uses. There is no second, looser route
 * into the model for the UI to take.
 *
 * Never throws: an unknown name or a throwing handler comes back as a failed
 * outcome, so a caller that forgets to check `ok` still cannot corrupt state.
 */
export function runTool(
  name: string,
  input: Record<string, unknown> = {},
  actor: 'assistant' | 'user' = 'assistant',
): ToolOutcome {
  const spec = TOOLS_BY_NAME.get(name);
  if (!spec) return bad(`There is no tool called "${name}".`);
  const previous = currentActor;
  currentActor = actor;
  try {
    return spec.handler(input);
  } catch (e) {
    return { ok: false, summary: '', error: e instanceof Error ? e.message : String(e) };
  } finally {
    currentActor = previous;
  }
}

export { formatArea, formatLength };
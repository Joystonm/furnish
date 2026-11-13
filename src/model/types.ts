/**
 * The shape of everything the app knows about.
 *
 * One rule holds the whole model together: **the drawing is a function of the
 * data, never a second copy of it.** The plan you look at, the findings the
 * checks report and the numbers on the status strip are all computed from
 * these structures. There is no second place where a room's size is written
 * down, so there is nothing to fall out of step.
 */

/** What a room is for. The kind decides its minimum usable size. */
export type RoomKind =
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'bedroom'
  | 'bathroom'
  | 'study'
  | 'hall';

export const ROOM_KINDS: RoomKind[] = [
  'living',
  'kitchen',
  'dining',
  'bedroom',
  'bathroom',
  'study',
  'hall',
];

/** A rectangle in plan metres. `x` grows east, `y` grows south. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  depth: number;
}

/** One room as the person asked for it, before any geometry exists. */
export interface BriefRoom {
  id: string;
  label: string;
  kind: RoomKind;
  /** Requested floor area, in square metres. */
  area: number;
  /** Which storey the room goes on. 0 is the ground floor. */
  floor: number;
}

/** What the person asked for. */
export interface Brief {
  /** The brief in their own words. */
  text: string;
  plotWidth: number;
  plotDepth: number;
  storeys: number;
  rooms: BriefRoom[];
}

/** A room with a place on the plot. */
export interface Room extends Rect {
  id: string;
  label: string;
  kind: RoomKind;
  floor: number;
  /** The area the brief asked for, so the drawing can show the difference. */
  requestedArea: number;
}

/** A way through a wall. */
export interface Door {
  id: string;
  floor: number;
  kind: 'door' | 'front';
  /** The centre of the opening, in plan metres. */
  x: number;
  y: number;
  width: number;
  /** Which way the wall runs. 'vertical' walls stand north–south. */
  axis: 'vertical' | 'horizontal';
  /** Which side the leaf swings to. */
  swing: 1 | -1;
  /** The two spaces the opening joins. `null` where it leads outside. */
  joins: [string | null, string | null];
}

/** A flight of stairs from one storey to the next. */
export interface Stair {
  id: string;
  /** The storey the flight starts on. */
  floor: number;
  toFloor: number;
  /** The plan rectangle the flight occupies. */
  x: number;
  y: number;
  width: number;
  /** How far the flight runs, north–south. */
  run: number;
  /** +1 rises toward the south, -1 toward the north. */
  direction: 1 | -1;
  risers: number;
}

/** A piece of furniture. */
export interface Furniture {
  id: string;
  label: string;
  roomId: string;
  floor: number;
  x: number;
  y: number;
  width: number;
  depth: number;
}

/** A complete design. */
export interface Plan {
  brief: Brief;
  rooms: Room[];
  doors: Door[];
  stairs: Stair[];
  furniture: Furniture[];
}

/** Why the generator could not produce a plan. */
export interface Refusal {
  reason: string;
  detail: string;
  /** What the person would have to change to make it fit. */
  shortfall: number;
}

export type GenerateResult =
  | { ok: true; plan: Plan }
  | { ok: false; refusal: Refusal };

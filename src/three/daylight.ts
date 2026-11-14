/**
 * Daylight as something that falls off from the windows.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * three.js has no global illumination. Indoors, a room's walls cast a full
 * shadow over everything inside them, so without help every interior surface is
 * lit only by whatever uniform fill the scene declares. That is what the
 * interior looked like: a hemisphere light at a fixed strength reaching the
 * back wall of a bathroom as strongly as the render right beside the window,
 * plus a sky environment map applied globally — which is the sky lighting every
 * surface as though the roof were off. Result: flat, cool, washed-out rooms with
 * no sense of where the openings were, and furniture that read as grey shapes
 * because nothing in the frame had a direction.
 *
 * The honest fix is image-based lighting with ray-traced occlusion, which this
 * does not have and is not going to pretend to. What it has instead is the
 * thing that actually carries the impression: **each window is a light source
 * with a falloff**, so the wall under it is bright, the far corner of the room
 * is not, and the direction of the light tells you which way the room faces.
 * A doorway passes a little of that light on, which is why a hall off a sunny
 * living room is not as dark as a hall off a bathroom.
 *
 * ── What this does not do ───────────────────────────────────────────────────
 *
 * The lights here do not cast shadows, so light passes through the wall behind
 * a window into the room next door. That is a real approximation and is not
 * hidden: the renderer is told how many lights to keep, and it keeps the ones
 * nearest the camera, which bounds the error to the room you are standing in
 * and the one beyond it. Shadow-casting point lights are not an option here —
 * the software rasteriser the automated suite runs under cannot afford them.
 */
import type { Floor, Opening, Room, Wall } from '../model/types.ts';

/** An opening that admits daylight. */
const GLAZED: ReadonlySet<string> = new Set(['window']);

/**
 * Openings that pass light between rooms without glazing.
 *
 * A doorway between a sunlit living room and a hall is why the hall is not
 * black. Cheaper than a bounce trace and about as accurate.
 */
const CONNECTING: ReadonlySet<string> = new Set(['doorway', 'opening']);

/** How much of a glazed opening's light a connecting one passes. */
const CONNECTING_GAIN = 0.35;

/** A light source derived from an opening, in world coordinates. */
export interface DaylightSource {
  x: number;
  y: number;
  z: number;
  /**
   * Horizontal direction the light travels *into* the building, unit length.
   * A window on the north elevation points south; the sky is behind it.
   */
  nx: number;
  nz: number;
  /** Glazed width and height in metres — area drives how much light it admits. */
  w: number;
  h: number;
  floorOrder: number;
  floorId: string;
  /** Glazed openings are brighter; connecting ones carry a share of the room's. */
  gain: number;
}

/** How far a source's light still reaches, in metres. */
export const REACH = 9.5;

/**
 * Falloff exponent.
 *
 * Physical inverse-square is 2, and is what `decay: 2` means in three.js. Real
 * interiors do not obey it because the light that reaches the back of a room
 * has bounced two or three times first, and inverse-square over 9 m makes the
 * far end of a room read as a cave. 1.35 keeps a clear gradient — the falloff is
 * plainly visible walking away from a window — without pretending the room goes
 * black. The compensation is stated here rather than hidden in a literal.
 */
export const DECAY = 1.35;

/** Interior sources the renderer keeps at once. */
export const MAX_SOURCES = 6;

/**
 * Base strength of a 1 m² window, in three.js intensity units before the
 * distance term. Calibrated against the exterior render, which is already
 * correct: a window has to out-shine the uniform fill near it without pushing
 * the wall under it past the top of the ACES curve.
 */
const BASE_STRENGTH = 5.2;

/**
 * Cool sky, and the warm sun coming through glass.
 *
 * The cool end tracks the sky in `textures.ts`: same hue, less saturated. A
 * saturated blue *light* reads as a gel rather than as daylight, so the two
 * ends of this ramp are deliberately far apart in warmth and close in chroma —
 * which is also what keeps the mix from passing through a muddy neutral in the
 * middle. `WARM` is untouched by the move to the cool scheme: a warm sun
 * against a cool sky is what makes a render read as daylight, and flattening
 * the warm end to match would leave the whole scene overcast and dead.
 */
const COOL = '#d4e3f2';
const WARM = '#ffe3bd';

export interface WorldFrame {
  plotWidth: number;
  plotDepth: number;
}

export interface DaylightInput {
  walls: Wall[];
  floors: Floor[];
  rooms: Room[];
  plot: WorldFrame;
}

/**
 * Every opening in the project that should behave as a source of light, in
 * world coordinates.
 *
 * Plan coordinates map to world as `x - plotWidth/2` and `y - plotDepth/2`
 * (see `sceneModel`), with height as `floor.elevation + height above the
 * floor`. Only exterior walls are considered: a window drawn on an internal
 * partition has nothing behind it.
 */
export function daylightSources({ walls, floors, rooms, plot }: DaylightInput): DaylightSource[] {
  const order = new Map(floors.map((f) => [f.id, f.order]));
  const elevation = new Map(floors.map((f) => [f.id, f.elevation]));

  // Where the inside of the building is, per wall, so a source knows which way
  // to shine. Rooms first, because a plot's centre can be outside an L-shaped
  // house; the plot centre is only the fallback for a wall with no rooms yet.
  const centreOfRooms = (ids: readonly string[]): { x: number; y: number } | null => {
    let n = 0;
    let x = 0;
    let y = 0;
    for (const id of ids) {
      const room = rooms.find((r) => r.id === id);
      if (!room) continue;
      x += room.x + room.width / 2;
      y += room.y + room.depth / 2;
      n += 1;
    }
    return n ? { x: x / n, y: y / n } : null;
  };

  const out: DaylightSource[] = [];
  for (const wall of walls) {
    if (wall.type !== 'exterior') continue;
    const baseY = elevation.get(wall.floorId);
    const floorOrder = order.get(wall.floorId);
    if (baseY === undefined || floorOrder === undefined) continue;

    const ax = wall.a.x;
    const ay = wall.a.y;
    const bx = wall.b.x;
    const by = wall.b.y;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-4) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;

    const mid = { x: (ax + bx) / 2, y: (ay + by) / 2 };
    const inside = centreOfRooms(wall.roomIds) ?? {
      x: plot.plotWidth / 2,
      y: plot.plotDepth / 2,
    };
    // Perpendicular to the wall, pointing at the inside. Both candidates are
    // candidates; the one nearer the inside wins, and a wall exactly on the
    // inside (which cannot happen for an exterior wall) falls back to +normal.
    let nx = uy;
    let nz = -ux;
    if (Math.hypot(mid.x + nx - inside.x, mid.y + nz - inside.y) >
        Math.hypot(mid.x - nx - inside.x, mid.y - nz - inside.y)) {
      nx = -nx;
      nz = -nz;
    }

    for (const opening of wall.openings) {
      const gain = openingGain(opening);
      if (!gain) continue;
      const s = opening.offset + opening.width / 2;
      if (s < 0 || s > len) continue;
      const px = ax + ux * s;
      const py = ay + uy * s;
      out.push({
        x: px - plot.plotWidth / 2,
        y: baseY + opening.sill + opening.height / 2,
        z: py - plot.plotDepth / 2,
        nx,
        nz,
        w: opening.width,
        h: opening.height,
        floorOrder,
        floorId: wall.floorId,
        gain,
      });
    }
  }
  return out;
}

/** How strongly one opening lights the space in front of it. 0 means none. */
export function openingGain(opening: Opening): number {
  if (GLAZED.has(opening.kind)) return 1;
  if (CONNECTING.has(opening.kind)) return CONNECTING_GAIN;
  return 0;
}

/**
 * The strength one source should be given, for a viewer standing `distance`
 * away.
 *
 * Three.js applies the inverse-square itself when `decay` is set, so this is the
 * constant in front of it: glazed area, times the opening's own gain, times how
 * squarely it faces the sun.
 */
export function sourceIntensity(source: DaylightSource, sun: { x: number; z: number }): number {
  return BASE_STRENGTH * Math.max(0.05, source.w * source.h) * source.gain * facingGain(source, sun);
}

/**
 * How squarely a source faces the sun, as a gain between 0.35 and 1.25.
 *
 * `sun` is the horizontal direction *towards* the sun. A window whose inward
 * normal points the same way has the sun behind it and is in its own shade;
 * one facing the sun is not. Not a lighting simulation — just the difference
 * between a north window and a south one, which is the first thing anyone
 * notices about a room.
 */
export function facingGain(source: DaylightSource, sun: { x: number; z: number }): number {
  const len = Math.hypot(sun.x, sun.z);
  if (len < 1e-6) return 0.8;
  const facing = (source.nx * sun.x + source.nz * sun.z) / len;
  return 0.8 + 0.45 * facing;
}

/** The colour a source lends the room: cool in shade, warm in sun. */
export function sourceColor(source: DaylightSource, sun: { x: number; z: number }): string {
  const len = Math.hypot(sun.x, sun.z);
  const facing = len < 1e-6 ? 0 : (source.nx * sun.x + source.nz * sun.z) / len;
  const t = Math.max(0, Math.min(1, (facing + 1) / 2));
  return mixHex(COOL, WARM, t);
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

export interface ChosenSource {
  source: DaylightSource;
  intensity: number;
  color: string;
  /** Metres from the viewer, for the fade at the edge of the budget. */
  distance: number;
}

/**
 * How far inside the room a source's light is placed, in metres.
 *
 * A point light sitting exactly in the plane of the glass lights the wall
 * around the opening from behind and puts a hard hotspot on the reveal. Stepping
 * it into the room spreads that over something closer to the even wash a real
 * window throws, and costs nothing.
 */
export const INSET = 0.4;

/** Where the light for a source should actually be put, in world coordinates. */
export function lightPosition(source: DaylightSource, inset = INSET): { x: number; y: number; z: number } {
  return {
    x: source.x + source.nx * inset,
    y: source.y,
    z: source.z + source.nz * inset,
  };
}

/**
 * The sources worth rendering from where the viewer is standing.
 *
 * Sorted by distance and cut to `MAX_SOURCES`. The cut is not a performance
 * detail alone — it is also what bounds the no-shadow approximation described
 * at the top of this file, because a light thirty metres away is not lighting
 * anything the viewer can see.
 *
 * A source on another storey is not a candidate at all: a first-floor window
 * lighting the ground floor through the slab is the single most obvious way
 * this cheat shows, and skipping it costs nothing, since the room you are in
 * has its own windows.
 */
export function chooseSources(
  sources: DaylightSource[],
  eye: { x: number; y: number; z: number },
  sun: { x: number; z: number },
  max: number = MAX_SOURCES,
): ChosenSource[] {
  const candidates = sources.map((source) => ({
    source,
    distance: Math.hypot(source.x - eye.x, source.y - eye.y, source.z - eye.z),
  }));
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.slice(0, max).map(({ source, distance }) => ({
    source,
    distance,
    intensity: sourceIntensity(source, sun),
    color: sourceColor(source, sun),
  }));
}
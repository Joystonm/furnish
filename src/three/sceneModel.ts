/**
 * Plan → 3D geometry.
 *
 * Nothing here is authored by hand: every box comes out of the canonical model,
 * which is what makes the 2D and 3D views the same building rather than two
 * drawings that happen to agree today.
 *
 * ── The mapping ──────────────────────────────────────────────────────────────
 *   plan (x, y)  →  world (x - plotWidth/2,  elevation,  y - plotDepth/2)
 *
 * Y already grows "south" in the plan, so it becomes +Z in the world with no
 * flip. Centring on the plot puts the building at the origin, which keeps the
 * orbit camera's default framing stable no matter how big the plot is.
 *
 * ── Openings ─────────────────────────────────────────────────────────────────
 * Doors and windows are cut by *splitting a wall into boxes*, not by CSG.
 * A wall with openings becomes a set of axis-aligned solids: a pier on each
 * side of each opening, a lintel above it, and (for windows) a sill below plus
 * a glass pane. That is exact, cheap, and cannot produce the broken geometry a
 * boolean subtract produces when two openings nearly touch.
 *
 * The splitting happens in the wall's own local frame: distances along the
 * centreline from point `a`. Walls in this model are axis-aligned, but the
 * frame is defined by the wall's actual direction rather than assumed, so a
 * non-axis-aligned wall splits into the right places instead of silently
 * producing one long box.
 */
import type { Floor, FurnitureItem, MaterialDef, Opening, OutdoorSpace, Project, Room, RoomKind, Staircase, Wall } from '../model/types.ts';
import type { Footprint } from './collision.ts';
import { furnitureParts, yawOffset } from './furniture.ts';

export interface Box {
  /** Centre, in world metres. */
  x: number;
  y: number;
  z: number;
  /** Full extents, in world metres. */
  w: number;
  h: number;
  d: number;
  /** Rotation about the vertical axis, degrees clockwise. */
  ry: number;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  /**
   * What this is, so a click can map a mesh back to a model id.
   *
   * `trim`, `frame`, `door` and `ceiling` are the purely-presentational kinds. They are kept
   * separate from `wall` and `glass` for a reason that is not cosmetic: the
   * test suite asserts *how many* wall and glass boxes a given model produces,
   * and a plinth that counted as wall would make those counts mean something
   * different from what they were written to mean. `colliders` is filtered on
   * these kinds too — a frame that stopped the camera would be worse than no
   * frame at all.
   */
  kind:
    | 'wall'
    | 'slab'
    | 'room-slab'
    | 'stair'
    | 'furniture'
    | 'deck'
    | 'railing'
    | 'roof'
    | 'glass'
    | 'door'
    | 'ceiling'
    | 'trim'
    | 'frame'
    | 'lawn'
    | 'paving'
    | 'path';
  /** Id of the owning model element, when there is exactly one. */
  ownerId?: string;
  floorId: string;
  /**
   * Primitive to build this box from.
   *
   * `box` is right for anything architectural: a wall has arrises, and a
   * bevelled one does not. Furniture is the other way round — a cushion or a
   * cabinet front with a hard 90° edge reads as a block of modelling clay, so
   * its parts come from `furniture.ts` and arrive already bevelled.
   */
  shape?: 'box' | 'cylinder' | 'sphere';
  /** Bevel radius in metres. 0 or absent means hard edges. */
  round?: number;
  /** Extra pitch/roll in degrees, for anything not standing on its base. */
  rx?: number;
  rz?: number;
  /** Texture family — see `textures.ts`. Undefined means flat colour. */
  surface?: string;
  /**
   * The swinging door this box is part of.
   *
   * Every part of one leaf — panel, panel, handle — carries the same id, so the
   * renderer can gather them into a single group that pivots about the hinge.
   * Absent on everything that does not swing.
   */
  swingId?: string;
  /**
   * Position relative to the door's hinge, in the hinge's own frame.
   *
   * Set only on boxes with a `swingId`, and for rendering it *replaces*
   * `x`/`z`/`ry`: the leaf is a child of a group that is already positioned and
   * rotated, so a part drawn from its world coordinates would sit twice as far
   * from the pivot as it should.
   */
  dx?: number;
  dz?: number;
  /** Height above the hinge's midpoint — the group origin. */
  dy?: number;
  /** Render as glass: a physical material, not a tinted standard one. */
  glass?: boolean;
  /**
   * Rectangles of this surface the camera must not be given as floor.
   *
   * A slab that lies under a flight is one of them. `floorUnder` resolves ties
   * by taking the *highest* surface at or below the feet, so a flat slab under
   * a staircase does not lose to the staircase's ramp — it beats it, and the
   * camera walks the length of the flight at a constant height, passing through
   * the middle of it. The hole is in the *floor*, not in the picture: the slab
   * is still drawn whole.
   */
  walkHoles?: Footprint[];
  /**
   * Excluded from walk-mode collision.
   *
   * Furniture is modelled as many small parts so it reads as furniture, and
   * most of those parts — cushions, handles, a plant's canopy — sit on or
   * inside something that is solid. Treating each of them as an obstacle would
   * mean the camera is stopped by a pillow before it reaches the sofa.
   */
  noCollide?: boolean;
  /**
   * Kept out of the shadow map as a *receiver*.
   *
   * Set only on a surface with nothing above it: the roof deck. Nothing can cast
   * onto a roof, so the only shadow it can ever take is its own — and a big flat
   * plane shadowing itself at a shallow sun angle wears the classic acne moiré,
   * which on the deck read as a dashed ladder of light marks ruled down the
   * middle of the roof when seen from outside. It still *casts*, which is what
   * puts the hard shadow line along the elevation under the eaves.
   */
  noReceiveShadow?: boolean;
}

export interface Collider {
  x: number;
  z: number;
  w: number;
  d: number;
  /**
   * The world height of the bottom and top of this collider.
   *
   * The collision test is circle-vs-rect on the XZ plane, but a box on the XZ
   * plane is only meaningful if you also know how far up it reaches. Without
   * these, the lintel over a front door — a wall box sitting at 2.1 m to 2.7 m,
   * well above anybody's head — became an obstacle exactly as wide as the
   * doorway and sealed it, so walking up the path led you to a blank wall where
   * the door should be. The same applied to the wall above every window head.
   *
   * Optional so that a hand-built collider in a test keeps working; an absent
   * height is treated as infinitely tall, which blocks rather than lets you
   * through something of unknown extent.
   */
  y0?: number;
  y1?: number;
  /**
   * The floor this collider belongs to.
   *
   * Collision is tested on the XZ plane only, so without it the first floor's
   * walls sit exactly on top of the ground floor's and a camera upstairs is
   * blocked by the furniture of the room *below* — which is what happened when
   * the second camera mode let the viewer walk between storeys.
   */
  floorId?: string;
}

export interface SceneGeometry {
  boxes: Box[];
  /** Opaque vertical obstacles for first-person collision. */
  colliders: Collider[];
  bounds: { width: number; depth: number; height: number };
  /**
   * The building itself, as opposed to the plot it stands on.
   *
   * Framing the camera on `bounds` — which is the *plot* — is why a house on a
   * generous plot sat small and off-centre in an empty field with the plot
   * boundary as the only other thing on screen. This is the extent that has
   * walls in it, and it is what the orbit camera should be looking at.
   */
  building: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    /** Centre of the footprint, at half height. A sensible orbit target. */
    cx: number;
    cz: number;
    cy: number;
    width: number;
    depth: number;
    height: number;
  };
  /**
   * The front door, derived rather than authored: the ground-floor door in the
   * exterior wall whose outward face points at the plot's street edge. The path
   * is drawn to it, so if the entrance moves the path moves with it.
   */
  entrance: { x: number; z: number; width: number } | null;
  /** Door leaves that swing, grouped by `Box.swingId`. */
  doors: SwingDoor[];
}

/**
 * One door leaf, as a pivot plus the parts that rotate with it.
 *
 * The leaf is described in the hinge's own frame: `parts` are offsets from the
 * hinge, not world positions, so the renderer can spin the whole group with one
 * `rotation.y` and the panels and handle follow the leaf rather than floating
 * off it. That is why the door is described here at all — as a flat box in
 * `boxes` it has no hinge to turn about, and the parts would each have to be
 * rotated and re-offset independently.
 */
export interface SwingDoor {
  id: string;
  floorId: string;
  /** World position of the hinge post: the axis the leaf turns about. */
  hinge: { x: number; y: number; z: number };
  /** The leaf's own yaw in degrees — the wall's, when closed. */
  ry: number;
  /**
   * Which way the leaf swings, as the sign to add to `ry` at full open.
   *
   * `Opening.swing` already says this ('negative'/'positive'), and honouring it
   * matters for more than looks: a door that swings into a corridor across the
   * path would hit the walker coming the other way.
   */
  swingSign: 1 | -1;
  /** How far the leaf stands off the hinge, and how tall it is. */
  width: number;
  height: number;
  /** Parts of the leaf, positioned relative to the hinge. */
  parts: Box[];
}

/**
 * The palette.
 *
 * Every value here is chosen to *separate* from its neighbours. The previous
 * set put the exterior wall, the roof, the parapet, the paving and the site all
 * within a few percent of the same cream, which is why the building read as one
 * undifferentiated slab: the eye finds edges through value contrast, and there
 * was none to find. The rule now is that anything meeting anything else at a
 * corner differs by enough luminance to draw its own line.
 *
 * ── Toward the cool neutral scheme ───────────────────────────────────────────
 * Roughly 20% of the saturation has come out of every value and each has been
 * pulled a hair onto the cool side, which turns the terracotta cast into a
 * greige. Two rules govern that, and the second is the one worth stating:
 *
 * 1. **The luminance is preserved exactly.** Nothing here was re-toned, only
 *    de-chromaed, and the corner gaps the paragraph above promises were checked
 *    afterwards and survive. Where a gap did narrow, the value that caused it
 *    was nudged back rather than the gap being waved through.
 * 2. **The materials are not recoloured, only desaturated.** Brick, oak,
 *    plaster, limestone, wool, porcelain, cedar and walnut are physical
 *    finishes with their own hues; a render that puts a teal tint on them reads
 *    as fake. What changed is how much chroma they carry, not what they are.
 */
const WALL_COLORS: Record<Wall['type'], string> = {
  exterior: '#ddd9cd',
  interior: '#ebe8e0',
  parapet: '#bdb6a5',
  boundary: '#a49e90',
  railing: '#6b675b',
};

/** Dark joinery. Windows are read by their frames far more than by their glass. */
const FRAME_COLOR = '#48443e';
const DOOR_FRAME_COLOR = '#544f45';
/** A door with no material of its own — the catalogue's standard joinery timber. */
const DOOR_LEAF_COLOR = '#76614d';
const DOOR_HANDLE_COLOR = '#8c8a85';
/** Plasterboard soffit thickness. Thin enough to read as a ceiling, thick enough to have an underside. */
const CEILING_THICKNESS = 0.08;
/** How far the ceiling hangs below the underside of the roof deck. See `roomSlab`. */
const CEILING_DROP = 0.01;
/**
 * The base band, and the one value here that moved in *value* rather than only
 * in chroma. Desaturating it left the plinth sitting closer to the lawn than
 * the two had ever been, and those two meet at the bottom of every elevation.
 * Taking a little light out of it puts the gap back wider than it started.
 */
const PLINTH_COLOR = '#867f74';
const ROOF_COLOR = '#6b6c69';
const FASCIA_COLOR = '#797267';
/**
 * The lawn, and the anchor every other piece of ground is derived from.
 *
 * Desaturated, but kept at its own yellow-green hue rather than pushed toward
 * the new scheme's teal: grass in shade and grass in sun are the same colour,
 * and the moment the two drift apart the building's cast shadow lands on two
 * surfaces of visibly different hue, which reads as a grey slab laid over the
 * site. The far ground plane in `Scene` and the hemisphere light's ground
 * colour are both taken from this hue, deliberately within a few percent of
 * each other.
 */
const LAWN_COLOR = '#829364';
const PAVING_COLOR = '#b2aca0';
const PATH_COLOR = '#bcb7aa';

/**
 * Floor colour by room kind.
 *
 * These were all within a few percent luminance of each other, which is why
 * every ground-floor slab looked like the same beige rectangle: with a single
 * flat colour and no texture to read, the eye has nothing but value to go on.
 * They are now separated the way real floor finishes are — warm oak against
 * cool limestone, pale bathroom tile against dark utility concrete — so a room
 * is identifiable from its floor alone before any furniture is in it.
 */
const KIND_FLOORS: Record<string, string> = {
  living: '#bcb3a2',
  dining: '#ad8961',
  kitchen: '#babfbf',
  bedroom: '#b08f69',
  bathroom: '#d2d6d4',
  guest: '#b08f69',
  office: '#b08f69',
  prayer: '#c5c1b7',
  storage: '#a7a49d',
  utility: '#a7a49d',
  pantry: '#a7a49d',
  corridor: '#bcb3a2',
  hall: '#bcb3a2',
  lobby: '#bcb3a2',
  garage: '#9c9a94',
  balcony: '#a49b8c',
  terrace: '#a49b8c',
};

const DEFAULT_FLOOR_COLOR = '#b3afa7';

/**
 * Material finish → procedural texture family.
 *
 * `MaterialDef.kind` says what a surface *is*; the painters in `textures.ts`
 * are named after how it is drawn. Most of the names happen to line up, which
 * is why this is a short table rather than a search.
 */
const SURFACE_FOR_KIND: Record<string, string | undefined> = {
  plaster: 'plaster',
  stone: 'stone',
  concrete: 'concrete',
  wood: 'oak',
  tile: 'tile',
  metal: 'metal',
  paint: 'plaster',
  // Glass is drawn by its own path with transparency and its own surface, and
  // must never pick up an opaque grain.
  glass: undefined,
};

/** What a surface should actually be rendered as. */
interface Finish {
  color: string;
  roughness: number;
  metalness: number;
  surface?: string;
}

/**
 * The finish for a wall: the material the project actually assigns it, falling
 * back to the built-in colour for its type.
 *
 * This is the join between the material model and the renderer, and until it
 * existed it was missing entirely — `sceneModel` read `wall.type` and nothing
 * else, so applying a material to every exterior wall rewrote the model
 * correctly, showed up in the undo history and the activity log, and changed
 * not one pixel on screen. The palette the assistant picks has to land here
 * or "render it" is not something the app can honestly claim to do.
 */
function wallFinish(materials: Record<string, MaterialDef>, wall: Wall): Finish {
  const mat = wall.material ? materials[wall.material] : undefined;
  if (!mat) {
    return { color: WALL_COLORS[wall.type], roughness: 0.84, metalness: 0, surface: WALL_SURFACE[wall.type] };
  }
  return {
    color: mat.color,
    roughness: mat.roughness,
    metalness: mat.metalness,
    surface: SURFACE_FOR_KIND[mat.kind],
  };
}

/** The same, for a room's floor finish. */
function floorFinish(materials: Record<string, MaterialDef>, room: Room): Finish {
  const mat = room.floorMaterial ? materials[room.floorMaterial] : undefined;
  if (!mat) {
    return {
      color: KIND_FLOORS[room.kind] ?? DEFAULT_FLOOR_COLOR,
      roughness: 0.86,
      metalness: 0,
      surface: FLOOR_SURFACE[room.kind],
    };
  }
  return {
    color: mat.color,
    roughness: mat.roughness,
    metalness: mat.metalness,
    surface: SURFACE_FOR_KIND[mat.kind] ?? 'flat',
  };
}
const GLASS_COLOR = '#abd0da';
const TREAD_COLOR = '#b4ad9c';

// ─────────────────────────────────────────────────────────── surfaces ────────
/**
 * Which procedural texture each surface wears.
 *
 * The colours above say what a surface *is*; these say how it behaves. A tiled
 * bathroom floor, a boarded bedroom floor and a lawn are three different
 * materials that happen to share a value range, and without distinct texture
 * they render as one flat field that the eye reads as untextured. See
 * `textures.ts` for how each of these is generated.
 */
const WALL_SURFACE: Record<Wall['type'], string> = {
  exterior: 'render',
  interior: 'plaster',
  parapet: 'render',
  boundary: 'concrete',
  railing: 'metal',
};

/**
 * Floors by room kind. A wet room is tiled, a bedroom is boarded, a hall is
 * stone — which is both how houses are actually built and what stops every
 * ground-floor slab in the model looking like the same beige rectangle.
 */
const FLOOR_SURFACE: Record<RoomKind, string> = {
  living: 'stone',
  dining: 'oak',
  kitchen: 'tile',
  bedroom: 'oak',
  bathroom: 'tile',
  guest: 'oak',
  office: 'oak',
  prayer: 'tile',
  storage: 'concrete',
  utility: 'tile',
  pantry: 'tile',
  corridor: 'stone',
  hall: 'stone',
  lobby: 'stone',
  garage: 'concrete',
  balcony: 'paving',
  terrace: 'paving',
};

/** Height of the band that runs round the base of the elevation. */
export const PLINTH_HEIGHT = 0.45;
/** How far the plinth stands proud of the wall face, per side. */
const PLINTH_PROUD = 0.04;
/**
 * How far each solid piece of a wall runs past the joint on either side of it.
 *
 * Two boxes that stop exactly at a shared edge tile the screen perfectly in
 * exact arithmetic — the model puts them at the same coordinate and the
 * geometry puts the vertex at the same float — but they are still two separate
 * triangles from two separate draw calls, and a rasteriser that computes the
 * shared edge from different vertices can leave a sliver of a pixel covered by
 * neither. Multisampling does not paper over that: the uncovered samples are
 * filled from whatever is behind, so the sliver resolves as a hair of dark
 * interior. Every elevation came out dressed in dashed vertical hairlines at
 * every opening jamb and every piece joint, and turning antialiasing off made
 * them vanish completely — which is what identified it as coverage rather than
 * as a gap or a z-fight.
 *
 * Running each piece a couple of millimetres *under* its neighbours removes the
 * shared edge altogether. The overlap is far below a pixel at any sane viewing
 * distance, and the two faces it covers are coplanar with the same normal and
 * the same material, so there is nothing for the depth test to disagree about.
 */
export const JOINT_OVERLAP = 0.006;
/** How far the roof oversails the wall face. The shadow it casts is the line. */
export const EAVES_OVERHANG = 0.5;
const ROOF_THICKNESS = 0.24;
const FASCIA_HEIGHT = 0.2;

interface Frame {
  plotW: number;
  plotD: number;
  tx(x: number): number;
  tz(y: number): number;
}

export const frameFor = (plotW: number, plotD: number): Frame => ({
  plotW,
  plotD,
  tx: (x) => x - plotW / 2,
  tz: (y) => y - plotD / 2,
});

/** Whether two world rectangles overlap at all. */
function overlaps(a: Footprint, b: Footprint): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
}

/**
 * The floor a flight stands on, in world elevation.
 *
 * `null` when the flight's own storey is not in the project. A flight ascends
 * away from its `floorId` (`direction` +1) or descends out of it (−1), so the
 * floor *underneath* the flight is its own storey in the first case and the one
 * it connects to in the second. The arithmetic has to match `flightSurfaces`
 * in `collision.ts` exactly — the ramp's height and the hole in the slab under
 * it are two halves of the same fact.
 */
function flightUnder(stair: Staircase, floors: Floor[]): number | null {
  const host = floors.find((x) => x.id === stair.floorId);
  if (!host) return null;
  const rise = stair.rise ?? host.height;
  return stair.direction === 1 ? host.elevation : host.elevation - rise;
}

// ────────────────────────────────────────────────────────── wall junctions ───

/** How close two endpoints have to be to count as the same junction, in metres. */
const JOINT_EPS = 1e-3;

/** A corner where two walls meet at an angle, and the block that closes it. */
interface Corner {
  x: number;
  y: number;
  /** Half-extent of the closing block — a full wall thickness across. */
  half: number;
  height: number;
  color: string;
  roughness: number;
  metalness: number;
  surface: string;
  /** True when the plinth band should be continued round the corner too. */
  plinth: boolean;
  plinthHalf: number;
  floorId: string;
  baseY: number;
}

const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.abs(a.x - b.x) <= JOINT_EPS && Math.abs(a.y - b.y) <= JOINT_EPS;

/**
 * Resolve, once per storey, what each wall end runs into.
 *
 * Two walls meeting at 90° used to leave a thickness/2 × thickness/2 notch in
 * the outside corner: each wall box stopped on its own centreline, and nothing
 * filled the gap between them, so from outside you looked straight through the
 * slot into the interior. Every corner had a lit white seam running up it.
 *
 * The obvious repair — run each wall half a thickness *past* its endpoint —
 * trades that notch for something just as visible. Two boxes overlapping with
 * their outer faces exactly coplanar render with a one-pixel z-fight along the
 * overlap, so the corner became a bright stripe instead of a hole.
 *
 * The repair that actually holds is to give the corner its own solid: both
 * walls stop half a thickness short, and a block exactly one thickness square
 * fills the space between them. Its faces meet the walls' end faces edge to
 * edge, never face to face, and the end faces it meets point *into* the block —
 * so they are back-facing, culled, and cannot z-fight with anything.
 *
 * Walls that meet end-on along a straight line get no block and no trim: they
 * butt, their faces are back-to-back at the same plane, and neither is ever
 * drawn.
 */
function resolveCorners(
  walls: Wall[],
  floor: Floor,
  materials: Record<string, MaterialDef>,
  out: Corner[],
): Map<string, number> {
  /** `${wallId}:a|b` → how far that end pulls back, in metres. */
  const trim = new Map<string, number>();
  /** Junction point → half-extent of the block that fills it. */
  const halfAt = new Map<string, number>();

  for (const w of walls) {
    if (w.type === 'railing' || w.type === 'boundary') {
      trim.set(`${w.id}:a`, 0);
      trim.set(`${w.id}:b`, 0);
      continue;
    }
    const own = { x: w.b.x - w.a.x, y: w.b.y - w.a.y };
    const ownLen = Math.hypot(own.x, own.y) || 1;

    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      // Every wall arriving at this junction, not just the first one found.
      const joined = walls.filter((o) => {
        if (o.id === w.id) return false;
        if (o.type === 'railing' || o.type === 'boundary') return false;
        if (!samePoint(o.a, p) && !samePoint(o.b, p)) return false;
        const other = { x: o.b.x - o.a.x, y: o.b.y - o.a.y };
        const otherLen = Math.hypot(other.x, other.y) || 1;
        // Collinear: a straight run of wall. Nothing to bridge.
        const cross = Math.abs((own.x * other.y - own.y * other.x) / (ownLen * otherLen));
        return cross >= 1e-6;
      });
      if (!joined.length) {
        trim.set(`${w.id}:${end}`, 0);
        continue;
      }

      const key = `${floor.id}:${p.x.toFixed(3)}:${p.y.toFixed(3)}`;
      let half = halfAt.get(key);
      if (half === undefined) {
        // The thickest wall at the junction sets the block, so that a thin
        // partition arriving at an exterior corner still stops on the block's
        // face rather than poking a few millimetres out past it.
        const thickest = joined.reduce((a, o) =>
          Math.max(0.05, o.type === 'exterior' ? o.thickness : Math.max(w.thickness, o.thickness)) >
          Math.max(0.05, a.type === 'exterior' ? a.thickness : Math.max(w.thickness, a.thickness))
            ? o
            : a,
        );
        const exterior = w.type === 'exterior' || thickest.type === 'exterior';
        const thickness = exterior
          ? Math.max(0.05, w.type === 'exterior' ? w.thickness : thickest.thickness)
          : Math.max(0.05, Math.max(w.thickness, thickest.thickness));
        half = thickness / 2;
        halfAt.set(key, half);
        // The corner block takes the finish of the exterior wall it closes, so
        // it does not stand out as a pale stripe at every junction in a brick
        // or cedar facade. It used to be hardcoded to the render colour and the
        // mismatch was invisible until a palette could change the walls.
        const faceWall =
          w.type === 'exterior'
            ? w
            : thickest.type === 'exterior'
              ? thickest
              : joined.find((o) => o.type === 'exterior') ?? w;
        const cornerFinish = exterior ? wallFinish(materials, faceWall) : wallFinish(materials, w);

        out.push({
          x: p.x,
          y: p.y,
          half,
          // The shortest wall here decides: a corner block taller than its walls
          // would stand above the eaves.
          height: Math.min(
            Math.max(0.1, w.height || floor.height),
            ...joined.map((o) => Math.max(0.1, o.height || floor.height)),
          ),
          color: cornerFinish.color,
          roughness: cornerFinish.roughness,
          metalness: cornerFinish.metalness,
          surface: cornerFinish.surface ?? 'flat',
          plinth: floor.order === 0 && (w.type === 'exterior' || joined.some((o) => o.type === 'exterior')),
          plinthHalf: half + PLINTH_PROUD,
          floorId: floor.id,
          baseY: floor.elevation,
        });
      }
      trim.set(`${w.id}:${end}`, half);
    }
  }
  return trim;
}

/**
 * Split one wall into solid boxes around its openings.
 *
 * `s0`/`s1` are distances along the centreline from point `a`; `y0`/`y1` are
 * heights above the storey datum. Both axes are transformed with the wall's
 * own direction vector, so the split is correct for any wall orientation.
 */
function wallBoxes(
  wall: Wall,
  f: Frame,
  floor: Floor,
  trims: Map<string, number>,
  materials: Record<string, MaterialDef>,
  out: Box[],
  swingDoors: SwingDoor[],
): void {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;

  const ux = dx / len;
  const uy = dy / len;
  const thickness = Math.max(0.05, wall.thickness);
  const height = Math.max(0.1, wall.height || floor.height);
  const baseY = floor.elevation;
  const ry = (Math.atan2(dy, dx) * 180) / Math.PI;

  // Resolved once per wall, not per box: every panel of this wall wears the
  // same finish, and the joinery and glass below it deliberately do not.
  const finish = wallFinish(materials, wall);

  /**
   * A box spanning [s0,s1] along the wall and [y0,y1] in height.
   *
   * `depth` overrides the wall thickness — joinery is proud of both wall faces
   * by a couple of centimetres, which is the only reason a frame is visible at
   * all on a wall that is itself only 20 cm thick.
   */
  const push = (
    s0: number,
    s1: number,
    y0: number,
    y1: number,
    kind: Box['kind'],
    color: string,
    opts: { opacity?: number; depth?: number; roughness?: number; metalness?: number; surface?: string; glass?: boolean } = {},
  ) => {
    const ds = s1 - s0;
    const dyh = y1 - y0;
    if (ds < 1e-4 || dyh < 1e-4) return undefined;
    const sm = (s0 + s1) / 2;
    const cx = wall.a.x + ux * sm;
    const cy = wall.a.y + uy * sm;
    out.push({
      x: f.tx(cx),
      y: baseY + (y0 + y1) / 2,
      z: f.tz(cy),
      w: ds,
      h: dyh,
      d: opts.depth ?? thickness,
      ry,
      color,
      // Falls back to the wall's own finish rather than to a flat 0.84, so a
      // material that says "polished concrete" or "oak" is honoured. 0.84 rather
      // than the 0.92 this used to default to: at 0.92 a wall is so close to a
      // perfect lambertian that image-based lighting collapses to a single flat
      // term per pixel and the surface reads as painted cardboard no matter how
      // good the normal map is.
      roughness: opts.roughness ?? finish.roughness,
      metalness: opts.metalness ?? finish.metalness,
      opacity: opts.opacity ?? 1,
      kind,
      ownerId: wall.id,
      floorId: wall.floorId,
      surface: opts.surface ?? finish.surface,
      glass: opts.glass,
    });
    return out[out.length - 1];
  };

  if (wall.type === 'railing' || wall.type === 'boundary') {
    push(0, len, 0, height, 'railing', WALL_COLORS[wall.type], { metalness: 0.35, roughness: 0.55 });
    return;
  }

  const color = finish.color;
  const openings = [...wall.openings].sort((a, b) => a.offset - b.offset);
  // A plinth is a base band, so it belongs to the storey that sits on the
  // ground and to nothing above it. It also runs a little proud of the wall,
  // which is what puts a shadow line along the bottom of the elevation.
  const plinth = floor.order === 0 && wall.type === 'exterior';
  const plinthH = Math.min(PLINTH_HEIGHT, height * 0.4);
  const plinthDepth = thickness + PLINTH_PROUD * 2;

  // Each end of the wall stops short of a corner by half a thickness, and the
  // gap is filled by a block owned by neither wall. See `resolveCorners` for
  // why oversailing instead — the obvious fix — trades a hole for a z-fight.
  const backA = trims.get(`${wall.id}:a`) ?? 0;
  const backB = trims.get(`${wall.id}:b`) ?? 0;
  const s0 = (v: number) => (v <= 1e-6 ? backA : v);
  const s1 = (v: number) => (v >= len - 1e-6 ? len - backB : v);

  // The plinth pulls back further than the wall does, by exactly its own
  // proudness, because the corner block's plinth is proud on the same amount.
  // Stopping both at the wall's line instead leaves the two plinths overlapping
  // by four centimetres with their outer faces coplanar — the same z-fight the
  // wall above was carefully arranged to avoid, four centimetres lower down.
  const p0 = (v: number) => (v <= 1e-6 ? backA + PLINTH_PROUD : v);
  const p1 = (v: number) => (v >= len - 1e-6 ? len - backB - PLINTH_PROUD : v);

  /**
   * One solid piece of the elevation, run past its joints on both sides.
   *
   * Clamped to the wall's own extent, so a wall that simply stops in the open
   * still stops — but a piece that meets a corner block reaches two millimetres
   * inside it, which is what takes the hairline off that joint too.
   */
  const piece = (from: number, to: number, y0: number, y1: number) =>
    push(Math.max(0, from - JOINT_OVERLAP), Math.min(len, to + JOINT_OVERLAP), y0, y1, 'wall', color);

  const pushPlinth = (from: number, to: number, upTo: number) => {
    if (!plinth) return;
    const top = Math.min(upTo, plinthH);
    if (top > 0.02) {
      push(Math.max(0, from - JOINT_OVERLAP), Math.min(len, to + JOINT_OVERLAP), 0, top, 'trim', PLINTH_COLOR, {
        depth: plinthDepth,
        roughness: 0.88,
        surface: 'stone',
      });
    }
  };

  /**
   * A door leaf, its two recessed panels, and a handle.
   *
   * Without this a door is a frame round a hole, and a hole is the most
   * model-like thing a house can have on its elevation — the eye knows
   * instantly there is nothing behind it. The leaf is thinner than the wall and
   * centred on it, so it sits recessed a little on both faces and picks up a
   * shadow line all the way round.
   */
  const doorLeaf = (o: Opening, start: number, end: number, y0: number, y1: number, fw: number) => {
    const leafStart = start + fw;
    const leafEnd = end - fw;
    const leafTop = y1 - fw;
    const leafBase = y0 + 0.015;
    if (leafEnd - leafStart < 0.2 || leafTop - leafBase < 0.6) return;

    // The opening's own material wins if it has one; otherwise the catalogue's
    // standard door. Panels keep the leaf's colour — they are the same timber,
    // set back a couple of centimetres.
    const mat = o.material ? materials[o.material] : undefined;
    const leafColor = mat?.color ?? DOOR_LEAF_COLOR;
    const leafDepth = thickness * 0.52;
    const leafSurface = mat ? (SURFACE_FOR_KIND[mat.kind] ?? 'oak') : 'oak';

    const swingId = `${wall.id}:${o.id}`;
    // Everything below is one rigid leaf, so each `push` is recorded and the
    // whole set is registered as a single swinging door.
    const parts: Box[] = [];
    const part = (b: Box | undefined) => {
      if (!b) return;
      b.swingId = swingId;
      parts.push(b);
    };

    part(push(leafStart, leafEnd, leafBase, leafTop, 'door', leafColor, {
      depth: leafDepth,
      roughness: mat?.roughness ?? 0.6,
      metalness: mat?.metalness ?? 0,
      surface: leafSurface,
    }));

    // Two recessed panels. Without them a door is a slab the same colour as the
    // frame beside it, and joins into one flat shape at any real viewing distance.
    const inset = 0.085;
    const pa = leafStart + inset;
    const pb = leafEnd - inset;
    const bottom = y0 + 0.16;
    const rail = y0 + (leafTop - y0) * 0.38;
    part(push(pa, pb, bottom, rail - 0.05, 'door', leafColor, {
      depth: leafDepth - 0.022,
      roughness: mat?.roughness ?? 0.6,
      surface: leafSurface,
    }));
    part(push(pa, pb, rail + 0.05, leafTop - inset, 'door', leafColor, {
      depth: leafDepth - 0.022,
      roughness: mat?.roughness ?? 0.6,
      surface: leafSurface,
    }));

    // Lever handle on the latch side — the `hinge` field says which end that is,
    // and doors without one are drawn latched toward the far end.
    const latchEnd = o.hinge === 'start' ? leafEnd : leafStart;
    const hx = latchEnd === leafEnd ? leafEnd - 0.16 : leafStart + 0.11;
    part(push(hx, hx + 0.05, 1.02, 1.14, 'door', DOOR_HANDLE_COLOR, {
      depth: leafDepth + 0.06,
      roughness: 0.3,
      metalness: 0.85,
      surface: 'metal',
    }));

    // Re-express every part relative to the hinge, and undo the wall's own yaw
    // so the leaf is stored square in its hinge's frame.
    //
    // Without the second step the group would be spun twice — once by the
    // group's `ry`, once by each part's own — and every door would open at an
    // angle unrelated to the wall it sits in. Storing the parts square and
    // putting the wall's yaw on the group means one rotation drives the lot.
    const hingeS = o.hinge === 'start' ? leafStart : leafEnd;
    const hingeW = {
      x: f.tx(wall.a.x + ux * hingeS),
      z: f.tz(wall.a.y + uy * hingeS),
    };
    const cos = Math.cos((-ry * Math.PI) / 180);
    const sin = Math.sin((-ry * Math.PI) / 180);
    const hingeY = baseY + (leafBase + leafTop) / 2;
    for (const p of parts) {
      const ox = p.x - hingeW.x;
      const oz = p.z - hingeW.z;
      p.dx = ox * cos + oz * sin;
      p.dz = -ox * sin + oz * cos;
      p.dy = p.y - hingeY;
      p.ry = 0;
    }

    swingDoors.push({
      id: swingId,
      floorId: wall.floorId,
      // Half the leaf's height up from its foot, so the group origin is the
      // middle of the hinge line rather than the floor it stands on.
      hinge: { x: hingeW.x, y: hingeY, z: hingeW.z },
      ry,
      // `Opening.swing` already says which way it opens, and following it
      // matters for more than looks: a door swinging the wrong way sweeps the
      // path of whoever is walking the other way.
      swingSign: o.swing === 'negative' ? 1 : -1,
      width: leafEnd - leafStart,
      height: leafTop - leafBase,
      parts,
    });
  };

  if (!openings.length) {
    piece(s0(0), s1(len), 0, height);
    pushPlinth(p0(0), p1(len), height);
    return;
  }

  // Every piece is the *full* wall thickness, so the elevation is one
  // continuous plane from end to end — and every piece runs a couple of
  // millimetres under its neighbours, so the plane has no seams in it either.
  // See `JOINT_OVERLAP`.
  //
  // Setting the sill and head pieces *back* by a few millimetres instead — which
  // this did once — put a 6 mm step down the full height of every pier, at every
  // opening jamb. At any real viewing distance that step is far thinner than a
  // pixel but its shaded inner face still lands on one, so every elevation came
  // out decorated with a row of dark hairlines running from the plinth to the
  // eaves. Overlapping keeps every face on the one plane.

  let cursor = 0;
  for (const o of openings) {
    const start = Math.max(0, o.offset - o.width / 2);
    const end = Math.min(len, o.offset + o.width / 2);
    // Pier from the last opening (or the wall start) up to this one.
    if (start > cursor) {
      piece(s0(cursor), s1(start), 0, height);
      pushPlinth(p0(cursor), p1(start), height);
    }

    const head = Math.min(height, o.sill + o.height);
    if (o.sill > 0.01) {
      piece(s0(start), s1(end), 0, o.sill);
      pushPlinth(p0(start), p1(end), o.sill);
    }
    if (head < height - 0.01) piece(s0(start), s1(end), head, height);

    // Joinery. A window with no frame is a hole; a window with a dark frame,
    // a mullion and a proud sill reads as a window from across the site.
    const joineryDepth = thickness + 0.06;
    const fw = 0.055;
    const y0 = o.kind === 'window' ? o.sill : 0;
    const y1 = Math.min(o.sill + o.height, height);
    // A leaf is only for a real door. `opening` and `doorway` are cased openings —
    // a living room opening into its kitchen is 1.5 m of nothing by design, and
    // hanging a leaf across it would put a swinging slab in the middle of the
    // living space. They still get a frame, so the opening reads as joinery.
    const isDoor = o.kind !== 'window';
    const hasLeaf = o.kind === 'door';

    // Jambs, set just inside the reveal so they do not narrow the clear opening
    // by their own width on top of the wall that already does.
    push(start, start + fw, y0, y1, 'frame', isDoor ? DOOR_FRAME_COLOR : FRAME_COLOR, { depth: joineryDepth, roughness: 0.55 });
    push(end - fw, end, y0, y1, 'frame', isDoor ? DOOR_FRAME_COLOR : FRAME_COLOR, { depth: joineryDepth, roughness: 0.55 });
    // Head, plus a sill for windows and a threshold for doors.
    push(start, end, y1 - fw, y1, 'frame', isDoor ? DOOR_FRAME_COLOR : FRAME_COLOR, { depth: joineryDepth, roughness: 0.55 });
    if (o.kind === 'window') {
      push(start, end, y0, y0 + fw, 'trim', PLINTH_COLOR, { depth: thickness + 0.14, roughness: 0.85 });
      // One central mullion on anything wide enough to need one, so a 2.4 m
      // opening does not read as a single sheet of glass.
      if (end - start > 1.15) {
        const m = (start + end) / 2;
        push(m - 0.03, m + 0.03, y0, y1, 'frame', FRAME_COLOR, { depth: joineryDepth, roughness: 0.55 });
      }
    }

    if (o.kind === 'window') push(start, end, o.sill, y1, 'glass', GLASS_COLOR, { opacity: 0.3, roughness: 0.05, metalness: 0.1, glass: true, surface: undefined });

    if (hasLeaf) doorLeaf(o, start, end, y0, y1, fw);

    cursor = Math.max(cursor, end);
  }
  if (cursor < len) {
    piece(s0(cursor), s1(len), 0, height);
    pushPlinth(p0(cursor), p1(len), height);
  }
}

function roomSlab(
  room: Room,
  f: Frame,
  floor: Floor,
  thickness: number,
  materials: Record<string, MaterialDef>,
  out: Box[],
  showCeiling: boolean,
  holes: Footprint[],
): void {
  // The floor finish the project assigns, not a colour keyed off the room's
  // kind — see `floorFinish`. `apply_material` with target `floor` has always
  // been able to rewrite every `floorMaterial`; until this lookup existed that
  // edit was invisible.
  const finish = floorFinish(materials, room);
  out.push({
    x: f.tx(room.x + room.width / 2),
    y: floor.elevation - thickness / 2,
    z: f.tz(room.y + room.depth / 2),
    w: room.width,
    h: thickness,
    d: room.depth,
    ry: 0,
    color: finish.color,
    roughness: finish.roughness,
    metalness: finish.metalness,
    opacity: 1,
    kind: 'room-slab',
    ownerId: room.id,
    floorId: room.floorId,
    surface: finish.surface,
    // Only the holes that actually fall in this room's rectangle. The stairwell
    // is the room that has one; the rooms beside it are told nothing.
    walkHoles: holes.filter((h) => overlaps(h, { x: f.tx(room.x + room.width / 2), z: f.tz(room.y + room.depth / 2), w: room.width, d: room.depth })),
  });

  if (!showCeiling) return;

  // The ceiling. Until this existed the only thing overhead was the underside of
  // the roof deck — a mottled grey slab reading as a lid, which is most of why
  // standing inside the house felt like standing inside a model of one. A real
  // room is closed at the top by white plaster, and that bounce is half of what
  // makes an interior feel lit rather than spotlit.
  //
  // It reuses `interior.plaster` so a palette that warms the internal walls
  // warms the ceilings with them. It overlaps the room rectangle by half a
  // typical wall so it meets the wall face with no hairline gap at the junction.
  const plaster = materials['interior.plaster'];
  const overhang = 0.15;
  // Dropped a centimetre clear of `floor.elevation + floor.height`, which is
  // exactly where the roof soffit starts. Flush, the two coplanar faces fight
  // for the depth buffer and the roof wears a stripe of ceiling texture across
  // it — visible from outside as a ladder of light seams down the whole roof.
  const drop = CEILING_DROP;
  out.push({
    x: f.tx(room.x + room.width / 2),
    y: floor.elevation + floor.height - drop - CEILING_THICKNESS / 2,
    z: f.tz(room.y + room.depth / 2),
    w: room.width + overhang,
    h: CEILING_THICKNESS,
    d: room.depth + overhang,
    ry: 0,
    color: plaster?.color ?? '#f1f2f1',
    roughness: plaster?.roughness ?? 0.95,
    metalness: 0,
    opacity: 1,
    kind: 'ceiling',
    ownerId: room.id,
    floorId: room.floorId,
    surface: 'plaster',
  });
}

/**
 * A flight as a run of solid steps with a balustrade either side.
 *
 * **Each step is a full-height solid, not a tread floating over a core.** The
 * first version drew 0.05 m treads spaced a riser apart over one big block, and
 * that had two faults that shared a cause. It looked wrong, because you could
 * see between every pair of treads and the flight read as a stack of loose
 * slats. And it walked wrong for the same reason, because the camera's floor
 * came from those tread boxes: it climbed a row of thin, see-through slabs with
 * the block's flat top 2.5 m above them.
 *
 * Making each step a solid that runs from the nosing below it up to its own
 * closes the flight. Consecutive steps overlap by the nosing oversail, so there
 * is no gap in plan either.
 *
 * None of these boxes is walked on. The camera's floor for a flight is a ramp
 * built from the staircase itself — see `flightSurfaces` in `collision.ts` — so
 * this function is free to draw what reads as a staircase rather than what
 * happens to line up with a collision query, which is the trap the first version
 * fell into. What is left here is the picture.
 *
 * The balustrade is a panel and a cap stepped one per tread, because the box
 * primitive carries yaw and no pitch: a single raked rail cannot be expressed,
 * and a flight with no handrail at all reads as unfinished. Railings are neither
 * colliders nor walkable surfaces, so drawing them disturbs nothing else.
 *
 * The step count is still the real one. It is what tells you the flight is
 * climbable at a believable slope, and it is what the validator checks.
 */
function stairBoxes(stair: Staircase, f: Frame, floor: Floor, out: Box[]): void {
  const rise = stair.rise ?? floor.height;
  const count = Math.max(2, Math.round(stair.riserCount));
  const riser = rise / count;
  const going = stair.run / count;
  // `direction` is +1 when the flight ascends away from this storey (it leaves
  // this floor and arrives at `connectsToFloorId`) and -1 when it descends out
  // of it. An ascending flight therefore starts *on* this floor, and only a
  // descending one starts below it.
  const baseY = stair.direction === 1 ? floor.elevation : floor.elevation - rise;
  const startPlanY = stair.y - stair.run / 2;
  /** How far each nosing oversails the step below it. */
  const nosing = 0.03;
  /** Handrail height above the nosing line. */
  const rail = 0.92;
  const post = 0.06;
  const cap = 0.11;
  const railColor = '#8b8479';

  for (let i = 0; i < count; i++) {
    const along = stair.direction === 1 ? (i + 0.5) * going : stair.run - (i + 0.5) * going;
    const top = baseY + (i + 1) * riser;
    const z = f.tz(startPlanY + along);
    const d = going + nosing;
    const cx = f.tx(stair.x);

    // The solid step, from the nosing below it up to this one.
    out.push({
      x: cx,
      y: top - riser / 2,
      z,
      w: stair.width,
      h: riser,
      d,
      ry: 0,
      color: TREAD_COLOR,
      roughness: 0.85,
      metalness: 0,
      opacity: 1,
      kind: 'stair',
      ownerId: stair.id,
      floorId: stair.floorId,
      surface: 'oak',
    });

    // Balustrade both sides: a panel standing on each nosing, and a cap on it.
    for (const side of [-1, 1]) {
      out.push({
        x: cx + side * (stair.width / 2 - post / 2),
        y: top + rail / 2,
        z,
        w: post,
        h: rail,
        d,
        ry: 0,
        color: railColor,
        roughness: 0.5,
        metalness: 0.4,
        opacity: 1,
        kind: 'railing',
        ownerId: stair.id,
        floorId: stair.floorId,
        surface: 'metal',
      });
      out.push({
        x: cx + side * (stair.width / 2 - cap / 2),
        y: top + rail + 0.025,
        z,
        w: cap,
        h: 0.05,
        d,
        ry: 0,
        color: railColor,
        roughness: 0.5,
        metalness: 0.4,
        opacity: 1,
        kind: 'railing',
        ownerId: stair.id,
        floorId: stair.floorId,
        surface: 'metal',
      });
    }
  }
}

/**
 * One catalogue item as an assembly of parts, placed in the world.
 *
 * The parts come from `furniture.ts` in the item's own frame — x across its
 * width, z across its depth, y up from its floor — and are rotated as a group
 * here. Rotating each part about the *item's* origin rather than about its own
 * is what puts a sofa's back against the wall when the plan says the sofa faces
 * the other way; the rotation is applied once, to the part's offset, and once
 * more to the part itself as its yaw.
 */
function furnitureBoxes(item: FurnitureItem, f: Frame, floor: Floor, out: Box[]): void {
  for (const p of furnitureParts(item)) {
    const off = yawOffset(p, item.rotation);
    const px = off.x;
    const pz = off.y;
    const solid = p.solid && p.h > 0.03;
    out.push({
      x: f.tx(item.x + px),
      y: floor.elevation + p.y,
      z: f.tz(item.y + pz),
      w: Math.max(0.01, p.w),
      h: Math.max(0.01, p.h),
      d: Math.max(0.01, p.d),
      ry: item.rotation + (p.ry ?? 0),
      color: p.color,
      roughness: p.roughness,
      metalness: p.metalness,
      opacity: p.opacity,
      kind: 'furniture',
      ownerId: item.id,
      floorId: item.floorId,
      shape: p.shape,
      round: p.round,
      rx: p.rx,
      rz: p.rz,
      surface: p.surface,
      glass: p.glass,
      // Non-solid parts are decoration sitting on or inside something solid.
      // They still render — a pillow is visible — they just do not stop the
      // camera, which would otherwise meet a footstool before the sofa.
      noCollide: solid ? undefined : true,
    });
  }
}

function outdoorBoxes(o: OutdoorSpace, f: Frame, floor: Floor, out: Box[]): void {
  const y = floor.elevation + o.elevationOffset;
  const x0 = o.x - o.width / 2;
  const z0 = o.y - o.depth / 2;
  out.push({
    x: f.tx(o.x),
    y: y - 0.06,
    z: f.tz(o.y),
    w: o.width,
    h: 0.12,
    d: o.depth,
    ry: 0,
    color: TREAD_COLOR,
    roughness: 0.9,
    metalness: 0,
    opacity: 1,
    kind: 'deck',
    ownerId: o.id,
    floorId: o.floorId,
    surface: 'oak',
  });

  const h = Math.max(0.3, o.railingHeight);
  const post = 0.06;
  const rails: Array<[number, number, number, number]> = [
    [0, 0, o.width, post],
    [0, o.depth - post, o.width, post],
    [0, 0, post, o.depth],
    [o.width - post, 0, post, o.depth],
  ];
  for (const [rx, rz, rw, rd] of rails) {
    out.push({
      x: f.tx(x0 + rx + rw / 2),
      y: y + h / 2,
      z: f.tz(z0 + rz + rd / 2),
      w: rw,
      h,
      d: rd,
      ry: 0,
      color: '#8b8479',
      roughness: 0.5,
      metalness: 0.4,
      opacity: 1,
      kind: 'railing',
      ownerId: o.id,
      floorId: o.floorId,
      surface: 'metal',
    });
  }
}

/**
 * Flat roof over the topmost storey, oversailing the wall line.
 *
 * This replaced a parapet that sat flush with the walls, which from any angle
 * above eye level read as an open tray: the roof plane, the parapet and the
 * walls were all the same cream and all the same height, so the building had no
 * top edge at all. Oversailing by half a metre puts the roof in its own shadow
 * and casts a hard line along the elevation, and the fascia below it gives that
 * line a third tone to fall against.
 */
function roofBoxes(rooms: Room[], walls: Wall[], f: Frame, floor: Floor, out: Box[]): void {
  if (!rooms.length && !walls.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // Exterior walls sit on the room boundary, so including them guarantees the
  // roof covers the wall footprint rather than stopping at the inner face.
  for (const r of rooms) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.depth);
  }
  for (const w of walls) {
    if (w.type !== 'exterior') continue;
    minX = Math.min(minX, w.a.x, w.b.x);
    minY = Math.min(minY, w.a.y, w.b.y);
    maxX = Math.max(maxX, w.a.x, w.b.x);
    maxY = Math.max(maxY, w.a.y, w.b.y);
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return;

  const w = maxX - minX + EAVES_OVERHANG * 2;
  const d = maxY - minY + EAVES_OVERHANG * 2;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // The deck sits on top of the wall head; the fascia hangs below it.
  const top = floor.elevation + floor.height + ROOF_THICKNESS;

  out.push({
    x: f.tx(cx),
    y: top - ROOF_THICKNESS / 2,
    z: f.tz(cy),
    w,
    h: ROOF_THICKNESS,
    d,
    ry: 0,
    color: ROOF_COLOR,
    roughness: 0.96,
    metalness: 0,
    opacity: 1,
    kind: 'roof',
    floorId: floor.id,
    surface: 'roof',
    noReceiveShadow: true,
  });

  const halfW = w / 2;
  const halfD = d / 2;
  const fascia: Array<[number, number, number, number]> = [
    [cx - halfW, cy - halfD, w, 0.07],
    [cx - halfW, cy + halfD - 0.07, w, 0.07],
    [cx - halfW, cy - halfD, 0.07, d],
    [cx + halfW - 0.07, cy - halfD, 0.07, d],
  ];
  for (const [fx, fz, fw, fd] of fascia) {
    out.push({
      x: f.tx(fx + fw / 2),
      y: top - ROOF_THICKNESS - FASCIA_HEIGHT / 2,
      z: f.tz(fz + fd / 2),
      w: fw,
      h: FASCIA_HEIGHT,
      d: fd,
      ry: 0,
      color: FASCIA_COLOR,
      roughness: 0.9,
      metalness: 0,
      opacity: 1,
      kind: 'roof',
      floorId: floor.id,
      surface: 'flat',
    });
  }
}

/**
 * The blocks that close a junction.
 *
 * Two per corner: one for the wall, one for the plinth. The plinth is proud of
 * the wall face by four centimetres, so a wall-sized block would leave the base
 * band open at exactly the same place the wall corner was open before — the
 * seam would simply move down to the bottom of the elevation and become a
 * stripe in the plinth instead.
 */
function cornerBoxes(corners: Corner[], f: Frame, out: Box[]): void {
  for (const c of corners) {
    const full = c.half * 2;
    if (c.plinth) {
      const plinthH = Math.min(PLINTH_HEIGHT, c.height * 0.4);
      if (plinthH > 0.02) {
        out.push({
          x: f.tx(c.x),
          y: c.baseY + plinthH / 2,
          z: f.tz(c.y),
          w: c.plinthHalf * 2,
          h: plinthH,
          d: c.plinthHalf * 2,
          ry: 0,
          color: PLINTH_COLOR,
          roughness: 0.88,
          metalness: 0,
          opacity: 1,
          kind: 'trim',
          floorId: c.floorId,
          surface: 'stone',
        });
      }
      const above = c.height - plinthH;
      if (above > 0.02) {
        out.push({
          x: f.tx(c.x),
          y: c.baseY + plinthH + above / 2,
          z: f.tz(c.y),
          w: full,
          h: above,
          d: full,
          ry: 0,
          color: c.color,
          roughness: c.roughness,
          metalness: c.metalness,
          opacity: 1,
          kind: 'trim',
          floorId: c.floorId,
          surface: c.surface,
        });
      }
      continue;
    }
    out.push({
      x: f.tx(c.x),
      y: c.baseY + c.height / 2,
      z: f.tz(c.y),
      w: full,
      h: c.height,
      d: full,
      ry: 0,
      color: c.color,
      roughness: c.roughness,
      metalness: c.metalness,
      opacity: 1,
      kind: 'trim',
      floorId: c.floorId,
      surface: c.surface,
    });
  }
}

export interface BuildOptions {
  /** Which floors to include. Undefined means every floor. */
  visibleFloorIds?: string[];
  showRoof?: boolean;
  showFurniture?: boolean;
  showGround?: boolean;
  /**
   * Whether to hang a ceiling under each room. Defaults to `showRoof`, because
   * a ceiling and the roof above it come off together: take the lid off to see
   * into the plan from outside and you want to see the furniture, not the top
   * of a plasterboard soffit.
   */
  showCeiling?: boolean;
}

/**
 * The world footprint of a box that is turned on the floor.
 *
 * A box's `w` and `d` are its own extents along its local axes, and `ry` is
 * its heading in degrees. A wall that runs north–south is built as a long box
 * on its side: `w` is its length, `d` its thickness, `ry` a quarter turn. So
 * taking `w` and `d` as the world extent turns every such wall sideways — the
 * stairwell's west wall, 0.1 m thick and 1.5 m long, was given a collider
 * 1.5 m wide and 0.1 m deep, and the camera could not walk past a wall that
 * was not there. The same turned a quarter-turned dining table into a
 * rectangle 0.9 m too wide, which reached through the wall and blocked the
 * stairwell door.
 *
 * What is wanted is the axis-aligned bounds of the turned rectangle, which is
 * exact for the quarter turns the model actually uses and a snug enclosure
 * for anything else.
 */
export function worldFootprint(w: number, d: number, ry: number): { w: number; d: number } {
  const t = (ry * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return { w: w * c + d * s, d: w * s + d * c };
}

export function buildScene(project: Project, options: BuildOptions = {}): SceneGeometry {
  const { showRoof = true, showFurniture = true, showGround = true } = options;
  const showCeiling = options.showCeiling ?? showRoof;
  const f = frameFor(project.plot.width, project.plot.depth);
  const boxes: Box[] = [];
  // Accumulated across every floor: a door on the first storey swings just as
  // much as one on the second, and the walk camera only ever sees the storey it
  // is standing on.
  const swingDoors: SwingDoor[] = [];

  const allFloors = project.floors.slice().sort((a, b) => a.order - b.order);
  const topFloor = allFloors[allFloors.length - 1];
  const floors = allFloors.filter((x) => (options.visibleFloorIds?.length ? options.visibleFloorIds.includes(x.id) : true));

  for (const floor of floors) {
    const rooms = project.rooms.filter((r) => r.floorId === floor.id);
    const walls = project.walls.filter((w) => w.floorId === floor.id);

    if (floor.order === 0 && showGround) {
      const sb = project.plot.setbacks;
      const bw = Math.max(0, project.plot.width - sb.left - sb.right);
      const bd = Math.max(0, project.plot.depth - sb.front - sb.rear);
      boxes.push({
        x: f.tx(sb.left + bw / 2),
        y: -0.09,
        z: f.tz(sb.front + bd / 2),
        w: bw,
        h: 0.18,
        d: bd,
        ry: 0,
        color: PAVING_COLOR,
        roughness: 0.95,
        metalness: 0,
        opacity: 1,
        kind: 'slab',
        floorId: floor.id,
        surface: 'paving',
      });
    }

    const corners: Corner[] = [];
    const trims = resolveCorners(walls, floor, project.materials ?? {}, corners);

    // The slab a flight stands on has to be holed where the flight is.
    //
    // The ground paving is holed for exactly this reason (`groundSurfaces` in
    // `collision.ts`): an unbroken plane at the ground level passes under every
    // flight, and `floorUnder` takes the *highest* surface at or below the feet,
    // so the flat plane does not lose to the ramp — it beats it, and the camera
    // walks the length of the staircase at a constant height. The same is true of
    // the room slab under the stairwell, and it is the one that matters here:
    // the stairwell is a room, so it has a floor, and that floor lies under the
    // flight.
    const flightHoles: Footprint[] = [];
    for (const s of project.stairs) {
      const under = flightUnder(s, project.floors);
      if (under === null || Math.abs(under - floor.elevation) > 1e-6) continue;
      flightHoles.push({ x: f.tx(s.x), z: f.tz(s.y), w: s.width, d: s.run });
    }

    for (const r of rooms) roomSlab(r, f, floor, 0.2, project.materials ?? {}, boxes, showCeiling, flightHoles);
    for (const w of walls) wallBoxes(w, f, floor, trims, project.materials ?? {}, boxes, swingDoors);
    cornerBoxes(corners, f, boxes);
    for (const s of project.stairs.filter((x) => x.floorId === floor.id)) stairBoxes(s, f, floor, boxes);
    for (const o of project.outdoor.filter((x) => x.floorId === floor.id)) outdoorBoxes(o, f, floor, boxes);
    if (showFurniture) {
      for (const item of project.furniture.filter((x) => x.floorId === floor.id)) furnitureBoxes(item, f, floor, boxes);
    }
    if (showRoof && topFloor && floor.id === topFloor.id) roofBoxes(rooms, walls, f, floor, boxes);
  }

  // Collision volumes: opaque walls and furniture only. Slabs, stairs, decks
  // and railings are walkable or harmless — a camera that bumps into a window
  // pane but walks through a deck would be worse than no collision at all.
  // Glass is treated as a wall because you should not walk through a window.
  // Corner blocks are deliberately absent: they are flush with the two walls
  // they join, so the walls themselves already block that square of floor.
  const colliders = boxes
    .filter((b) => (b.kind === 'wall' || b.kind === 'furniture' || b.kind === 'glass') && !b.noCollide)
    .map((b) => {
      const fp = worldFootprint(b.w, b.d, b.ry);
      return { x: b.x, z: b.z, w: fp.w, d: fp.d, y0: b.y - b.h / 2, y1: b.y + b.h / 2, floorId: b.floorId };
    });

  const building = buildingExtent(boxes);
  const entrance = findEntrance(project, f);
  siteBoxes(project, building, entrance, boxes);

  let maxY = 0;
  for (const b of boxes) if (b.kind !== 'lawn' && b.kind !== 'paving' && b.kind !== 'path') maxY = Math.max(maxY, b.y + b.h / 2);

  return {
    boxes,
    colliders,
    doors: swingDoors,
    bounds: { width: project.plot.width, depth: project.plot.depth, height: maxY },
    building,
    entrance,
  };
}

/**
 * The extent of the built fabric, as opposed to the plot.
 *
 * Only walls count. Slabs, decks and the roof all oversail or under-run the
 * wall line, so including them would hand the camera a target that is already
 * wrong by the width of an eaves overhang — and a plan with no walls yet (a
 * fresh empty plot) correctly produces an empty extent rather than the whole
 * site, which is what stops the camera framing a building that does not exist.
 */
function buildingExtent(boxes: Box[]): SceneGeometry['building'] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let maxY = 0;
  for (const b of boxes) {
    if (b.kind !== 'wall') continue;
    // `ry` is the wall's own heading, so its world footprint is the box extent
    // rotated about its centre. Walls are axis-aligned by construction, but the
    // swap below costs nothing and keeps this honest if that ever changes.
    const swap = Math.abs(Math.sin((b.ry * Math.PI) / 180)) > 0.5;
    const hw = (swap ? b.d : b.w) / 2;
    const hd = (swap ? b.w : b.d) / 2;
    minX = Math.min(minX, b.x - hw);
    maxX = Math.max(maxX, b.x + hw);
    minZ = Math.min(minZ, b.z - hd);
    maxZ = Math.max(maxZ, b.z + hd);
    maxY = Math.max(maxY, b.y + b.h / 2);
  }
  if (!Number.isFinite(minX)) {
    // No walls: fall back to the plot centre so the camera still has a target.
    return {
      minX: 0,
      maxX: 0,
      minZ: 0,
      maxZ: 0,
      cx: 0,
      cz: 0,
      cy: 0,
      width: 0,
      depth: 0,
      height: 0,
    };
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    cy: maxY / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
    height: maxY,
  };
}

/**
 * The ground the building stands on: lawn, a paved apron against the elevation,
 * and a path from the street edge to the front door.
 *
 * The path is the only part that could be accused of invention, so it is drawn
 * only when the model actually has a door facing the street — `entrance` is
 * `null` otherwise and no path is emitted. Its length is computed to the plot
 * boundary rather than to a fixed distance, so it always meets the edge.
 *
 * Heights are staggered on purpose. These are coplanar horizontals stacked
 * within a few centimetres of each other, and a paving box whose top face sat
 * exactly on the slab's top face would z-fight into a shimmering mess.
 */
function siteBoxes(project: Project, building: SceneGeometry['building'], entrance: SceneGeometry['entrance'], out: Box[]): void {
  const groundId = project.floors.find((fl) => fl.order === 0)?.id ?? project.floors[0]?.id ?? '';
  const verge = 6;

  // Lawn: the whole site plus a generous verge, so the plot edge is a change of
  // ground rather than a hard line ending in nothing.
  out.push({
    x: 0,
    y: -0.3,
    z: 0,
    w: project.plot.width + verge,
    h: 0.1,
    d: project.plot.depth + verge,
    ry: 0,
    color: LAWN_COLOR,
    roughness: 1,
    metalness: 0,
    opacity: 1,
    kind: 'lawn',
    surface: 'lawn',
    floorId: groundId,
  });

  // Apron: paving hard against the building, which is what stops the lawn
  // running right up the wall and looking like the house is sitting in a field.
  if (building.width > 0 && building.depth > 0) {
    const apron = 1.3;
    out.push({
      x: building.cx,
      y: -0.04,
      z: building.cz,
      w: building.width + apron * 2,
      h: 0.12,
      d: building.depth + apron * 2,
      ry: 0,
      color: PAVING_COLOR,
      roughness: 0.94,
      metalness: 0,
      opacity: 1,
      kind: 'paving',
      surface: 'paving',
      floorId: groundId,
    });
  }

  if (!entrance) return;
  const dir = STREET_DIR[project.plot.orientation] ?? STREET_DIR[0]!;
  const halfW = project.plot.width / 2;
  const halfD = project.plot.depth / 2;
  const toEdge =
    dir.x > 0 ? halfW - entrance.x : dir.x < 0 ? entrance.x + halfW : Number.POSITIVE_INFINITY;
  const toEdgeZ = dir.z > 0 ? halfD - entrance.z : dir.z < 0 ? entrance.z + halfD : Number.POSITIVE_INFINITY;
  const reach = Math.min(toEdge, toEdgeZ);
  if (!Number.isFinite(reach) || reach <= 0.5) return;

  // Overlap the threshold slightly so the path tucks under the door frame
  // rather than stopping a hair short of it.
  const length = reach + 0.4;
  const alongX = dir.x !== 0;
  const width = Math.max(1.3, entrance.width + 0.6);

  out.push({
    x: alongX ? entrance.x + dir.x * (length / 2 - 0.2) : entrance.x,
    y: 0.02,
    z: alongX ? entrance.z : entrance.z + dir.z * (length / 2 - 0.2),
    w: alongX ? length : width,
    h: 0.04,
    d: alongX ? width : length,
    ry: 0,
    color: PATH_COLOR,
    roughness: 0.92,
    metalness: 0,
    opacity: 1,
    kind: 'path',
    surface: 'paving',
    floorId: groundId,
  });
}

/**
 * Which way the street lies, in world coordinates.
 *
 * `Orientation` is a compass bearing from plan-north, and plan-north is −y, so
 * the bearing maps straight onto world axes with no rotation anywhere: north is
 * −Z, east is +X.
 */
export const STREET_DIR: Record<number, { x: number; z: number }> = {
  0: { x: 0, z: -1 },
  90: { x: 1, z: 0 },
  180: { x: 0, z: 1 },
  270: { x: -1, z: 0 },
};

/**
 * The front door: the ground-floor door in the exterior wall that faces the
 * street.
 *
 * Returns `null` rather than guessing when the model has no such door, because
 * a path drawn to an invented entrance would be a lie about the design — the
 * site simply gets no path.
 */
function findEntrance(project: Project, f: Frame): SceneGeometry['entrance'] {
  const dir = STREET_DIR[project.plot.orientation] ?? STREET_DIR[0]!;
  const ground = project.floors.find((fl) => fl.order === 0);
  if (!ground) return null;

  let best: { score: number; x: number; z: number; width: number } | null = null;
  for (const wall of project.walls) {
    if (wall.floorId !== ground.id || wall.type !== 'exterior') continue;
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // A wall has two perpendiculars and only one of them is its outside, so the
    // test has to consider both. Taking a single perpendicular and asking which
    // way it points is not enough — which one that is depends on the order the
    // wall's endpoints were entered, and getting it wrong silently reported "no
    // entrance" for every door in the building.
    const px = -dy / len;
    const py = dx / len;
    const facing = Math.abs(px * dir.x + py * dir.z);
    if (facing <= 0.2) continue; // this wall does not front the street at all

    for (const o of wall.openings) {
      if (o.kind === 'window') continue;
      const s = Math.max(0, Math.min(len, o.offset));
      // Prefer a door squarely on the street wall; break ties on the one that
      // runs furthest along it, so the choice is stable rather than arbitrary.
      const score = facing * 100 + s / len;
      if (best && score <= best.score) continue;
      best = {
        score,
        x: f.tx(wall.a.x + (dx / len) * s),
        z: f.tz(wall.a.y + (dy / len) * s),
        width: o.width,
      };
    }
  }
  if (!best) return null;
  return { x: best.x, z: best.z, width: best.width };
}
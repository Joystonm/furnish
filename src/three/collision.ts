/**
 * First-person camera collision.
 *
 * A walk-through where the camera passes through walls is worse than no
 * walk-through, so the camera is a circle of radius `CAMERA_RADIUS` that is
 * pushed out of every collider it overlaps. The test is circle-vs-rect on the
 * XZ plane, which is exact for axis-aligned boxes and cheap enough to run on
 * every frame.
 *
 * Resolution is per-axis rather than "push out along the shortest vector",
 * because per-axis is what makes sliding along a wall feel right: you approach
 * a wall at an angle, you do not stop dead, you travel along it.
 */
import { Vector3, type Object3D } from 'three';
import type { Collider } from './sceneModel.ts';

/** Radius of the camera's "body" in metres — roughly shoulder width. */
export const CAMERA_RADIUS = 0.26;

/** Eye height above the floor the camera stands on, in metres. */
export const EYE_HEIGHT = 1.62;

export interface MoveResult {
  x: number;
  z: number;
  /** Colliders the camera is currently pressed against. */
  touching: boolean;
}

/** Closest point on a rect to (x, z), in the rect's local frame. */
function clampToRect(x: number, z: number, c: Collider): { x: number; z: number } {
  return {
    x: Math.max(c.x - c.w / 2, Math.min(c.x + c.w / 2, x)),
    z: Math.max(c.z - c.d / 2, Math.min(c.z + c.d / 2, z)),
  };
}

export function overlapsCollider(x: number, z: number, c: Collider, radius: number): boolean {
  const nearest = clampToRect(x, z, c);
  const dx = x - nearest.x;
  const dz = z - nearest.z;
  return dx * dx + dz * dz < radius * radius;
}

/**
 * The span along one axis that a camera of `radius` may not occupy, given where
 * it sits on the *other* axis.
 *
 * The forbidden set is a rectangle grown by a disc, which is not a rectangle.
 * Growing it by a square instead is simpler but wrong in the corners: it both
 * freezes the camera a few centimetres early when you hug a wall diagonally and
 * reports contact that does not exist. Since a move along x is a straight line
 * at a fixed z, slicing the true forbidden set at that z gives an exact
 * interval, so that is what is computed here — `h` is the disc radius reduced
 * by how far off-centre the camera already is on the other axis.
 */
function forbiddenSpan(
  centre: number,
  halfExtent: number,
  lateral: number,
  radius: number,
): { lo: number; hi: number } | null {
  if (Math.abs(lateral) >= radius) return null; // clear of the collider entirely
  const h = Math.sqrt(radius * radius - lateral * lateral);
  return { lo: centre - halfExtent - h, hi: centre + halfExtent + h };
}

/** A collider re-expressed along whichever axis the current pass resolves. */
interface AxisCollider {
  centre: number;
  halfExtent: number;
  /**
   * Signed gap to the camera on the *other* axis; set before each pass.
   *
   * Zero means the camera's centre lies within the collider's span on that
   * axis — it is squarely in front of the collider's face rather than off to
   * one side beside it, and that is what tells a head-on move from a move
   * along the wall.
   */
  lateral: number;
}

interface AxisResult {
  value: number;
  touching: boolean;
}

/**
 * Signed gap between coordinate `v` and the collider's span
 * [`lo`, `hi`]: 0 inside, positive beyond the far end, negative before it.
 */
function gapFrom(v: number, lo: number, hi: number): number {
  return Math.max(lo - v, v - hi, 0);
}

/**
 * Resolve one axis against every collider, clamping to the nearest face.
 *
 * The camera is a disc of `radius`, and a collider is a rectangle, so the
 * camera's centre may not come within `radius` of it. Where the camera starts
 * decides what the move is allowed to do:
 *
 *  - **Clear of the collider.** The move stops at the face it is about to
 *    reach. This is the ordinary case and it is a swept test, so a step longer
 *    than a wall cannot tunnel through it.
 *  - **Already overlapping, but off to one side.** The move runs *along* the
 *    collider's face rather than into it, and clamping it back is what froze a
 *    camera in a doorway it was halfway through. The move is let alone.
 *  - **Already overlapping, and squared up against the face.** The move is
 *    heading into the collider, and it is held where it is. Carrying on would
 *    take the camera through: pressed two centimetres into an exterior wall,
 *    it was allowed to travel the whole way through it and out of the house.
 *  - **Embedded.** The camera's centre is inside the collider, so it cannot
 *    simply stay; it is carried out the far side, which is the only escape.
 */
function resolveAxis(
  from: number,
  delta: number,
  active: AxisCollider[],
  radius: number,
): AxisResult {
  if (delta === 0) return { value: from, touching: false };
  const target = from + delta;
  let allowed = target;
  let touching = false;

  for (const c of active) {
    const span = forbiddenSpan(c.centre, c.halfExtent, c.lateral, radius);
    if (!span) continue;
    const { lo, hi } = span;
    // A straight move either ends inside the interval or crosses it — there is
    // no third way, so this single test is also the swept test. Checking only
    // the destination would let any step longer than a wall tunnel straight
    // through it, which is exactly what this module exists to prevent.
    if (Math.min(from, target) >= hi || Math.max(from, target) <= lo) continue;
    touching = true;

    const bodyLo = c.centre - c.halfExtent;
    const bodyHi = c.centre + c.halfExtent;

    let limit: number;
    if (from > lo && from < hi && c.lateral !== 0) {
      // Already overlapping, but off to one side: the camera is beside the
      // collider rather than in front of it, so the move runs along the
      // collider's face. Clamping it back is what froze a camera in a doorway
      // it was halfway through.
      limit = target;
    } else if (from <= bodyLo) {
      // West of the collider: moving east is into it, moving west is away.
      limit = delta > 0 ? lo : target;
    } else if (from >= bodyHi) {
      // East of the collider: moving west is into it, moving east is away.
      limit = delta < 0 ? hi : target;
    } else {
      // The camera's centre is inside the collider, so there is nowhere to
      // hold it. Put it back on whichever side is nearer.
      limit = from - bodyLo <= bodyHi - from ? lo : hi;
    }
    // Fold monotonically rather than assigning. Which collider constrains a move
    // must not depend on the order the array happens to be in: with a hundred of
    // them, "last one wins" let a permissive wall near the end of the list
    // overrule the jamb the camera was actually about to hit, so whether a step
    // through the front door went through or stuck depended on nothing more than
    // how many frames the browser had drawn.
    allowed = delta > 0 ? Math.min(allowed, limit) : Math.max(allowed, limit);
  }
  return { value: allowed, touching };
}

/**
 * The ground-plane direction the camera is facing, and its right-hand side.
 *
 * Read out of the camera's *world* orientation rather than from `rotation.y`.
 *
 * This is the whole ballgame for walking, and reading the yaw alone gets it
 * wrong roughly half the time. A camera looking down its own -Z toward world +Z
 * is not stored as yaw = π: `Object3D.lookAt` builds an orthonormal basis whose
 * +Z axis is `eye - target`, so facing north comes out as **pitch = ±π, yaw = 0**.
 * Derive forward as `(-sin yaw, 0, -cos yaw)` from that and you get the exact
 * opposite of where the camera is looking — W walks backwards, A and D swap.
 * It is intermittent rather than constant because the alternative representation
 * is used for some headings and this one for others, so it feels like the
 * controls are intermittently inverted.
 *
 * Taking the world direction and projecting it onto the ground plane is exact at
 * any pitch, and it also means looking up or down does not slow you down, which
 * is the behaviour a first-person camera wants.
 */
export function movementBasis(camera: Object3D): { fx: number; fz: number; rx: number; rz: number } {
  camera.getWorldDirection(FORWARD);
  const len = Math.hypot(FORWARD.x, FORWARD.z);
  // Looking straight up or straight down leaves no ground direction. Hold the
  // last heading rather than dividing by zero and sending the camera off at a
  // random angle; W still walks, it just keeps the heading it had.
  if (len < 1e-4) return { fx: 0, fz: -1, rx: 1, rz: 0 };
  const fx = FORWARD.x / len;
  const fz = FORWARD.z / len;
  // Right is forward turned a quarter turn clockwise seen from above.
  return { fx, fz, rx: -fz, rz: fx };
}

/** Move the camera by its own forward and right vectors, scaled by intent. */
export function wishVector(
  basis: { fx: number; fz: number; rx: number; rz: number },
  forward: number,
  strafe: number,
  speed: number,
): { x: number; z: number } {
  // Normalise, so that a diagonal is not faster than a straight line.
  //
  // Forward and strafe are unit vectors on orthogonal axes, so holding both adds
  // two vectors of `speed` that are √2 apart — holding W+D moved at 41% more
  // than holding W alone. The consequence is not just a number: you cannot walk
  // a straight line without drifting wide, and you overshoot a doorway every
  // time you approach it diagonally.
  //
  // Divided by `max(1, ·)` rather than by the magnitude itself, so that a
  // deliberate fraction — the inside camera's scroll-wheel push — is passed
  // through untouched and only a genuine diagonal is scaled down.
  const scale = speed / Math.max(1, Math.hypot(forward, strafe));
  return {
    x: (basis.fx * forward + basis.rx * strafe) * scale,
    z: (basis.fz * forward + basis.rz * strafe) * scale,
  };
}

/**
 * Walking pace, in metres per second.
 *
 * 1.7 m/s is about 6 km/h, which is an adult's ordinary walking pace. The 2.6
 * this replaces is a power walk: brisk enough that the camera has cover half a
 * large room before you can read anything in it, which is the wrong trade for a
 * tool whose job is looking at rooms.
 */
export const WALK_SPEED = 1.7;

/** Running pace, on Shift. */
export const RUN_SPEED = 3.1;

/**
 * Indoor pace, in metres per second.
 *
 * Lower than outdoors for the reason `InsideView` already gives: these rooms are
 * two and a half metres across, and a sprint crosses one before it can be read.
 */
export const INDOOR_SPEED = 1.45;

/** Indoor running pace, on Shift. */
export const INDOOR_RUN_SPEED = 2.7;

/**
 * Acceleration, in m/s².
 *
 * A gait, not a snap: ~0.28 s from standing to walking pace. What this replaces
 * was an exponential chase with a ~83 ms time constant, whose *initial*
 * acceleration was about 31 m/s² and which reached 90% of pace in ~190 ms — a
 * body that either has momentum or does not, with no weight between.
 */
export const ACCEL = 6;

/**
 * Deceleration, in m/s².
 *
 * Deliberately about twice `ACCEL`, and that ratio is the whole feel. People
 * start up slowly and stop quickly; a walk that took as long to stop as to start
 * reads as sliding on ice, and one that stopped as fast as it started reads as a
 * cursor. ~0.15 s from pace to still.
 */
export const DECEL = 11;

/**
 * Move `vel` toward `wish` at a fixed rate, in m/s².
 *
 * Frame-rate independent by construction: the step is `rate * delta`, never a
 * fixed fraction of the gap, so a machine drawing at 30 fps and one drawing at
 * 240 reach walking pace in the same wall-clock time. The exponential smoothing
 * this replaces looked frame-rate independent too, and was not — its time
 * constant was multiplied through the frame rate, so a slow machine lagged into
 * every stride.
 *
 * Which rate applies is decided by where the wish vector is *relative* to the
 * current velocity, not by its own magnitude:
 *
 * - Opposed (`wish · vel < 0`) means the player has reversed or turned to face
 *   the other way. Decelerating is right: a turnaround passes through still.
 * - Slower (`|wish| < |vel|`) means releasing the keys, or dropping off Shift.
 *   Decelerating is right.
 * - Otherwise accelerate — including a hard change of heading at constant
 *   speed, where the two vectors are perpendicular and neither test fires.
 */
export function approachVelocity(
  vel: { x: number; z: number },
  wish: { x: number; z: number },
  delta: number,
  accel: number = ACCEL,
  decel: number = DECEL,
): { x: number; z: number } {
  const dx = wish.x - vel.x;
  const dz = wish.z - vel.z;
  const gap = Math.hypot(dx, dz);
  if (gap === 0) return { x: vel.x, z: vel.z };

  const opposed = wish.x * vel.x + wish.z * vel.z < 0;
  const slower = wish.x * wish.x + wish.z * wish.z < vel.x * vel.x + vel.z * vel.z;
  const step = (opposed || slower ? decel : accel) * Math.max(0, delta);
  if (gap <= step) return { x: wish.x, z: wish.z }; // close enough to arrive this frame
  return { x: vel.x + (dx / gap) * step, z: vel.z + (dz / gap) * step };
}

/**
 * Distance one walking stride covers, in metres.
 *
 * The head bob advances its phase once per this much ground, which is what ties
 * the two together: bob frequency cannot drift out of step with the gait, and
 * the bob cannot keep going after the walker has stopped, because no ground is
 * being covered to drive it.
 */
export const STRIDE = 0.9;

/**
 * Head bob, and the constants that drive it.
 *
 * Kept as plain numbers rather than as a scene setting because this is a
 * question of taste that can be answered in one place: `BOB` is the single
 * constant to set to zero if the motion reads as a gimmick rather than as a
 * body. The two amplitudes are ratios of it rather than separate literals, so
 * dropping one constant drops the whole effect.
 *
 * 1.2 cm vertical is at the bottom of the range for a real walk (measured head
 * sway is 1–2 cm). It is meant to be felt on a straight run down a corridor and
 * not thought about in a room — a design tool whose camera never quite settles
 * is a tool that is worse at showing you a room.
 */
export const BOB = 0.012;
export const BOB_LATERAL = BOB * 0.55;
export const BOB_ROLL = (0.3 * Math.PI) / 180;

/** The camera's bob at one instant. */
export interface Bob {
  /** Vertical offset, in metres. Positive is up. */
  vertical: number;
  /** Lateral offset, in metres, along the camera's own right vector. */
  lateral: number;
  /** Roll, in radians. */
  roll: number;
}

/**
 * Advance the bob's phase by the ground actually covered.
 *
 * Distance, not seconds: a time-driven bob falls out of step with the gait
 * whenever the pace changes, keeps rocking after the walker has stopped, and
 * runs at the wrong frequency on a machine drawing four frames a second. The
 * ground covered is the one quantity that is right in all three cases — and it
 * is zero when the walker is pushing into a wall, which is why the camera does
 * not shake when it cannot move.
 */
export function bobPhase(phase: number, covered: number): number {
  return phase + (covered / STRIDE) * Math.PI * 2;
}

/**
 * The camera's bob at a phase and a pace.
 *
 * `pace` is the fraction of full walking speed, and it scales the whole effect:
 * a standing camera is a still camera, including during the deceleration after
 * the key is released.
 *
 * The sway is at half the bob frequency, because a body sways once per stride
 * and dips twice.
 */
export function bob(phase: number, pace: number): Bob {
  const sway = Math.sin(phase / 2);
  return {
    vertical: Math.sin(phase) * BOB * pace,
    lateral: sway * BOB_LATERAL * pace,
    roll: sway * BOB_ROLL * pace,
  };
}

const FORWARD = new Vector3();

/** How far above the eye the top of the camera's head sits, in metres. */
export const HEAD_ABOVE_EYE = 0.14;

/**
 * The vertical extent of the camera's body, for colliders to be tested against.
 *
 * A camera is a sphere on the XZ plane but a person on the Y axis, and the
 * difference is the difference between a walkable front door and a blank wall.
 * Feet are the floor the camera stands on; head is the eye plus a little.
 */
export function bodyBand(eyeY: number): { y0: number; y1: number } {
  return { y0: eyeY - EYE_HEIGHT, y1: eyeY + HEAD_ABOVE_EYE };
}

/**
 * Move from (x, z) by (dx, dz), sliding along colliders.
 *
 * Each axis is resolved independently, which is what produces wall-sliding
 * instead of sticking. `filter` lets the caller ignore colliders on a floor the
 * camera is not on — otherwise you could not walk under a first-floor slab or
 * through a first-floor wall while standing on the ground floor.
 *
 * `band` is the height the camera's body actually occupies, and it is what makes
 * a doorway a doorway. Without it every collider is treated as infinitely tall,
 * so the lintel over a front door blocks exactly as hard as the door frame beside
 * it and the viewer walks up the path into a solid elevation. A collider with no
 * declared height is treated as infinitely tall too, so omitting it blocks
 * rather than quietly letting the camera through something of unknown extent.
 */
export function moveWithCollision(
  x: number,
  z: number,
  dx: number,
  dz: number,
  colliders: Collider[],
  radius: number = CAMERA_RADIUS,
  filter?: (c: Collider) => boolean,
  band?: { y0: number; y1: number },
): MoveResult {
  const active = colliders.filter((c) => {
    if (filter && !filter(c)) return false;
    if (band) {
      // Blocks only where the camera's body and the collider actually overlap.
      // An absent height means infinitely tall, so unknown blocks.
      const y0 = c.y0 ?? -Infinity;
      const y1 = c.y1 ?? Infinity;
      if (band.y1 <= y0 || band.y0 >= y1) return false;
    }
    return true;
  });

  const alongX: AxisCollider[] = active.map((c) => ({
    centre: c.x,
    halfExtent: c.w / 2,
    lateral: gapFrom(z, c.z - c.d / 2, c.z + c.d / 2),
  }));
  const alongZ: AxisCollider[] = active.map((c) => ({
    centre: c.z,
    halfExtent: c.d / 2,
    lateral: 0, // filled in below, against the *resolved* x
  }));

  const rx = resolveAxis(x, dx, alongX, radius);
  const nx = rx.value;

  for (let i = 0; i < alongZ.length; i++) {
    const c = active[i]!;
    alongZ[i]!.lateral = gapFrom(nx, c.x - c.w / 2, c.x + c.w / 2);
  }
  const rz = resolveAxis(z, dz, alongZ, radius);

  return { x: nx, z: rz.value, touching: rx.touching || rz.touching };
}

/**
 * Nudge a camera onto a walkable surface — upwards only.
 *
 * The rule is deliberately one-directional: a surface counts only if it is at
 * or just above the camera (within 25 cm), and the highest such surface wins.
 * The camera is never moved *down* to a surface. That asymmetry is the point —
 * pressing "down" on a landing must not drop the camera through the floor to
 * the storey below, and starting a walk must not shove the camera up onto a
 * slab a metre overhead. Returning `fromY` unchanged when nothing qualifies is
 * a valid and safe answer.
 */
export function snapToFloor(fromY: number, candidates: Array<{ y: number; x: number; z: number; w: number; d: number }>): number {
  let best = fromY;
  for (const c of candidates) {
    if (fromY < c.y - 0.25) continue;
    if (c.y < best - 0.25) continue;
    if (c.y > best) best = c.y;
  }
  return best;
}

/**
 * The flat surfaces a camera can stand on, out of the scene's boxes: every room
 * slab and every terrace deck.
 *
 * **Stair boxes are deliberately not read from here.** They used to be, and a
 * flight was therefore climbable only if every one of its boxes happened to line
 * up — which couples whether you can walk up the stairs to how the renderer
 * chose to draw them. A flight is now walked as a slope built from the staircase
 * itself, by `flightSurfaces`, so the boxes are free to be whatever reads best
 * without the two having to agree. See `WalkSurface.ramp`.
 *
 * The ground paving is likewise not one of them. `sceneModel` builds it as a
 * single slab spanning the whole buildable envelope with its top at +0.09, a
 * little above the ground-floor slabs' top face at exactly the floor elevation —
 * so counting it would put the camera 9 cm above the floor in every ground-floor
 * room in the house, and make it step up rather than down across the threshold.
 * It is the ground the building stands on, not a floor in it.
 */
export function walkableSurfaces(
  boxes: Array<{
    y: number;
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    kind: string;
    /** Rectangles of this surface the camera must not be given as floor. */
    walkHoles?: Footprint[];
  }>,
): WalkSurface[] {
  const out: WalkSurface[] = [];
  for (const b of boxes) {
    if (b.kind !== 'room-slab' && b.kind !== 'deck') continue;
    // A slab with a hole in it is still one slab to look at and several to walk
    // on. The hole is a hole in the *floor*, not in the picture: the room's floor
    // finish is still drawn whole, and only the surface the camera may stand on
    // is broken into the pieces around the hole.
    let rects: Footprint[] = [{ x: b.x, z: b.z, w: b.w, d: b.d }];
    for (const hole of b.walkHoles ?? []) rects = rects.flatMap((r) => cutOut(r, hole));
    for (const r of rects) {
      if (r.w < 0.05 || r.d < 0.05) continue;
      out.push({ y: b.y + b.h / 2, x: r.x, z: r.z, w: r.w, d: r.d });
    }
  }
  return out;
}

/**
 * How far above the feet a surface still counts as a step rather than a ceiling.
 *
 * A stair riser is 170–190 mm and the camera moves a few centimetres a frame, so
 * 30 cm clears a riser with margin while remaining far short of the 2.7 m a
 * storey is. Below it, the first floor's slab is a ceiling — which is exactly
 * why the number has to exist: without a threshold, standing in a ground-floor
 * room directly under the one above would snap the camera up through the slab.
 */
export const STEP_UP = 0.3;

/**
 * How far below a storey's elevation the feet may be and still count as being
 * on it.
 *
 * Deliberately far smaller than `STEP_UP`. `STEP_UP` answers "can the camera
 * step onto this", and it is generous because a riser is. This answers "which
 * storey is the camera in", and the answer must not change while the camera is
 * still below the upper slab: the storey decides whose walls and furniture
 * the camera collides with, and handing over early means the camera is already
 * being filtered by a floor it has not reached. The tolerance is only here to
 * absorb the rounding in a height read back from a ramp.
 */
export const STOREY_EPSILON = 0.05;

/** A surface a camera can stand on, as `walkableSurfaces` and `flightSurfaces` produce. */
export interface WalkSurface {
  /** Height of the top face, in world metres. Ignored when `ramp` is set. */
  y: number;
  /** Centre in world X and Z. */
  x: number;
  z: number;
  /** Full extents in world X and Z. */
  w: number;
  d: number;
  /**
   * A sloped surface: the height at the min-Z end and at the max-Z end.
   *
   * Only a flight has one. It is what a staircase is — a continuous incline —
   * and reading it as such means the camera's height along the run is decided by
   * the model's own `run`, `rise` and `direction` rather than by however many
   * boxes the renderer happened to emit and whether they line up.
   */
  ramp?: { from: number; to: number };
}

/** The height of a walkable surface at world Z `z`. */
export function surfaceHeightAt(c: WalkSurface, z: number): number {
  if (!c.ramp) return c.y;
  const t = Math.min(1, Math.max(0, (z - (c.z - c.d / 2)) / c.d));
  return c.ramp.from + (c.ramp.to - c.ramp.from) * t;
}

/** The part of a `Staircase` a walkable flight needs. */
export interface StairRun {
  floorId: string;
  /** Footprint centre in plan coordinates. */
  x: number;
  y: number;
  width: number;
  run: number;
  direction: -1 | 1;
  rise?: number;
}

/**
 * Every staircase as a slope the camera can walk.
 *
 * Built from the model, not from the render, and that is the whole point. Reading
 * a walkable floor out of the boxes ties "can you climb this" to "how did the 3D
 * builder choose to draw it" — and when the two disagree, or the boxes are simply
 * absent, the camera walks straight through a staircase that is plainly there.
 *
 * `direction` is +1 for a flight ascending away from `floorId`, so its low end is
 * at the min-Z end of the run; −1 is a flight descending out of that floor, whose
 * low end is at the max-Z end instead. `tz` is a translation, not a flip, so the
 * plan's +Y really is the world's +Z and the ends are unambiguous.
 */
export function flightSurfaces(
  stairs: StairRun[],
  frame: { tx: (x: number) => number; tz: (y: number) => number },
  elevationOf: Map<string, number>,
  heightOf: Map<string, number>,
): WalkSurface[] {
  return stairs.map((s) => {
    const rise = s.rise ?? heightOf.get(s.floorId) ?? 0;
    const base = elevationOf.get(s.floorId) ?? 0;
    // A +1 flight leaves `floorId` and arrives above it; a -1 one arrives below.
    const lowAtMinZ = s.direction === 1;
    const bottom = s.direction === 1 ? base : base - rise;
    const top = bottom + rise;
    return {
      x: frame.tx(s.x),
      y: bottom + rise / 2,
      z: frame.tz(s.y),
      w: s.width,
      d: s.run,
      ramp: { from: lowAtMinZ ? bottom : top, to: lowAtMinZ ? top : bottom },
    };
  });
}

/** A flat rectangle in world X and Z. */
export interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
}

/**
 * `a` with `hole` taken out of it: the band before the hole, the band after it,
 * and the two flanks beside it. The whole of `a` when they do not meet.
 *
 * A local copy rather than the generator's `subtractRect` because that works in
 * plan coordinates and this works in world ones, and because pulling the whole
 * layout module into the camera's floor system to borrow ten lines of rectangle
 * arithmetic is the wrong way round.
 */
function cutOut(a: Footprint, hole: Footprint): Footprint[] {
  const left = a.x - a.w / 2;
  const right = a.x + a.w / 2;
  const near = a.z - a.d / 2;
  const far = a.z + a.d / 2;
  const x0 = Math.max(left, hole.x - hole.w / 2);
  const z0 = Math.max(near, hole.z - hole.d / 2);
  const x1 = Math.min(right, hole.x + hole.w / 2);
  const z1 = Math.min(far, hole.z + hole.d / 2);
  if (x1 <= x0 || z1 <= z0) return [a];

  const out: Footprint[] = [];
  if (z0 > near) out.push({ x: a.x, z: (near + z0) / 2, w: a.w, d: z0 - near });
  if (z1 < far) out.push({ x: a.x, z: (z1 + far) / 2, w: a.w, d: far - z1 });
  if (x0 > left) out.push({ x: (left + x0) / 2, z: a.z, w: x0 - left, d: z1 - z0 });
  if (x1 < right) out.push({ x: (x1 + right) / 2, z: a.z, w: right - x1, d: z1 - z0 });
  return out;
}

/**
 * The ground a walk-mode camera crosses to reach the house.
 *
 * This is the one thing walk mode needs and inside mode does not. The walk
 * starts out on the pavement, so it needs something to stand on *before* it
 * reaches a room slab — and it cannot simply take `walkableSurfaces`, because
 * that deliberately omits the ground paving, which indoors would float the
 * camera 9 cm above every ground-floor floor. Out here that paving is not a floor
 * at all; it is the terrain the house stands on, and standing on it is the whole
 * point.
 *
 * **The holes are the whole point.** A single unbroken plane at the ground level
 * would pass under every flight, and `floorUnder` resolves ties by taking the
 * *highest* candidate at or below the feet — so a flat plane at 0 underneath a
 * flight climbing to 2.7 does not lose to the ramp, it beats it at the foot and
 * the camera walks the length of the staircase at a constant height, passing
 * straight through the middle of it. That is the failure this arrangement
 * exists to prevent, and it is not hypothetical: it is what walk mode did until
 * this function existed, because walk mode had no floor system at all.
 */
export function groundSurfaces(
  plot: { width: number; depth: number },
  flights: WalkSurface[],
  verge = 0,
): WalkSurface[] {
  let rects: Footprint[] = [{ x: 0, z: 0, w: plot.width + verge * 2, d: plot.depth + verge * 2 }];
  for (const f of flights) rects = rects.flatMap((r) => cutOut(r, { x: f.x, z: f.z, w: f.w, d: f.d }));
  return rects
    .filter((r) => r.w > 0.05 && r.d > 0.05)
    .map((r) => ({ y: 0, x: r.x, z: r.z, w: r.w, d: r.d }));
}

/**
 * The height of the surface the camera is standing on at (x, z).
 *
 * `snapToFloor` cannot answer this. It ignores position entirely, so every
 * surface in the building competes no matter which one is underfoot — which was
 * tolerable while the inside camera never left one storey, and is fatal once it
 * climbs: halfway up a flight the query would return the first-floor slab, which
 * is 1.4 m above the treads and belongs to the flight's *destination*.
 *
 * So this tests containment, and then takes the **highest** surface at or below
 * `feetY + STEP_UP`. Highest rather than lowest because that is what keeps the
 * camera on the tread it is on rather than dropping it through the flight to the
 * slab beneath, and it is symmetric: descending, the tread behind is out of
 * containment and the next tread down becomes the highest candidate. Falling is
 * allowed here, unlike in `snapToFloor`, because standing still on a landing and
 * stepping off it should be a drop, not a hover — but only ever to a surface
 * directly below, never to nothing: with nothing underfoot the height is returned
 * unchanged, which leaves the camera exactly where it was rather than at the
 * origin.
 */
export function floorUnder(
  x: number,
  z: number,
  feetY: number,
  candidates: WalkSurface[],
): number {
  let best = -Infinity;
  for (const c of candidates) {
    if (Math.abs(x - c.x) > c.w / 2) continue;
    if (Math.abs(z - c.z) > c.d / 2) continue;
    // For a flight this is the height along the incline at this Z, which is the
    // whole reason the flight is carried as a ramp: the camera follows the slope
    // rather than snapping to whichever tread box happened to be nearest.
    const y = surfaceHeightAt(c, z);
    if (y > feetY + STEP_UP) continue;
    if (y > best) best = y;
  }
  return best === -Infinity ? feetY : best;
}

/**
 * Whether there is anything to stand on at (x, z) at or below the feet.
 *
 * `floorUnder` returns the current height unchanged when nothing is beneath,
 * which is the right answer for a camera that is already standing somewhere. It
 * is the wrong answer for one being *asked* to walk there: the generator leaves
 * the stairwell out of every floor's packing, so the flight has no slab above
 * it and the edge of that hole is walkable — the camera would step into a void
 * and hover in it. This is the question to ask before committing to a move.
 */
export function hasFloorUnder(
  x: number,
  z: number,
  feetY: number,
  candidates: WalkSurface[],
): boolean {
  // With no surfaces at all there is no floor system to be trapped by. Refusing
  // every move because the list is empty would freeze the camera where it was
  // placed, which is a worse failure than the one this guards against — and the
  // camera was placed inside a room, so there is ground under it either way.
  if (!candidates.length) return true;
  return candidates.some((c) => {
    if (Math.abs(x - c.x) > c.w / 2) return false;
    if (Math.abs(z - c.z) > c.d / 2) return false;
    return surfaceHeightAt(c, z) <= feetY + STEP_UP;
  });
}

/**
 * Which storey the camera is standing on.
 *
 * Matched by elevation rather than by anything carried on the surface, because
 * a flight belongs to no single storey — it leaves one floor and arrives at the
 * next, and the upper half of it is genuinely between them. Choosing by height
 * keeps the collider filter and the room lookup on one floor the whole way up,
 * and hands over exactly when the feet reach within `STEP_UP` of the upper slab.
 *
 * Order-independent; the highest qualifying elevation wins.
 *
 * The handover happens when the feet actually reach the slab, not when they come
 * within `STEP_UP` of it. A camera climbing the last few steps is still below
 * the upper floor and must still be filtered by the floor it is leaving.
 */
export function floorAtElevation(
  feetY: number,
  floors: Array<{ floorId: string; elevation: number }>,
): string | null {
  let best: { id: string; y: number } | null = null;
  for (const f of floors) {
    if (f.elevation > feetY + STOREY_EPSILON) continue;
    if (!best || f.elevation > best.y) best = { id: f.floorId, y: f.elevation };
  }
  return best?.id ?? null;
}

/**
 * The longest move the walk may make in one go.
 *
 * A flight is carried as a ramp, and the camera follows it by asking how high
 * that ramp is where it now stands. The question has a condition attached: the
 * surface under the camera must be no more than `STEP_UP` above the feet, or it
 * is a ceiling rather than a step, and the camera is not allowed onto it.
 *
 * So a move that rises more than `STEP_UP` in one go does not climb the flight.
 * It is refused — and because the camera is then standing over nothing at all,
 * it counts as *stranded*, which is allowed to move regardless. The result is
 * the camera gliding up the inside of the staircase at a constant height: the
 * flight is right there, the camera goes through it, and the storey above is
 * never reached.
 *
 * That is not a hypothetical. The move has to cover more than 30 cm of rise in
 * one go, which at walking pace is a frame time of about a fifth of a second —
 * and a machine that renders at four frames a second does it on every frame.
 * The head of the flight is also exactly where this bites: the camera arrives at
 * the top of the ramp still at the height of the bottom of it, and never gets
 * through the door.
 *
 * Integrating the movement in fixed small steps takes the dependence on the
 * frame rate out of it: a step of 1/60 s rises at most 4 cm on the steepest
 * flight this app builds, which no riser can out-run.
 */
export const WALK_SUB_STEP = 1 / 60;

/** The world a walk takes place in. */
export interface WalkWorld {
  plot: { width: number; depth: number };
  colliders: Collider[];
  surfaces: WalkSurface[];
  /** The storeys, by elevation. */
  floors: Array<{ floorId: string; elevation: number }>;
  /** How far outside the plot the camera may stand, in metres. */
  verge?: number;
}

/** Where the camera is, and which storey it is on. */
export interface WalkBody {
  /** Eye height, in world metres. */
  x: number;
  y: number;
  z: number;
  floorId?: string | null;
}

/** Where the camera is after a step, with the storey settled one way or the other. */
export interface WalkBodyAfter {
  x: number;
  y: number;
  z: number;
  floorId: string | null;
}

/** What one frame of walking did. */
export interface WalkAdvance {
  body: WalkBodyAfter;
  vel: { x: number; z: number };
  /** Ground actually covered, in metres — this is what drives the head bob. */
  covered: number;
  /** Whether the camera is pressed against something. */
  touching: boolean;
}

/**
 * One frame of walking: move, resolve against what is in the way, and settle
 * onto whatever is underfoot.
 *
 * The whole of it, in one place, because the two cameras that walk — the one
 * outdoors and the one indoors — used to keep their own copy of the same
 * arithmetic, and a fix to one of them was not a fix to the other.
 *
 * The movement is integrated in steps of at most `WALK_SUB_STEP` rather than in
 * one move per frame, so that how fast the camera climbs a flight does not
 * depend on how fast the machine draws it. See `WALK_SUB_STEP` for what happens
 * when it does.
 */
export function advanceWalk(
  body: WalkBody,
  vel: { x: number; z: number },
  dt: number,
  world: WalkWorld,
): WalkAdvance {
  const steps = Math.max(1, Math.ceil(dt / WALK_SUB_STEP));
  const sub = dt / steps;
  let { x, y, z } = body;
  let floorId = body.floorId;
  let vx = vel.x;
  let vz = vel.z;
  let covered = 0;
  let touching = false;

  for (let i = 0; i < steps; i++) {
    const clamped = clampToPlot(x, z, world.plot, 0.6, world.verge ?? 0);
    const moved = moveWithCollision(
      clamped.x,
      clamped.z,
      vx * sub,
      vz * sub,
      world.colliders,
      CAMERA_RADIUS,
      // Only this storey's walls and furniture. Collision is tested on the XZ
      // plane, so without the filter the ground floor's sofa blocks the first
      // floor — and once the camera can actually climb, that is not a
      // hypothetical.
      (c) => !floorId || !c.floorId || c.floorId === floorId,
      bodyBand(y),
    );

    // Refuse a step onto nothing — unless the camera is *already* over nothing,
    // which is a different question. If the ground beneath it has gone (a plan
    // regenerated under an open walk), refusing every move would freeze it in
    // mid-air with no way back onto anything, and a frozen camera is worse than
    // the one this guards against. So one that is already stranded may move, and
    // walks out.
    const stranded = !hasFloorUnder(x, z, y - EYE_HEIGHT, world.surfaces);
    if (moved.touching) touching = true;
    if (stranded || hasFloorUnder(moved.x, moved.z, y - EYE_HEIGHT, world.surfaces)) {
      covered += Math.hypot(moved.x - clamped.x, moved.z - clamped.z);
      x = moved.x;
      z = moved.z;
    } else {
      // Stopped at the edge rather than bounced off it, so holding the key
      // against the lip of the void does not accumulate speed to be spent the
      // moment the camera steps back.
      vx = 0;
      vz = 0;
    }

    // What is underfoot, which sets the eye height and says which storey the
    // camera has reached.
    //
    // This is what makes a staircase climbable. A flight is carried as a single
    // ramp (`flightSurfaces`), so its height at any point along the run is the
    // incline itself and the eye rises continuously rather than in steps —
    // there is no frame on which the ground under the camera is simply missing
    // and the move is refused. Stepping off the head onto the upper floor's
    // slab hands the camera to the storey above, which is what the collider
    // filter and the room readout both follow a frame later.
    const support = floorUnder(x, z, y - EYE_HEIGHT, world.surfaces);
    y = support + EYE_HEIGHT;
    floorId = floorAtElevation(support, world.floors) ?? floorId;
  }

  return { body: { x, y, z, floorId: floorId ?? null }, vel: { x: vx, z: vz }, covered, touching };
}

/**
 * Keep the camera inside the plot.
 *
 * Walking off the edge of the world is disorienting; clamping to the buildable
 * envelope means the user is always looking at something.
 *
 * `verge` widens that envelope by a margin outside the plot boundary. It exists
 * because the walk camera *starts* on the pavement outside the front door: with
 * no verge, the very first `useFrame` clamped that start position back inside
 * the plot — a 3 m teleport that landed the camera inside the front wall, which
 * is why walking in showed a wall at point-blank range.
 */
export function clampToPlot(
  x: number,
  z: number,
  plot: { width: number; depth: number },
  margin = 0.5,
  verge = 0,
): { x: number; z: number } {
  const halfW = plot.width / 2 - margin + verge;
  const halfD = plot.depth / 2 - margin + verge;
  return {
    x: Math.max(-halfW, Math.min(halfW, x)),
    z: Math.max(-halfD, Math.min(halfD, z)),
  };
}

/** How far outside the plot the walk camera may stand, in metres. */
export const WALK_VERGE = 11;

/**
 * How far back to stand to see something `width` wide in a viewport of the
 * given shape.
 *
 * The 3D viewport is taller than it is wide, so its *horizontal* field of view
 * is much the smaller of the two. Framing off a fixed distance — which is what
 * `plot.depth / 2 + 2.4` was — put the camera 3.5 m from an 11 m facade in a
 * viewport that can only see 3.4 m of it at that range, so "walk mode" opened
 * on one window at point-blank range.
 */
export function standBackDistance(width: number, height: number, aspect: number, fovDeg: number): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.2, aspect));
  // The wide axis governs, and the building is seen at three-quarters, so its
  // diagonal is what has to fit — not its width head-on.
  const span = Math.max(width, height * 1.6);
  return span / (2 * Math.tan(hFov / 2));
}

/**
 * Where the walk camera starts: on the pavement, back from the street elevation,
 * looking at the house.
 *
 * Computed from the geometry rather than from the plot, because "in front of
 * the building" and "halfway across the plot" are not the same place — on a
 * plot with a deep front setback the second is inside the house. The returned
 * position is then stepped back until it is provably clear of every collider,
 * because a start point that is *probably* outside a wall is the same bug one
 * wall-thickness away from happening again.
 *
 * `street` is the compass direction the front door faces, so "front" means the
 * side a visitor arrives from. Taking the largest z unconditionally — which is
 * what this used to do — put the camera at the *back* of the house whenever the
 * street ran the other way: staring at a blank rear wall, in shadow, since the
 * sun is placed over the street.
 */
export function walkStart(
  building: { minX: number; maxX: number; minZ: number; maxZ: number; width: number; height: number },
  plot: { width: number; depth: number },
  colliders: Collider[],
  radius = CAMERA_RADIUS,
  aspect = 1.6,
  fovDeg = 68,
  street: { x: number; z: number } = { x: 0, z: 1 },
): { x: number; z: number } {
  // The street bearing is a compass direction off an axis-aligned plan, so it
  // is one of ±x/±z and projecting a box onto it is exact rather than a bound.
  const ax = street.x;
  const az = street.z;

  let front = -Infinity;
  for (const c of colliders) {
    front = Math.max(front, ax * c.x + az * c.z + Math.abs(ax) * (c.w / 2) + Math.abs(az) * (c.d / 2));
  }
  if (!Number.isFinite(front)) {
    front = ax > 0 ? building.maxX : ax < 0 ? building.minX : az > 0 ? building.maxZ : building.minZ;
  }

  // Bounded so a wide plot does not push the camera to the horizon and a narrow
  // one does not jam it against the front door. The margin is what stops the
  // house from touching both edges of the frame — at the exact fit distance it
  // fills the viewport edge to edge and reads as a wall, not as a building.
  const back = Math.min(26, Math.max(3.5, standBackDistance(building.width, building.height, aspect, fovDeg) * 1.18));
  const cx = (building.minX + building.maxX) / 2;
  const cz = (building.minZ + building.maxZ) / 2;
  const offset = front - (ax * cx + az * cz) + back;

  let x = cx + ax * offset;
  let z = cz + az * offset;

  const clamped = clampToPlot(x, z, plot, 0.5, WALK_VERGE);
  x = clamped.x;
  z = clamped.z;

  // If that still lands inside something, retreat. Every step moves further out
  // along the street bearing and the frontmost collider's face is the last thing
  // on that side, so this terminates one radius clear of it at worst.
  for (let i = 0; i < 40 && colliders.some((c) => overlapsCollider(x, z, c, radius)); i++) {
    x += ax * 0.25;
    z += az * 0.25;
  }
  return { x, z };
}

/** Compass heading in radians from a yaw angle in degrees. */
export const headingFromYaw = (yawDeg: number): number => (yawDeg * Math.PI) / 180;

// ─────────────────────────────────────────────────────── interior viewpoint ────

/**
 * Plan→world mapping, as `frameFor` produces it. Declared structurally rather
 * than imported so the placement maths stays testable without the scene model.
 */
export interface PlanFrame {
  tx: (x: number) => number;
  tz: (y: number) => number;
}

/** The parts of a `Room` that placement needs. Structural, for the same reason. */
export interface RoomRect {
  id: string;
  label: string;
  floorId: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height?: number;
  outdoor?: boolean;
}

/** Where to stand in a room, and where to point. */
export interface InteriorViewpoint {
  x: number;
  y: number;
  z: number;
  /** Yaw in degrees; 0 looks along −Z, which is also the walk camera's zero. */
  yaw: number;
  /** Pitch in degrees, positive looking up — this *is* `camera.rotation.x`. */
  pitch: number;
}

/** Room kinds never used as somewhere to stand and look. */
const NOT_A_VIEWPOINT = new Set(['balcony', 'terrace', 'garage']);

/**
 * Room kinds that make a good first view, best first.
 *
 * A viewer opening the inside of a house wants somewhere with furniture and
 * windows, so the choice is not "biggest room" — on a generated plan that is
 * reliably the living room, but on a hand-edited one it can be the garage or
 * the hall. Ranking by kind first and area second makes the default stable
 * without making it wrong.
 */
const PREFERRED_VIEWS = ['living', 'dining', 'kitchen', 'office', 'guest', 'bedroom', 'lobby'];

/** The footprint of a room in world space. */
export function roomFootprint(
  room: RoomRect,
  frame: PlanFrame,
): { minX: number; maxX: number; minZ: number; maxZ: number; cx: number; cz: number } {
  const minX = frame.tx(room.x);
  const maxX = frame.tx(room.x + room.width);
  const minZ = frame.tz(room.y);
  const maxZ = frame.tz(room.y + room.depth);
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

/**
 * Whether a room is one you can stand in.
 *
 * `outdoor` covers decks and terraces, which have a footprint and a label but
 * no walls — walking the viewpoint into one would put the camera on an open
 * slab looking at a wall that is not there.
 */
export function canViewFromInside(room: RoomRect): boolean {
  return !room.outdoor && !NOT_A_VIEWPOINT.has(room.kind) && room.width > 0.6 && room.depth > 0.6;
}

/**
 * The floors that can be stood on, lowest first.
 *
 * `order` is the storey number; without it the ids sort among themselves, which
 * keeps the answer deterministic but not physically meaningful.
 */
function standableFloors(rooms: RoomRect[], order?: Map<string, number>): string[] {
  const ids = [...new Set(rooms.filter(canViewFromInside).map((r) => r.floorId))];
  return ids.sort((a, b) => {
    const oa = order?.get(a) ?? Number.MAX_SAFE_INTEGER;
    const ob = order?.get(b) ?? Number.MAX_SAFE_INTEGER;
    return oa - ob || a.localeCompare(b);
  });
}

/**
 * The lowest floor there is anywhere to stand on.
 *
 * Lowest, not largest. You walk into a house at ground level, so opening the
 * inside view three storeys up is the wrong answer even when the upper floor
 * has more floor area — which it can, on a house with a small open-plan ground
 * floor and a full set of bedrooms above.
 */
export function principalFloorId(rooms: RoomRect[], order?: Map<string, number>): string | null {
  return standableFloors(rooms, order)[0] ?? null;
}

/**
 * Which room to open the inside view on.
 *
 * The lowest floor that has a room worth opening on, and within it the
 * best-ranked kind — so a house whose ground floor is a garage and a hallway
 * opens upstairs, where the bedrooms are, instead of on an empty hall.
 *
 * Ranking by kind before area matters because "biggest room" is not "best
 * room": on a generated plan it is usually the living room, but on a
 * hand-edited one it is just as likely to be the store cupboard. If no floor
 * has a ranked kind at all, the largest room on the lowest standable floor is
 * still a defensible answer, and beats showing nothing.
 */
export function defaultInteriorRoom(rooms: RoomRect[], order?: Map<string, number>): RoomRect | null {
  const byFloor = new Map<string, RoomRect[]>();
  for (const r of rooms) {
    if (!canViewFromInside(r)) continue;
    const list = byFloor.get(r.floorId);
    if (list) list.push(r);
    else byFloor.set(r.floorId, [r]);
  }

  let fallback: RoomRect | null = null;
  for (const floorId of standableFloors(rooms, order)) {
    const onFloor = byFloor.get(floorId)!;
    if (!fallback) {
      fallback = onFloor.reduce((a, b) => (b.width * b.depth > a.width * a.depth ? b : a));
    }
    let best: RoomRect | null = null;
    let bestRank = PREFERRED_VIEWS.length;
    for (const r of onFloor) {
      const rank = PREFERRED_VIEWS.indexOf(r.kind);
      if (rank === -1) continue;
      const area = r.width * r.depth;
      if (!best || rank < bestRank || (rank === bestRank && area > best.width * best.depth)) {
        best = r;
        bestRank = rank;
      }
    }
    if (best) return best;
  }
  return fallback;
}

/**
 * Where the camera stands and looks, in a room.
 *
 * **In a corner, looking at the opposite one.** That is how a room is
 * photographed, and the reason is worth stating because the obvious
 * alternative is much worse: stand in the middle of the room and look at the
 * far wall, and in a room under about six metres the frame is filled edge to
 * edge by one flat plane — you learn the room's width and nothing else. From
 * the corner, both side walls sweep back to a vanishing point, the floor and
 * ceiling give the depth, and the furniture between is spread across the shot
 * rather than stacked in the middle of it.
 *
 * (Standing on the *long axis* of a narrow room is the other valid framing,
 * and it is what you would do in a corridor. For a room that is roughly as
 * wide as it is deep it is strictly worse, because the wall you face is flat
 * and close, so it is not what this does.)
 *
 * The corner chosen is the one furthest from the middle of the building, so
 * you look inward: an outside wall behind you, the heart of the house ahead.
 *
 * Candidates are tried in order and the first clear of every collider is taken,
 * because the spot you would like is frequently occupied — a sofa in the corner
 * is normal furniture, not a mistake in the plan. Falling back through the
 * other corners, then points part-way in, then the middle, means a tight or
 * cluttered room still gets a view instead of a camera inside a wall.
 *
 * The aim point is below eye height on purpose. Aiming level frames a band of
 * blank wall; aiming a little down puts the floor, the furniture standing on
 * it, and the bottom of the windows in the same shot.
 */
export function roomViewpoint(
  room: RoomRect,
  frame: PlanFrame,
  opts: {
    elevation?: number;
    buildingCentre?: { x: number; z: number };
    colliders?: Collider[];
    radius?: number;
    eyeHeight?: number;
  } = {},
): InteriorViewpoint {
  const radius = opts.radius ?? CAMERA_RADIUS;
  const eye = opts.eyeHeight ?? EYE_HEIGHT;
  const elevation = opts.elevation ?? 0;
  const { minX, maxX, minZ, maxZ, cx, cz } = roomFootprint(room, frame);
  const bc = opts.buildingCentre ?? { x: cx, z: cz };

  // Stand off each wall by the camera's own radius plus the wall's half
  // thickness — room rectangles are drawn to the wall *centreline*, so the
  // inner face is already a little way inside the rectangle.
  const inset = radius + 0.18;
  // Too small to hold the camera anywhere but the middle.
  const fits = maxX - minX > 2 * inset + 0.5 && maxZ - minZ > 2 * inset + 0.5;

  const corners: Array<[number, number]> = fits
    ? (
        [
          [maxX - inset, maxZ - inset],
          [maxX - inset, minZ + inset],
          [minX + inset, maxZ - inset],
          [minX + inset, minZ + inset],
        ] as Array<[number, number]>
      ).sort(
        (a, b) => Math.hypot(b[0] - bc.x, b[1] - bc.z) - Math.hypot(a[0] - bc.x, a[1] - bc.z),
      )
    : [];

  type Shot = { at: [number, number] };
  const shots: Shot[] = corners.map((at) => ({ at }));
  if (fits) {
    // Part-way in from each corner, for a room whose corners are all occupied.
    for (const [x, z] of corners) {
      shots.push({ at: [x + (cx - x) * 0.55, z + (cz - z) * 0.55] });
      shots.push({ at: [x + (cx - x) * 0.25, z + (cz - z) * 0.25] });
    }
  }
  shots.push({ at: [cx, cz] });

  const clear = (x: number, z: number) =>
    !opts.colliders?.some((c) => overlapsCollider(x, z, c, radius));
  const [x, z] = shots.find((s) => clear(s.at[0], s.at[1]))?.at ?? [cx, cz]!;

  const y = elevation + eye;
  const aimY = y - Math.max(0.12, Math.min(0.34, (room.height ?? 2.7) * 0.09));
  const dx = cx - x;
  const dy = aimY - y;
  const dz = cz - z;
  const len = Math.hypot(dx, dy, dz) || 1;

  return {
    x,
    y,
    z,
    // The camera looks down its local −Z, so yaw is `atan2(-dx, -dz)`, and
    // pitch is the rotation about X that puts `dy/len` into the forward vector.
    yaw: (Math.atan2(-dx, -dz) * 180) / Math.PI,
    pitch: (Math.asin(Math.max(-1, Math.min(1, dy / len))) * 180) / Math.PI,
  };
}

/**
 * Which room a world point is in.
 *
 * The smallest match wins: a plan may legitimately overlap rooms (the checks
 * report it when it happens, and a room placed over another still has to be
 * clickable), and the inner one is the one you are actually standing in.
 */
export function roomAt(
  x: number,
  z: number,
  rooms: RoomRect[],
  frame: PlanFrame,
  floorId?: string,
): RoomRect | null {
  let best: RoomRect | null = null;
  let bestArea = Infinity;
  for (const r of rooms) {
    if (floorId && r.floorId !== floorId) continue;
    const f = roomFootprint(r, frame);
    if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
    const area = r.width * r.depth;
    if (area < bestArea) {
      best = r;
      bestArea = area;
    }
  }
  return best;
}

/** Pitch beyond which the view is looking at the ceiling or the floor. */
export const PITCH_LIMIT = (86 * Math.PI) / 180;

/** Radians per pixel of pointer drag. */
export const LOOK_SENSITIVITY = 0.0032;

/** Look up or down, in radians per second, on Q and E. */
export const TURN_RATE = 1.9;

/**
 * Shortest signed difference between two angles, in degrees.
 *
 * Used to interpolate a flight's yaw: flying from 179° to −179° is a two-degree
 * turn, not a three-hundred-and-fifty-eight-degree one.
 */
export function shortestAngle(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}
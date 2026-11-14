/**
 * First-person camera collision.
 *
 * A walk-through where the camera passes through walls is worse than no
 * walk-through, so this is the module that decides whether the 3D view is
 * usable or embarrassing. Two properties matter and are tested separately:
 *
 *   1. the camera cannot end a move inside a solid, and
 *   2. approaching a wall at an angle *slides* along it rather than sticking.
 *
 * The second is the one that separates a walk-through from a shove.
 */
import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import {
  ACCEL,
  BOB,
  BOB_LATERAL,
  BOB_ROLL,
  CAMERA_RADIUS,
  DECEL,
  EYE_HEIGHT,
  STRIDE,
  WALK_SPEED,
  advanceWalk,
  approachVelocity,
  bob,
  bobPhase,
  bodyBand,
  canViewFromInside,
  clampToPlot,
  defaultInteriorRoom,
  flightSurfaces,
  floorAtElevation,
  floorUnder,
  groundSurfaces,
  hasFloorUnder,
  headingFromYaw,
  movementBasis,
  moveWithCollision,
  overlapsCollider,
  principalFloorId,
  roomAt,
  roomFootprint,
  roomViewpoint,
  shortestAngle,
  snapToFloor,
  standBackDistance,
  STEP_UP,
  walkableSurfaces,
  walkStart,
  wishVector,
  WALK_VERGE,
  type RoomRect,
  type WalkSurface,
} from './collision.ts';
import type { Collider } from './sceneModel.ts';

/** A 10 m long wall of zero thickness, running east–west at z = 0. */
const wall: Collider = { x: 0, z: 0, w: 10, d: 0.2 };
/** A solid block, for testing corners. */
const block: Collider = { x: 3, z: 3, w: 2, d: 2 };

describe('overlapsCollider', () => {
  it('detects a point well inside a rect', () => {
    expect(overlapsCollider(0, 0, wall, CAMERA_RADIUS)).toBe(true);
  });

  it('clears a point comfortably outside', () => {
    expect(overlapsCollider(0, 2, wall, CAMERA_RADIUS)).toBe(false);
  });

  it('detects a circle that overlaps a rect corner', () => {
    // The corner of the wall is at (5, 0.1). A camera at (5.2, 0.2) is 0.22
    // away — just inside the 0.26 radius.
    expect(overlapsCollider(5.2, 0.2, wall, CAMERA_RADIUS)).toBe(true);
    expect(overlapsCollider(5.4, 0.3, wall, CAMERA_RADIUS)).toBe(false);
  });

  it('measures from the rect edge, not the centre', () => {
    // 0.3 m from the wall's long face: inside the radius.
    expect(overlapsCollider(0, 0.2, wall, CAMERA_RADIUS)).toBe(true);
  });
});

describe('moveWithCollision', () => {
  it('moves freely through open space', () => {
    const r = moveWithCollision(0, 5, 0, -1, [wall]);
    expect(r.x).toBe(0);
    expect(r.z).toBe(4);
    expect(r.touching).toBe(false);
  });

  it('cannot walk through a wall', () => {
    // Starting 1 m north of the wall, walking 3 m south would end inside it.
    const r = moveWithCollision(0, 1, 0, -3, [wall]);
    expect(r.z).toBeGreaterThan(0.1);
    expect(overlapsCollider(r.x, r.z, wall, CAMERA_RADIUS)).toBe(false);
    expect(r.touching).toBe(true);
  });

  it('stops the camera a radius clear of the surface, not overlapping it', () => {
    const r = moveWithCollision(0, 1, 0, -3, [wall]);
    expect(r.z).toBeCloseTo(0.1 + CAMERA_RADIUS, 6);
  });

  it('slides along a wall instead of sticking to it', () => {
    // Approach the wall diagonally: south-east. The camera should end up pressed
    // against the wall but well along its length, not stopped short of it.
    const r = moveWithCollision(-2, 0.6, 2, -1, [wall]);
    expect(r.touching).toBe(true);
    expect(r.z).toBeCloseTo(0.1 + CAMERA_RADIUS, 6);
    // The eastward component must not have been cancelled by the collision.
    expect(r.x).toBeCloseTo(0, 6);
  });

  it('blocks one axis while still allowing the other', () => {
    // Straight into the wall: x is blocked, and there is no z to recover.
    const r = moveWithCollision(0, 0.5, 0, -1, [wall]);
    expect(r.x).toBe(0);
    expect(r.z).toBeCloseTo(0.1 + CAMERA_RADIUS, 6);
  });

  it('lets the camera slide along the length of a long wall', () => {
    // Running parallel to the wall should be unimpeded.
    const r = moveWithCollision(-4, 0.5, 4, 0, [wall]);
    expect(r.x).toBe(0);
    expect(r.z).toBeCloseTo(0.5, 9);
  });

  it('is a no-op for a zero-length move', () => {
    const r = moveWithCollision(1, 2, 0, 0, [wall, block]);
    expect(r.x).toBe(1);
    expect(r.z).toBe(2);
  });

  it('never lets a legal position end up inside a solid', () => {
    // The invariant that matters, checked over a grid of starts and step
    // directions rather than a handful of hand-picked cases. Only starts that
    // are *not* already penetrating count: moveWithCollision guarantees the
    // camera never enters a solid, which is not the same claim as being able to
    // escape one it is already inside — a single step cannot clear an obstacle
    // thicker than itself.
    const steps: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [-1, 0.7], [0.1, 0.1], [-3, 2]];
    let checked = 0;
    for (let sx = -2; sx <= 2; sx += 0.25) {
      for (let sz = -2; sz <= 2; sz += 0.25) {
        const legal = !overlapsCollider(sx, sz, wall, CAMERA_RADIUS) && !overlapsCollider(sx, sz, block, CAMERA_RADIUS);
        if (!legal) continue;
        for (const [dx, dz] of steps) {
          const r = moveWithCollision(sx, sz, dx, dz, [wall, block]);
          expect(overlapsCollider(r.x, r.z, wall, CAMERA_RADIUS)).toBe(false);
          expect(overlapsCollider(r.x, r.z, block, CAMERA_RADIUS)).toBe(false);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('does not tunnel through a wall no matter how long the step', () => {
    // The bug this guards: an endpoint-only test lets a 3 m step pass clean
    // through a 0.2 m wall, because the destination happens to be clear again.
    // Only the southbound steps actually threaten the wall; the northbound ones
    // walk away from it and must stay free.
    for (const step of [-2, -3, -10]) {
      const r = moveWithCollision(0, 2, 0, step, [wall]);
      expect(r.z).toBeCloseTo(0.1 + CAMERA_RADIUS, 6);
    }
    // A step that stops short of the wall must not be dragged to it.
    expect(moveWithCollision(0, 2, 0, -1, [wall]).z).toBeCloseTo(1, 6);
    for (const step of [0.5, 1, 3, 10]) {
      const r = moveWithCollision(0, 2, 0, step, [wall]);
      expect(r.z).toBeCloseTo(2 + step, 6);
      expect(r.touching).toBe(false);
    }
  });

  it('does not tunnel sideways through a wall either', () => {
    // The wall runs east–west, so a long east–west step runs *along* it and a
    // long north–south step crosses it. Crossing at an offset end exercises the
    // same swept test without the wall's own extent interfering.
    const post: Collider = { x: 0, z: 0, w: 0.2, d: 0.2 };
    for (const step of [-3, -10]) {
      const r = moveWithCollision(2, 0, step, 0, [post]);
      expect(r.x).toBeCloseTo(0.1 + CAMERA_RADIUS, 6);
      expect(overlapsCollider(r.x, r.z, post, CAMERA_RADIUS)).toBe(false);
    }
  });

  it('honours a filter so a floor the camera is not on cannot block it', () => {
    const upperOnly: Collider = { x: 0, z: 0, w: 10, d: 0.2 };
    const onGround = moveWithCollision(0, 1, 0, -3, [upperOnly], CAMERA_RADIUS, () => false);
    expect(onGround.z).toBe(-2);
    expect(onGround.touching).toBe(false);
  });

  it('respects a custom radius', () => {
    // Start clear of the wall, then walk into it with a wide body.
    const fat = moveWithCollision(0, 2, 0, -3, [wall], 1.0);
    expect(fat.z).toBeCloseTo(0.1 + 1.0, 6);
    expect(overlapsCollider(fat.x, fat.z, wall, 1.0)).toBe(false);
  });

  // The bug that made a front door un-walkable. A collider dropped `y` and `h`,
  // so the lintel over a doorway — a wall box from 2.4 m to 3 m, a metre above
  // the viewer's head — became an obstacle exactly as wide as the door and
  // sealed it. Walking up the path led to a blank elevation.
  describe('height', () => {
    /** The lintel over a doorway: full width of the door, well above head height. */
    const lintel: Collider = { x: 0, z: 0, w: 1.1, d: 0.23, y0: 2.4, y1: 3 };
    const standing = bodyBand(EYE_HEIGHT);

    it('walks under a collider that starts above head height', () => {
      const r = moveWithCollision(0, 1, 0, -3, [lintel], CAMERA_RADIUS, undefined, standing);
      expect(r.z).toBe(-2);
      expect(r.touching).toBe(false);
    });

    it('still blocks on a collider that reaches the body', () => {
      // The same box dropped to knee height, as a wall under a window sill is.
      const sill: Collider = { ...lintel, y0: 0, y1: 0.9 };
      const r = moveWithCollision(0, 1, 0, -3, [sill], CAMERA_RADIUS, undefined, standing);
      expect(r.z).toBeGreaterThan(0.1);
      expect(r.touching).toBe(true);
    });

    it('blocks on a collider that overlaps the head alone', () => {
      // A soffit at 1.5 m to 1.9 m: above the eye, below the top of the head.
      const soffit: Collider = { ...lintel, y0: 1.5, y1: 1.9 };
      const r = moveWithCollision(0, 1, 0, -3, [soffit], CAMERA_RADIUS, undefined, standing);
      expect(r.touching).toBe(true);
    });

    it('treats a collider with no declared height as solid', () => {
      // The conservative direction: unknown extent must block, never let through.
      const r = moveWithCollision(0, 1, 0, -3, [{ x: 0, z: 0, w: 1.1, d: 0.23 }], CAMERA_RADIUS, undefined, standing);
      expect(r.z).toBeGreaterThan(0.1);
      expect(r.touching).toBe(true);
    });

    it('lets a taller camera be stopped by a lower ceiling it stands under', () => {
      // Crouching under a 1.2 m beam: body [0.3, 1.44] overlaps it, so it blocks.
      const beam: Collider = { ...lintel, y0: 1.0, y1: 1.2 };
      const crouching = bodyBand(0.9);
      expect(crouching.y1).toBeGreaterThan(beam.y0!);
      expect(moveWithCollision(0, 1, 0, -3, [beam], CAMERA_RADIUS, undefined, crouching).touching).toBe(true);
    });
  });

  // The bug that froze the camera in the front doorway. `resolveAxis` reads
  // `from` and `other` as (x, z) on the x pass and as (z, x) on the z pass, so
  // passing them straight into `overlapsCollider(x, z, …)` asked whether the
  // camera penetrates a pier at a *transposed* location. The answer is almost
  // always no, so a camera that really was a millimetre into the jamb was told
  // it was only grazing it — and then frozen there for good.
  describe('the axis being resolved', () => {
    /** A pier: 2 m of wall from x 3 to 5, at z 0, full height. */
    const pier: Collider = { x: 4, z: 0, w: 2, d: 0.2, y0: 0, y1: 3 };
    const standing = bodyBand(EYE_HEIGHT);

    // 0.185 from the pier's corner: inside the 0.26 radius, so the camera is
    // genuinely penetrating and must be pushed clear, not held.
    const insideX = 2.88;
    const insideZ = -0.24;
    expect(overlapsCollider(insideX, insideZ, pier, CAMERA_RADIUS)).toBe(true);

    it('pushes a camera through when it is moving along z', () => {
      const r = moveWithCollision(insideX, insideZ, 0, 0.5, [pier], CAMERA_RADIUS, undefined, standing);
      expect(r.z).toBeGreaterThan(0.1);
      expect(r.z).not.toBeLessThan(insideZ);
    });

    it('pushes a camera through when it is moving along x', () => {
      // The same situation resolved on the other axis, which always worked —
      // the guard against over-correcting the fix into the x pass.
      const r = moveWithCollision(-0.24, -0.18, 0.5, 0, [pier], CAMERA_RADIUS, undefined, standing);
      expect(r.x).toBeGreaterThan(0.1);
      expect(r.x).not.toBeLessThan(-0.24);
    });

    it('walks a camera through a doorway it is aligned with', () => {
      // Two piers with a 4 m gap between them; the camera is on the centre of
      // the gap and walks straight through, which is the whole point of a door.
      const left: Collider = { x: -4, z: 0, w: 2, d: 0.2, y0: 0, y1: 3 };
      const through = moveWithCollision(0, 1, 0, -3, [left, pier], CAMERA_RADIUS, undefined, standing);
      expect(through.z).toBe(-2);
      expect(through.touching).toBe(false);
    });

    it('stops at the nearest barrier, whichever order the colliders come in', () => {
      // Two walls on the line of travel, the near one first. Moving *towards*
      // them, the near wall is the one that has to stop the camera: taking
      // whichever constraint was applied last let a farther, more permissive
      // wall overrule the one actually in the way, and the camera passed
      // straight through the near one. Both orders must agree.
      const near: Collider = { x: 0, z: 0, w: 10, d: 0.2 };
      const far: Collider = { x: 0, z: 2, w: 10, d: 0.2 };
      const stop = (list: Collider[]) => moveWithCollision(0, -1, 0, 6, list).z;

      expect(stop([near, far])).toBeCloseTo(-(0.1 + CAMERA_RADIUS), 6);
      expect(stop([far, near])).toBeCloseTo(-(0.1 + CAMERA_RADIUS), 6);
      // And the near wall really is intact afterwards.
      const r = moveWithCollision(0, -1, 0, 6, [near, far]);
      expect(overlapsCollider(r.x, r.z, near, CAMERA_RADIUS)).toBe(false);
    });

    it('stops a camera that is not aligned with the gap', () => {
      // Close enough to the pier that it blocks — 0.22 m from its face, inside
      // the 0.26 radius — but tangent, not penetrating, so it must be held on
      // the near side rather than shoved through to the far one.
      const blocked = moveWithCollision(2.78, 1, 0, -3, [pier], CAMERA_RADIUS, undefined, standing);
      expect(blocked.z).toBeGreaterThan(0.1);
      expect(blocked.z).toBeLessThan(1);
      expect(overlapsCollider(blocked.x, blocked.z, pier, CAMERA_RADIUS)).toBe(false);
      expect(blocked.touching).toBe(true);
    });

    it('does not carry a camera through a wall it is already grazing', () => {
      // The regression: a camera pressed two centimetres into a wall counted as
      // one that was "penetrating" it, and the resolver carried it out the far
      // side — so it walked through the wall and out of the house. A wall
      // running north–south, so the camera is squarely in front of its face.
      const wall: Collider = { x: 4, z: 0, w: 0.2, d: 4, y0: 0, y1: 3 };
      const face = 4 - 0.1;
      const start = face - CAMERA_RADIUS + 0.02;
      expect(overlapsCollider(start, 0, wall, CAMERA_RADIUS)).toBe(true);

      const r = moveWithCollision(start, 0, 1, 0, [wall], CAMERA_RADIUS);
      expect(r.x, 'the camera went through the wall').toBeLessThan(face);
      expect(overlapsCollider(r.x, r.z, wall, CAMERA_RADIUS)).toBe(false);
    });
  });
});

describe('snapToFloor — upwards only', () => {
  const candidates = [
    { y: 0, x: 0, z: 0, w: 10, d: 10 },
    { y: 3, x: 0, z: 0, w: 10, d: 10 },
    { y: 6, x: 0, z: 0, w: 10, d: 10 },
  ];

  it('stays where it is when already on a surface', () => {
    expect(snapToFloor(3, candidates)).toBe(3);
  });

  it('rises to a surface just above the camera', () => {
    expect(snapToFloor(5.9, candidates)).toBe(6);
    expect(snapToFloor(2.8, candidates)).toBe(3);
  });

  it('refuses to drop the camera onto a lower storey', () => {
    // Pressing "down" on a landing must not fall through to the floor below.
    expect(snapToFloor(4, candidates)).toBe(4);
    expect(snapToFloor(10, candidates)).toBe(10);
  });

  it('refuses to shove the camera up onto a slab more than a step away', () => {
    expect(snapToFloor(0, candidates)).toBe(0);
    expect(snapToFloor(5, candidates)).toBe(5);
  });

  it('returns the input height when there are no surfaces', () => {
    expect(snapToFloor(2, [])).toBe(2);
  });
});

describe('walkableSurfaces', () => {
  it('keeps room slabs and decks, and drops walls, furniture and stair boxes', () => {
    const boxes = [
      { kind: 'room-slab', y: 0, x: 0, z: 0, w: 4, d: 4, h: 0.2 },
      { kind: 'deck', y: 0.94, x: 6, z: 6, w: 4, d: 3, h: 0.12 },
      // Drawn steps. Whether the camera can climb a flight must not depend on
      // how the renderer chose to draw it — `flightSurfaces` owns that.
      { kind: 'stair', y: 0.5, x: 2, z: 2, w: 1, d: 2, h: 0.05 },
      { kind: 'wall', y: 1, x: 0, z: 3, w: 4, d: 0.2, h: 3 },
      { kind: 'furniture', y: 0.5, x: 1, z: 1, w: 1, d: 1, h: 0.8 },
    ];
    const s = walkableSurfaces(boxes);
    expect(s).toHaveLength(2);
    expect(s.every((x) => x.y >= 0)).toBe(true);
    expect(s.some((x) => x.y === 0.5)).toBe(false);
  });

  it('reports the surface height as the top of the box', () => {
    const s = walkableSurfaces([{ kind: 'room-slab', y: 0, x: 0, z: 0, w: 4, d: 4, h: 0.2 }]);
    expect(s[0]!.y).toBeCloseTo(0.1, 9);
  });

  it('drops the ground paving the building stands on', () => {
    // The real numbers from `sceneModel`: the paving spans the whole envelope
    // with its top at +0.09, and the ground-floor room slab's top face is at
    // exactly the floor elevation of 0. Counting the paving would put the camera
    // 9 cm above the floor in every ground-floor room.
    const s = walkableSurfaces([
      { kind: 'slab', y: -0.09, x: 0, z: 0, w: 9, d: 11, h: 0.18 },
      { kind: 'room-slab', y: -0.1, x: 0, z: 0, w: 4, d: 4, h: 0.2 },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]!.y).toBeCloseTo(0, 9);
  });

  it('keeps a terrace deck, which really is a floor you stand on', () => {
    const s = walkableSurfaces([{ kind: 'deck', y: 0.94, x: 3, z: 3, w: 4, d: 3, h: 0.12 }]);
    expect(s).toHaveLength(1);
    expect(s[0]!.y).toBeCloseTo(1, 9);
  });
});

/**
 * The shape a generated two-storey house actually has, at the generator's own
 * numbers, and it is not the shape that reads naturally.
 *
 * `placeStair` takes `riserCount = round(rise / RISER)` with `RISER` = 0.18 and
 * `run = riserCount * GOING` with `GOING` = 0.26, so a 2.7 m storey is a 3.9 m
 * run. `roomSlab` puts a slab's top face at exactly the floor elevation, so the
 * ground floor is at 0, not 0.1.
 *
 * The packer subtracts the stairwell from *every* floor, so no room — and so no
 * slab — covers the shaft: the ground slab stops short of it, the first-floor
 * slab starts past it, and the flight is the only thing underfoot in between. A
 * fixture with one slab stacked over the other would test a building this
 * generator cannot make. And the shaft is *deeper* than the flight, so the
 * stretch of it beyond the head has nothing beneath it at all — that is the
 * void, and it is the case `hasFloorUnder` exists for.
 *
 *     ground slab  z ∈ [-5, -2]     top 0
 *     flight       z ∈ [-1.95, 1.95]  a slope from 0 to 2.7
 *     shaft, bare  z ∈ [1.95, 3]     nothing beneath, on either storey
 *     first floor  z ∈ [3, 6]       top 2.7
 */
const GOING = 0.26;
const RUN = 15 * GOING;
const FOOT = -RUN / 2;

/** Plan equals world for this fixture; `frameFor` only ever subtracts the origin. */
const identity = { tx: (x: number) => x, tz: (y: number) => y };

/** Both storeys' slabs plus the flight, exactly as the scene composes them. */
function twoStoreySurfaces(): WalkSurface[] {
  return [
    { y: 0, x: 0, z: -3.5, w: 6, d: 3 },
    { y: 2.7, x: 0, z: 4.5, w: 6, d: 3 },
    ...flightSurfaces(
      [{ floorId: 'ground', x: 0, y: 0, width: 1.4, run: RUN, direction: 1 }],
      identity,
      new Map([['ground', 0]]),
      new Map([['ground', 2.7]]),
    ),
  ];
}

/** Plan Z a fraction `t` of the way up the run, 0 at the foot and 1 at the head. */
const alongRun = (t: number) => FOOT + t * RUN;

describe('advanceWalk — climbing a flight, at any frame rate', () => {
  /**
   * A ground slab that meets the foot of the flight, the flight itself, and a
   * first floor beyond the bare stretch of the shaft — which is the shape the
   * generator makes, where the flight's own footprint is cut out of the slab
   * below it and the two meet exactly.
   */
  const world = {
    plot: { width: 40, depth: 40 },
    colliders: [] as Collider[],
    surfaces: [
      { y: 0, x: 0, z: (-5 + FOOT) / 2, w: 6, d: FOOT + 5 },
      { y: 2.7, x: 0, z: 4.5, w: 6, d: 3 },
      ...flightSurfaces(
        [{ floorId: 'ground', x: 0, y: 0, width: 1.4, run: RUN, direction: 1 }],
        identity,
        new Map([['ground', 0]]),
        new Map([['ground', 2.7]]),
      ),
    ] as WalkSurface[],
    floors: [
      { floorId: 'ground', elevation: 0 },
      { floorId: 'first', elevation: 2.7 },
    ],
  };

  /** Walk up the flight at `dt` seconds a frame, and report where it got to. */
  function climb(dt: number, frames: number) {
    let body = { x: 0, y: EYE_HEIGHT, z: -4.5, floorId: 'ground' as string | null };
    let vel = { x: 0, z: 0 };
    for (let i = 0; i < frames; i++) {
      vel = approachVelocity(vel, { x: 0, z: WALK_SPEED }, dt);
      const advanced = advanceWalk(body, vel, dt, world);
      body = advanced.body;
      vel = advanced.vel;
    }
    return body;
  }

  it('climbs the flight and arrives at the head of it', () => {
    const body = climb(1 / 60, 600);
    expect(body.z).toBeGreaterThan(FOOT);
    // Within a centimetre or two of the head: the camera stops at the top of
    // the flight rather than at its middle.
    expect(body.y - EYE_HEIGHT).toBeCloseTo(2.7, 1);
  });

  it('climbs the flight just as well on a machine drawing four frames a second', () => {
    // The complaint this answers: "in walk mode I still cannot climb the
    // staircase, I go straight through it".
    //
    // A quarter of a second a frame is a slow machine, and at walking pace a
    // move that long rises more than a riser in one go. The ramp is then not a
    // step but a ceiling, so it is refused — and because the camera is by then
    // standing over nothing at all, it is *stranded*, which is allowed to move
    // regardless. The result is the camera sailing up the inside of the
    // staircase at the height of its foot, and the storey above never reached.
    //
    // The movement is integrated in small steps, so the height the camera
    // reaches does not depend on how fast the machine draws it.
    const body = climb(1 / 4, 120);
    expect(body.y - EYE_HEIGHT).toBeCloseTo(2.7, 1);
  });

  it('climbs at every frame rate it might meet', () => {
    for (const dt of [1 / 120, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1]) {
      const body = climb(dt, Math.ceil(6 / dt));
      expect(body.y - EYE_HEIGHT, `the climb failed at ${dt.toFixed(3)} s a frame`).toBeCloseTo(2.7, 1);
    }
  });
});

describe('floorUnder — what is underfoot', () => {
  const surfaces = twoStoreySurfaces();

  it('stands on the ground slab rather than being pushed up to the ceiling', () => {
    expect(floorUnder(0, -3.5, 0, surfaces)).toBeCloseTo(0, 9);
  });

  it('climbs: the eye rises all the way up the run', () => {
    let feet = 0;
    let last = -1;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      feet = floorUnder(0, alongRun(t), feet, surfaces);
      expect(feet, `the height fell at ${t} of the way up`).toBeGreaterThanOrEqual(last - 1e-9);
      last = feet;
      // The slope is continuous: whatever the camera is standing on is never
      // more than one frame's travel above the feet, which is what `STEP_UP`
      // exists to guarantee.
      expect(feet).toBeLessThanOrEqual(t * 2.7 + STEP_UP + 1e-9);
    }
    expect(feet).toBeCloseTo(2.7, 9); // the head of the flight, at the first floor
  });

  it('climbs straight from the foot onto the first tread, with no gap to fall in', () => {
    // The bug this replaces: fifteen thin tread boxes had to line up. If even one
    // was missed the camera walked through the flight at a constant height.
    expect(floorUnder(0, FOOT, 0, surfaces)).toBeCloseTo(0, 9);
    expect(floorUnder(0, FOOT + 0.05, 0, surfaces)).toBeGreaterThan(0);
  });

  it('descends as well as climbs', () => {
    let feet = 2.7;
    let last = Infinity;
    for (let i = 40; i >= 0; i--) {
      feet = floorUnder(0, alongRun(i / 40), feet, surfaces);
      expect(feet, `the height rose while descending at ${i / 40}`).toBeLessThanOrEqual(last + 1e-9);
      last = feet;
    }
    expect(feet).toBeCloseTo(0, 9);
  });

  it('lands on the first floor on stepping off the head of the flight', () => {
    expect(floorUnder(0, 3.2, 2.7, surfaces)).toBeCloseTo(2.7, 9);
  });

  it('leaves the camera where it is when nothing is beneath it', () => {
    // In the bare stretch of shaft: no ground slab, no first-floor slab, no
    // flight. Unchanged is the only safe answer — falling is not an option and
    // snapping to the origin would teleport the viewer.
    expect(floorUnder(0, 2.5, 2.7, surfaces)).toBeCloseTo(2.7, 9);
    expect(floorUnder(40, 40, 0, surfaces)).toBeCloseTo(0, 9);
    expect(floorUnder(0, 0, 0, [])).toBeCloseTo(0, 9);
  });
});

describe('flightSurfaces', () => {
  const stair = { floorId: 'ground', x: 4, y: 6, width: 1.4, run: RUN, direction: 1 as const };

  it('puts the low end of an ascending flight at the min-Z end of the run', () => {
    const [f] = flightSurfaces([stair], { tx: (x) => x - 10, tz: (y) => y - 8 }, new Map([['ground', 0]]), new Map([['ground', 2.7]]));
    expect(f!.ramp!.from).toBeCloseTo(0, 9);
    expect(f!.ramp!.to).toBeCloseTo(2.7, 9);
  });

  it('reverses for a flight descending out of its floor', () => {
    const [f] = flightSurfaces([{ ...stair, direction: -1 }], identity, new Map([['ground', 5.4]]), new Map([['ground', 2.7]]));
    // Descending from 5.4 by a 2.7 storey: high at the min-Z end, low at the max-Z.
    expect(f!.ramp!.from).toBeCloseTo(5.4, 9);
    expect(f!.ramp!.to).toBeCloseTo(2.7, 9);
  });

  it('uses the frame, and the storey the flight leaves', () => {
    const [f] = flightSurfaces([{ ...stair, floorId: 'first' }], { tx: (x) => x - 10, tz: (y) => y - 8 }, new Map([['first', 2.7]]), new Map([['first', 2.7]]));
    expect(f!.x).toBeCloseTo(-6, 9);
    expect(f!.z).toBeCloseTo(-2, 9);
    expect(f!.ramp!.from).toBeCloseTo(2.7, 9);
  });

  it('falls back to the floor-to-floor height when the flight has no rise of its own', () => {
    const [a] = flightSurfaces([stair], identity, new Map([['ground', 0]]), new Map([['ground', 3.1]]));
    const [b] = flightSurfaces([{ ...stair, rise: 3.1 }], identity, new Map([['ground', 0]]), new Map([['ground', 3.1]]));
    expect(a!.ramp!.to).toBeCloseTo(b!.ramp!.to, 9);
  });
});

describe('groundSurfaces — the ground walk mode stands on', () => {
  const plot = { width: 9, depth: 11 };

  it('covers the whole plot when there is no flight', () => {
    const s = groundSurfaces(plot, []);
    expect(s).toHaveLength(1);
    expect(s[0]!.w).toBeCloseTo(9, 9);
    expect(s[0]!.d).toBeCloseTo(11, 9);
    expect(s[0]!.y).toBe(0);
  });

  it('widens by the verge, so the pavement start is on it', () => {
    const s = groundSurfaces(plot, [], 1.5);
    expect(s[0]!.w).toBeCloseTo(12, 9);
    expect(s[0]!.d).toBeCloseTo(14, 9);
  });

  it('holes out exactly the footprint of a flight', () => {
    // This is the regression that matters, and it is the bug this function was
    // written for. Walk mode had no floor system at all, so adding one naively —
    // one flat plane at ground level under the whole plot — puts a surface at 0
    // directly beneath a flight climbing to 2.7. `floorUnder` takes the highest
    // candidate at or below the feet, so the plane wins at the foot and the
    // camera walks the length of the staircase at a constant height: through it.
    const flight = { y: 0, x: 3.5, z: -1.95, w: 1.2, d: 3.9, ramp: { from: 0, to: 2.7 } };
    const ground = groundSurfaces(plot, [flight]);
    const covered = (x: number, z: number) =>
      ground.some((c) => Math.abs(x - c.x) <= c.w / 2 && Math.abs(z - c.z) <= c.d / 2);

    expect(covered(3.5, -1.95)).toBe(false); // the middle of the run
    expect(covered(3.5, -3.5)).toBe(false); // the foot of it
    expect(covered(0, 0)).toBe(true); // the rest of the house
    expect(covered(0, 4)).toBe(true);
    // And the flight itself is still there to climb, built from the model: from
    // the foot, one step at a time, the ground rises all the way to the head.
    let feet = 0;
    for (let i = 0; i <= 40; i++) feet = floorUnder(3.5, -3.9 + (i / 40) * 3.9, feet, [flight]);
    expect(feet).toBeCloseTo(2.7, 9);
  });

  it('leaves no hole where two flights overlap the same strip', () => {
    const a = { y: 0, x: -2, z: 0, w: 1.2, d: 3.9, ramp: { from: 0, to: 2.7 } };
    const b = { y: 0, x: 0.5, z: 0, w: 1.2, d: 3.9, ramp: { from: 0, to: 2.7 } };
    const ground = groundSurfaces(plot, [a, b]);
    expect(ground.every((c) => c.w > 0.05 && c.d > 0.05)).toBe(true);
  });
});

describe('hasFloorUnder — refusing to walk into a void', () => {
  const surfaces = twoStoreySurfaces();

  it('is true on the ground floor, on the flight and on the first floor', () => {
    expect(hasFloorUnder(0, -3.5, 0, surfaces)).toBe(true);
    // Halfway up the run, at the height the slope actually is there.
    expect(hasFloorUnder(0, alongRun(0.5), 1.35, surfaces)).toBe(true);
    expect(hasFloorUnder(0, 4.5, 2.7, surfaces)).toBe(true);
  });

  it('is false over the bare stretch of the stairwell on the floor above', () => {
    // `floorUnder` alone would report "unchanged" there, which reads as
    // permission; this is the check that says no.
    expect(hasFloorUnder(0, 2.5, 2.7, surfaces)).toBe(false);
    // Beside the flight, over the ground-floor room below: not a void, and
    // saying so lets the camera drop a storey rather than stopping dead.
    expect(hasFloorUnder(2.5, -3.5, 2.7, surfaces)).toBe(true);
  });

  it('is true along the whole flight even from the first floor, because the slope is there', () => {
    for (let i = 0; i <= 20; i++) {
      const z = alongRun(i / 20);
      expect(hasFloorUnder(0, z, 2.7, surfaces), `no floor at ${z}`).toBe(true);
    }
  });

  it('does not freeze the camera when the building has no walkable surfaces at all', () => {
    // Refusing every move because the list is empty would strand the camera
    // where it was placed, which is worse than anything this guards against.
    expect(hasFloorUnder(0, 0, 0, [])).toBe(true);
  });
});

describe('floorAtElevation', () => {
  const storeys = [
    { floorId: 'ground', elevation: 0 },
    { floorId: 'first', elevation: 2.7 },
    { floorId: 'second', elevation: 5.4 },
  ];

  it('picks the storey the feet are on', () => {
    expect(floorAtElevation(0.1, storeys)).toBe('ground');
    expect(floorAtElevation(2.7, storeys)).toBe('first');
  });

  it('keeps the storey below while on a flight between two of them', () => {
    // A tread at 1.35 is between the ground and the first: treads carry the id
    // of the storey they are climbed from, and matching on that would keep the
    // camera on the ground floor's colliders all the way up.
    expect(floorAtElevation(1.35, storeys)).toBe('ground');
    expect(floorAtElevation(2.55, storeys)).toBe('ground');
  });

  it('hands over within a step of the storey above', () => {
    expect(floorAtElevation(2.55 + 0.27, storeys)).toBe('first');
  });

  it('is order-independent', () => {
    const shuffled = [storeys[1]!, storeys[2]!, storeys[0]!];
    expect(floorAtElevation(0.1, shuffled)).toBe('ground');
    expect(floorAtElevation(5.5, shuffled)).toBe('second');
  });

  it('has no answer below the lowest storey', () => {
    expect(floorAtElevation(-1, storeys)).toBeNull();
  });
});

describe('clampToPlot', () => {
  it('leaves a point inside the envelope alone', () => {
    expect(clampToPlot(3, 4, { width: 20, depth: 16 })).toEqual({ x: 3, z: 4 });
  });

  it('pulls a point outside back to the edge', () => {
    const r = clampToPlot(50, -50, { width: 20, depth: 16 });
    expect(r.x).toBeCloseTo(10 - 0.5, 9);
    expect(r.z).toBeCloseTo(-8 + 0.5, 9);
  });

  it('honours the margin', () => {
    expect(clampToPlot(99, 0, { width: 20, depth: 16 }, 2).x).toBe(8);
  });
});

describe('headingFromYaw', () => {
  it('converts degrees to radians', () => {
    expect(headingFromYaw(0)).toBe(0);
    expect(headingFromYaw(180)).toBeCloseTo(Math.PI, 12);
    expect(headingFromYaw(90)).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('where the walk camera starts', () => {
  /** A house 11 m wide × 5 m deep, centred on the origin, walls 0.2 m thick. */
  function house(): { building: Parameters<typeof walkStart>[0]; plot: { width: number; depth: number }; colliders: Collider[] } {
    const t = 0.1;
    return {
      building: { minX: -5.5, maxX: 5.5, minZ: -2.5, maxZ: 2.5, width: 11, height: 3 },
      plot: { width: 18, depth: 14 },
      colliders: [
        { x: 0, z: -2.5, w: 11, d: t * 2 },
        { x: 0, z: 2.5, w: 11, d: t * 2 },
        { x: -5.5, z: 0, w: t * 2, d: 5 },
        { x: 5.5, z: 0, w: t * 2, d: 5 },
      ],
    };
  }

  it('does not start inside the building', () => {
    const h = house();
    const start = walkStart(h.building, h.plot, h.colliders);
    for (const c of h.colliders) {
      expect(overlapsCollider(start.x, start.z, c, CAMERA_RADIUS), 'started inside a wall').toBe(false);
    }
  });

  it('starts in front of the front wall, not on top of it', () => {
    const h = house();
    const start = walkStart(h.building, h.plot, h.colliders);
    expect(start.z).toBeGreaterThan(h.building.maxZ + 2);
  });

  it('stays within the plot plus the verge', () => {
    const h = house();
    const start = walkStart(h.building, h.plot, h.colliders);
    expect(start.z).toBeLessThanOrEqual(h.plot.depth / 2 - 0.5 + WALK_VERGE);
  });

  it('backs off further for a narrower viewport, because the horizontal field of view is the binding one', () => {
    const h = house();
    const wide = walkStart(h.building, h.plot, h.colliders, CAMERA_RADIUS, 2.2, 68);
    const tall = walkStart(h.building, h.plot, h.colliders, CAMERA_RADIUS, 0.55, 68);
    expect(tall.z).toBeGreaterThan(wide.z);
  });

  it('reproduces the old bug if the start position is clamped back inside the plot', () => {
    // This is the regression itself. The camera used to be placed at
    // plot.depth / 2 + 2.4 and then clamped inside the plot on the next frame,
    // which put it inside the front wall. The clamp must no longer do that.
    const h = house();
    const start = walkStart(h.building, h.plot, h.colliders);
    const afterOneFrame = clampToPlot(start.x, start.z, h.plot, 0.6, WALK_VERGE);
    expect(afterOneFrame.z).toBeCloseTo(start.z, 6);
    expect(afterOneFrame.z).toBeGreaterThan(h.building.maxZ);
  });

  it('stands on the side the street is on, whichever side that is', () => {
    // The regression: taking the largest z unconditionally put the camera at
    // the back of the house on every plot whose street ran the other way —
    // facing a blank wall, in shadow, with the front door behind the viewer.
    const h = house();
    for (const street of [{ x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 0 }, { x: -1, z: 0 }]) {
      const start = walkStart(h.building, h.plot, h.colliders, CAMERA_RADIUS, 0.72, 68, street);
      const outward = start.x * street.x + start.z * street.z;
      // Beyond the building's far face on the street side, not short of it.
      const face = street.x !== 0 ? (street.x > 0 ? h.building.maxX : h.building.minX) : street.z > 0 ? h.building.maxZ : h.building.minZ;
      expect(outward, `street ${street.x},${street.z}`).toBeGreaterThan(face + 2);
      for (const c of h.colliders) {
        expect(overlapsCollider(start.x, start.z, c, CAMERA_RADIUS)).toBe(false);
      }
    }
  });
});

describe('standBackDistance', () => {
  it('grows with the thing it has to fit', () => {
    expect(standBackDistance(20, 3, 1.6, 60)).toBeGreaterThan(standBackDistance(8, 3, 1.6, 60));
  });

  it('grows as the viewport narrows', () => {
    expect(standBackDistance(10, 3, 0.6, 68)).toBeGreaterThan(standBackDistance(10, 3, 2.4, 68));
  });

  it('never returns a distance the camera could not actually see from', () => {
    const d = standBackDistance(12, 3, 0.72, 68);
    const hFov = 2 * Math.atan(Math.tan((68 * Math.PI) / 360) * 0.72);
    // The building's diagonal must fit inside the horizontal field of view.
    expect(d * 2 * Math.tan(hFov / 2)).toBeGreaterThanOrEqual(12);
  });
});

// ──────────────────────────────────────────────────── the inside camera ────

/** Plan → world, as `frameFor` produces it: the plot's centre is the origin. */
const frame = { tx: (x: number) => x - 10, tz: (y: number) => y - 8 };

const room = (over: Partial<RoomRect> = {}): RoomRect => ({
  id: 'r1',
  label: 'Living room',
  floorId: 'f0',
  kind: 'living',
  x: 2,
  y: 2,
  width: 6,
  depth: 5,
  height: 2.7,
  ...over,
});

/** The 6 × 5 living room, in plan coordinates. World footprint is −8..−2 × −6..−1. */
const big = room();

describe('roomFootprint', () => {
  it('moves the room rectangle into world space', () => {
    // Plan 2..8 by 2..7, on a 20 × 16 plot centred on the origin.
    expect(roomFootprint(room(), frame)).toMatchObject({
      minX: -8,
      maxX: -2,
      minZ: -6,
      maxZ: -1,
      cx: -5,
      cz: -3.5,
    });
  });
});

describe('canViewFromInside', () => {
  it('refuses outdoor spaces, garages and anything too small to stand in', () => {
    expect(canViewFromInside(room({ outdoor: true }))).toBe(false);
    expect(canViewFromInside(room({ kind: 'garage' }))).toBe(false);
    expect(canViewFromInside(room({ kind: 'balcony' }))).toBe(false);
    expect(canViewFromInside(room({ width: 0.4, depth: 4 }))).toBe(false);
    expect(canViewFromInside(room({ kind: 'bathroom', width: 2, depth: 2.4 }))).toBe(true);
  });
});

describe('defaultInteriorRoom', () => {
  it('opens on a living room rather than a larger hall', () => {
    const rooms = [
      room({ id: 'hall', label: 'Hall', kind: 'hall', width: 4, depth: 6 }),
      room({ id: 'living', label: 'Living room', kind: 'living' }),
    ];
    expect(defaultInteriorRoom(rooms)?.id).toBe('living');
  });

  it('opens on the ground floor, not on a larger storey above it', () => {
    // A big upstairs landing against a small ground-floor kitchen. Lowest wins:
    // you walk into a house at ground level.
    const rooms = [
      room({ id: 'k', floorId: 'f0', kind: 'kitchen', width: 3, depth: 3 }),
      room({ id: 'landing', floorId: 'f1', kind: 'hall', width: 8, depth: 6 }),
    ];
    const order = new Map([['f0', 0], ['f1', 1]]);
    expect(defaultInteriorRoom(rooms, order)?.id).toBe('k');
    expect(principalFloorId(rooms, order)).toBe('f0');
  });

  it('goes upstairs when the ground floor has nothing worth standing in', () => {
    const rooms = [
      room({ id: 'store', floorId: 'f0', kind: 'storage', width: 3, depth: 3 }),
      room({ id: 'bed', floorId: 'f1', kind: 'bedroom', width: 4, depth: 4 }),
    ];
    const order = new Map([['f0', 0], ['f1', 1]]);
    expect(defaultInteriorRoom(rooms, order)?.id).toBe('bed');
  });

  it('falls back to the biggest room when none is on the preferred list', () => {
    const rooms = [
      room({ id: 'small', label: 'Store', kind: 'storage', width: 2, depth: 2 }),
      room({ id: 'big', label: 'Workshop', kind: 'utility', width: 5, depth: 5 }),
    ];
    expect(defaultInteriorRoom(rooms)?.id).toBe('big');
  });

  it('returns nothing when there is nowhere to stand', () => {
    expect(defaultInteriorRoom([room({ outdoor: true })])).toBeNull();
    expect(defaultInteriorRoom([])).toBeNull();
  });
});

describe('roomViewpoint', () => {
  it('stands inside the room, clear of every wall', () => {
    const v = roomViewpoint(big, frame);
    const f = roomFootprint(big, frame);
    expect(v.x).toBeGreaterThan(f.minX + CAMERA_RADIUS);
    expect(v.x).toBeLessThan(f.maxX - CAMERA_RADIUS);
    expect(v.z).toBeGreaterThan(f.minZ + CAMERA_RADIUS);
    expect(v.z).toBeLessThan(f.maxZ - CAMERA_RADIUS);
    expect(v.y).toBeCloseTo(EYE_HEIGHT, 6);
  });

  it('stands in a corner, not on the centre line', () => {
    const f = roomFootprint(big, frame);
    const v = roomViewpoint(big, frame);
    const inset = CAMERA_RADIUS + 0.18;
    // Every corner is the same distance from the middle of a rectangle, so the
    // "furthest from the building's middle" sort cannot break the tie — it is
    // the first corner of the list, at +x +z.
    expect(v.x).toBeCloseTo(f.maxX - inset, 6);
    expect(v.z).toBeCloseTo(f.maxZ - inset, 6);
    // Standing in the middle and facing the far wall is the framing this
    // exists to avoid: in a room this size it fills the frame with one plane.
    expect(v.x).not.toBeCloseTo(f.cx, 2);
    expect(v.z).not.toBeCloseTo(f.cz, 2);
  });

  it('stands in the corner furthest from the middle of the building', () => {
    const f = roomFootprint(big, frame);
    const bc = { x: f.maxX + 6, z: f.maxZ + 6 };
    const v = roomViewpoint(big, frame, { buildingCentre: bc });
    // The building's middle is off past +x +z, so the camera is in the far
    // −x −z corner, looking back across the room toward it.
    const inset = CAMERA_RADIUS + 0.18;
    expect(v.x).toBeCloseTo(f.minX + inset, 6);
    expect(v.z).toBeCloseTo(f.minZ + inset, 6);
  });

  it('uses a corner in a room deeper than it is wide, too', () => {
    const tall = room({ width: 4, depth: 7 });
    const f = roomFootprint(tall, frame);
    const v = roomViewpoint(tall, frame);
    const inset = CAMERA_RADIUS + 0.18;
    expect([f.minX + inset, f.maxX - inset]).toContain(Number(v.x.toFixed(6)));
    expect([f.minZ + inset, f.maxZ - inset]).toContain(Number(v.z.toFixed(6)));
  });

  it('looks at the middle of the room', () => {
    const f = roomFootprint(big, frame);
    const v = roomViewpoint(big, frame);
    const d = Math.hypot(f.cx - v.x, f.cz - v.z);
    expect(d).toBeGreaterThan(0);
    // The camera looks down its local −Z, so with yaw 0 its forward vector in
    // world (x, z) is (−sin yaw, −cos yaw).
    expect(Math.sin((v.yaw * Math.PI) / 180)).toBeCloseTo(-(f.cx - v.x) / d, 6);
    expect(Math.cos((v.yaw * Math.PI) / 180)).toBeCloseTo(-(f.cz - v.z) / d, 6);
  });

  it('aims a little below eye level, so the floor is in shot', () => {
    const v = roomViewpoint(big, frame);
    expect(v.pitch).toBeLessThan(0);
    expect(v.pitch).toBeGreaterThan(-12);
  });

  it('stands on the storey it was told to', () => {
    expect(roomViewpoint(big, frame, { elevation: 3 }).y).toBeCloseTo(3 + EYE_HEIGHT, 6);
  });

  it('steps in off the corners when all four are occupied', () => {
    const f = roomFootprint(big, frame);
    const bc = { x: f.maxX + 6, z: f.maxZ + 6 };
    const inset = CAMERA_RADIUS + 0.18;
    const corners = (
      [
        [f.minX + inset, f.minZ + inset],
        [f.minX + inset, f.maxZ - inset],
        [f.maxX - inset, f.minZ + inset],
        [f.maxX - inset, f.maxZ - inset],
      ] as Array<[number, number]>
    ).map(([x, z]) => ({ x, z, w: 0.9, d: 0.9 }));
    const v = roomViewpoint(big, frame, { buildingCentre: bc, colliders: corners });
    for (const c of corners) expect(overlapsCollider(v.x, v.z, c, CAMERA_RADIUS)).toBe(false);
    // Moved off the wall and in towards the middle rather than standing in one.
    expect(Math.hypot(v.x - f.cx, v.z - f.cz)).toBeLessThan(
      Math.hypot(f.minX + inset - f.cx, f.minZ + inset - f.cz),
    );
  });

  it('still answers when the room is completely full', () => {
    const f = roomFootprint(big, frame);
    // Every candidate blocked: there is no legal answer to give.
    const solid = { x: f.cx, z: f.cz, w: f.maxX - f.minX, d: f.maxZ - f.minZ };
    const v = roomViewpoint(big, frame, { colliders: [solid] });
    // So it falls back to the middle rather than throwing — and returns a
    // real viewpoint either way.
    expect(Number.isFinite(v.x)).toBe(true);
    expect(Number.isFinite(v.z)).toBe(true);
    expect(Number.isFinite(v.yaw)).toBe(true);
  });

  it('views a room too small for corners from its middle', () => {
    const tiny = room({ width: 1, depth: 1 });
    const f = roomFootprint(tiny, frame);
    const v = roomViewpoint(tiny, frame);
    expect(v.x).toBeCloseTo(f.cx, 6);
    expect(v.z).toBeCloseTo(f.cz, 6);
  });
});

describe('roomAt', () => {
  it('names the room the camera is standing in', () => {
    const bed = room({ id: 'bed', label: 'Bedroom', x: 8, y: 2, width: 4, depth: 4 });
    const f = roomFootprint(big, frame);
    expect(roomAt(f.cx, f.cz, [big, bed], frame)?.label).toBe('Living room');
    const bf = roomFootprint(bed, frame);
    expect(roomAt(bf.cx, bf.cz, [big, bed], frame)?.label).toBe('Bedroom');
  });

  it('returns the smallest match, so a room placed over another is still named', () => {
    const inner = room({ id: 'inner', label: 'Alcove', x: 3, y: 3, width: 2, depth: 2 });
    const f = roomFootprint(inner, frame);
    expect(roomAt(f.cx, f.cz, [big, inner], frame)?.id).toBe('inner');
  });

  it('ignores rooms on other storeys when a floor is given', () => {
    const upstairs = room({ id: 'up', label: 'Bedroom', floorId: 'f1' });
    const f = roomFootprint(upstairs, frame);
    expect(roomAt(f.cx, f.cz, [upstairs], frame, 'f1')?.id).toBe('up');
    expect(roomAt(f.cx, f.cz, [upstairs], frame, 'f0')).toBeNull();
  });

  it('returns nothing outdoors', () => {
    const f = roomFootprint(big, frame);
    expect(roomAt(f.cx + 40, f.cz, [big], frame)).toBeNull();
  });
});

describe('shortestAngle', () => {
  it('takes the short way round the ±180° seam', () => {
    expect(shortestAngle(179, -179)).toBeCloseTo(2, 6);
    expect(shortestAngle(-179, 179)).toBeCloseTo(-2, 6);
  });

  it('leaves an ordinary turn alone', () => {
    expect(shortestAngle(0, 90)).toBeCloseTo(90, 6);
    expect(shortestAngle(90, 0)).toBeCloseTo(-90, 6);
    expect(shortestAngle(-10, 10)).toBeCloseTo(20, 6);
  });
});

// ─────────────────────────────────────────────────────── how it feels ──────────

/** A basis as `movementBasis` returns one, for a camera facing −Z. */
const NORTH = { fx: 0, fz: -1, rx: 1, rz: 0 };

describe('wishVector', () => {
  it('leaves a straight-ahead walk at exactly the top speed', () => {
    const w = wishVector(NORTH, 1, 0, WALK_SPEED);
    expect(Math.hypot(w.x, w.z)).toBeCloseTo(WALK_SPEED, 10);
  });

  it('does not go faster on the diagonal', () => {
    // The bug this replaces: forward and strafe are unit vectors on orthogonal
    // axes, so adding them gave √2 × the top speed. You could not walk a
    // straight line without drifting wide, and you overshot doorways.
    const diagonal = wishVector(NORTH, 1, 1, WALK_SPEED);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(WALK_SPEED, 10);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeLessThanOrEqual(WALK_SPEED + 1e-9);
  });

  it('still goes fast when only one key is held diagonally', () => {
    // Only a *full* diagonal is scaled. Half a diagonal should feel like a
    // gentle blend of the two, not like walking at half speed.
    const half = wishVector(NORTH, 1, 0.4, WALK_SPEED);
    const straight = wishVector(NORTH, 1, 0, WALK_SPEED);
    expect(Math.hypot(half.x, half.z)).toBeGreaterThan(Math.hypot(straight.x, straight.z) * 0.9);
  });

  it('preserves the input magnitude for anything under a full diagonal', () => {
    // Normalisation must only ever apply to a *full* diagonal. The inside
    // camera's scroll-wheel push is a deliberate fraction, and normalising by
    // the magnitude itself would turn any gentle nudge into a full-speed walk in
    // whatever direction the wheel happened to spin.
    for (const [fwd, strafe] of [
      [0.5, 0],
      [0.5, 0.5],
      [0.2, 0.2],
      [0, 0.75],
    ]) {
      const w = wishVector(NORTH, fwd, strafe, WALK_SPEED);
      expect(Math.hypot(w.x, w.z)).toBeCloseTo(WALK_SPEED * Math.hypot(fwd, strafe), 10);
    }
  });

  it('caps the magnitude at the top speed for every input', () => {
    // The invariant the diagonal fix exists to restore, checked over the whole
    // unit square of forward/strafe rather than at one hand-picked angle.
    for (let fwd = -1; fwd <= 1.001; fwd += 0.1) {
      for (let strafe = -1; strafe <= 1.001; strafe += 0.1) {
        const w = wishVector(NORTH, fwd, strafe, WALK_SPEED);
        expect(Math.hypot(w.x, w.z)).toBeLessThanOrEqual(WALK_SPEED + 1e-9);
      }
    }
  });

  it('stands still when no key is held', () => {
    expect(wishVector(NORTH, 0, 0, WALK_SPEED)).toEqual({ x: 0, z: 0 });
  });
});

describe('approachVelocity', () => {
  /** Runs the helper for `seconds` at `fps` and reports the wall-clock time to reach the wish. */
  function timeToPace(fps: number, wish: { x: number; z: number }): number {
    const dt = 1 / fps;
    let v = { x: 0, z: 0 };
    for (let t = 0; t < 10; t += dt) {
      v = approachVelocity(v, wish, dt);
      if (Math.hypot(v.x, v.z) >= Math.hypot(wish.x, wish.z) - 1e-9) return t + dt;
    }
    return Infinity;
  }

  it('reaches walking pace in the same wall-clock time at any frame rate', () => {
    // The whole point of moving at a rate in m/s² rather than a fixed fraction
    // of the gap: a machine drawing at 30 fps and one drawing at 240 have to
    // walk like the same person, not like two people with different hardware.
    const wish = { x: 0, z: -WALK_SPEED };
    const times = [30, 60, 120, 240].map((fps) => timeToPace(fps, wish));
    for (const t of times) expect(t).toBeLessThan(1);
    for (const t of times) expect(t).toBeCloseTo(times[0]!, 1);
  });

  it('accelerates at the stated rate in m/s²', () => {
    const dt = 1 / 60;
    const wish = { x: 0, z: -WALK_SPEED };
    const v = approachVelocity({ x: 0, z: 0 }, wish, dt);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(ACCEL * dt, 6);
  });

  it('stops faster than it starts — the asymmetry that reads as a body', () => {
    const toStart = timeToPace(60, { x: 0, z: -WALK_SPEED });
    const dt = 1 / 60;
    let v = { x: 0, z: -WALK_SPEED };
    let toStop = 0;
    for (let t = 0; t < 10; t += dt) {
      v = approachVelocity(v, { x: 0, z: 0 }, dt);
      toStop = t + dt;
      if (Math.hypot(v.x, v.z) === 0) break;
    }
    expect(DECEL).toBeGreaterThan(ACCEL);
    expect(toStop).toBeLessThan(toStart);
  });

  it('comes to a complete stop, rather than creeping toward the origin', () => {
    const dt = 1 / 60;
    let v = { x: 0, z: -WALK_SPEED };
    for (let i = 0; i < 200; i++) v = approachVelocity(v, { x: 0, z: 0 }, dt);
    expect(v).toEqual({ x: 0, z: 0 });
  });

  it('lands exactly on the wish vector when it can arrive this frame', () => {
    const v = approachVelocity({ x: 0, z: 0 }, { x: 0, z: -0.001 }, 1 / 60);
    expect(v).toEqual({ x: 0, z: -0.001 });
  });

  it('turns through still rather than pivoting on the spot', () => {
    // Reversing: opposite wish and velocity, so it has to decelerate to zero
    // and accelerate the other way. A pivot would be instantaneous and wrong.
    const dt = 1 / 60;
    let v = { x: 0, z: -WALK_SPEED };
    let minSpeed = Infinity;
    for (let i = 0; i < 120; i++) {
      v = approachVelocity(v, { x: 0, z: WALK_SPEED }, dt);
      minSpeed = Math.min(minSpeed, Math.hypot(v.x, v.z));
    }
    expect(minSpeed).toBeLessThan(WALK_SPEED * 0.05);
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(WALK_SPEED * 0.9);
  });

  it('changes heading at the accelerate rate, not the decelerate rate', () => {
    // Perpendicular wish at the same speed is neither opposed nor slower, so it
    // must take the accelerate path. Taking the decelerate path here is what
    // makes a strafing turn feel like hitting treacle.
    const dt = 1 / 60;
    const from = { x: WALK_SPEED, z: 0 };
    const v = approachVelocity(from, { x: 0, z: -WALK_SPEED }, dt);
    // This frame's change of velocity, which is exactly the rate applied.
    expect(Math.hypot(v.x - from.x, v.z - from.z)).toBeCloseTo(ACCEL * dt, 6);
    expect(Math.hypot(v.x - from.x, v.z - from.z)).toBeLessThan(DECEL * dt);
  });

  it('holds its pace while the heading sweeps round', () => {
    // The turn that actually happens when walking: the *camera* turns, so the
    // wish direction sweeps rather than jumping. Pace must be held throughout,
    // up to the fastest heading the body can actually produce.
    //
    // Worth distinguishing from an instantaneous jump in the input direction,
    // which does dip to 1/√2 of pace mid-turn. That is correct rather than a
    // bug — walking forward and sideways at once means the two components
    // partially cancel — and it cannot arise here, because there is no way to
    // re-aim the camera by 90° in a single frame.
    //
    // The ceiling is `ACCEL / WALK_SPEED` radians per second, ~202°/s: the
    // velocity vector can only turn as fast as it is accelerated around. It is
    // comfortably above any turn a person makes at a walking pace — Q/E turns
    // at 109°/s — and it is the one limit worth knowing about.
    const dt = 1 / 60;
    const ceilingDegPerSec = (ACCEL / WALK_SPEED) * (180 / Math.PI);
    expect(ceilingDegPerSec).toBeGreaterThan(180);
    for (const degPerSec of [30, 90, 180]) {
      let v = { x: 0, z: -WALK_SPEED };
      let slowest = Infinity;
      for (let i = 0; i * dt < 1; i++) {
        const a = (degPerSec * Math.PI) / 180 * i * dt;
        v = approachVelocity(v, { x: Math.sin(a) * WALK_SPEED, z: -Math.cos(a) * WALK_SPEED }, dt);
        slowest = Math.min(slowest, Math.hypot(v.x, v.z));
      }
      expect(slowest, `held pace turning at ${degPerSec}°/s`).toBeGreaterThan(WALK_SPEED * 0.999);
    }
  });

  it('trades pace for heading when whirled faster than the body can turn', () => {
    // The documented limit, asserted rather than left as a comment. A mouse
    // flick can outrun `ACCEL / speed`; the camera should then lag and settle
    // rather than keep its full speed pointing the wrong way.
    const dt = 1 / 60;
    let v = { x: 0, z: -WALK_SPEED };
    let slowest = Infinity;
    for (let i = 0; i * dt < 1; i++) {
      const a = (720 * Math.PI) / 180 * i * dt;
      v = approachVelocity(v, { x: Math.sin(a) * WALK_SPEED, z: -Math.cos(a) * WALK_SPEED }, dt);
      slowest = Math.min(slowest, Math.hypot(v.x, v.z));
    }
    expect(slowest).toBeLessThan(WALK_SPEED * 0.8);
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(0); // and recovers, rather than stopping dead
  });

  it('walks at the same speed whichever way it is facing', () => {
    // `movementBasis` is what feeds this, and it is only correct for every
    // heading if the wish vector is a unit-speed vector in every direction.
    // A heading where the walk came out slower — or reversed — is the bug this
    // whole function exists to prevent.
    const camera = new Object3D();
    const dt = 1 / 60;
    for (const yaw of [0, 0.7, 1.6, 2.4, 3.3, 4.7, 6.1]) {
      camera.rotation.set(0, yaw, 0, 'YXZ');
      camera.updateMatrixWorld(true);
      const basis = movementBasis(camera);
      const wish = wishVector(basis, 1, 0, WALK_SPEED);
      let v = { x: 0, z: 0 };
      for (let i = 0; i < 60; i++) v = approachVelocity(v, wish, dt);
      expect(Math.hypot(v.x, v.z), `top speed at yaw ${yaw}`).toBeCloseTo(WALK_SPEED, 6);
      // And it goes where the camera is pointed, not 180° off it.
      expect(Math.hypot(v.x * basis.fx + v.z * basis.fz)).toBeCloseTo(WALK_SPEED, 6);
    }
  });
});

describe('movementBasis', () => {
  it('keeps forward and right perpendicular and unit length', () => {
    // The property every walking control depends on, and the reason strafe
    // cannot drift into the forward axis at any heading.
    for (const yaw of [0, 0.4, 1.2, 2.6, 3.9, 5.5]) {
      const b = { fx: -Math.sin(yaw), fz: -Math.cos(yaw), rx: Math.cos(yaw), rz: -Math.sin(yaw) };
      expect(Math.hypot(b.fx, b.fz)).toBeCloseTo(1, 10);
      expect(Math.hypot(b.rx, b.rz)).toBeCloseTo(1, 10);
      expect(b.fx * b.rx + b.fz * b.rz).toBeCloseTo(0, 10);
    }
  });

  it('holds the last heading when looking straight up', () => {
    // Asking for a ground direction with no horizontal component would divide
    // by zero and send the camera off at a random angle.
    const camera = new Object3D();
    camera.rotation.set(-Math.PI / 2, 0, 0, 'YXZ');
    camera.updateMatrixWorld(true);
    const b = movementBasis(camera);
    expect(Math.hypot(b.fx, b.fz)).toBeCloseTo(1, 10);
  });
});

describe('head bob', () => {
  it('advances one full cycle per stride of ground covered', () => {
    // The bob is tied to distance rather than to time, so the phase after one
    // stride is one turn of the wheel whatever the frame rate or the pace.
    expect(bobPhase(0, STRIDE)).toBeCloseTo(Math.PI * 2, 10);
    expect(bobPhase(0, STRIDE / 4)).toBeCloseTo(Math.PI / 2, 10);
    expect(bobPhase(0, STRIDE * 3)).toBeCloseTo(Math.PI * 6, 10);
  });

  it('does not advance when no ground is covered', () => {
    // Walking into a wall covers nothing, so the camera must not shake. This
    // is the property a time-driven bob gets wrong, and it is the one that
    // makes a bob read as a gimmick rather than as a body.
    expect(bobPhase(1.234, 0)).toBeCloseTo(1.234, 12);
  });

  it('accumulates, rather than restarting each frame', () => {
    // Ten steps of a tenth of a stride each is one stride, not one tenth.
    let phase = 0;
    for (let i = 0; i < 10; i += 1) phase = bobPhase(phase, STRIDE / 10);
    expect(phase).toBeCloseTo(Math.PI * 2, 10);
  });

  it('is still at the bottom of the range for a real walk', () => {
    // 1.2 cm: felt on a long run, not thought about in a room. If this drifts
    // the bob has stopped being subtle, which is a design decision not a
    // number — so the number is pinned here rather than left to drift.
    expect(BOB).toBeCloseTo(0.012, 10);
    expect(BOB_LATERAL).toBeCloseTo(BOB * 0.55, 10);
    expect(BOB_ROLL).toBeCloseTo((0.3 * Math.PI) / 180, 12);
  });

  it('is a still camera when the pace is zero', () => {
    const b = bob(1.1, 0);
    expect(b.vertical).toBeCloseTo(0, 12);
    expect(b.lateral).toBeCloseTo(0, 12);
    expect(b.roll).toBeCloseTo(0, 12);
  });

  it('dips twice for every sway, because a body sways once per stride', () => {
    // The vertical is at the full frequency and the sway at half of it. This
    // is why the lateral term uses `sin(phase / 2)`.
    //
    // Over one stride the phase runs 0 → 2π. The sway goes out and back once
    // in that time — 0, out to its maximum at the half stride, and home to 0 —
    // while the vertical dips twice, down and up.
    const at = (phase: number) => bob(phase, 1);
    expect(at(0).lateral).toBeCloseTo(0, 12);
    expect(at(Math.PI).lateral).toBeCloseTo(BOB_LATERAL, 12);
    expect(at(Math.PI * 2).lateral).toBeCloseTo(0, 12);

    // The vertical is back to zero at every half stride, and reverses in
    // between — two dips per stride, against one sway.
    expect(at(0).vertical).toBeCloseTo(0, 12);
    expect(at(Math.PI / 2).vertical).toBeCloseTo(BOB, 12);
    expect(at(Math.PI).vertical).toBeCloseTo(0, 12);
    expect(at((Math.PI * 3) / 2).vertical).toBeCloseTo(-BOB, 12);
    expect(at(Math.PI * 2).vertical).toBeCloseTo(0, 12);
  });

  it('never moves the camera more than the amplitude says', () => {
    for (let phase = 0; phase < Math.PI * 8; phase += 0.05) {
      const b = bob(phase, 1);
      expect(Math.abs(b.vertical)).toBeLessThanOrEqual(BOB + 1e-12);
      expect(Math.abs(b.lateral)).toBeLessThanOrEqual(BOB_LATERAL + 1e-12);
      expect(Math.abs(b.roll)).toBeLessThanOrEqual(BOB_ROLL + 1e-12);
    }
  });

  it('scales the whole effect with pace', () => {
    const full = bob(0.9, 1);
    const half = bob(0.9, 0.5);
    expect(half.vertical).toBeCloseTo(full.vertical / 2, 12);
    expect(half.lateral).toBeCloseTo(full.lateral / 2, 12);
    expect(half.roll).toBeCloseTo(full.roll / 2, 12);
  });
});

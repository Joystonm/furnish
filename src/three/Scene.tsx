/**
 * The 3D view.
 *
 * Renders `buildScene(project)` — a pure function of the canonical model — so
 * it is always the same building the 2D plan shows. An edit in either view
 * mutates the model; there is no synchronisation step because there is no
 * second copy to synchronise.
 *
 * Four cameras, one scene:
 *   orbit      exterior, free
 *   top-down   orthographic-ish plan check in 3D
 *   walk       first person, pointer-locked, outdoors, from the pavement
 *   inside     first person inside the building, drag to look, room to room
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Html as DreiHtml, OrbitControls, PointerLockControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useProject, type CameraMode } from '../store/useProject.ts';
import { isTypingTarget, MOVEMENT_CODES, SCROLL_CODES } from '../keys.ts';
import { buildScene, EAVES_OVERHANG, STREET_DIR, frameFor, type Box, type SceneGeometry } from './sceneModel.ts';
import {
  environmentFromSky,
  materialFor,
  primitiveGeometry,
  setSurfaceQuality,
  skyTexture,
  surfaceRepeat,
  type SurfaceQuality,
} from './textures.ts';
import {
  DECAY,
  MAX_SOURCES,
  REACH,
  chooseSources,
  daylightSources,
  lightPosition,
} from './daylight.ts';
import type { Project } from '../model/types.ts';
import {
  CAMERA_RADIUS,
  EYE_HEIGHT,
  INDOOR_RUN_SPEED,
  INDOOR_SPEED,
  LOOK_SENSITIVITY,
  PITCH_LIMIT,
  RUN_SPEED,
  TURN_RATE,
  WALK_SPEED,
  WALK_VERGE,
  advanceWalk,
  approachVelocity,
  bob,
  bobPhase,
  canViewFromInside,
  defaultInteriorRoom,
  flightSurfaces,
  groundSurfaces,
  movementBasis,
  roomAt,
  roomViewpoint,
  shortestAngle,
  walkStart,
  walkableSurfaces,
  wishVector,
  type RoomRect,
  type WalkSurface,
} from './collision.ts';

export type { CameraMode };

/**
 * The head bob and its constants live in `collision.ts`, with the rest of the
 * gait, and are tested there. This file only decides when the camera moves.
 */
export interface SceneProps {
  cameraMode: CameraMode;
  showFurniture: boolean;
  showRoof: boolean;
  visibleFloorIds: string[] | null;
  onSelect?: (ownerId: string, kind: string) => void;
  /** Reports which room the inside camera is standing in. Fires on change. */
  onInsideRoom?: (label: string | null) => void;
}

/** Vertical field of view for each camera. Set imperatively — see `FirstPerson`. */
const WALK_FOV = 68;
const ORBIT_FOV = 38;
/**
 * Inside is wider than walk on purpose: you are a room away from the walls
 * rather than a building away, and the walls are the subject.
 */
const INSIDE_FOV = 75;
/** Degrees to radians. `roomViewpoint` reports in degrees, because that is how
 *  the room labels and the compass are written; the running camera state is in
 *  radians, because `camera.rotation` is. Everything crossing that boundary goes
 *  through here — mixing the two silently is what put the view on the floor. */
const DEG = Math.PI / 180;

// ─────────────────────────────────────────────────────────────── the boxes ────

/** Kinds that are the site rather than the building: flat, and never pickable. */
const SITE_KINDS = new Set(['lawn', 'paving', 'path']);

function BoxMesh({ box, onSelect, quality }: { box: Box; onSelect?: (id: string, kind: string) => void; quality: SurfaceQuality }) {
  const selection = useProject((s) => s.selection);
  const selected = box.ownerId ? selection.ids.includes(box.ownerId) : false;
  const [hovered, setHovered] = useState(false);
  const site = SITE_KINDS.has(box.kind);

  // Texture scale follows the part, so a 20 m roof and a 20 cm drawer front get
  // the same physical grain rather than the same single tile of picture.
  //
  // A box has three dimensions but each of its six faces shows two of them, and
  // which two depends on which way up the box is: a wall is drawn as length ×
  // height, a floor slab as length × depth. Taking the two *largest* dimensions
  // picks the right pair in both cases and is right for the narrow side faces
  // too, since those are strips a couple of centimetres across either way.
  //
  // This used to take the width and the height, which is exactly right for a
  // wall and badly wrong for anything flat. The lawn is a 30 m × 26 m slab ten
  // centimetres thick, so its second dimension came out as 0.1 m: the repeat
  // along that axis bottomed out at half a tile while the other ran to twelve,
  // and a map stretched fiftyfold in one direction and tiled twelve times in
  // the other is not grass. It came out combed into long furrows running away
  // from the camera. The roof and the paving were smeared the same way.
  const repeat = useMemo(() => {
    if (!box.surface) return null;
    const dims = [box.w, box.h, box.d].sort((a, b) => b - a);
    return surfaceRepeat(dims[0]!, dims[1]!);
  }, [box.surface, box.w, box.d, box.h]);

  // Hover and selection tint the surface rather than replacing the material,
  // so a highlighted sofa still has its fabric grain while it is highlighted.
  //
  // `quality` is in the dependency list and it is not optional. react-three-fiber
  // mounts the children *before* `onCreated` runs, so the first pass built every
  // material while `textures.ts` still believed it was in draft mode and cached
  // albedo-only textures. `onCreated` then set the real quality, which cleared
  // that cache — but a `useMemo` whose box is unchanged returns the material it
  // already built, so the normal and roughness maps were silently discarded and
  // the realistic path rendered exactly like the draft one. Depending on the
  // quality is what makes the rebuild actually happen.
  // Selection and hover tints.
  //
  // Blue for selection, deliberately, and in the same family as the 2D plan's
  // selection blue. Both views marking the same thing in the same colour is the
  // point — a selection that changed hue when you changed view reads as two
  // different selections. It is a clean azure rather than the plan's #2563eb
  // because this one *replaces* the material colour rather than drawing a line
  // over it, so it has to stay light enough for the part's own shading to read
  // through it.
  //
  // Hover is a neutral, not a tint: it says "there is something here" and
  // nothing more, so it should not imply a second meaning on top of the one
  // selection already carries.
  const material = useMemo(
    () =>
      materialFor({
        surface: box.surface,
        color: selected ? '#6f9de8' : hovered ? '#d9dbde' : box.color,
        roughness: box.roughness,
        metalness: box.metalness,
        opacity: box.opacity,
        glass: box.glass,
        repeat: repeat ?? undefined,
      }),
    [box.surface, box.color, box.roughness, box.metalness, box.opacity, box.glass, selected, hovered, repeat, quality],
  );

  const rotation: [number, number, number] = [
    ((box.rx ?? 0) * Math.PI) / 180,
    (box.ry * Math.PI) / 180,
    ((box.rz ?? 0) * Math.PI) / 180,
  ];

  // Geometry is cached and shared by every identical part — a house full of
  // cushions wants one cushion mesh's worth of vertices, not forty. It is
  // passed as a prop rather than as a `<primitive>` child because a shared
  // object handed to `<primitive>` is owned by the renderer, and one mesh
  // unmounting takes the geometry out from under the others still using it.
  const geometry = useMemo(
    () => primitiveGeometry(box.shape, box.w, box.h, box.d, box.round ?? 0),
    [box.shape, box.w, box.h, box.d, box.round],
  );

  return (
    <mesh
      position={[box.x, box.y, box.z]}
      rotation={rotation}
      geometry={geometry}
      material={material}
      castShadow={!site && box.kind !== 'glass'}
      receiveShadow={!box.noReceiveShadow}
      onClick={(e) => {
        if (site) return;
        e.stopPropagation();
        if (box.ownerId) onSelect?.(box.ownerId, box.kind);
      }}
      onPointerOver={(e) => {
        if (site) return;
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = '';
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────── swinging doors ───

/**
 * How far away a door starts to open, and how fast it moves.
 *
 * The radius is the point at which a door has to get out of your way: you have
 * to be able to walk straight at one without steering. Two metres is a shade
 * over a comfortable arm's length plus a step, so the door is already swinging
 * before you reach the threshold — which is what makes it read as a door rather
 * than as a trapdoor.
 */
const DOOR_TRIGGER = 2.0;
/** Fully open, in degrees. Just past a right angle so the leaf clears the jamb. */
const DOOR_OPEN = 95;
/** Radians per second at which the leaf turns. */
const DOOR_RATE = 3.4;

/**
 * One door leaf, pivoting on its hinge, opening as the walker comes near.
 *
 * The parts are drawn from their hinge-relative offsets (`dx`/`dz`) rather than
 * their world coordinates, and the whole group carries the wall's yaw. That
 * split is the point: it means a single `rotation.y` on the group swings the
 * leaf, its panels and its handle together and in the right direction, with no
 * per-frame trigonometry at all.
 */
function SwingDoorLeaf({
  door,
  walker,
  quality,
}: {
  door: SceneGeometry['doors'][number];
  walker: React.RefObject<{ x: number; y: number; z: number } | null>;
  quality: SurfaceQuality;
}) {
  const group = useRef<THREE.Group>(null);
  const open = useRef(0);

  // Distance to the leaf itself rather than to the hinge, so a door swings when
  // you are in front of it rather than when you are beside the post. This is the
  // leaf's centre put back into world space: `dx` is measured along the leaf
  // from the hinge, and the leaf sits at `ry`, so it has to be turned by that
  // to get back to where the viewer sees it.
  const mid = useMemo(() => {
    const leaf = door.parts[0];
    if (!leaf) return { x: door.hinge.x, z: door.hinge.z };
    const a = (door.ry * Math.PI) / 180;
    return {
      x: door.hinge.x + (leaf.dx ?? 0) * Math.cos(a),
      z: door.hinge.z - (leaf.dx ?? 0) * Math.sin(a),
    };
  }, [door]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const w = walker.current;

    const dist = w ? Math.hypot(mid.x - w.x, mid.z - w.z) : Infinity;
    const want = dist < DOOR_TRIGGER ? 1 : 0;
    // Frame-rate independent, and clamped so a backgrounded tab does not snap
    // the leaf from shut to wide open on the frame it comes back.
    const step = DOOR_RATE * Math.min(delta, 0.1);
    open.current += Math.max(-step, Math.min(step, want - open.current));

    const deg = open.current * DOOR_OPEN * door.swingSign;
    g.rotation.y = (door.ry * Math.PI) / 180 + (deg * Math.PI) / 180;
  });

  return (
    <group ref={group} position={[door.hinge.x, door.hinge.y, door.hinge.z]} rotation={[0, (door.ry * Math.PI) / 180, 0]}>
      {door.parts.map((b, i) => (
        <DoorPartMesh key={`${door.id}:${i}`} box={b} quality={quality} />
      ))}
    </group>
  );
}

/**
 * One part of a leaf, drawn at its offset from the hinge.
 *
 * Deliberately not `BoxMesh`: that positions from `box.x`/`box.z`, which for a
 * swinging part are the *world* coordinates and would be measured from the
 * origin rather than from the group's pivot — the leaf would fly off twice its
 * own distance as it turned.
 */
function DoorPartMesh({ box, quality }: { box: Box; quality: SurfaceQuality }) {
  const material = useMemo(
    () =>
      materialFor({
        surface: box.surface,
        color: box.color,
        roughness: box.roughness,
        metalness: box.metalness,
        opacity: box.opacity,
        glass: box.glass,
      }),
    [box.surface, box.color, box.roughness, box.metalness, box.opacity, box.glass, quality],
  );
  const geometry = useMemo(
    () => primitiveGeometry(box.shape, box.w, box.h, box.d, box.round ?? 0),
    [box.shape, box.w, box.h, box.d, box.round],
  );
  return (
    <mesh
      position={[box.dx ?? 0, box.dy ?? 0, box.dz ?? 0]}
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow={!box.noReceiveShadow}
    />
  );
}

/** Everything the model says, as one batch of instanced-looking meshes. */
function Building({ boxes, onSelect, quality }: { boxes: Box[]; onSelect?: (id: string, kind: string) => void; quality: SurfaceQuality }) {
  return (
    <group>
      {boxes.map((b, i) =>
        // Door leaves carry a `swingId` and are drawn by `SwingDoors`, pivoting
        // on their hinge. Rendering them here as well would draw every leaf
        // twice: once in place, and once swinging away from it.
        b.swingId ? null : (
          <BoxMesh key={`${b.kind}:${b.ownerId ?? 'x'}:${i}`} box={b} onSelect={onSelect} quality={quality} />
        ),
      )}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────── ground ───────

function Ground({ width, depth, setbacks }: { width: number; depth: number; setbacks: { front: number; rear: number; left: number; right: number } }) {
  const buildableW = Math.max(0, width - setbacks.left - setbacks.right);
  const buildableD = Math.max(0, depth - setbacks.front - setbacks.rear);
  return (
    <group>
      {/* The far ground, out past the lawn the scene model draws. Its own edge
          used to land inside the fog's near distance, so the site ended on a
          hard diagonal line against the sky; it now runs far enough out that
          the fog closes over it first. It is deliberately not *too* far: at
          forty plot-widths the plane reached three hundred and sixty metres
          and the fog had a hundred and sixty-five to work with, so almost the
          whole middle distance stayed full-saturation green and the backdrop
          read as one flat field of lawn behind the house rather than as land
          running away into haze. Twenty plot-widths puts the horizon where the
          fog has already closed, so the green band ends in distance instead of
          ending at the edge of the world. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.36, 0]} receiveShadow>
        <planeGeometry args={[Math.max(width, depth) * 20, Math.max(width, depth) * 20]} />
        {/* Matched to the lawn the scene model draws — hue AND value. A
            different green here meant the building's cast shadow fell across
            two surfaces of clearly different hue, so shaded ground read as a
            grey slab laid over the site rather than as grass in shade.

            Both are the same hue (82°), this one a few percent lighter and a
            little less saturated: it is further away, it is flat-lit, and the
            fog has most of the chroma out of it by the time you see it. The
            value gap is deliberately narrow — five points of lightness, where
            it used to be thirteen — because a wide one draws a visible band at
            the edge of the lawn instead of letting it recede. */}
        <meshStandardMaterial color="#8e997a" roughness={1} />
      </mesh>
      {/* Setback boundary, the one line on site that is genuinely a rule. */}
      <lineSegments position={[0, -0.24, 0]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(buildableW, buildableD).rotateX(-Math.PI / 2)]} />
        <lineBasicMaterial color="#8a8d90" />
      </lineSegments>
    </group>
  );
}

// ─────────────────────────────────────────────────────────── first person ─────

interface WalkState {
  pos: { x: number; y: number; z: number };
  vel: { x: number; z: number };
  keys: Record<string, boolean>;
  /**
   * The storey the camera is standing on, by elevation.
   *
   * This camera had none until now, which is the whole of the "I walk straight
   * through the staircase" bug: `pos.y` was written once at mount and never
   * again, so the eye stayed at `EYE_HEIGHT` from the pavement to the top floor
   * and a flight of stairs had nothing it could do about it. Every fix for that
   * was made to `InsideView`, which is a different camera — this one is what the
   * "walk" button mounts, and it was never touched.
   */
  floorId: string | null;
  /**
   * Head-bob phase in radians, advanced by ground covered rather than by time.
   *
   * Distance, not seconds, is what makes the bob gait-accurate: it cannot fall
   * out of step with the stride, it stops dead when the walker stops because
   * nothing is advancing it, and it doubles when the walker runs because twice
   * the ground goes by. A time-driven bob does all three wrong.
   */
  bob: number;
  /** Drag-to-look state, the fallback for when pointer lock is not engaged. */
  dragging: boolean;
  downAt: { x: number; y: number } | null;
  lastAt: { x: number; y: number } | null;
}

function FirstPerson({
  colliders,
  surfaces,
  elevationOf,
  plot,
  building,
  street,
  entrance,
  walker,
  onExit,
}: {
  colliders: ReturnType<typeof buildScene>['colliders'];
  /**
   * Everything the camera can stand on — slabs, decks, the ground it walks in
   * on, and one ramp per flight.
   *
   * This camera had no floor of any kind until now. It wrote `pos.y` once at
   * mount and never touched it again, so the eye stayed at `EYE_HEIGHT` from
   * the pavement to the top floor and the staircase had nothing it could do
   * about it. The fix belongs to whichever camera the "walk" button mounts, and
   * this is that one.
   */
  surfaces: WalkSurface[];
  /** Floor id to elevation, so the camera can tell which storey it has reached. */
  elevationOf: Map<string, number>;
  plot: { width: number; depth: number };
  building: SceneGeometry['building'];
  street: { x: number; z: number };
  entrance: SceneGeometry['entrance'];
  /**
   * Where the camera is, published for anything that has to react to it.
   *
   * A ref rather than state on purpose: the swinging doors read this every
   * frame, and re-rendering the whole scene tree sixty times a second to move a
   * door would cost far more than the doors do. A ref is written in `useFrame`
   * and read in another `useFrame`, which is exactly this use.
   */
  walker: React.RefObject<{ x: number; y: number; z: number } | null>;
  onExit: () => void;
}) {
  const { camera, size, gl } = useThree();
  const state = useRef<WalkState>({
    pos: { x: 0, y: EYE_HEIGHT, z: 0 },
    vel: { x: 0, z: 0 },
    keys: {},
    floorId: null,
    bob: 0,
    dragging: false,
    downAt: null,
    lastAt: null,
  });
  const [hud, setHud] = useState({ locked: false, touching: false });

  /**
   * The storeys by elevation, read once per rebuild.
   *
   * `floorAtElevation` is order-independent, so this is only for reading — but
   * it has to be recomputed rather than cached on the state, because a plan
   * regenerated under an open walk leaves a stale list that would keep the
   * camera on the floor it left.
   */
  const storeys = useMemo(() => [...elevationOf].map(([floorId, elevation]) => ({ floorId, elevation })), [elevationOf]);

  /**
   * Live floor readout.
   *
   * "I walk through the staircase" has three causes that look identical from
   * outside — no floor at all, a floor at the wrong height, or the right floor
   * out of reach — and none of them can be told apart by looking at the render.
   * This names all three in one line. Throttled to about seven a second: it is
   * the only thing in the frame loop that calls back into React, and a readout
   * that re-renders the view every frame to show an unchanged number costs more
   * than it tells you.
   */
  const [probe, setProbe] = useState('');
  const probedAt = useRef(0);
  const flightCount = useMemo(() => surfaces.filter((c) => c.ramp).length, [surfaces]);

  // Start on the pavement, back from the front wall, looking at the house.
  //
  // This used to be a fixed `plot.depth / 2 + 2.4`, which the per-frame clamp
  // then dragged back inside the plot on the very next frame — a 3 m teleport
  // that put the camera inside the front wall. `walkStart` derives the position
  // from the geometry and the viewport's own field of view instead, and
  // guarantees it is clear of every collider.
  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera;
    // The Canvas declares a different fov per mode, but R3F only applies that
    // to the camera when it creates it — switching modes left the camera on
    // the orbit camera's 38°. Framing was computed for 68°, so walk mode came
    // out at nearly twice the intended closeness: a wall at point-blank range.
    if (persp.fov !== WALK_FOV) {
      persp.fov = WALK_FOV;
      persp.updateProjectionMatrix();
    }
    const aspect = size.width / Math.max(1, size.height);
    const start = walkStart(building, plot, colliders, CAMERA_RADIUS, aspect, WALK_FOV, street);
    state.current.pos = { x: start.x, y: EYE_HEIGHT, z: start.z };
    state.current.vel = { x: 0, z: 0 };
    state.current.bob = 0;
    camera.position.set(start.x, EYE_HEIGHT, start.z);
    // YXZ, because that is the order three-stdlib's `PointerLockControls` reads
    // and writes: it round-trips `camera.quaternion` through an Euler of this
    // order on every locked mouse move. Leaving the camera on three's default
    // XYZ means the first mouse movement after engaging the pointer silently
    // rewrites the pitch and yaw this mode just set.
    camera.rotation.order = 'YXZ';
    // Aim at the front door, not at the middle of the building.
    //
    // This used to look at `building.cx/cz`, which on any house whose entrance
    // is off-centre — which is nearly all of them — points the viewer at a blank
    // stretch of wall. The first thing they press is W, the first thing they hit
    // is that wall, and the "Blocked — turn or step back" message tells them
    // nothing about which way to turn. Facing the door makes the first press of
    // W walk you to the entrance instead of into it.
    camera.lookAt(entrance?.x ?? building.cx, EYE_HEIGHT, entrance?.z ?? building.cz);
    // Keyed on the geometry, not the collider array, or every new piece of
    // furniture would yank the camera back to the doorstep mid-walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, size.width, size.height, building.minX, building.maxX, building.minZ, building.maxZ, building.cx, building.cz, building.width, building.height, plot.width, plot.depth, street.x, street.z, entrance?.x, entrance?.z]);

  useEffect(() => {
    const s = state.current;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return;
      // Typing "wasd" into the brief used to walk the viewer through their own
      // house, because the camera asked nothing about where the keystroke came
      // from. The editor shortcuts have guarded on this since the start; the
      // cameras are the other half of the same key.
      if (isTypingTarget(e.target)) return;
      // Arrows scroll, and held they scroll forever — behind the canvas, which
      // in a camera mode is not what the user is reading.
      if (SCROLL_CODES.has(e.code)) e.preventDefault();
      // Only the keys this camera actually drives. Without it every keystroke
      // anywhere in the application lands in this map, and the object it keys
      // grows for as long as the mode is open.
      if (MOVEMENT_CODES.has(e.code)) s.keys[e.code] = true;
    };
    const up = (e: KeyboardEvent) => {
      s.keys[e.code] = false;
    };
    // A browser never delivers the keyup for a key held when the window lost
    // focus, so `keys` keeps saying W is down and the camera walks off on its
    // own the moment the user comes back. Alt-tab is not a rare event.
    const release = () => {
      for (const code of Object.keys(s.keys)) s.keys[code] = false;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') release();
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /**
   * Drag to look around, for when the pointer is not locked.
   *
   * Pointer lock needs a click and eats the cursor, which makes it a poor way to
   * have a look at something — you cannot click and drag from a menu and you
   * cannot fine-adjust a heading. This is the fallback for exactly that, and it
   * is inert while the pointer *is* locked: under pointer lock the browser
   * delivers no `pointermove` to the page at all, and the check below makes that
   * explicit rather than relying on it.
   *
   * The capture-phase `swallowClick` is what keeps the two apart. A drag has to
   * not be read as a click, because a click is what requests the pointer lock
   * and grabs the cursor — so a drag would end by taking away the very control
   * the drag was using. Same pattern, and same reasoning, as `InsideView`.
   */
  useEffect(() => {
    const host = (gl.domElement.closest('.furnish-3d-view') as HTMLElement | null) ?? gl.domElement;
    const s = state.current;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      s.dragging = true;
      s.downAt = { x: e.clientX, y: e.clientY };
      s.lastAt = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!s.dragging || !s.lastAt) return;
      // Under pointer lock the mouse belongs to the lock, not to the page.
      if (document.pointerLockElement) return;
      const dx = e.clientX - s.lastAt.x;
      const dy = e.clientY - s.lastAt.y;
      s.lastAt = { x: e.clientX, y: e.clientY };
      // Pitch clamped to ±86°, matching what `PointerLockControls` allows under
      // the pointer lock. Without it a drag rolls the camera over the top.
      camera.rotation.set(
        Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, camera.rotation.x - dy * LOOK_SENSITIVITY)),
        camera.rotation.y - dx * LOOK_SENSITIVITY,
        0,
      );
    };
    const onUp = () => {
      s.dragging = false;
      s.lastAt = null;
    };
    // `downAt` deliberately survives the release: the click the browser fires
    // next is what it is compared against.
    const swallowClick = (e: MouseEvent) => {
      const down = s.downAt;
      s.downAt = null;
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4) return;
      e.stopPropagation();
      e.preventDefault();
    };

    host.style.touchAction = 'none';
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('click', swallowClick, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      host.style.touchAction = '';
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('click', swallowClick, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [camera, gl]);

  // drei hands PointerLockControls a DOM Event, not a boolean, so read the
  // document state instead of trusting the argument's type.
  const onLock = () => {
    const locked = typeof document !== 'undefined' && document.pointerLockElement !== null;
    setHud((h) => ({ ...h, locked }));
    if (!locked) onExit();
  };

  useFrame((_, delta) => {
    const s = state.current;
    const k = s.keys;
    // `step` is the frame time, capped so that a tab which was backgrounded does
    // not integrate seconds of movement at once. It is applied exactly once,
    // when converting velocity to this frame's displacement — applying it to
    // `speed` as well made the camera move at about 1/60th of the speed the HUD
    // advertises.
    const step = Math.min(3, delta);
    const speed = k['ShiftLeft'] || k['ShiftRight'] ? RUN_SPEED : WALK_SPEED;

    // Turn on the spot. This is the look path that works *without* a click, so
    // it is the one that has to work — pointer lock swallows the cursor and
    // makes a heading hard to adjust once you have it. Yaw is unbounded, so this
    // is a full 360° turn with no clamp, matching `InsideView`.
    const turn = (k['KeyQ'] ? 1 : 0) - (k['KeyE'] ? 1 : 0);
    if (turn) camera.rotation.y += turn * TURN_RATE * step;

    // Forward is -Z in camera space; yaw comes from the pointer lock or a drag.
    const forward = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
    const strafe = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);

    // Forward and right come from the camera's actual world orientation, not
    // from `rotation.y`. See `movementBasis` — reading the yaw alone inverts
    // every heading that three stores as a pitch of ±π rather than a yaw of π.
    const basis = movementBasis(camera);
    const wish = wishVector(basis, forward, strafe, speed);
    // A gait, not a snap: `approachVelocity` moves toward the wish vector at a
    // fixed rate in m/s², so it reaches pace in the same wall-clock time at any
    // frame rate, and stops about twice as fast as it starts.
    s.vel = approachVelocity(s.vel, wish, step);

    /**
     * The movement itself — move, resolve against what is in the way, and settle
     * onto whatever is underfoot — is `advanceWalk`'s job, and it is shared with
     * the indoor camera.
     *
     * It integrates the movement in small steps rather than in one move per
     * frame, and that is the difference between climbing a flight and going
     * through it: a move long enough to rise more than a riser in one go is
     * refused as a ceiling, and a camera refused like that sails up the inside
     * of the staircase at a constant height. On a slow machine that is every
     * frame. See `WALK_SUB_STEP`.
     */
    const advanced = advanceWalk(s.pos, s.vel, step, {
      plot,
      colliders,
      surfaces,
      floors: storeys,
      verge: WALK_VERGE,
    });
    s.pos.x = advanced.body.x;
    s.pos.y = advanced.body.y;
    s.pos.z = advanced.body.z;
    s.floorId = advanced.body.floorId ?? s.floorId;
    s.vel.x = advanced.vel.x;
    s.vel.z = advanced.vel.z;

    // Ground actually covered, which is what drives the bob. Measured from the
    // resolved position rather than from the intended one, so that walking into
    // a wall does not shake the camera.
    s.bob = bobPhase(s.bob, advanced.covered);

    /**
     * The walk state, published for the verification scripts.
     *
     * `scripts/stairwalk.mjs` and `scripts/flightprobe.mjs` drive the app
     * through a real browser and need to know what the camera is standing on
     * and what is in its way — the questions a unit test cannot answer,
     * because only the running app has the colliders and surfaces the camera
     * is actually using. It is a seam for the tests, not debug output: it
     * costs one object per frame and nothing reads it in normal use.
     *
     * The heading is here for the same reason as the position: a script that
     * wants to know which way the camera is looking should not have to reach
     * into three.js to find out, and the end-to-end tests need it to tell
     * "the camera turned" from "the picture changed for some other reason".
     *
     * Two of them, because they answer different questions. `heading` is the
     * compass direction the camera looks — the angle of its own forward vector
     * from the positive Z axis — and it wraps, so it is what a script aims with.
     * `yaw` is the camera's rotation, which accumulates and never wraps, so it
     * is what a test measures a turn with: a camera that has turned a full
     * circle looks the same way as one that never turned, and only the yaw
     * tells those two apart.
     */
    (window as unknown as { __walk?: unknown }).__walk = {
      pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z },
      vel: { x: s.vel.x, z: s.vel.z },
      heading: Math.atan2(basis.fx, basis.fz),
      yaw: camera.rotation.y,
      floorId: s.floorId,
      support: s.pos.y - EYE_HEIGHT,
      keys: { ...k },
      colliders: colliders.map((c) => ({
        x: c.x, z: c.z, w: c.w, d: c.d, y0: c.y0, y1: c.y1, floorId: c.floorId,
      })),
      surfaces: surfaces.map((c) => ({
        x: c.x, z: c.z, w: c.w, d: c.d, y: c.y, ramp: c.ramp ?? null,
      })),
    };

    const now = performance.now();
    if (now - probedAt.current > 140) {
      probedAt.current = now;
      const feet = s.pos.y - EYE_HEIGHT;
      const here = surfaces.filter(
        (c) => Math.abs(s.pos.x - c.x) <= c.w / 2 && Math.abs(s.pos.z - c.z) <= c.d / 2,
      );
      setProbe(
        [
          `feet ${feet.toFixed(2)} m`,
          here.length === 0
            ? 'nothing underneath'
            : `${here.length} here${here.some((c) => c.ramp) ? ', on a flight' : ''}`,
          `${flightCount} flight${flightCount === 1 ? '' : 's'} of ${surfaces.length} surfaces`,
          s.floorId ? `on ${elevationOf.get(s.floorId) ?? '?'} m` : 'on no storey',
        ].join(' · '),
      );
    }

    if (advanced.touching) {
      setHud((h) => (h.touching ? h : { ...h, touching: true }));
    } else if (hud.touching) {
      setHud((h) => ({ ...h, touching: false }));
    }

    // Amplitude follows pace, so standing still is perfectly still — including
    // during the deceleration after the key is released, which is what stops
    // the camera from rocking on the spot while you read a room.
    const pace = Math.min(1, Math.hypot(s.vel.x, s.vel.z) / WALK_SPEED);
    const b = bob(s.bob, pace);
    // Lateral sway goes along the camera's own right vector.
    camera.position.set(
      s.pos.x + basis.rx * b.lateral,
      s.pos.y + b.vertical,
      s.pos.z + basis.rz * b.lateral,
    );
    camera.rotation.z = b.roll;
    // Published for the swinging doors, which open as the walker nears them.
    // `s.pos.y`, not the camera's bobbed height: the doors want the true eye
    // height, and so does the collision band above.
    if (walker.current) {
      walker.current.x = s.pos.x;
      walker.current.y = s.pos.y;
      walker.current.z = s.pos.z;
    }
  });

  return (
    <group>
      {/* `selector` matters, and not for tidiness. drei attaches the
          lock trigger to `document` when it is omitted, which means a click
          anywhere in the application — toolbar, navigator, assistant panel —
          calls `requestPointerLock()` on the 3D canvas. When such a click is
          also what leaves walk mode, React has already detached the canvas by
          the time the event finishes bubbling, the request rejects, and
          three-stdlib does not catch it: an unhandled rejection that the
          end-to-end run caught intermittently as a `WrongDocumentError`.
          Scoping the trigger to this view means the listener lives on the
          wrapper div, a detached canvas can never be reachable through it, and
          "click to walk" means what the HUD says it means. */}
      <PointerLockControls selector=".furnish-3d-view" onLock={onLock} onUnlock={onLock} makeDefault />

      {!hud.locked && (
        <Hud>
          <p className="font-medium text-ink">Click to walk</p>
          <p className="mt-1 text-inkSoft">W A S D to move · Shift to run · Esc to leave</p>
          <p className="mt-1 text-inkSoft">Drag or Q E to look around</p>
          <p className="mt-1 text-inkSoft">Walls and furniture stop you.</p>
        </Hud>
      )}
      {/* Through `DreiHtml`, like the HUD above it. A bare `<div>` here is not
          a styling slip: `<group>` is an R3F node, so R3F resolves every JSX
          element under it as a THREE object and throws *"Div is not part of the
          THREE namespace"* — taking the whole Canvas down with it. This branch
          only renders when `touching && locked`, and pointer lock does not
          engage in a headless browser, so no automated run had ever rendered
          it. Overlay DOM inside a canvas has exactly one correct home. */}
      {hud.touching && hud.locked && (
        <DreiHtml center position={[0, EYE_HEIGHT - 0.42, -1.6]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded-control bg-ink/80 px-3 py-1.5 text-[12px] text-white">
            Blocked — turn or step back
          </div>
        </DreiHtml>
      )}
      {/* The floor readout, kept up while walking as well as before. `DreiHtml`
          for the same reason as everything else in here: a bare `<div>` under
          an R3F node is resolved as a THREE object and throws. */}
      <DreiHtml fullscreen style={{ pointerEvents: 'none' }}>
        <div className="absolute bottom-3 left-3 rounded-control bg-ink/80 px-2.5 py-1 text-[11px] tabular-nums text-white">
          {probe || '…'}
        </div>
      </DreiHtml>
    </group>
  );
}

// ───────────────────────────────────────────────────────────────── daylight ───

/**
 * Interior light that falls off from the openings.
 *
 * A fixed pool of point lights, re-aimed every frame at whichever windows are
 * nearest the camera. Written as a pool rather than one `<pointLight>` per
 * window because the number of lights is what the renderer compiles against:
 * changing it per project is a shader rebuild, and the pool keeps that cost
 * paid once. Selecting the nearest few is not only cheaper — see the note on
 * shadows at the top of `daylight.ts` — it is what keeps the no-shadow
 * approximation to the room you are standing in.
 *
 * The lights are given `intensity={0}` on mount and set from `useFrame`, so a
 * frame lands with the right value in it rather than a frame of full-strength
 * lights before the selection runs.
 */
function Daylight({ project, sun, active }: { project: Project; sun: THREE.Vector3; active: boolean }) {
  const sources = useMemo(
    () =>
      daylightSources({
        walls: project.walls,
        floors: project.floors,
        rooms: project.rooms,
        plot: { plotWidth: project.plot.width, plotDepth: project.plot.depth },
      }),
    [project.walls, project.floors, project.rooms, project.plot.width, project.plot.depth],
  );
  const pool = useRef<(THREE.PointLight | null)[]>([]);

  useFrame(({ camera }) => {
    const chosen = chooseSources(sources, camera.position, sun, MAX_SOURCES);
    for (let i = 0; i < MAX_SOURCES; i++) {
      const light = pool.current[i];
      if (!light) continue;
      const hit = chosen[i];
      if (!hit) {
        light.intensity = 0;
        continue;
      }
      const at = lightPosition(hit.source);
      light.position.set(at.x, at.y, at.z);
      light.color.set(hit.color);
      light.intensity = hit.intensity;
    }
  });

  if (!active) return null;
  return (
    <>
      {Array.from({ length: MAX_SOURCES }, (_, i) => (
        <pointLight
          key={i}
          ref={(el) => {
            pool.current[i] = el;
          }}
          intensity={0}
          distance={REACH}
          decay={DECAY}
        />
      ))}
    </>
  );
}

/**
 * How much uniform fill an interior gets.
 *
 * The environment map is the sky, applied to every surface in the building
 * whether or not it can see the sky — which is exactly the "light fills the
 * room evenly" complaint, arriving through the side door. It is also what made
 * the ceilings read as open sky: a downward-facing white surface integrates the
 * *whole* upper hemisphere of the environment, so at half strength a plaster
 * ceiling came out brighter and bluer than the walls under it. Indoors it is
 * pulled right down, and what is left of it is the bounce that genuinely
 * arrives from every direction at once.
 *
 * Assigned in `useFrame`, not in an effect, and that is not a style choice. The
 * scene's environment is installed by `onCreated`, which R3F runs *after* the
 * children mount — so an effect reading `scene.environment` on first render sees
 * null, bails, and never runs again, since nothing it depends on has changed.
 * That is exactly what happened: the first version of this did nothing at all,
 * silently, in every run. One assignment per frame cannot have that failure.
 */
function InteriorEnvironment({ indoor }: { indoor: boolean }) {
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    if (!scene.environment) return;
    scene.environmentIntensity = indoor ? INDOOR_ENV_INTENSITY : EXTERIOR_ENV_INTENSITY;
  });
  return null;
}

/** The environment strength `onCreated` establishes for an exterior view. */
const EXTERIOR_ENV_INTENSITY = 0.5;

/**
 * Indoors, enough to keep shadowed joinery from crushing to black and no more.
 * The windows are doing the work; see `Daylight`.
 */
const INDOOR_ENV_INTENSITY = 0.14;

function Hud({ children }: { children: React.ReactNode }) {
  return (
    <DreiHtml center>
      {/* `float-surface` rather than a hand-rolled card: it is the same rounded
          card, line border, surface fill, pop shadow and backdrop blur every
          other floating panel in the app uses, so this hint sits at the same
          height above the canvas as the toolbar above it. */}
      <div className="float-surface pointer-events-none w-64 px-4 py-3 text-center text-[12px]">
        {children}
      </div>
    </DreiHtml>
  );
}

// ──────────────────────────────────────────────────────────────── inside ─────

/** Seconds a move to another room takes. Long enough to read as travel. */
const FLIGHT_SECONDS = 0.75;

/** Smoothstep, so a flight eases in and out instead of starting and stopping. */
const ease = (t: number): number => t * t * (3 - 2 * t);

interface Flight {
  /** Metres for position, radians for orientation. */
  from: { x: number; y: number; z: number; yaw: number; pitch: number };
  to: { x: number; y: number; z: number; yaw: number; pitch: number };
  t: number;
}

interface InsideState {
  pos: { x: number; y: number; z: number };
  vel: { x: number; z: number };
  keys: Record<string, boolean>;
  /**
   * Radians, always — it goes straight into `camera.rotation` every frame, and
   * `PITCH_LIMIT`, `LOOK_SENSITIVITY` and `TURN_RATE` are all radian quantities
   * too. A viewpoint arrives from `roomViewpoint` in degrees and is converted
   * on the way in.
   */
  look: { yaw: number; pitch: number };
  /** Which storey the camera is on, so the ground floor cannot block it. */
  floorId: string | null;
  flight: Flight | null;
  /** Forward drive from the scroll wheel, decaying to zero every frame. */
  push: number;
  /** Head-bob phase in radians, advanced by ground covered. See `WalkState`. */
  bob: number;
  dragging: boolean;
  /** Where the current drag was pressed. Kept until the click it may cancel. */
  downAt: { x: number; y: number } | null;
  /** The last pointer position, for computing this move's delta. */
  lastAt: { x: number; y: number } | null;
  /** Last reported position, so the room readout is not recomputed every frame. */
  checkedAt: { x: number; z: number } | null;
  room: string | null;
}

/**
 * First person, indoors.
 *
 * The difference from `FirstPerson` is the mouse. Pointer lock is the right
 * answer outdoors — a walk-through wants to face where you are going without
 * the cursor getting in the way — and the wrong answer indoors, where the user
 * still has to reach the toolbar, the room list and the inspector. Dragging to
 * look keeps the cursor, so the whole application stays reachable from a view
 * you are standing in the middle of.
 *
 * Which means dragging must not also click. React's capture phase is the hook:
 * a listener on the 3D view's own wrapper runs before the canvas's own
 * listeners, so stopping propagation there means a drag that ends over the
 * building never reaches the raycaster. Whether a press became a drag is
 * decided by how far the pointer travelled between press and release, which —
 * unlike a flag cleared on pointerup — cannot go stale if the release lands
 * outside the view and no click event follows.
 */
function InsideView({
  colliders,
  surfaces,
  plot,
  rooms,
  frame,
  elevationOf,
  floorOrder,
  building,
  selectedRoomId,
  onInsideRoom,
}: {
  colliders: ReturnType<typeof buildScene>['colliders'];
  /**
   * Everything the camera can stand on: every room slab and terrace deck, read
   * off the render boxes, plus one ramp per staircase, read off the model.
   *
   * Without this the camera had no floor at all: its height was written once at
   * mount and never again, which is why it could be *placed* on the first floor
   * by selecting a room but could never *walk* there.
   */
  surfaces: WalkSurface[];
  plot: { width: number; depth: number };
  rooms: RoomRect[];
  frame: ReturnType<typeof frameFor>;
  elevationOf: Map<string, number>;
  floorOrder: Map<string, number>;
  building: SceneGeometry['building'];
  selectedRoomId: string | null;
  onInsideRoom?: (label: string | null) => void;
}) {
  const { camera, gl } = useThree();
  const state = useRef<InsideState>({
    pos: { x: 0, y: EYE_HEIGHT, z: 0 },
    vel: { x: 0, z: 0 },
    keys: {},
    look: { yaw: 0, pitch: 0 },
    floorId: null,
    flight: null,
    push: 0,
    bob: 0,
    dragging: false,
    downAt: null,
    lastAt: null,
    checkedAt: null,
    room: null,
  });

  /**
   * The storeys in this building, by elevation.
   *
   * `floorAtElevation` is order-independent, so this list is only for reading.
   * It is recomputed from `elevationOf` rather than cached on the state, because
   * a storey can be added while the inside view is open and a stale list would
   * then silently keep the camera on the floor it left.
   */
  const storeys = useMemo(
    () => [...elevationOf].map(([floorId, elevation]) => ({ floorId, elevation })),
    [elevationOf],
  );

  /**
   * What the camera is standing on, read out live.
   *
   * This exists because "I cannot climb the stairs" has three quite different
   * causes that look identical from outside the window: no surface under the
   * camera at all (the whole floor system is missing), a surface under it at the
   * wrong height (it is standing on the ground paving and passing straight
   * through the flight), or the right surface in the right place but no door to
   * reach it (it is walled off in the stairwell). Each has a different fix and
   * none of them can be told apart by looking. This names all three in one line.
   */
  const [probe, setProbe] = useState('');
  const probedAt = useRef(0);
  const flights = useMemo(() => surfaces.filter((c) => c.ramp).length, [surfaces]);

  const viewpointFor = useCallback(
    (room: RoomRect) =>
      roomViewpoint(room, frame, {
        elevation: elevationOf.get(room.floorId) ?? 0,
        buildingCentre: { x: building.cx, z: building.cz },
        colliders: colliders.filter((c) => c.floorId === room.floorId),
        radius: CAMERA_RADIUS,
        eyeHeight: EYE_HEIGHT,
      }),
    [frame, elevationOf, building.cx, building.cz, colliders],
  );

  const beginFlight = useCallback(
    (room: RoomRect) => {
      const s = state.current;
      const to = viewpointFor(room);
      s.floorId = room.floorId;
      s.vel = { x: 0, z: 0 };
      s.push = 0;
      s.flight = {
        from: { ...s.pos, yaw: s.look.yaw, pitch: s.look.pitch },
        // Shortest way round, so crossing the ±180° seam is a two-degree turn.
        to: {
          ...to,
          yaw: s.look.yaw + shortestAngle(s.look.yaw / DEG, to.yaw) * DEG,
          pitch: to.pitch * DEG,
        },
        t: 0,
      };
    },
    [viewpointFor],
  );

  /**
   * The room the camera was last sent to, so the effect below only reacts to a
   * *change* of room. Initialised by the mount effect rather than by a null
   * sentinel here: "no room is selected" is itself a perfectly ordinary value,
   * and a `null` that means both "not started" and "nothing selected" swallows
   * the first room the user actually picks.
   */
  const lastSelected = useRef<string | null>(null);

  // This component is mounted only while the mode is active, so "run once" is
  // "run when the user enters the mode" — which is exactly right, and stops a
  // new piece of furniture from yanking the camera out of the room it is in.
  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.fov !== INSIDE_FOV) {
      persp.fov = INSIDE_FOV;
      persp.updateProjectionMatrix();
    }
    const chosen =
      (selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) : null) ??
      defaultInteriorRoom(rooms, floorOrder);
    lastSelected.current = selectedRoomId;
    if (!chosen) return;
    // Land there without a flight: entering the mode is a jump, not a move.
    const to = viewpointFor(chosen);
    const s = state.current;
    s.floorId = chosen.floorId;
    s.pos = { x: to.x, y: to.y, z: to.z };
    s.look = { yaw: to.yaw * DEG, pitch: to.pitch * DEG };
    camera.position.set(to.x, to.y, to.z);
    camera.rotation.set(to.pitch * DEG, to.yaw * DEG, 0, 'YXZ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selecting a room — in the 3D view or in the plan beside it — moves the
  // camera there. Anything else selected does not: clicking a wall should not
  // teleport the viewer out of the room they are standing in.
  useEffect(() => {
    if (!selectedRoomId || selectedRoomId === lastSelected.current) return;
    lastSelected.current = selectedRoomId;
    const room = rooms.find((r) => r.id === selectedRoomId);
    if (room && canViewFromInside(room)) beginFlight(room);
  }, [selectedRoomId, rooms, beginFlight]);

  useEffect(() => {
    const s = state.current;
    const down = (e: KeyboardEvent) => {
      // Typing "wasd" into a field used to walk the viewer out of the room they
      // were looking at. See `keys.ts`.
      if (isTypingTarget(e.target)) return;
      if (SCROLL_CODES.has(e.code)) e.preventDefault();
      s.keys[e.code] = true;
      // Any intent to move takes over from a flight in progress.
      if (/^(Key[WASDQE]|Arrow|Shift)/.test(e.code)) s.flight = null;
    };
    const up = (e: KeyboardEvent) => {
      s.keys[e.code] = false;
    };
    // Held keys survive a lost window without this, and the camera walks itself
    // out of the building on return.
    const release = () => {
      for (const code of Object.keys(s.keys)) s.keys[code] = false;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') release();
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    const host = (gl.domElement.closest('.furnish-3d-view') as HTMLElement | null) ?? gl.domElement;
    const s = state.current;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      s.dragging = true;
      s.downAt = { x: e.clientX, y: e.clientY };
      s.lastAt = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!s.dragging || !s.lastAt) return;
      s.look.yaw -= (e.clientX - s.lastAt.x) * LOOK_SENSITIVITY;
      s.look.pitch -= (e.clientY - s.lastAt.y) * LOOK_SENSITIVITY;
      s.lastAt = { x: e.clientX, y: e.clientY };
      s.flight = null;
    };
    // `downAt` deliberately survives the release: the click event the browser
    // fires next is what it is compared against.
    const onUp = () => {
      s.dragging = false;
      s.lastAt = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      s.push = Math.max(-1, Math.min(1, s.push - e.deltaY * 0.0012));
      s.flight = null;
    };
    // Capture phase, on the wrapper rather than the canvas. See the docstring.
    const swallowClick = (e: MouseEvent) => {
      const down = s.downAt;
      s.downAt = null;
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4) return;
      e.stopPropagation();
      e.preventDefault();
    };

    host.style.touchAction = 'none';
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('click', swallowClick, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      host.style.touchAction = '';
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('click', swallowClick, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const s = state.current;
    // Applied exactly once, when converting velocity to this frame's
    // displacement — see `FirstPerson`.
    const step = Math.min(3, delta);

    if (s.flight) {
      const f = s.flight;
      f.t = Math.min(1, f.t + step / FLIGHT_SECONDS);
      const e = ease(f.t);
      s.pos.x = f.from.x + (f.to.x - f.from.x) * e;
      s.pos.y = f.from.y + (f.to.y - f.from.y) * e;
      s.pos.z = f.from.z + (f.to.z - f.from.z) * e;
      s.look.yaw = f.from.yaw + (f.to.yaw - f.from.yaw) * e;
      s.look.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * e;
      if (f.t >= 1) s.flight = null;
      // A flight is a glide, not a stride. Zeroed here so the walk that follows
      // it does not start mid-step.
      s.bob = 0;
      s.vel.x = 0;
      s.vel.z = 0;
    } else {
      const k = s.keys;
      const turn = (k['KeyQ'] ? 1 : 0) - (k['KeyE'] ? 1 : 0);
      if (turn) s.look.yaw += turn * TURN_RATE * step;

      // Indoors is slower than outdoors: these rooms are two and a half metres
      // across, and a sprint crosses one before it can be read.
      const speed = k['ShiftLeft'] || k['ShiftRight'] ? INDOOR_RUN_SPEED : INDOOR_SPEED;
      const forward =
        (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0) + s.push;
      const strafe = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);

      // Same basis as walk mode — see `movementBasis`.
      const basis = movementBasis(camera);
      const wish = wishVector(basis, forward, strafe, speed);
      // Same gait as outdoors, so the two cameras do not read as two products.
      s.vel = approachVelocity(s.vel, wish, step);
      s.push *= Math.max(0, 1 - delta * 6);

      // The movement — move, resolve, and settle onto what is underfoot — is
      // `advanceWalk`'s job, and it is shared with the outdoor camera. No verge
      // here, unlike walk mode: there is nothing outside to walk to, and the
      // margin walk mode needs to keep its camera off the pavement would here
      // only let the viewer step through an outside wall.
      const advanced = advanceWalk(s.pos, s.vel, step, {
        plot,
        colliders,
        surfaces,
        floors: storeys,
      });
      s.pos.x = advanced.body.x;
      s.pos.y = advanced.body.y;
      s.pos.z = advanced.body.z;
      s.floorId = advanced.body.floorId ?? s.floorId;
      s.vel.x = advanced.vel.x;
      s.vel.z = advanced.vel.z;
      // Distance actually covered, so pushing into a wall does not shake the
      // camera. See `FirstPerson`.
      s.bob = bobPhase(s.bob, advanced.covered);
    }

    s.look.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, s.look.pitch));
    // YXZ, so pitch is applied about the camera's own axis: with the default
    // XYZ order, looking up also rolls the heading and the horizon tilts.
    camera.rotation.set(s.look.pitch, s.look.yaw, 0, 'YXZ');
    // Head bob, camera only — `s.pos.y` stays the true eye height, which is
    // what the collision band above was tested against. Scaled by pace, so a
    // stopped camera is a still camera.
    const pace = Math.min(1, Math.hypot(s.vel.x, s.vel.z) / INDOOR_SPEED);
    const b = bob(s.bob, pace);
    camera.rotation.z = b.roll;
    camera.position.set(
      s.pos.x + Math.cos(s.look.yaw) * b.lateral,
      s.pos.y + b.vertical,
      s.pos.z - Math.sin(s.look.yaw) * b.lateral,
    );

    // Which room am I in? Recomputed when the camera has actually moved — a
    // readout that calls back into React every frame would re-render the whole
    // view sixty times a second to say nothing new.
    const moved = !s.checkedAt || Math.hypot(s.pos.x - s.checkedAt.x, s.pos.z - s.checkedAt.z) > 0.05;
    if (moved) {
      s.checkedAt = { x: s.pos.x, z: s.pos.z };
      const label = roomAt(s.pos.x, s.pos.z, rooms, frame, s.floorId ?? undefined)?.label ?? null;
      if (label !== s.room) {
        s.room = label;
        onInsideRoom?.(label);
      }
    }

    // Throttled to about seven a second. This is the only thing in the frame
    // loop that calls back into React, and it is deliberately slow: a readout
    // that re-renders the view every frame to display an unchanged number costs
    // more than it tells you.
    const now = performance.now();
    if (now - probedAt.current > 140) {
      probedAt.current = now;
      const feet = s.pos.y - EYE_HEIGHT;
      const here = surfaces.filter(
        (c) => Math.abs(s.pos.x - c.x) <= c.w / 2 && Math.abs(s.pos.z - c.z) <= c.d / 2,
      );
      setProbe(
        [
          `feet ${feet.toFixed(2)} m`,
          here.length === 0
            ? 'nothing underneath'
            : `${here.length} here${here.some((c) => c.ramp) ? ', on a flight' : ''}`,
          `${flights} flight${flights === 1 ? '' : 's'} of ${surfaces.length} surfaces`,
          s.floorId ? `on ${elevationOf.get(s.floorId) ?? '?'} m` : 'on no storey',
        ].join(' · '),
      );
    }
  });

  return (
    // Through `DreiHtml`, like the walk HUD. A bare `<div>` here is not a styling
    // slip: `<group>` is an R3F node, so R3F resolves every JSX element under it
    // as a THREE object and throws *"Div is not part of the THREE namespace"*,
    // taking the whole Canvas down with it.
    <DreiHtml fullscreen style={{ pointerEvents: 'none' }}>
      <div className="absolute bottom-3 left-3 rounded-control bg-ink/80 px-2.5 py-1 text-[11px] tabular-nums text-white">
        {probe || '…'}
      </div>
    </DreiHtml>
  );
}

// ───────────────────────────────────────────────────────────── camera rigs ────

/**
 * Orbit and top-down framing.
 *
 * Both are framed on the **building**, not the plot. Framing on the plot meant
 * that a modest house on a generous plot sat in the middle of an empty field
 * with the setback line as the only other thing on screen, and a large plot
 * pushed the building off-centre entirely. The distance is now derived from the
 * diagonal the camera actually has to fit, plus the height it has to clear, and
 * the target is the centre of the built fabric.
 */
function Rig({ mode, building, street }: { mode: CameraMode; building: SceneGeometry['building']; street: { x: number; z: number } }) {
  const { camera, size } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);

  // A plan with no walls yet has no extent to frame. Fall back to the plot
  // rather than dividing by zero, so the camera still lands somewhere sane.
  const w = Math.max(building.width, 6);
  const d = Math.max(building.depth, 6);
  const h = Math.max(building.height, 3);
  const target: [number, number, number] = [building.cx, Math.min(building.cy, h / 2), building.cz];

  // A three-quarter view from above eye height, opened from the *street* side.
  //
  // Viewing from a fixed compass bearing meant that for the default orientation
  // the app showed the back of the house — no entrance, no path, and the
  // elevation that matters least. `lateral` is the screen-right axis of that
  // view, and it is computed up front because both the framing and the sun
  // depend on it.
  const lateral = useMemo(
    () => new THREE.Vector3(-street.z, 0, street.x).normalize(),
    [street.x, street.z],
  );
  const viewDir = useMemo(
    () => new THREE.Vector3(street.x, 0, street.z).addScaledVector(lateral, 0.72).setY(0.45).normalize(),
    [street.x, street.z, lateral],
  );

  useEffect(() => {
    const aspect = Math.max(0.2, size.width / Math.max(1, size.height));
    const persp = camera as THREE.PerspectiveCamera;
    // Symmetrically: leaving walk mode puts the narrow field of view back, so
    // the orbit view is framed against the fov it is actually rendered with.
    if (persp.fov !== ORBIT_FOV) {
      persp.fov = ORBIT_FOV;
      persp.updateProjectionMatrix();
    }
    const vFov = (ORBIT_FOV * Math.PI) / 180;
    // The binding constraint is the *narrow* axis. This viewport is often
    // taller than it is wide, so the horizontal field of view can be much the
    // smaller of the two — framing off the vertical one put the camera inside
    // the front wall of its own house and cropped the roof off the screen.
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // Fit the actual corners, not a bounding sphere.
    //
    // Framing off one distance for the whole building cannot work in
    // perspective: the near corner is half the building's depth nearer than the
    // target, so it is magnified while the far corner is not. A distance that
    // fits the far corner crops the near one off both edges of the frame — which
    // is exactly what a "projected width" fit does too.
    //
    // For a corner at offset (u across, v up, w toward the camera) from the
    // target, it is inside the frustum at distance D iff |u| ≤ (D − w)·tan(hFov/2)
    // and |v| ≤ (D − w)·tan(vFov/2) — so each corner states its own minimum D,
    // and the camera takes the largest.
    const tanH = Math.tan(hFov / 2);
    const tanV = Math.tan(vFov / 2);
    const e = EAVES_OVERHANG;
    const dist = (() => {
      // Straight down there is no perspective foreshortening to compensate for,
      // so the plan's own half-extents are the fit.
      if (mode === 'top') {
        return Math.max((w / 2 + e) / tanH, (d / 2 + e) / tanV) * 1.06;
      }
      const right = new THREE.Vector3(-viewDir.z, 0, viewDir.x).normalize();
      const up = new THREE.Vector3().crossVectors(right, viewDir).normalize();
      let need = 0;
      for (const x of [building.minX - e, building.maxX + e]) {
        for (const z of [building.minZ - e, building.maxZ + e]) {
          for (const y of [-e, building.height + e]) {
            const dx = x - target[0];
            const dy = y - target[1];
            const dz = z - target[2];
            const toward = dx * viewDir.x + dy * viewDir.y + dz * viewDir.z;
            const across = dx * right.x + dz * right.z;
            const upOff = dx * up.x + dy * up.y + dz * up.z;
            need = Math.max(need, toward + Math.max(Math.abs(across) / tanH, Math.abs(upOff) / tanV));
          }
        }
      }
      // Air around the subject. A corner-exact fit puts the eaves on the top
      // edge of the viewport and the near corner on the bottom one, which reads
      // as a photograph taken through a letterbox rather than as a building on
      // a site. The margin is the difference between "fitted" and "framed".
      return need * 1.16;
    })();

    if (mode === 'top') {
      // Straight down is a degenerate `lookAt`: with the default up vector of
      // +Y the cross product collapses and three picks an arbitrary roll, which
      // is why the top view used to come up rotated 45°. Declaring +Z as up
      // first puts plan-north at the top of the screen, which is what a plan
      // check is for.
      camera.up.set(0, 0, -1);
      camera.position.set(target[0], target[1] + dist, target[2]);
      camera.lookAt(target[0], target[1], target[2]);
      camera.up.set(0, 1, 0);
      controls.current?.target.set(...target);
      controls.current?.update();
    } else {
      camera.position.set(
        target[0] + viewDir.x * dist,
        target[1] + viewDir.y * dist,
        target[2] + viewDir.z * dist,
      );
      camera.lookAt(...target);
      controls.current?.target.set(...target);
      controls.current?.update();
    }
  }, [mode, camera, size.width, size.height, w, d, h, target[0], target[1], target[2], street.x, street.z, lateral, viewDir]);

  if (mode === 'walk' || mode === 'inside') return null;

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={1.5}
      maxDistance={Math.max(w, d) * 8}
      // Looking straight down is the top-down mode; stop just short so the
      // camera never flips through the ground.
      maxPolarAngle={Math.PI / 2 - 0.03}
      target={target}
    />
  );
}

// ────────────────────────────────────────────────────────── render quality ────

/**
 * What the surface fidelity settled on, so the toolbar can say so.
 *
 * A module-level ref rather than React state: it is written once during the
 * first render, and read by a component that must not re-render the whole 3D
 * tree to update a label.
 */
export const surfaceQualitySignal = { value: 'draft' as SurfaceQuality };

/**
 * Is this a software rasteriser?
 *
 * The renderer string is the only honest signal available — there is no feature
 * query that distinguishes "a GPU" from "SwiftShader" — and getting it wrong in
 * the expensive direction is much worse than getting it wrong the cheap way: a
 * software context would spend most of its frame budget on an environment-map
 * lookup per pixel, while a real GPU treats that lookup as free.
 *
 * Chrome, Firefox and Edge all name SwiftShader in the unmasked renderer
 * string when hardware acceleration is unavailable or explicitly disabled,
 * which is exactly the configuration the end-to-end suite runs under.
 *
 * This makes its own throwaway context rather than reading the one three.js
 * already has. It has to: `onCreated` — the only place the live renderer exists
 * — fires *after* react-three-fiber has mounted the children, so anything the
 * children build is already built by then. See `resolveQuality`.
 */
function softwareRasteriser(): boolean {
  let name = '';
  try {
    const probe = document.createElement('canvas');
    const gl = (probe.getContext('webgl2') ?? probe.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
    // Hand the context back immediately; browsers cap how many are live.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // Some browsers refuse the debug extension. Absence of evidence is not
    // evidence of a software renderer, so fall back to the optimistic answer.
    return false;
  }
  return /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(name);
}

/**
 * What the quality should actually be.
 *
 * Detection is right almost always, and "almost always" is the phrase that
 * makes an override worth having: a machine that reports a renderer string
 * nobody anticipated should not be stuck with the cheap path, and a slow
 * machine should be able to ask for the cheap one even if it does have a GPU.
 * `?quality=realistic` or `?quality=draft` on the URL, and it wins.
 *
 * Resolved once, lazily, and the answer is what `textures.ts` is told before
 * any material is built. The earlier version of this asked `onCreated` instead
 * and was wrong in a way that cost the entire realistic path: fiber commits the
 * children first and calls `onCreated` afterwards, so every material was built
 * and cached while `textures.ts` still thought it was in draft mode. Clearing
 * that cache from `onCreated` did not help, because each `BoxMesh` holds its
 * material in a `useMemo` whose box had not changed — so the normal and
 * roughness maps were thrown away and realistic rendered identically to draft.
 */
let resolvedQuality: SurfaceQuality | null = null;
export function resolveQuality(): SurfaceQuality {
  if (resolvedQuality) return resolvedQuality;
  const asked = new URLSearchParams(window.location.search).get('quality');
  resolvedQuality =
    asked === 'realistic' || asked === 'draft' ? asked : softwareRasteriser() ? 'draft' : 'realistic';
  setSurfaceQuality(resolvedQuality);
  surfaceQualitySignal.value = resolvedQuality;
  return resolvedQuality;
}

// ───────────────────────────────────────────────────────────────── scene ─────

export function Scene({ cameraMode, showFurniture, showRoof, visibleFloorIds, onSelect, onInsideRoom }: SceneProps) {
  /**
   * The walker's position, shared with every swinging door.
   *
   * Left at a far-away point until the walk camera publishes into it, so a door
   * in the orbit view measures a real distance rather than reading a zeroed
   * ref as "you are standing in the doorway".
   */
  const walker = useRef<{ x: number; y: number; z: number } | null>({ x: 0, y: -999, z: 0 });
  const project = useProject((s) => s.project);
  const selectedRoomId = useProject((s) => (s.selection.kinds.includes('room') ? (s.selection.ids[0] ?? null) : null));
  const geometry = useMemo(
    () => buildScene(project, { showFurniture, showRoof, visibleFloorIds: visibleFloorIds ?? undefined }),
    [project, showFurniture, showRoof, visibleFloorIds],
  );
  const frame = useMemo(
    () => frameFor(project.plot.width, project.plot.depth),
    [project.plot.width, project.plot.depth],
  );
  const elevationOf = useMemo(
    () => new Map(project.floors.map((f) => [f.id, f.elevation] as const)),
    [project.floors],
  );
  const floorOrder = useMemo(
    () => new Map(project.floors.map((f) => [f.id, f.order] as const)),
    [project.floors],
  );
  /** Floor-to-floor height by id, for a flight whose own `rise` is absent. */
  const floorHeightOf = useMemo(
    () => new Map(project.floors.map((f) => [f.id, f.height] as const)),
    [project.floors],
  );
  // Only what the inside camera can stand on. Derived once per scene rebuild
  // rather than inline in the JSX, which would rebuild the list on every render
  // of this component — the camera reads it through `useFrame`, not by
  // re-rendering.
  //
  // Slabs and decks come from the boxes; flights do not. A flight is built from
  // the staircase itself, so whether the camera can climb one is decided by the
  // model rather than by how the 3D builder happened to draw it.
  //
  // Declared after the three maps it reads, which is not a style preference. A
  // `useMemo` factory runs during this render, not later, so naming a `const`
  // declared further down would read it out of the temporal dead zone and throw
  // on every frame of the studio — and `tsc` cannot see that, because the read is
  // inside a closure.
  const flights = useMemo(
    () => flightSurfaces(project.stairs, frame, elevationOf, floorHeightOf),
    [project.stairs, frame, elevationOf, floorHeightOf],
  );
  const walkSurfaces = useMemo(() => [...walkableSurfaces(geometry.boxes), ...flights], [geometry, flights]);
  /**
   * Walk mode stands on the ground as well as on the building.
   *
   * The walk starts out on the pavement, so unlike the inside camera it needs
   * something to stand on before it reaches a room — and that something is the
   * ground the house stands on, not a floor in it. It is holed where each
   * flight is, because an unbroken plane at ground level would pass underneath
   * the staircase and beat its ramp to the foot, which is exactly how walking
   * straight through a flight happens. See `groundSurfaces`.
   */
  const walkModeSurfaces = useMemo(
    () => [...walkSurfaces, ...groundSurfaces(project.plot, flights, WALK_VERGE)],
    [walkSurfaces, flights, project.plot],
  );

  const shadows = geometry.bounds.height > 0.5;
  // Read in the JSX below to decide whether the fill lights stand in for an
  // environment map (draft) or merely top it up (realistic).
  //
  // Not `useState` + a `setState` from `onCreated`. This is a fixed answer for
  // the lifetime of the page, it is needed *before* the children mount, and a
  // state update from `onCreated` would arrive after every material had
  // already been built. Resolving it during the first render — and letting
  // `resolveQuality` tell `textures.ts` in the same breath — is what puts the
  // right maps in the first material rather than in a repair pass afterwards.
  const quality = resolveQuality();
  const draft = quality === 'draft';
  // Fit the shadow camera to the whole site, not just the building. Anything
  // outside this box is simply not shadowed, and the boundary shows as a hard
  // straight line across the lawn — which is worse than having no shadow at all.
  // The margin covers the cast shadow of the eaves, which reaches well past the
  // wall line.
  // Wide enough to cover the plot plus the reach of the building's own shadow.
  const shadowSpan = Math.max(15, Math.hypot(project.plot.width, project.plot.depth) / 2 + 6);
  const street = STREET_DIR[project.plot.orientation] ?? STREET_DIR[0]!;
  // Over the street but on the *opposite* side from the orbit camera, at
  // roughly 49° above the horizon — high enough that the cast shadow is a
  // shape on the lawn rather than a slab across the whole foreground, low
  // enough that the roof still has a lit plane and a shaded one.
  //
  // Putting the sun on the camera's own side was the single worst thing about
  // the old lighting: the front elevation went flat, and — because a shadow
  // always falls away from the sun — the whole cast shadow landed behind the
  // building, where the default view never sees it. The app showed a building
  // that looked pasted onto a lawn. Sun across the view rakes the shadow into
  // the foreground and puts the front in light and the return face in shade.
  const right = new THREE.Vector3(-street.z, 0, street.x).normalize();
  const sunDir = new THREE.Vector3(street.x, 0, street.z)
    .addScaledVector(right, -0.78)
    .setY(0.95)
    .normalize();

  // The fill comes from the opposite side of the sun, so the shaded elevation
  // keeps some modelling instead of going flat and dead.
  const shadowDir = new THREE.Vector3(-sunDir.x, 0, -sunDir.z).normalize();

  // Both of the modes that put the camera inside the building. The walk starts
  // on the pavement, but it ends in rooms, and it was those rooms — lit only by
  // what leaks past the front elevation — that looked worst.
  const indoors = cameraMode === 'inside' || cameraMode === 'walk';

  return (
    <Canvas
      shadows={shadows ? 'soft' : false}
      dpr={[1, 2]}
      className="furnish-3d-view"
      camera={{ fov: ORBIT_FOV, near: 0.05, far: 500, position: [12, 10, 14] }}
      gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.92 }}
      onCreated={({ gl, scene }) => {
        const sky = skyTexture();
        // The sky is the background — a horizon is worth far more to a render
        // that the eye reads as a photograph than a flat clear colour is — and
        // it is *also* the environment, pre-filtered.
        //
        // It used to be background only, on the grounds that image-based
        // lighting on every wall was an expensive way to produce a difference
        // nobody could see. That was wrong, and it is why this scene read as a
        // white cardboard model: with no environment, a wall is a diffuse colour
        // times a cosine, and never picks up sky from above or warm bounce from
        // the lawn. The whole look of a real surface is in what the lighting
        // equations leave out.
        //
        // So it is set, with the one honest exception: under a software
        // rasteriser the per-pixel lookup is the most expensive thing in the
        // frame, and the automated suite runs there. `softwareRasteriser()`
        // is what decides, and it is a property of the driver rather than a
        // guess about the user's machine.
        //
        // `resolveQuality` has already run by now — the render pass calls it to
        // work out which materials to build — so this is a cached read, not a
        // second detection.
        const quality = resolveQuality();

        scene.background = sky;
        if (quality !== 'draft') {
          const env = environmentFromSky(gl);
          if (env) scene.environment = env;
        }
        // The sky is a *bright* environment — its horizon is near-white and its
        // zenith a mid blue — and at unit intensity it added roughly as much
        // irradiance as the sun did, so every lit surface ran past the top of
        // the ACES curve and the whole building came out paper-white. Halved
        // here, with the sun trimmed to match, so a sunlit render wall lands
        // just under clipping instead of on it and keeps its shading.
        scene.environmentIntensity = 0.5;
        gl.setClearColor('#eef1f4');
        // Fog pulled in much closer than it used to be. It started at fifty-two
        // metres, which is past the far edge of the plot, so nothing in the
        // scene was actually in it: the middle distance stayed at full
        // saturation and the first hint of haze arrived as an abrupt ramp at
        // the far edge of the lawn, which read as a milky green wash across
        // the top of the frame rather than as distance. Starting the ramp just
        // past the house puts it where the eye expects it and gives the far
        // ground somewhere to recede to.
        //
        // The colour is a cool haze rather than the cream it replaced, and it
        // is exactly the horizon stop in `skyTexture` — the two have to agree
        // or the plot edge stops dissolving and draws itself a line. The range
        // is a touch narrower than it was, which suits the cooler ramp: a
        // shorter one closes over the far ground sooner, and this scene is
        // meant to read as land running into distance rather than as a field
        // of lawn behind the house.
        scene.fog = new THREE.Fog('#e4e8ec', 26, 112);
      }}
      data-testid="scene-3d"
    >
      {/* Sky and bounce.
          These two are now genuinely small, and the comment above them used to
          say why in a way that was not true: it claimed most of the ambient
          "comes from the environment map instead" while no environment map
          existed. It does now — see `onCreated` — and the split is the correct
          one. The hemisphere and ambient carry the fill that image-based
          lighting is bad at, which is essentially nothing; the environment
          carries every direction-dependent term, and carries it correctly
          instead of approximating it with two constants.

          They stay in at all for the draft path, where there is no environment
          at all: removing them outright would make every shadow in the
          software-rendered configuration go to pure black. */}
      {/* The ground half of the hemisphere is the lawn's own hue, taken from
          `LAWN_COLOR` in `sceneModel`. If the bounce is a different green from
          the grass it bounces off, the undersides of the eaves and the soffit
          read as a second, wrong-coloured ground. */}
      <hemisphereLight args={['#dde5ef', '#959d85', draft ? 0.28 : 0.12]} />
      <ambientLight intensity={draft ? 0.1 : 0.03} />
      {/* The sun comes from over the street, swung to one side rather than dead
          on. A sun square to the elevation flattens it; raking across it gives
          the front face light and the return face shade, which is the difference
          between a wall and a wall that has a corner. Positioned from the
          compass bearing, so it follows the plot when the street edge moves. */}
      <directionalLight
        castShadow={shadows}
        position={[
          sunDir.x * shadowSpan * 2,
          sunDir.y * shadowSpan * 2,
          sunDir.z * shadowSpan * 2,
        ]}
        intensity={2.1}
        // Deliberately still warm. Everything around it went cool — sky, fog,
        // hemisphere, fill, environment — and this is the one light left that
        // carries the sun's own colour. A warm sun on a cool sky is the whole
        // difference between a render that reads as daylight and one that
        // reads as an overcast afternoon, so it is not re-toned with the rest.
        color="#fff2da"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowSpan}
        shadow-camera-right={shadowSpan}
        shadow-camera-top={shadowSpan}
        shadow-camera-bottom={-shadowSpan}
        // Tight to the scene. A 116 m depth range for a 20 m scene spent the
        // shadow map's precision on empty space, and the shortfall showed up as
        // evenly spaced vertical bands of wrong self-shadowing running across
        // the walls, the plinth and the ground alike.
        shadow-camera-near={shadowSpan * 0.7}
        shadow-camera-far={shadowSpan * 3.1}
        // Without these the wall boxes shadow-acne against their own floors,
        // which reads as dirt on the elevation rather than as a shadow.
        shadow-bias={-0.0006}
        shadow-normalBias={0.045}
        // Percentage-closer filtering with a wide kernel. A hard-edged shadow
        // from a directional light is the other half of the "not real" look:
        // the sun subtends half a degree and its edges are soft.
        shadow-radius={2.4}
      />
      {/* A dim, shadowless fill from the opposite side so the shaded elevation
          keeps some modelling instead of going flat and dead. Trimmed from
          0.55 once the environment map arrived: sky bounce from the north is
          this light's actual job and the sky already does it, directionally
          and correctly. What is left is the ground-bounce term. */}
      <directionalLight position={[shadowDir.x * shadowSpan * 1.4, shadowSpan * 0.8, shadowDir.z * shadowSpan * 1.4]} intensity={0.3} color="#dbe4f1" />

      {/* Interior light, indoors only.
          This used to be one hemisphere light at a fixed strength, and it was
          the reason every room looked the same: a constant reaching the back
          wall of a windowless bathroom as hard as the render beside the glass.
          Uniform fill is the thing being removed.

          What replaces it is below — `Daylight`, one light per opening, with
          falloff — and this is only the residue it needs to keep an interior
          room that no window can reach from going black. It is a third of what
          it was, which is the honest trade: the falloff is now visible, and a
          hallway off a lit living room is lit by the light it can actually
          borrow.

          Scoped to the two modes where you are inside the building. It cannot
          change a single pixel in the exterior modes, which have been checked. */}
      {indoors && <hemisphereLight args={['#e7eef7', '#bdb5a7', 0.3]} />}
      <InteriorEnvironment indoor={indoors} />
      <Daylight project={project} sun={sunDir} active={indoors} />

      <Suspense fallback={null}>
        <Ground width={project.plot.width} depth={project.plot.depth} setbacks={project.plot.setbacks} />
        <Building boxes={geometry.boxes} onSelect={onSelect} quality={quality} />
        {/* Doors swing as you walk up to them. Drawn in every mode: they hang on
            real hinges in the model, and seeing them open from the orbit camera
            is the same behaviour the walk camera gets. */}
        {geometry.doors.map((d) => (
          <SwingDoorLeaf key={d.id} door={d} walker={walker} quality={quality} />
        ))}
        {cameraMode === 'walk' ? (
          <FirstPerson
            colliders={geometry.colliders}
            surfaces={walkModeSurfaces}
            elevationOf={elevationOf}
            plot={{ width: project.plot.width, depth: project.plot.depth }}
            building={geometry.building}
            street={street}
            entrance={geometry.entrance}
            walker={walker}
            onExit={() => useProject.getState().setViewMode('3d')}
          />
        ) : cameraMode === 'inside' ? (
          <InsideView
            colliders={geometry.colliders}
            surfaces={walkSurfaces}
            plot={{ width: project.plot.width, depth: project.plot.depth }}
            rooms={project.rooms}
            frame={frame}
            elevationOf={elevationOf}
            floorOrder={floorOrder}
            building={geometry.building}
            selectedRoomId={selectedRoomId}
            onInsideRoom={onInsideRoom}
          />
        ) : (
          <Rig mode={cameraMode} building={geometry.building} street={street} />
        )}
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport axisColors={['#c05b5b', '#5b9e6b', '#5b7cc0']} labelColor="#3f4650" />
        </GizmoHelper>
      </Suspense>
    </Canvas>
  );
}

/** Fullscreen PNG of the current canvas, for the 3D export. */
export async function captureCanvas3D(el: HTMLElement | null): Promise<Blob | null> {
  if (!el) return null;
  const canvas = el.querySelector('canvas');
  if (!canvas) return null;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
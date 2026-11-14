// Diagnostic: can a person get into the house and climb to the first floor?
//
// This drives the *running* application, not a model. The unit tests can say a
// flight has a door at its head; only the running app can say whether a person
// standing on the pavement can walk in, find the flight, and get up it.
//
// The route is read from the plan the app itself generated — the entrance, the
// doors between the rooms, and the flight — so it stays honest when the layout
// moves. A route written out by hand would only prove that the layout used to
// work. And it is walked with the keyboard, one press at a time, because that
// is the only way to find out what a person would hit.
import { chromium } from 'playwright';
import { readPlan, doorsOf, wallNormal, roomAt } from './planprobe.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:5173/studio';
const SHOTS = process.env.SHOTS || 'shots';

/**
 * The room program the walkthrough walks.
 *
 * The model writes a fresh program every time, so the same brief gives a
 * different house on every run — which is right for the product and useless
 * for a diagnostic: a failure cannot be looked at twice. This one is fixed, so
 * the walk is the same walk every time and a change to the code is the only
 * thing that can move the outcome.
 */
const FIXED_PROGRAM = {
  summary: 'A fixed program, so this walk is the same walk every time.',
  rooms: [
    { ref: 'living', kind: 'living', areaM2: 22, floor: 0 },
    { ref: 'dining', kind: 'dining', areaM2: 12, floor: 0, touches: ['living'] },
    { ref: 'kitchen', kind: 'kitchen', areaM2: 11, floor: 0, touches: ['dining'] },
    { ref: 'bed-1', kind: 'bedroom', areaM2: 14, floor: 1 },
    { ref: 'bed-2', kind: 'bedroom', areaM2: 12, floor: 1 },
    { ref: 'bath-1', kind: 'bathroom', areaM2: 5, floor: 1, touches: ['bed-1'] },
    { ref: 'office', kind: 'office', areaM2: 8, floor: 1 },
  ],
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.VW || 1600), height: Number(process.env.VH || 1000) } });
page.on('pageerror', (e) => console.log('  [page error]', String(e).slice(0, 200)));

// The model is stood in for, so that the plan is the same plan every run.
await page.route('**/api/room-program', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ program: FIXED_PROGRAM, usage: null }),
  }),
);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('furnish'); d.onsuccess = r; d.onerror = r; d.onblocked = r; }));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Two storeys, so there is a flight to climb.
const storeys = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Storeys' }) });
await storeys.getByRole('button', { name: 'Two', exact: true }).click();
await page.waitForTimeout(300);
await page.getByTestId('wizard-generate').click();
await page.waitForTimeout(5000);

const plan = await readPlan(page);

// The plan, in full, so that a failed walk can be read afterwards without
// having to reproduce the run.
console.log('floor 0 rooms');
for (const r of plan.rooms) {
  if (r.floor !== 0) continue;
  console.log(`  ${r.label.padEnd(12)} x ${r.world.x0.toFixed(2)}..${r.world.x1.toFixed(2)}  z ${r.world.z0.toFixed(2)}..${r.world.z1.toFixed(2)}`);
}
console.log('floor 1 rooms');
for (const r of plan.rooms) {
  if (r.floor !== 1) continue;
  console.log(`  ${r.label.padEnd(12)} x ${r.world.x0.toFixed(2)}..${r.world.x1.toFixed(2)}  z ${r.world.z0.toFixed(2)}..${r.world.z1.toFixed(2)}`);
}
for (const floor of [0, 1]) {
  console.log(`floor ${floor} walls with openings`);
  for (const w of plan.walls) {
    if (w.floor !== floor) continue;
    console.log(`  ${w.type.padEnd(8)} ${w.a.x.toFixed(2)},${w.a.z.toFixed(2)} -> ${w.b.x.toFixed(2)},${w.b.z.toFixed(2)}  len ${w.len.toFixed(2)}`);
    for (const o of w.openings) {
      console.log(`      ${o.kind.padEnd(8)} w=${o.width} at (${o.at.x}, ${o.at.z})`);
    }
  }
}
console.log('stairs');
for (const s of plan.stairs) {
  console.log(
    `  ${s.name} · floor ${s.floor} → ${s.to} · run ${s.run.toFixed(2)} · ${s.riserCount} risers · width ${s.width.toFixed(2)}`,
  );
  console.log(`      foot (${s.foot.x.toFixed(2)}, ${s.foot.z.toFixed(2)})  head (${s.head.x.toFixed(2)}, ${s.head.z.toFixed(2)})`);
}
console.log('floor 0 furniture');
const byRoom = new Map(plan.rooms.map((r) => [r.id, r.label]));
for (const f of plan.furniture ?? []) {
  if (f.floor !== 0) continue;
  console.log(`  ${String(f.catalogId).padEnd(16)} ${byRoom.get(f.roomId) ?? '?'}  x ${(f.x - f.w / 2).toFixed(2)}..${(f.x + f.w / 2).toFixed(2)}  z ${(f.z - f.d / 2).toFixed(2)}..${(f.z + f.d / 2).toFixed(2)}  rot ${f.rotation}`);
}

// ── the route ───────────────────────────────────────────────────────────────
//
// Entrance → the rooms it takes to reach the stairwell → the flight → the
// landing at the head. Which rooms those are comes from the doors the plan
// actually has, found by walking the room graph.

const doors = doorsOf(plan);
const ground = plan.stairs[0]?.floor ?? 0;

const entrance = doors.find((d) => d.wall.type === 'exterior' && d.connects?.[1] == null);
if (!entrance) throw new Error('the plan has no entrance door');

const stair = plan.stairs[0];
if (!stair) throw new Error('the plan has no staircase');

const stairwell = roomAt(plan, stair.planCentre.x, stair.planCentre.y);
if (!stairwell) throw new Error('the flight is not in any room');

/** Room → the doors that lead out of it, on the ground floor. */
const adjacency = new Map();
const link = (room, edge) => {
  const list = adjacency.get(room) ?? [];
  list.push(edge);
  adjacency.set(room, list);
};
for (const d of doors) {
  if (d.floor !== ground) continue;
  const [a, b] = d.connects ?? [];
  if (!a || !b) continue;
  link(a, { door: d, to: b });
  link(b, { door: d, to: a });
}

/** Breadth-first: the doors to walk through to get from one room to another. */
function doorRoute(from, to) {
  const queue = [[from, []]];
  const seen = new Set([from]);
  while (queue.length) {
    const [room, path] = queue.shift();
    if (room === to) return path;
    for (const edge of adjacency.get(room) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push([edge.to, [...path, edge.door]]);
    }
  }
  return null;
}

const through = doorRoute(entrance.connects[0], stairwell.id);
if (!through) throw new Error('no door route from the entrance to the stairwell');

const labelOf = (id) => plan.rooms.find((r) => r.id === id)?.label ?? id;
console.log('entrance →', labelOf(entrance.connects[0]));
for (const d of through) console.log('  door →', labelOf(d.connects[0]), '/', labelOf(d.connects[1]));
console.log('stairwell →', stairwell.label);

// The waypoints, in order: outside the front door, in through it, in through
// each door on the way, then the foot of the flight, then its head.
//
// The point before and after each door is a metre either side of it, on the
// side the camera comes from and the side it goes to. The camera cannot be
// aimed at a door's middle and expect to go through it: it stops on the
// threshold, and the swing of the leaf is in the way.
const waypoints = [];
const push = (label, x, z) => waypoints.push({ label, x, z });

{
  // The outside face of the entrance: the side of its wall that is away from
  // the middle of the house.
  const n = wallNormal(entrance.wall);
  const rooms = plan.rooms.filter((r) => r.floor === ground);
  const cx = rooms.reduce((s, r) => s + (r.world.x0 + r.world.x1) / 2, 0) / Math.max(1, rooms.length);
  const cz = rooms.reduce((s, r) => s + (r.world.z0 + r.world.z1) / 2, 0) / Math.max(1, rooms.length);
  const away = Math.hypot(entrance.at.x + n.x - cx, entrance.at.z + n.z - cz) >
    Math.hypot(entrance.at.x - n.x - cx, entrance.at.z - n.z - cz);
  const sign = away ? 1 : -1;
  push('outside the front door', entrance.at.x + n.x * sign * 1.6, entrance.at.z + n.z * sign * 1.6);
  push('through the front door', entrance.at.x - n.x * sign * 1.2, entrance.at.z - n.z * sign * 1.2);
}

// A door's approach is kept clear of furniture for 0.7 m, so a waypoint a
// little under that is standing on floor a person can stand on. Further out and
// the waypoint can land inside the dining table, which is a fault in the
// *walkthrough*, not in the house.
const STAND = 0.65;

let previous = { x: waypoints[0].x, z: waypoints[0].z };
for (const d of through) {
  const n = wallNormal(d.wall);
  const near = Math.hypot(previous.x - (d.at.x + n.x), previous.z - (d.at.z + n.z));
  const far = Math.hypot(previous.x - (d.at.x - n.x), previous.z - (d.at.z - n.z));
  const sign = near <= far ? 1 : -1;
  push(`to the ${labelOf(d.connects[0]).toLowerCase()} door`, d.at.x + n.x * sign * STAND, d.at.z + n.z * sign * STAND);
  push(`through the ${labelOf(d.connects[0]).toLowerCase()} door`, d.at.x - n.x * sign * STAND, d.at.z - n.z * sign * STAND);
  previous = { x: d.at.x - n.x * sign * STAND, z: d.at.z - n.z * sign * STAND };
}

push('onto the landing at the foot of the flight', stair.foot.x, stair.foot.z - 0.5);
push('up the flight', stair.foot.x, stair.foot.z + stair.run * 0.5);
push('at the head of the flight', stair.head.x, stair.head.z - 0.4);
push('through the door at the head', stair.head.x, stair.head.z + 0.9);

// ── the walk ────────────────────────────────────────────────────────────────

await page.getByTestId('view-3d').click();
await page.waitForTimeout(4000);
await page.getByTestId('camera-walk').click();
await page.waitForTimeout(3000);

const canvas = page.getByTestId('scene-3d').locator('canvas');

/** Where the camera is and which way it is looking. */
const read = () => page.evaluate(async () => {
  const r3f = await import('/node_modules/.vite/deps/@react-three_fiber.js');
  let st = null;
  for (const v of r3f._roots.values()) { st = v.store?.getState?.() ?? v; break; }
  const cam = st.camera;
  const d = cam.getWorldDirection(new cam.position.constructor());
  return {
    x: +cam.position.x.toFixed(2), y: +cam.position.y.toFixed(2), z: +cam.position.z.toFixed(2),
    h: +Math.atan2(d.x, d.z).toFixed(3),
  };
});

/** What the camera is standing on, as the HUD reports it. */
const probe = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find((d) => /^feet /.test(d.textContent?.trim() ?? ''));
  return el?.textContent?.trim() ?? '(no probe)';
});

/**
 * The app's own view of where the camera is and what it is standing on.
 *
 * Read from the walk state rather than from the HUD text, because the HUD is
 * throttled to about seven reads a second and this browser has no GPU: the
 * numbers in it can be a frame or two behind the camera's real position.
 */
const state = () =>
  page.evaluate(() => {
    const w = window.__walk;
    if (!w) return null;
    return {
      x: +w.pos.x.toFixed(2),
      y: +w.pos.y.toFixed(2),
      z: +w.pos.z.toFixed(2),
      support: +w.support.toFixed(2),
      floorId: w.floorId,
    };
  });

/**
 * What is in the way, within a couple of metres of the camera.
 *
 * The camera stops for a reason, and the reason is in the collider list: a
 * wall, a piece of furniture, or the edge of a floor it is not standing on.
 */
const blockers = () => page.evaluate(() => {
  const w = window.__walk;
  if (!w) return '(no walk state)';
  const near = (c) => Math.hypot(c.x - w.pos.x, c.z - w.pos.z) < 2.2;
  const ext = (c) => `x ${(c.x - c.w / 2).toFixed(2)}..${(c.x + c.w / 2).toFixed(2)} z ${(c.z - c.d / 2).toFixed(2)}..${(c.z + c.d / 2).toFixed(2)}`;
  return JSON.stringify({
    pos: w.pos,
    colliders: w.colliders.filter(near).map((c) => `${ext(c)} y ${c.y0 ?? '-'}..${c.y1 ?? '-'}`),
    surfaces: w.surfaces.filter(near).map((c) => `y=${c.y?.toFixed(2)} ${ext(c)}${c.ramp ? ' RAMP' : ''}`),
  });
});

/**
 * Which way to step, given what is in the way.
 *
 * A person walking to the far side of a room does not walk at the far side of
 * the room; they walk round the chair in the way. The walker here does the
 * same: it starts from the direction to the goal and turns away from it by
 * increasing amounts until the step ahead is clear. The test is the same one
 * the camera makes — a circle of the camera's own radius against the
 * colliders that are at the camera's height — so what it finds clear is
 * exactly what the camera can walk into.
 */
const steer = (gx, gz) =>
  page.evaluate(
    ({ gx, gz }) => {
      const w = window.__walk;
      if (!w) return null;
      const R = 0.3; // the camera's radius, with a little margin
      const pos = { x: w.pos.x, z: w.pos.z };
      const y0 = w.pos.y - 1.62;
      const y1 = w.pos.y + 0.15;
      const solids = w.colliders.filter((c) => {
        if (c.floorId && w.floorId && c.floorId !== w.floorId) return false;
        const lo = c.y0 ?? -Infinity;
        const hi = c.y1 ?? Infinity;
        return hi > y0 && lo < y1;
      });
      const clear = (x, z) =>
        solids.every((c) => {
          const cx = Math.max(c.x - c.w / 2, Math.min(x, c.x + c.w / 2));
          const cz = Math.max(c.z - c.d / 2, Math.min(z, c.z + c.d / 2));
          return Math.hypot(x - cx, z - cz) >= R;
        });
      const toGoal = Math.atan2(gx - pos.x, gz - pos.z);
      const offs = [];
      for (let k = 0; k <= 12; k++) {
        const o = (k * Math.PI) / 12;
        offs.push(o, -o);
      }
      for (const o of offs) {
        const a = toGoal + o;
        const sx = pos.x + Math.sin(a) * 0.45;
        const sz = pos.z + Math.cos(a) * 0.45;
        if (clear(sx, sz)) return { a, off: o };
      }
      return { a: toGoal, off: null };
    },
    { gx, gz },
  );

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Hold a key until the app has acted on it.
 *
 * The app reads the keyboard once per frame, and this browser has no GPU, so a
 * frame takes about a fifth of a second. A key pressed and released between
 * two frames is never seen at all; a key held for a fixed number of
 * milliseconds acts for however many frames happened to fall inside it. So the
 * walker holds the key until the thing it wanted to change has changed, and
 * gives up after a timeout rather than hanging on a key the app is ignoring.
 */
async function holdUntil(key, changed, timeout = 2500) {
  await page.keyboard.down(key);
  const t0 = Date.now();
  let acted = false;
  while (Date.now() - t0 < timeout) {
    await page.waitForTimeout(40);
    if (await changed()) {
      acted = true;
      break;
    }
  }
  await page.keyboard.up(key);
  await page.waitForTimeout(40);
  return acted;
}

/**
 * Turn to face a heading, in radians, measured as the camera measures it.
 *
 * Turned in steps, each one checked against the camera, because one frame of
 * turning is a fixed angle and the error left over after it is not known until
 * the camera has actually moved. Q turns the camera one way and E the other;
 * which is which is read from the camera rather than assumed, because getting it
 * backwards makes the walker orbit the target instead of reaching it.
 */
async function turnTo(a) {
  for (let i = 0; i < 14; i++) {
    const p = await read();
    const err = wrap(a - p.h);
    if (Math.abs(err) < 0.1) return true;
    const key = err > 0 ? 'KeyQ' : 'KeyE';
    const before = p.h;
    await holdUntil(
      key,
      async () => Math.abs(wrap((await read()).h - before)) > 0.05,
      1500,
    );
  }
  const p = await read();
  return Math.abs(wrap(a - p.h)) < 0.3;
}

/** Turn to face a point. */
async function face(tx, tz) {
  const p = await read();
  await turnTo(Math.atan2(tx - p.x, tz - p.z));
}

/**
 * Walk toward a point, steering round what is in the way.
 *
 * If the camera stops making progress — furniture, a wall, a chair — it is
 * nudged sideways and tries again, because a route that has to thread a room
 * full of furniture is exactly the route a person has to walk.
 */
async function walkTo(tx, tz, label, maxMs = 90000) {
  const t0 = Date.now();
  let stuck = 0;
  let best = Infinity;
  while (Date.now() - t0 < maxMs) {
    const p = await read();
    const dist = Math.hypot(tx - p.x, tz - p.z);
    if (dist < 0.55) break;
    if (dist < best - 0.05) { best = dist; stuck = 0; } else stuck++;
    if (stuck >= 4) {
      // Nudged sideways: held until the camera has actually moved, and only a
      // quarter of a metre, so that a nudge off a wall does not throw the
      // camera across the flight.
      const from = await read();
      await holdUntil(
        stuck % 2 ? 'KeyD' : 'KeyA',
        async () => Math.abs((await read()).x - from.x) > 0.25,
        1200,
      );
      stuck = 0;
      continue;
    }
    const s = await steer(tx, tz);
    if (s) await turnTo(s.a);
    if (process.env.DEBUG) {
      const after = await read();
      console.log(
        `      · pos (${after.x}, ${after.z}) h ${after.h} → goal ${tx},${tz} d ${dist.toFixed(2)} steer ${s ? s.off : '?'} head ${after.h}`,
      );
    }
    // One step's worth of walking: held until the camera has moved a stride,
    // so that the step is the same length whatever the frame rate is.
    const from = await read();
    await holdUntil(
      'KeyW',
      async () => {
        const q = await read();
        return Math.hypot(q.x - from.x, q.z - from.z) > 0.35;
      },
      2500,
    );
  }
  const p = await read();
  const st = await state();
  const dist = Math.hypot(tx - p.x, tz - p.z);
  console.log(
    `  ${label}: (${p.x}, ${p.z}) · ${dist > 0.55 ? `NOT REACHED (${dist.toFixed(2)} m short)` : 'reached'} · ` +
      `feet ${st ? st.support : '?'} m · on ${st?.floorId ?? '?'} · ${await probe()}`,
  );
  if (dist > 0.55) console.log(`      blockers ${await blockers()}`);
  return p;
}

/**
 * A picture of where the camera is.
 *
 * The canvas is animating, and Playwright's element screenshot waits for the
 * element to be *stable* — so the camera is given a moment to come to rest
 * before the shutter, and the wait is long enough for a browser with no GPU
 * to actually get there. A failed picture must not end the walk.
 */
async function shoot(name) {
  await page.waitForTimeout(1500);
  try {
    await canvas.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 25_000, animations: 'disabled' });
    console.log(`  · picture ${SHOTS}/${name}.png`);
  } catch {
    /* the walk matters more than the picture */
  }
}

console.log('start:', JSON.stringify(await read()), '·', await probe());

if (process.env.FPS) {
  // How many frames the app is actually managing. The walk is driven a frame at
  // a time, so a slow frame rate is a slow walk — and a key pressed and
  // released between two frames is never seen by the app at all.
  const frames = await page.evaluate(async () => {
    let n = 0;
    let last = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      const w = window.__walk;
      // The walk state is rebuilt every frame, so a new object is a new frame.
      if (w && w !== last) {
        n++;
        last = w;
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return n;
  });
  console.log(`frames in 3 s: ${frames}`);
}
await shoot('stair-01-pavement');

let n = 2;
for (const w of waypoints) {
  try {
    await walkTo(w.x, w.z, w.label);
  } catch (e) {
    console.log(`  ${w.label}: WALK FAILED — ${String(e).slice(0, 160)}`);
  }
  await shoot(`stair-${String(n).padStart(2, '0')}-${w.label.replace(/[^a-z]+/gi, '-')}`);
  n++;
}

console.log('final:', JSON.stringify(await read()), '·', await probe());
await browser.close();

/**
 * Walking has to feel like walking, not like driving the editor with your feet.
 *
 * The regression that motivated this file was not a feel problem at all: the
 * keyboard map binds `W` to the Wall tool, `D` to the Door tool and `S` to the
 * snap toggle, and those listeners sit on `window` with no camera-mode check.
 * So pressing W to walk forward also armed the wall tool, strafing right armed
 * the door tool, and backing up flipped snapping — with the toolbar changing
 * under you on every stride. That is most of what made walk mode feel broken
 * and hard to move, and no amount of tuning the acceleration curve would have
 * fixed it.
 *
 * Nothing else in the suite could have caught it. `pointer-lock.spec.ts` clicks
 * and checks the pointer; `demo.spec.ts` presses W and checks the canvas
 * changed; neither looks at what the editor thought happened.
 *
 * The *feel* half of the change — the gait curve, the head bob, the diagonal
 * speed — is unit-tested in `collision.test.ts`, which can reach `wishVector`,
 * `approachVelocity`, `bobPhase` and `bob` directly and check them over the
 * whole input space. This file covers only what has to be true of the running
 * application.
 */
import { expect, test, type Page } from '@playwright/test';

/** A generated house, in the 3D view, walking. */
async function walking(page: Page) {
  await page.goto('/studio');
  await page.getByTestId('wizard-generate').click();
  await expect(page.getByTestId('onboarding')).toBeHidden();
  await page.getByTestId('view-3d').click();
  await page.getByTestId('camera-walk').click();
  await expect(page.getByText(/W A S D to walk/)).toBeVisible();
  // The walk state is published by the first frame the walk camera draws, and
  // the HUD above is React state that appears before it. On a loaded machine
  // that frame can be a second away — so the wait is for the state itself,
  // which is what every test in this file reads.
  await page.waitForFunction(() => Boolean((window as unknown as { __walk?: unknown }).__walk), null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(400);
}

/**
 * The camera's own state, as the application publishes it.
 *
 * The app writes `window.__walk` every frame in walk mode: where the camera
 * is, which way it is looking, which keys it has been told about, and which
 * storey it is on. It is a seam for exactly this purpose — `scripts/stairwalk.mjs`
 * reads it to walk the house without knowing anything about the camera rig.
 *
 * These tests used to compare a hash of the rendered picture instead, which
 * sounds stricter and is not. A hash of a downsampled frame measures the
 * *renderer*, not the camera: on a machine with no GPU the 3D view draws about
 * four frames a second, so the frame on the screen when the sample is taken can
 * be seconds old, and the picture changes for reasons that have nothing to do
 * with the camera — the first walk-mode frame replacing the last orbit-mode
 * one, a texture finishing its upload, a shadow map being redrawn. Asking the
 * state instead asks the question directly: did the camera move, did it turn,
 * and was it ever told about the key?
 */
interface CameraState {
  x: number;
  y: number;
  z: number;
  heading: number;
  yaw: number;
  floorId: string | null;
  keys: string[];
}

async function cameraState(page: Page): Promise<CameraState | null> {
  return page.evaluate(() => {
    const w = (window as unknown as {
      __walk?: {
        pos: { x: number; y: number; z: number };
        heading: number;
        yaw: number;
        floorId: string | null;
        keys: Record<string, boolean>;
      };
    }).__walk;
    if (!w) return null;
    return {
      x: w.pos.x,
      y: w.pos.y,
      z: w.pos.z,
      heading: w.heading,
      yaw: w.yaw,
      floorId: w.floorId,
      keys: Object.entries(w.keys)
        .filter(([, down]) => down)
        .map(([code]) => code),
    };
  });
}

/**
 * Wait for the application to draw its next frame, in the page.
 *
 * The view draws about four frames a second on a machine with no GPU, and a key
 * that is pressed and released between two frames is never seen by the camera
 * at all. So any test that holds a key down has to know that a frame went by
 * while it was held — otherwise "the camera did not move" is true for the wrong
 * reason, and a test that passes is a test that proves nothing.
 *
 * The wait is for the *next* frame rather than a count taken inside a fixed
 * slice of wall clock, because that slice is the part that breaks. Under a
 * loaded run — the whole suite in one go — a second and a half can pass with
 * nothing drawn at all, and the test would fail on a machine that is merely
 * busy, having proved nothing either way. Waiting for the next frame asks the
 * same question and takes as long as the machine needs.
 */
async function waitForFrame(page: Page, timeoutMs = 20_000): Promise<boolean> {
  return page.evaluate(async (ms) => {
    const w = window as unknown as { __walk?: unknown };
    // The walk state is rebuilt every frame, so a new object is a new frame.
    const last = w.__walk;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (w.__walk && w.__walk !== last) return true;
      await new Promise((r) => setTimeout(r, 16));
    }
    return false;
  }, timeoutMs);
}

/** Which tool the toolbar currently shows as pressed. */
async function activeTool(page: Page): Promise<string | null> {
  const pressed = page.locator('[data-testid^="tool-"][aria-pressed="true"]');
  const id = await pressed.first().getAttribute('data-testid');
  return id ? id.replace('tool-', '') : null;
}

test('walking forward does not change the active tool', async ({ page }) => {
  await walking(page);
  const before = await activeTool(page);

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);

  expect(await activeTool(page)).toBe(before);
});

test('strafe and back do not change the active tool either', async ({ page }) => {
  // The three keys that collided, in one test, because they collided for one
  // reason — fixing one and not the others would be worse than not fixing it.
  await walking(page);
  const before = await activeTool(page);

  for (const code of ['KeyD', 'KeyS', 'KeyA']) {
    await page.keyboard.down(code);
    await page.waitForTimeout(350);
    await page.keyboard.up(code);
    await page.waitForTimeout(150);
    expect(await activeTool(page), `${code} changed the tool`).toBe(before);
  }
});

test('W still arms the wall tool outside a camera', async ({ page }) => {
  // The other half of the fix, and the one that would silently break if the
  // gate were left unconditional: binding W to the Wall tool is not a bug, it
  // is the keyboard map, and orbiting is where the editor is used.
  await page.goto('/studio');
  await page.getByTestId('wizard-generate').click();
  await expect(page.getByTestId('onboarding')).toBeHidden();

  // The camera buttons only exist in the 3D view.
  await page.getByTestId('view-3d').click();
  await page.getByTestId('camera-orbit').click();
  await expect(page.getByTestId('camera-orbit')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('KeyW');
  expect(await activeTool(page)).toBe('wall');
});

test('Q turns the camera in walk mode', async ({ page }) => {
  // Walk mode had no look control at all except pointer lock, which needs a
  // click and swallows the cursor. Yaw is unbounded, so this is a full 360°.
  await walking(page);

  const before = await cameraState(page);
  expect(before, 'the app published its walk state').not.toBeNull();

  await page.keyboard.down('KeyQ');
  const drew = await waitForFrame(page);
  await page.keyboard.up('KeyQ');

  const after = await cameraState(page);
  expect(drew, 'the camera drew a frame while the key was held').toBe(true);
  // The camera turned on the spot: it did not walk, it looked.
  expect(Math.hypot(after!.x - before!.x, after!.z - before!.z), 'the camera stayed put').toBeLessThan(0.01);
  // The yaw is the camera's own rotation, which accumulates and never wraps, so
  // this is the turn itself rather than the difference between two headings —
  // a camera that has turned a full circle looks the same way as one that
  // never turned, and only the yaw tells those two apart.
  expect(after!.yaw - before!.yaw, 'the camera turned one way').toBeGreaterThan(0.3);
});

test('E turns the other way', async ({ page }) => {
  // Both directions, because "Q works" is also true of a binding that only
  // ever turns one way and leaves the user unable to look back.
  await walking(page);

  const before = await cameraState(page);
  expect(before, 'the app published its walk state').not.toBeNull();

  await page.keyboard.down('KeyE');
  const drew = await waitForFrame(page);
  await page.keyboard.up('KeyE');

  const after = await cameraState(page);
  expect(drew, 'the camera drew a frame while the key was held').toBe(true);
  // The opposite sign to Q's, which is what "the other way" means.
  expect(after!.yaw - before!.yaw, 'the camera turned the other way').toBeLessThan(-0.3);
});

test('typing in the assistant does not walk the camera', async ({ page }) => {
  // The camera controllers asked nothing about where a keystroke came from, so
  // typing "wasd" into the brief also drove the viewer through the house. The
  // editor shortcuts have guarded on this since the start; the cameras were the
  // other half of the same key and had no way to ask.
  await walking(page);

  const before = await cameraState(page);
  expect(before, 'the app published its walk state').not.toBeNull();
  expect(before!.keys, 'no key is held to begin with').toEqual([]);

  // The panel may already be open — toggling it would close it.
  if ((await page.getByTestId('toggle-assistant').getAttribute('aria-pressed')) !== 'true') {
    await page.getByTestId('toggle-assistant').click();
  }
  const field = page.getByTestId('assistant-input');
  await field.click();

  // Held down, not tapped. A key that is pressed and released between two
  // frames is never seen by the camera at all — this browser has no GPU and
  // the view draws about four frames a second — so a tap would pass even with
  // the bug this test exists to catch. The hold is long enough for several
  // frames, and the count below says how many actually went by.
  await page.keyboard.down('w');
  const drew = await waitForFrame(page);
  const during = await cameraState(page);
  await page.keyboard.up('w');

  // And the rest of the word, the way a person would type it.
  await field.pressSequentially('asd', { delay: 60 });
  await expect(field).toHaveValue('wasd');
  const after = await cameraState(page);

  // The camera had to have had a chance to move, or "it did not move" would be
  // true for the wrong reason.
  expect(drew, 'the camera drew a frame while the key was held').toBe(true);

  // The camera was never told about the key — that is the fix, and it is the
  // camera's own map of what it has been told, not a picture of what it did.
  expect(during!.keys, 'the camera was never told about the key').toEqual([]);
  expect(after!.keys, 'nor about the rest of the word').toEqual([]);
  expect(Math.hypot(after!.x - before!.x, after!.z - before!.z), 'the camera did not move').toBeLessThan(0.01);
});

test('leaving the camera restores the tool shortcuts', async ({ page }) => {
  // The gate has to be a gate and not a deletion. Escape leaves walk mode, and
  // W goes back to meaning the Wall tool — otherwise the fix has quietly
  // removed a documented binding from the product.
  await walking(page);

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  expect(await activeTool(page)).not.toBe('wall');

  await page.keyboard.press('Escape');
  await expect(page.getByText(/W A S D to walk/)).toBeHidden();
  await page.keyboard.press('KeyW');
  expect(await activeTool(page)).toBe('wall');
});
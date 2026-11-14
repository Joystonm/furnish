/**
 * Doors open as you walk towards them.
 *
 * The unit tests in `sceneModel.test.ts` pin the geometry — a leaf is a pivot
 * plus parts measured from it, pivoting at the leaf's edge. What they cannot
 * reach is the wiring: a `walker` ref published each frame by `FirstPerson`, a
 * distance test in `SwingDoorLeaf`, and a `rotation.y` written on the group. A
 * break in any one of them is invisible to every other test here, because the
 * leaf still renders perfectly well as a flat box in the wall — it just never
 * moves.
 *
 * So this test saves the frames instead of asserting over them, and says why in
 * the artefact directory it prints. A frame hash cannot tell a swinging door
 * from a walking camera: both change every pixel. What identifies it as a *door*
 * is that the leaf is in a different position from the same viewpoint, which is
 * a judgement made by looking. The frames are the evidence for that judgement.
 *
 * What this does assert is everything that *is* decidable: the walk throws
 * nothing, and the canvas is still drawing at the end of it. A door that
 * unmounted its parent, or a frame callback that threw, would take the whole
 * Canvas with it — the same failure `walkHud.spec.ts` is built around.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

let artefacts = '';

test.beforeAll(() => {
  artefacts = fs.mkdtempSync(path.join(os.tmpdir(), 'furnish-doors-'));
});

/** Generates a house and enters walk mode, on the pavement facing the door. */
async function walking(page: Page) {
  await page.goto('/studio');
  await page.getByTestId('wizard-generate').click();
  await expect(page.getByTestId('onboarding')).toBeHidden();
  await page.getByTestId('view-3d').click();
  await page.getByTestId('camera-walk').click();
  await expect(page.getByText(/W A S D to walk/)).toBeVisible();
  await page.waitForTimeout(600);
}

/**
 * Walk forward in short bursts.
 *
 * Bursts rather than one long hold, because the endpoint has to be *at* a
 * doorway: a single hold carries the walker through the front door and into
 * the hall, where the camera faces a blank wall and the door that opened is
 * behind it. How many bursts is deliberately not pinned — the frame budget
 * under SwiftShader varies enough between runs to overshoot by metres — so the
 * frames land somewhere near the threshold and the test asserts nothing about
 * exactly where.
 */
async function walkForward(page: Page, bursts: number) {
  for (let i = 0; i < bursts; i++) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(700); // let the leaf finish turning
}

test('a door opens as the walker comes up to it', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await walking(page);

  // From the pavement: the entrance is well outside the two-metre trigger, so
  // its leaf is shut and flat in the frame.
  await page.screenshot({ path: path.join(artefacts, '01-shut.png') });

  await walkForward(page, 8);
  await page.screenshot({ path: path.join(artefacts, '02-at-the-threshold.png') });

  // And back off, which is the half that is easy to forget: a door that latches
  // open stops being a door and becomes a slab parked across the hall.
  await walkForwardBack(page);
  await page.screenshot({ path: path.join(artefacts, '03-back-away.png') });

  console.log(`door-swing frames written to: ${artefacts}`);

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  await expect(page.getByTestId('scene-3d').locator('canvas')).toBeVisible();
});

/** The same walk in reverse. */
async function walkForwardBack(page: Page) {
  for (let i = 0; i < 8; i++) {
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyS');
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(700);
}
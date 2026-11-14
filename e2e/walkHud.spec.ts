/**
 * The walk-through HUD must not be able to take the 3D view down with it.
 *
 * This exists because of a real crash. The "Blocked — turn or step back"
 * banner was written as a bare `<div>` sitting directly inside the
 * `<group>` that holds the walk controls. `<group>` is a react-three-fiber
 * node, so R3F resolves every JSX element beneath it as a THREE object and
 * throws
 *
 *     R3F: Div is not part of the THREE namespace! Did you forget to extend?
 *
 * — which does not fail that one banner, it unmounts the entire Canvas, and
 * with it the WebGL context. The user's building disappeared.
 *
 * Why 43 passing end-to-end tests never caught it: the branch renders only
 * when the camera is touching something *and* pointer lock is held. Pointer
 * lock does not engage in headless Chromium, so the branch had never once been
 * rendered by an automated run. This test therefore has to make both true —
 * which is why it stubs `requestPointerLock` instead of clicking and hoping.
 *
 * The assertion is deliberately the coarse one: after driving the camera into
 * a wall, the canvas must still be there and must still be drawing. If R3F
 * throws, the Canvas is gone and the signature collapses to -1, so this
 * catches the regression whether or not the banner happens to appear.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Make pointer lock succeed, which it does not on its own in headless Chromium.
 *
 * Both halves matter. `requestPointerLock` has to resolve, or the click is
 * followed by an unhandled rejection, and `document.pointerLockElement` has to
 * read back non-null, because that is what `onLock` consults to decide whether
 * the HUD should be showing. Stubbing only the method leaves `hud.locked`
 * false and the branch under test unreachable — which is the same blind spot
 * the original suite had, for a different reason.
 */
const POINTER_LOCK_STUB = () => {
  let target: Element | null = null;
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => target,
  });
  Element.prototype.requestPointerLock = function requestPointerLock(this: Element) {
    target = this;
    document.dispatchEvent(new Event('pointerlockchange'));
    return Promise.resolve();
  };
  document.exitPointerLock = function exitPointerLock() {
    target = null;
    document.dispatchEvent(new Event('pointerlockchange'));
    return Promise.resolve();
  };
};

let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  await context.addInitScript(POINTER_LOCK_STUB);
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/studio');
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await page.getByTestId('wizard-generate').click();
  await expect(page.getByTestId('onboarding')).toBeHidden();
  await page.getByTestId('view-3d').click();
  await page.getByTestId('camera-walk').click();
  await expect(page.getByText('Click to walk')).toBeVisible();
  // The lock is requested by clicking the 3D view itself, which is what the
  // on-screen card asks for. Done here rather than in a test so both tests
  // below observe the same locked state.
  await page.locator('.furnish-3d-view').click();
});

test.afterAll(async () => {
  expect(pageErrors, 'the browser threw nothing').toEqual([]);
});

test.describe('the walk-through overlay', () => {
  test('pointer lock is genuinely held, or this test proves nothing', async () => {
    // The "Click to walk" card is only rendered while `hud.locked` is false.
    // Its disappearance is the proof the stub reached the app. (The matching
    // assertion cannot be made against "W A S D to walk": that string is also
    // in the always-visible hint strip along the bottom of the view.)
    await expect(page.getByText('Click to walk')).toBeHidden();
    expect(await page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
  });

  test('walking into a wall does not unmount the canvas', async () => {
    const scene = page.getByTestId('scene-3d');
    await expect(scene.locator('canvas')).toBeVisible();
    const walking = await signature();
    expect(walking, 'the 3D view is drawing before we push').not.toBe(-1);

    // Walk forward until something stops us. The camera starts on the pavement
    // facing the front door, so this ends against the front elevation rather
    // than at the plot boundary, which does not register as contact.
    await page.keyboard.down('KeyW');
    await expect(page.getByText('Blocked — turn or step back')).toBeVisible({ timeout: 30_000 });
    await page.keyboard.up('KeyW');

    // The banner itself is a DOM node living inside the canvas tree, so its
    // presence means R3F accepted the JSX instead of throwing on it. The
    // signature check is the belt: it fails if the Canvas died for any other
    // reason on the same frame.
    await expect(scene.locator('canvas'), 'the Canvas survived the overlay').toBeVisible();
    await expect.poll(() => signature(), { timeout: 15_000 }).not.toBe(-1);
  });
});

/** A signature of what the canvas is actually showing; -1 means "no canvas". */
async function signature(): Promise<number> {
  return page.getByTestId('scene-3d').evaluate((el) => {
    const src = el.querySelector('canvas') as HTMLCanvasElement | null;
    if (!src) return -1;
    const s = document.createElement('canvas');
    s.width = 48;
    s.height = 30;
    const ctx = s.getContext('2d');
    if (!ctx) return -1;
    ctx.drawImage(src, 0, 0, 48, 30);
    const d = ctx.getImageData(0, 0, 48, 30).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4) {
      h ^= d[i]! + d[i + 1]! * 3 + d[i + 2]! * 7;
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  });
}
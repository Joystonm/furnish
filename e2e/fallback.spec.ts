/**
 * What the user sees when no model planned the layout.
 *
 * The other half of the room-program feature, and the half that is easier to
 * get wrong: a Generate that fails has to still produce a usable plan, and
 * still be unmistakable that nobody designed it. This runs the app against a
 * server with no key at all, so the failure is a real one and not a stubbed
 * response.
 *
 * The assertions are all about wording. A fallback that says "Plan generated"
 * has told the user something true about geometry and something false about
 * authorship, and the second is the one that costs.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { toastTexts, watchToasts } from './toastLog.ts';

/** The second server in playwright.config.ts, started with no API key. */
const BARE = `http://127.0.0.1:${Number(process.env.BARE_PORT ?? 8789)}`;

let page: Page;
let browserRef: Browser;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  const context = await browserRef.newContext({ viewport: { width: 1600, height: 1000 } });
  await watchToasts(context);
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(`${BARE}/studio`);
  await page.getByTestId('onboarding').waitFor({ state: 'visible', timeout: 30_000 });
});

test.afterAll(async () => {
  await page.context().close();
});

test.describe.configure({ mode: 'serial' });

test('a Generate with no model still plans, and says nobody planned it', async () => {
  await page.getByTestId('wizard-generate').click();
  await page.getByTestId('onboarding').waitFor({ state: 'hidden', timeout: 60_000 });

  // A real plan: rooms, walls, openings. The fallback is a working fallback.
  const rooms = await page.locator('[data-testid="room"]').count();
  expect(rooms, 'the fallback must still produce rooms').toBeGreaterThan(3);
  expect(await page.locator('[data-wall-id]').count()).toBeGreaterThan(0);
  expect(await page.locator('[data-opening-id]').count()).toBeGreaterThan(0);

  // And it says so, in a warning and not a confirmation. The text is read in
  // one go rather than asserted a phrase at a time, and it is read from the
  // record the page keeps of what it rendered rather than from the live
  // element: the toast is deliberately long-lived but not permanent, and a
  // suite whose own round trips can outlast it would otherwise be asserting
  // on an element that had already been read.
  await expect
    .poll(async () => (await toastTexts(page)).join('\n'), { timeout: 15_000 })
    .toContain('No model planned this layout');
  const copy = (await toastTexts(page)).find((t) => t.includes('No model planned this layout')) ?? '';
  expect(copy, 'the reason must be named, not implied').toMatch(/not configured/i);
  expect(copy, 'the user is told what would fix it').toContain('MINIMAX_API_KEY');
  // The audit copy: what the fallback actually did, so the user knows what
  // they are looking at and does not assume an ensuite is coming.
  expect(copy).toContain('catalogue room sizes');
  expect(copy).toContain('rooms on one');
});

test('the Checks panel keeps saying it, after the toast is gone', async () => {
  await page.getByRole('tab', { name: 'Checks' }).click();
  const notice = page.getByTestId('provenance-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('No model planned this layout');
  await expect(notice).not.toContainText('MiniMax planned');
  // It must not read as an error either — nothing is broken, the plan is fine.
  await expect(notice).not.toHaveClass(/text-danger/);
});

test('the plan is still geometrically valid', async () => {
  await expect(page.getByTestId('problems-panel')).toContainText('No problems found', { timeout: 15_000 });
});

test('the browser threw nothing', async () => {
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

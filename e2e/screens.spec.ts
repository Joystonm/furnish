/**
 * Pictures of the product, taken by a run anyone can repeat.
 *
 * A redesign is reviewed by looking at it. Asserting that a class name is
 * present proves the markup is there, not that the screen reads well — and the
 * difference between the two is the whole point of a redesign.
 *
 * So this captures the three screens and the 3D view, and writes them to
 * `shots/`. It also checks that each capture is a real picture and not a blank
 * frame: a 1600 × 1000 PNG of one flat colour is a few kilobytes, and a screen
 * that rendered something is a good deal larger than that.
 *
 * These are artefacts, not assertions about how the product looks. The
 * assertions here are only that each screen rendered at all — which is a real
 * check, and the one a screenshot cannot make on its own.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';

const SHOTS = 'shots';

let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  expect(pageErrors, 'the browser threw nothing').toEqual([]);
});

/** Take a picture, and check that there is a picture in it. */
async function shoot(name: string, fullPage = false): Promise<string> {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path, fullPage });
  const bytes = statSync(path).size;
  expect(bytes, `${path} must not be a blank frame`).toBeGreaterThan(20_000);
  console.log(`  · ${path} (${Math.round(bytes / 1024)} kB)`);
  return path;
}

test.describe('the screens', () => {
  test('the landing page', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Describe your home');
    await page.waitForTimeout(600);
    await shoot('ui-01-home');

    // The landing page scrolls inside a fixed-height column, so the *document*
    // never scrolls and a `fullPage` capture would take the same frame a
    // second time — it did, and the two files were byte for byte identical.
    // The window is made tall enough to hold the content instead, and put
    // back afterwards so the other pictures are taken at the usual size.
    const tall = await page.evaluate(() => {
      const column = document.querySelector('.overflow-y-auto');
      return column ? Math.ceil(column.scrollHeight) : document.body.scrollHeight;
    });
    await page.setViewportSize({ width: 1600, height: Math.min(tall, 6000) });
    await page.waitForTimeout(500);
    await shoot('ui-02-home-full');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(300);
  });

  test('the dashboard', async () => {
    await page.goto('/projects');
    await expect(page.getByTestId('projects')).toBeVisible();
    await page.waitForTimeout(400);
    await shoot('ui-03-projects');
  });

  test('the editor, in 2D and in 3D', async () => {
    await page.goto('/studio');
    await page.getByTestId('onboarding').waitFor({ state: 'visible', timeout: 30_000 });

    // Two storeys, so there is a flight to look at.
    const storeys = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Storeys' }) });
    await storeys.getByRole('button', { name: 'Two', exact: true }).click();
    await page.getByTestId('wizard-generate').click();
    await page.getByTestId('onboarding').waitFor({ state: 'hidden', timeout: 60_000 });
    await page.waitForTimeout(1200);

    await shoot('ui-04-studio-2d');

    // The panel that reports what is wrong with the plan.
    await page.getByRole('tab', { name: 'Checks' }).click();
    await page.waitForTimeout(500);
    await shoot('ui-05-studio-checks');
    await page.getByRole('tab', { name: 'Properties' }).click();

    // And the same model, seen from outside.
    await page.getByTestId('view-3d').click();
    await page.waitForTimeout(5000);
    await shoot('ui-06-studio-3d');
  });
});

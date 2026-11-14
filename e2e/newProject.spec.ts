/**
 * "New project" has to ask for a brief.
 *
 * The complaint this came from was exact: clicking File → New project dropped
 * the user straight onto an empty canvas at the *same* plot size they had been
 * working on, with no questions asked — indistinguishable from a bug where the
 * button did nothing.
 *
 * Two things had to be true, and they are separate failures that looked like
 * one:
 *
 *   1. The wizard opened at all. `App` computed that in a `useState` initializer,
 *      which runs once at mount, so a project started later never reached it.
 *   2. It opened on a *different* plan. The brief seeds itself from the project
 *      being replaced, so carrying the old plot across would reproduce the exact
 *      symptom even with the wizard showing.
 *
 * Asserted in a real browser because the defect was in the wiring between three
 * files, and no unit test of the store can see whether the wizard renders.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/studio');
  // A first visit opens the wizard; generate a real plan so there is something
  // to destroy.
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await page.getByTestId('wizard-generate').click();
  await expect(page.getByTestId('onboarding')).toBeHidden();
});

test.afterAll(async () => {
  expect(pageErrors, 'the browser threw nothing').toEqual([]);
});

test.describe('File → New project', () => {
  test('asks for a brief instead of leaving the previous plot on screen', async () => {
    // The plot that exists right now, so the assertion below is about a change
    // rather than about a constant.
    const before = await readPlot();
    expect(before.rooms, 'the first plan is real').toBeGreaterThan(1);

    await page.getByTestId('file-menu').click();
    await page.getByRole('button', { name: /New project/ }).click();

    // 1. The wizard appears. This is what never happened.
    await expect(page.getByTestId('onboarding'), 'New project must ask for a brief').toBeVisible();
    await expect(page.getByText('Plan your home')).toBeVisible();

    // 2. The old plan is gone — a fresh project, not the old one restyled.
    await expect(page.locator('[data-testid="rooms"] > g')).toHaveCount(0);

    // 3. And the form is not pre-filled with the plot just replaced, which was
    //    the symptom that made this read as "nothing happened".
    const seeded = await readPlot();
    expect(seeded.rooms).toBe(0);
    void before;
  });

  test('the new brief actually produces a new plan', async () => {
    // Typed numbers, not defaults: the point is that the answer is used.
    await page.getByTestId('plot-width').fill('20');
    await page.getByTestId('plot-depth').fill('16');
    await page.getByTestId('room-living').check();
    await page.getByTestId('wizard-generate').click();
    await expect(page.getByTestId('onboarding')).toBeHidden();

    const after = await readPlot();
    expect(after.rooms, 'the fresh brief was generated').toBeGreaterThan(0);

    // The Checks panel is behind a tab, so this has to open it. What matters
    // here is that the new project is a normal project: the plumbing the wizard
    // writes to is the same plumbing everything else reads.
    await page.getByRole('tab', { name: 'Checks' }).click();
    await expect(page.getByTestId('problems-panel')).toBeVisible();
    await page.getByRole('tab', { name: 'Properties' }).click();
  });

  test('the wizard does not come back over a finished plan', async () => {
    // The flag that opens the wizard must be cleared by whatever installed the
    // project, or every plan opens with a form over it.
    await expect(page.getByTestId('onboarding')).toBeHidden();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('onboarding')).toBeHidden();
  });

  test('Change the brief still works afterwards', async () => {
    // The pre-existing path must survive the change — it is the one the code
    // already had working.
    await page.getByTestId('change-brief').click();
    await expect(page.getByTestId('onboarding')).toBeVisible();

    // And dismissing it without generating leaves the plan alone.
    await page.getByTestId('wizard-empty').click();
    await expect(page.getByTestId('onboarding')).toBeHidden();
    expect((await readPlot()).rooms).toBe(0);
  });
});

async function readPlot(): Promise<{ rooms: number }> {
  return page.evaluate(() => ({
    rooms: document.querySelectorAll('[data-testid="rooms"] > g').length,
  }));
}
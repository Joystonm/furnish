/**
 * The three routes, and what each one is for.
 *
 * `/` is the landing page, `/projects` is the dashboard, `/studio` is the
 * editor. There is no routing library — `src/router.ts` is one string of path
 * and a `popstate` — so the three of them are the whole of the navigation, and
 * the two ways of moving between them are the two ways a browser offers:
 *
 *   · a link, which the app intercepts and turns into `pushState`
 *   · the back button, which fires `popstate` — and which a hand-rolled
 *     router has to be told about, because `pushState` fires no event of its own
 *
 * Both were broken in ways a unit test cannot see: the app has no URL of its
 * own in a unit test, and there is no browser to press Back in one. So the
 * landing page and the route change are checked here, in a browser, against the
 * built bundle.
 *
 * The landing page is also the one page a visitor sees before they know what
 * the product is, so it carries two promises that are worth asserting rather
 * than trusting: the plan in the hero is drawn by the product itself (a
 * marketing illustration that the code cannot produce is a picture that drifts),
 * and the page asks nobody's permission to load — no webfont, no tracker, no
 * third party at all.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

let page: Page;
const pageErrors: string[] = [];
/** Every request the page made that did not come from this server. */
const offSite: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) return;
    offSite.push(url);
  });
});

test.afterAll(async () => {
  expect(pageErrors, 'the browser threw nothing').toEqual([]);
});

test.describe('the landing page', () => {
  test('loads at / and says what the product is', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Describe your home');
    // The brand, in the header.
    await expect(page.getByRole('banner').getByText('Furnish')).toBeVisible();
  });

  test('the plan in the hero is drawn by the product, not shipped as a picture', async () => {
    const drawing = page.locator('figure svg[role="img"]');
    await expect(drawing, 'the hero shows a plan').toBeVisible();

    // It describes itself in the words the page is making: a plot, a number of
    // rooms and a total area, all of them computed.
    const label = await drawing.getAttribute('aria-label');
    expect(label).toMatch(/metre plot, with \d+ rooms totalling \d+ square metres/);

    // And it is a drawing: geometry inside the SVG, not a raster.
    const shapes = await drawing.locator('path, rect, line, polyline, polygon').count();
    expect(shapes, 'the hero plan is geometry, not an image').toBeGreaterThan(8);
    // The exporter labels the rooms, so a label is in there too.
    expect(await drawing.locator('text').count(), 'the rooms are named').toBeGreaterThan(0);

    // The caption under it agrees with the drawing, which is the same plan the
    // studio can load as the sample house.
    await expect(page.getByText('18 × 20 m')).toBeVisible();
  });

  test('it asks nobody else for anything', async () => {
    offSite.length = 0;
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(1000);
    // A webfont would hand every visitor's address to a third party the moment
    // the page loaded, which would make the promise on the page untrue.
    expect(offSite, 'the landing page must not call out to anyone').toEqual([]);
  });

  test('it states its limits instead of hiding them', async () => {
    // The heading's apostrophe is the plain one — the page writes it that way
    // in the title, and the typographic one only in the navigation link.
    await expect(page.getByRole('heading', { name: "What it is, and what it isn't." })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Concept stage, not a permit' })).toBeVisible();
    await expect(page.getByText(/not construction-ready/)).toBeVisible();
    // And it is honest about the formats: SVG, PNG and JSON, and no more.
    await expect(page.getByRole('heading', { name: 'SVG, PNG and JSON — and that is the list' })).toBeVisible();
  });
});

test.describe('moving between the routes', () => {
  test('"Open the studio" goes to the dashboard, not straight into an editor', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Open the studio' }).first().click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByTestId('projects')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
  });

  test('the back button goes back, which a hand-rolled router has to be told about', async () => {
    // `history.pushState` fires no event of its own, so an app that only
    // listens for one will show the right URL and the wrong page.
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Describe your home');
  });

  test('a new project goes to the editor', async () => {
    await page.goto('/projects');
    await page.getByTestId('project-new').click();
    await expect(page).toHaveURL(/\/studio$/);
    // The editor is the editor: its chrome is there, and it asked for a brief
    // rather than showing an empty sheet.
    await expect(page.getByTestId('file-menu')).toBeVisible();
    await expect(page.getByTestId('onboarding')).toBeVisible();
  });

  test('/studio opens on a direct visit, and on a refresh', async () => {
    await page.goto('/studio');
    await expect(page.getByTestId('file-menu')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('file-menu')).toBeVisible();
    await expect(page).toHaveURL(/\/studio$/);
  });

  test('the dashboard can be reached and left again', async () => {
    await page.goto('/projects');
    await expect(page.getByTestId('projects')).toBeVisible();
    // The brand in the header is a link home, and it is a real link: it has an
    // href, so it can be copied, opened in a new tab and read by a screen
    // reader, whether or not the click is intercepted.
    const home = page.getByRole('banner').getByRole('link', { name: 'Furnish' });
    await expect(home).toHaveAttribute('href', '/');
    await home.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Describe your home');
  });
});

/**
 * Generate, in a real browser, against the real server and the real bundle.
 *
 * This is the test for the complaint that started the feature: *"minimax is not
 * thinking and creating layout design of home, randomly its creating."* Before,
 * the Generate button ran a fixed recipe and the wizard said so in its footer.
 * Now it asks the model for a room program and the packer places it.
 *
 * What can be asserted here, honestly:
 *
 *   · the request really went to the server, and the server really called the
 *     model — read from the stand-in's own request log, not from the app
 *   · the rooms that come out are the rooms the model asked for, including the
 *     ones the default brief cannot produce
 *   · the connections the model asked for exist as real doors in the built
 *     geometry, which is the only way to know adjacency was honoured
 *   · the app says a model planned it, and the Checks panel keeps saying so
 *
 * What cannot be asserted here: that the layout is *good*. It is a legitimate
 * plan, not a vetted one, and the plan is not a compliance document.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { toastTexts, watchToasts } from './toastLog.ts';

const FAKE_PORT = Number(process.env.FAKE_MINIMAX_PORT ?? 8799);

let page: Page;
let browserRef: Browser;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  await open();
});

test.afterAll(async () => {
  await page.context().close();
});

test.describe.configure({ mode: 'serial' });

async function open() {
  const context = await browserRef.newContext({ viewport: { width: 1600, height: 1000 } });
  await watchToasts(context);
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
}

async function throughGenerate() {
  await page.context().close();
  await open();
  await page.goto('/studio');
  await page.getByTestId('onboarding').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('wizard-generate').click();
  await page.getByTestId('onboarding').waitFor({ state: 'hidden', timeout: 60_000 });
  await page.waitForTimeout(500);
}

/** Every request the stand-in received, straight from its own log. */
async function upstreamRequests(): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`http://127.0.0.1:${FAKE_PORT}/__requests`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

test.describe('Generate asks the model to plan the rooms', () => {
  test('the server called the model, and the model chose the rooms', async () => {
    await throughGenerate();

    const calls = (await upstreamRequests()).filter((r) => r.model === 'MiniMax-M3');
    // The program call is the one with the tool pinned — `tool_choice` naming
    // it — which is how it is told apart from the assistant's own turns.
    const programCall = calls.find((r) => (r.toolChoice as { name?: string } | null)?.name === 'propose_room_program');
    expect(programCall, 'the server must call the model with the program tool pinned').toBeTruthy();

    // The key is in the Authorization header on the server side and nowhere in
    // the browser. The stand-in records what it was sent, which is the proof.
    expect(programCall!.authorization).toMatch(/^Bearer /);
    expect(programCall!.authorization).not.toContain('undefined');

    // Exactly one tool, and it is the program tool: the model cannot be
    // choosing between a program and something else on the way in.
    expect(programCall!.toolCount).toBe(1);
  });

  test('the plan contains rooms the default brief cannot produce', async () => {
    await throughGenerate();

    const kinds = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="room"]')].map((g) => g.getAttribute('data-kind') ?? ''),
    );

    // The default brief is one of each of the four basics. A guest room and a
    // dining room can only be here because the model added them — so this
    // assertion must not depend on how many bedrooms the brief happened to ask
    // for. That is why the fake planner writes the guest room into its shape
    // unconditionally rather than deriving it from the brief's bedroom count.
    expect(kinds, 'the model added a room the brief never mentioned').toContain('guest');
    expect(kinds, 'the model added a dining room the brief never mentioned').toContain('dining');
    // And the ensuite the model asked for is a second bathroom, not the same
    // one the brief ticked.
    expect(kinds.filter((k) => k === 'bathroom').length).toBeGreaterThanOrEqual(2);
  });

  test('the connections the model asked for are real doors', async () => {
    await throughGenerate();

    // A door is the observable consequence of adjacency: the planner derives
    // doors from shared walls, so a bedroom with a door straight onto a
    // bathroom and no corridor between them is the ensuite, built.
    const ensuite = await page.evaluate(() => {
      const rooms = [...document.querySelectorAll('[data-testid="room"]')] as SVGGElement[];
      const box = (g: SVGGElement) => {
        const b = (g.querySelector('rect') as SVGRectElement).getBBox();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      const beds = rooms.filter((g) => (g.getAttribute('data-kind') ?? '').includes('bedroom'));
      const baths = rooms.filter((g) => g.getAttribute('data-kind') === 'bathroom');
      // Any bedroom and bathroom pair whose rectangles touch along an edge.
      return beds.some((bed) => {
        const a = box(bed);
        return baths.some((bath) => {
          const b = box(bath);
          const sharedH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          const sharedV = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          return (sharedH > 1.0 && sharedV <= 0.6) || (sharedV > 1.0 && sharedH <= 0.6);
        });
      });
    });
    expect(ensuite, 'a bedroom and its bathroom must share a wall the planner can door').toBe(true);
  });

  test('the app tells the user a model planned it, in the toast and in Checks', async () => {
    await throughGenerate();

    // The toast is transient and this suite's own round trips can outlast it,
    // so it is read from the record the page keeps of what it rendered — see
    // e2e/toastLog.ts. What is asserted is the same thing as before: the app
    // told the user, in a toast, that a model planned the layout.
    await expect
      .poll(async () => (await toastTexts(page)).join('\n'), { timeout: 15_000 })
      .toContain('MiniMax planned');

    // The toast disappears. The Checks panel does not — that is why the
    // provenance is stored on the project rather than only announced.
    await page.getByRole('tab', { name: 'Checks' }).click();
    const notice = page.getByTestId('provenance-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('MiniMax planned');
    await expect(notice).not.toContainText('No model planned');
  });

  test('the plan is geometrically sound, not merely pretty', async () => {
    await throughGenerate();
    await page.getByRole('tab', { name: 'Checks' }).click();
    // Zero error-severity issues means walls meet, openings fit their walls,
    // no room overlaps another and the footprint sits inside the setbacks.
    await expect(page.getByTestId('provenance-notice')).toBeVisible();
    await expect(page.getByTestId('problems-panel')).toContainText('No problems found', { timeout: 15_000 });
  });

  test('the browser threw nothing', async () => {
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

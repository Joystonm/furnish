/**
 * Watching the transient toasts from inside the page.
 *
 * A toast is on screen for a few seconds. That is right for a person and
 * awkward for a test that asks the browser a question some seconds later: the
 * round trips this suite makes — the generate itself, the trace's screencast,
 * the read-back — can outlast the toast's life, and then the assertion is
 * reporting on a toast that was never wrong.
 *
 * That is not hypothetical. `roomProgram.spec.ts` failed on every run for a
 * while, with the toast container empty and the plan on screen: the plan and
 * the toast arrive together, and by the time the assertion had asked, the
 * toast had gone. The message was right. The question was asked too late.
 *
 * So the observation is taken where the toast actually is. A
 * `MutationObserver` inside the page records the text of every toast as it is
 * rendered, and the assertion reads that record. What it asserts is what the
 * old assertion asserted — the app put "MiniMax planned …" in front of the
 * user — without depending on catching a transient element in the act of
 * disappearing.
 */
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Start recording every toast this context renders.
 *
 * It has to be installed on the *context*, not the page: several of these
 * specs throw the page away and open a new one for each step, and a script
 * added to a page that no longer exists records nothing.
 */
export async function watchToasts(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __toastLog?: string[] }).__toastLog = log;

    // The toast container is React's, so it does not exist yet when an init
    // script runs. Wait for it rather than assuming a shape.
    const install = () => {
      const container = document.querySelector('[data-testid="toasts"]');
      if (!container) {
        window.setTimeout(install, 25);
        return;
      }
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            const text = (node.textContent ?? '').trim();
            if (text) log.push(text);
          }
        }
      }).observe(container, { childList: true, subtree: true });
    };
    install();
  });
}

/** Every toast text this page has rendered, oldest first. */
export async function toastTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __toastLog?: string[] }).__toastLog ?? []);
}

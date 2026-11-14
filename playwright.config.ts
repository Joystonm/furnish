/**
 * Playwright configuration for the end-to-end demo.
 *
 * Three servers, because there are two different deployments worth testing and
 * they differ in one environment variable:
 *   · the stand-in MiniMax endpoint, which the app's own server talks to
 *   · the app itself, built and served by `server/main.ts`, WITH a key
 *   · the same app on a second port with NO key, which is how a real install
 *     looks before anyone has set one up
 *
 * The third is not a convenience. The Generate button has to work either way,
 * and the difference the user must be shown — that a model planned this, or
 * that nobody did — can only be tested by running both. Asserting the fallback
 * against a stubbed response would prove nothing about the 503 the server
 * actually returns.
 *
 * The app is served from `dist/`, not from the dev server, so the demo runs
 * against the same bundle `npm run build` produces.
 */
import { defineConfig } from '@playwright/test';

const APP_PORT = 8788;
const FAKE_PORT = 8799;
const BARE_PORT = 8789;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'retain-on-failure',
    // Headless Chromium has no GPU here, so the 3D view is rendered by
    // SwiftShader. Without these the WebGL context fails and steps 7–8 would
    // pass against a canvas that never drew anything.
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text'],
    },
    viewport: { width: 1600, height: 1000 },
  },
  webServer: [
    {
      command: 'node e2e/fake-minimax.mjs',
      env: { FAKE_MINIMAX_PORT: String(FAKE_PORT) },
      url: `http://127.0.0.1:${FAKE_PORT}/__requests`,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: `npm run build && node --experimental-strip-types server/main.ts`,
      env: {
        PORT: String(APP_PORT),
        MINIMAX_API_KEY: 'e2e-stand-in-key',
        MINIMAX_BASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
        MINIMAX_MODEL: 'MiniMax-M3',
      },
      url: `http://127.0.0.1:${APP_PORT}/api/health`,
      reuseExistingServer: false,
      // This server's command starts with a full `npm run build`, and that is
      // the whole cost of the startup gate: measured on this machine, `tsc -b`
      // plus `vite build` is about 4m49s (132 s of it inside vite). The old
      // 180 s cap sat *below* the build, so this webServer timed out before a
      // single test ran and reported a failure that had nothing to do with the
      // application. Seven minutes leaves room on a slower machine still.
      timeout: 420_000,
      stdout: 'pipe',
    },
    {
      // This one must be as unconfigured as a fresh clone, so the fallback
      // path is exercised for real rather than stubbed.
      //
      // Setting the key to an empty string is what does it: `loadEnv` skips any
      // key already present in the environment, so the developer's real `.env`
      // cannot leak into this server and turn a fallback test into a live API
      // call. `isConfigured` treats an empty key as absent, which is the same
      // thing. `ARGON_DISABLE_AI` is set as well so the intent survives a
      // `.env` that grows a key later.
      command: 'node --experimental-strip-types server/main.ts',
      env: {
        PORT: String(BARE_PORT),
        MINIMAX_API_KEY: '',
        ARGON_DISABLE_AI: 'true',
      },
      url: `http://127.0.0.1:${BARE_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
    },
  ],
});
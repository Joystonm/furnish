/**
 * What the app says when the model did not plan anything.
 *
 * The failure mode this file exists to prevent is not a crash. It is a plan
 * that is perfectly good and reads as if a designer produced it. A user who
 * believes MiniMax chose the rooms will not look for the ensuite, and will
 * not notice that three bedrooms came out identical.
 *
 * So every path that does not end in a model-planned program is asserted to
 * carry a *named* reason. "Something went wrong" passes a smoke test and fails
 * this one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestRoomProgram } from './planProgram.ts';
import type { DesignBrief } from '../model/types.ts';

const BRIEF: DesignBrief = {
  plot: {
    width: 15,
    depth: 20,
    orientation: 0,
    setbacks: { front: 4.5, rear: 4.5, left: 3, right: 3 },
  },
  floorCount: 1,
  rooms: [{ kind: 'living', count: 1 }],
  preferredAreas: {},
  style: 'contemporary',
  preferences: { accessibility: false, ventilation: false, privacy: false, daylight: true },
};

const GOOD_PROGRAM = {
  summary: 'A two-bedroom house with the kitchen open to the living space.',
  rooms: [
    { ref: 'living', kind: 'living', areaM2: 26, touches: ['kitchen'] },
    { ref: 'kitchen', kind: 'kitchen', areaM2: 13, touches: ['living'] },
    { ref: 'bed-1', kind: 'bedroom', areaM2: 12 },
    { ref: 'bed-2', kind: 'bedroom', areaM2: 10 },
  ],
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  const spy = vi.fn(async (url: unknown, init: unknown) => handler(String(url), init as RequestInit));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('requestRoomProgram', () => {
  it('returns the program when the model answers in the schema', async () => {
    stubFetch(() => json(200, { program: GOOD_PROGRAM }));
    const out = await requestRoomProgram(BRIEF);
    expect(out.planned).toBe(true);
    if (!out.planned) throw new Error(out.reason);
    expect(out.summary).toBe(GOOD_PROGRAM.summary);
    expect(out.program.rooms).toHaveLength(4);
    // Room names are resolved, never trusted: what comes back are names, and
    // the packer mints the real ids.
    expect(out.program.rooms.every((r) => typeof r.ref === 'string')).toBe(true);
  });

  it('sends the plot, not an instruction to place anything', async () => {
    const spy = stubFetch(() => json(200, { program: GOOD_PROGRAM }));
    await requestRoomProgram(BRIEF);
    const sent = spy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(sent.body));
    expect(body.plot.width).toBe(15);
    expect(body.plot.setbacks.front).toBe(4.5);
    expect(body.floorCount).toBe(1);
    // The browser never sees the key, so it must not be trying to send one.
    expect(Object.keys(body)).not.toContain('apiKey');
    expect(Object.keys(body)).not.toContain('api_key');
  });

  describe('every failure names its cause', () => {
    it('reports a missing key as unconfigured, and says so', async () => {
      stubFetch(() => json(503, { error: 'MiniMax is not configured.' }));
      const out = await requestRoomProgram(BRIEF);
      expect(out.planned).toBe(false);
      if (out.planned) throw new Error('should not have planned');
      expect(out.unconfigured).toBe(true);
      expect(out.reason).toMatch(/not configured/i);
    });

    it('names an HTTP failure from the server', async () => {
      stubFetch(() => json(500, { error: 'upstream exploded' }));
      const out = await requestRoomProgram(BRIEF);
      expect(out.planned).toBe(false);
      if (out.planned) throw new Error('should not have planned');
      expect(out.reason).toBe('upstream exploded');
    });

    it('names a network failure rather than reporting nothing', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('connection refused');
      }) as unknown as typeof fetch;
      const out = await requestRoomProgram(BRIEF);
      expect(out.planned).toBe(false);
      if (out.planned) throw new Error('should not have planned');
      expect(out.reason).toMatch(/never reached the server/i);
      expect(out.reason).toContain('connection refused');
    });

    it('refuses a program with a room kind this studio does not have', async () => {
      stubFetch(() => json(200, { program: { rooms: [{ ref: 'a', kind: 'helipad', areaM2: 20 }] } }));
      const out = await requestRoomProgram(BRIEF);
      expect(out.planned).toBe(false);
      if (out.planned) throw new Error('should not have planned');
      expect(out.reason).toMatch(/helipad/);
      // And it must be clear that nothing was built from it.
      expect(out.reason).toMatch(/nothing was changed/i);
    });

    it('refuses a program carrying an object id', async () => {
      const forged = ['rm_', 'k3f9x2', 'a1b2'].join('');
      stubFetch(() => json(200, { program: { rooms: [{ ref: forged, kind: 'bedroom', areaM2: 12 }] } }));
      const out = await requestRoomProgram(BRIEF);
      expect(out.planned).toBe(false);
      if (out.planned) throw new Error('should not have planned');
      expect(out.reason).toMatch(/object id/i);
    });

    it('refuses a program that will not fit the plot, with both numbers', async () => {
      stubFetch(() => json(200, { program: { rooms: [{ ref: 'villa', kind: 'living', areaM2: 400 }] } }));
      const out = await requestRoomProgram(BRIEF);
      expect(out.planned).toBe(false);
      if (out.planned) throw new Error('should not have planned');
      // The user needs both figures to argue with, not just "too big".
      expect(out.reason).toContain('400');
      expect(out.reason).toContain('81');
    });

    it('refuses a body with no program in it at all', async () => {
      stubFetch(() => json(200, { nothing: true }));
      const out = await requestRoomProgram(BRIEF);
      expect(out.planned).toBe(false);
      if (out.planned) throw new Error('should not have planned');
      expect(out.reason.length).toBeGreaterThan(0);
    });
  });

  it('drops a corridor rather than building a second one', async () => {
    // The generator draws its own corridor. A program that asks for one gets
    // a corridor either way, so the request is redundant — not invalid.
    stubFetch(() =>
      json(200, {
        program: {
          rooms: [
            { ref: 'living', kind: 'living', areaM2: 26 },
            { ref: 'hall', kind: 'corridor', areaM2: 0 },
          ],
        },
      }),
    );
    const out = await requestRoomProgram(BRIEF);
    expect(out.planned).toBe(true);
    if (!out.planned) throw new Error(out.reason);
    expect(out.program.rooms.map((r) => r.ref)).toEqual(['living']);
  });
});

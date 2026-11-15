import { describe, expect, it } from 'vitest';
import { clearTurns, getTurns, setTurns, subscribeTurns } from './transcript.ts';

const turn = (id: number, request: string) => ({
  id,
  request,
  report: null,
  liveSteps: [],
  pending: false,
  progress: '',
});

describe('the assistant transcript', () => {
  it('is not the panel state, so a remount cannot lose it', () => {
    clearTurns();
    setTurns((t) => [...t, turn(1, 'put an L-shaped sofa in the living room')]);

    // The panel is mounted again — a new project, a restored session, an
    // operation that rewrites the design. The transcript is read from the
    // module, not from a component that has just been thrown away.
    expect(getTurns()).toHaveLength(1);
    expect(getTurns()[0].request).toBe('put an L-shaped sofa in the living room');
  });

  it('keeps writing into the same transcript while a turn runs', () => {
    clearTurns();
    setTurns((t) => [...t, turn(1, 'put a sofa in the living room')]);
    // A step resolves after the panel has been remounted.
    setTurns((t) =>
      t.map((x) =>
        x.id === 1
          ? { ...x, liveSteps: [{ index: 0, tool: 'add_furniture', label: 'Add a piece of furniture', status: 'applied' }] }
          : x,
      ),
    );

    expect(getTurns()[0].liveSteps).toHaveLength(1);
  });

  it('tells its subscribers when it changes, and stops when they leave', () => {
    clearTurns();
    let calls = 0;
    const off = subscribeTurns(() => { calls += 1; });
    setTurns((t) => [...t, turn(1, 'put a sofa in the living room')]);
    expect(calls).toBe(1);

    off();
    setTurns((t) => [...t, turn(2, 'and a table')]);
    expect(calls).toBe(1);
  });

  it('is emptied for a new project, because the old turns are about another house', () => {
    clearTurns();
    setTurns((t) => [...t, turn(1, 'put a sofa in the living room')]);
    clearTurns();
    expect(getTurns()).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { adjacencyPairs, parseProgram, reviewProgram } from './program.ts';
import { DEFAULT_PLOT } from './ops.ts';
import type { Plot, RoomKind } from './types.ts';

const plot = (over: Partial<Plot> = {}): Plot => ({ ...DEFAULT_PLOT, ...over });

/**
 * A raw, untrusted room entry.
 *
 * Deliberately typed as plain strings, not `ProgramRoom`: `parseProgram` exists
 * to check exactly this shape, so a test helper that pre-validated it would be
 * testing nothing.
 */
const room = (ref: string, kind: string, areaM2: number | string, touches?: string[]) => ({
  ref,
  kind,
  areaM2,
  touches,
});

describe('parseProgram', () => {
  it('accepts a well-formed program', () => {
    const res = parseProgram({
      summary: 'A three-bed with the kitchen in the middle of the plan.',
      rooms: [
        room('living', 'living', 24),
        room('kitchen', 'kitchen', 12, ['living']),
        room('bed-1', 'bedroom', 14),
        room('bath-1', 'bathroom', 5, ['bed-1']),
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.program.rooms).toHaveLength(4);
    expect(res.program.summary).toContain('kitchen');
    // The adjacency is kept on the room that asked for it, unresolved.
    expect(res.program.rooms[3]!.touches).toEqual(['bed-1']);
  });

  it('rejects a room kind the catalogue does not have', () => {
    const res = parseProgram({ rooms: [room('x', 'laundry-crawl', 8)] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('laundry-crawl');
  });

  /**
   * A room kind the studio knows under another name.
   *
   * The real model asked for a "study" — a normal word for what this
   * catalogue calls an office. Refusing the whole programme over one word
   * cost the user the plan the model had actually written, so the kind is
   * repaired and the repair is reported rather than hidden.
   */
  it('repairs a room kind it knows under another name, and says so', () => {
    const res = parseProgram({ rooms: [room('study-1', 'study', 8), room('living', 'living', 22)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.program.rooms[0]!.kind).toBe('office');
    expect(res.repairs.join(' ')).toMatch(/study/);
  });

  it('still refuses a kind with no honest alias', () => {
    const res = parseProgram({ rooms: [room('x', 'cinema', 8)] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('cinema');
  });

  it('rejects a duplicate ref, which would make adjacency ambiguous', () => {
    const res = parseProgram({ rooms: [room('bed-1', 'bedroom', 12), room('bed-1', 'bedroom', 12)] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('twice');
  });

  it('rejects a room with no usable area', () => {
    expect(parseProgram({ rooms: [room('a', 'bedroom', 0)] }).ok).toBe(false);
    expect(parseProgram({ rooms: [room('a', 'bedroom', 'big')] }).ok).toBe(false);
    expect(parseProgram({ rooms: [room('a', 'bedroom', NaN)] }).ok).toBe(false);
  });

  it('rejects a ref shaped like an Furnish object id', () => {
    // Ids are minted by `newId`, never supplied by a caller. A ref wearing an
    // id's shape is either a leak from a previous turn or an attempt to name
    // an object that does not exist, and neither may reach the plan. The value
    // is assembled at runtime so the test file holds no id-shaped literal.
    const forgedRef = ['rm_', 'k3f9x2', 'a1b2'].join('');
    const res = parseProgram({ rooms: [{ ref: forgedRef, kind: 'bedroom', areaM2: 12 }] });
    expect(res.ok).toBe(false);
  });

  it('drops a corridor, because the generator draws its own', () => {
    const res = parseProgram({ rooms: [room('living', 'living', 22), room('corr', 'corridor', 0)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.program.rooms.map((r) => r.kind)).toEqual(['living']);
  });

  it('rejects a non-object and an empty room list', () => {
    expect(parseProgram(null).ok).toBe(false);
    expect(parseProgram({ rooms: 'not an array' }).ok).toBe(false);
    expect(parseProgram({ rooms: [] }).ok).toBe(false);
    expect(parseProgram({ rooms: [room('c', 'corridor', 0)] }).ok).toBe(false);
  });
});

/**
 * The one shape the real model actually got wrong.
 *
 * This is transcribed from a live MiniMax-M3 response on 2026-10-16, not
 * invented as a plausible failure: the model wrote `"kitchen": "kitchen"` as a
 * JSON *key* where the schema asks for `"ref": "kitchen"`, and the old parser
 * rejected the entire otherwise-good program over it.
 *
 * The repair is only allowed because the model's own `touches` prove the name —
 * the surrounding rooms refer to "kitchen", so the missing ref is recoverable
 * rather than guessed. Everything below tests that boundary, because the
 * failure mode of a recovery like this is recovering when it should not.
 */
describe('parseProgram repairs a missing ref only when the plan corroborates it', () => {
  const liveResponse = {
    rooms: [
      { ref: 'living', kind: 'living', areaM2: 22, touches: ['hall', 'kitchen'] },
      { kitchen: 'kitchen', kind: 'kitchen', areaM2: 12, touches: ['living', 'utility'], note: 'A real work kitchen with a breakfast bar.' },
      { ref: 'utility', kind: 'utility', areaM2: 6 },
    ],
  };

  it('recovers the room, because other rooms name it in their touches', () => {
    const res = parseProgram(liveResponse);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const kitchen = res.program.rooms.find((r) => r.kind === 'kitchen');
    expect(kitchen?.ref).toBe('kitchen');
    // The rest of the design survives; rejecting wholesale would have thrown
    // away a good plan over one malformed key.
    expect(res.program.rooms).toHaveLength(3);
  });

  it('keeps the edges that pointed at the repaired name', () => {
    // The whole reason this is worth repairing: if the recovery invented a
    // different name, `living`'s `touches: ['hall', 'kitchen']` would dangle
    // and the open-plan living/kitchen connection would silently vanish.
    const res = parseProgram(liveResponse);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const pairs = adjacencyPairs(res.program);
    expect(pairs).toContainEqual(['kitchen', 'living']);
  });

  it('reports the repair rather than applying it silently', () => {
    const res = parseProgram(liveResponse);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.repairs).toHaveLength(1);
    expect(res.repairs[0]).toContain('kitchen');
  });

  it('refuses when nothing else names the room', () => {
    // No corroboration: the missing ref could mean "call me kitchen" or "call me
    // anything". Inventing a name would break every edge referring to it, so the
    // honest answer is to reject and say so.
    const res = parseProgram({
      rooms: [
        { ref: 'living', kind: 'living', areaM2: 22 },
        { kind: 'kitchen', areaM2: 12 },
      ],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('ref');
  });

  it('refuses when the kind is not even a string, rather than coercing', () => {
    const res = parseProgram({ rooms: [{ ref: 'x', kind: { name: 'bedroom' }, areaM2: 12 }] });
    expect(res.ok).toBe(false);
  });

  it('does not let a repair invent a second room of the same name', () => {
    // Two unnamed kitchens, one string "kitchen" used in touches: which one is
    // it? Unanswerable, so the second is a refusal and the duplicate check
    // stands as the backstop.
    const res = parseProgram({
      rooms: [
        { kind: 'kitchen', areaM2: 12 },
        { ref: 'living', kind: 'living', areaM2: 22, touches: ['kitchen'] },
        { kind: 'kitchen', areaM2: 8 },
      ],
    });
    expect(res.ok).toBe(false);
  });

  it('a clean program reports no repairs at all', () => {
    // Guards the panel: an empty repair list must be empty, not a standing
    // "nothing was repaired" line the user learns to skip.
    const res = parseProgram({ rooms: [room('living', 'living', 22), room('kitchen', 'kitchen', 12, ['living'])] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.repairs).toEqual([]);
  });
});

/**
 * A program the parser has already accepted, for tests about the review step
 * rather than the parsing step. `p(...)` is the trusted constructor; `room(…)`
 * above stays untrusted on purpose.
 */
const p = (...rooms: Array<{ ref: string; kind: RoomKind; areaM2: number; touches?: string[]; floor?: number }>) => ({
  rooms,
});

describe('reviewProgram against the plot', () => {
  it('accepts a program that fits the envelope', () => {
    const res = reviewProgram(
      p(
        { ref: 'living', kind: 'living', areaM2: 24 },
        { ref: 'kitchen', kind: 'kitchen', areaM2: 12 },
        { ref: 'bed-1', kind: 'bedroom', areaM2: 14 },
        { ref: 'bed-2', kind: 'bedroom', areaM2: 12 },
        { ref: 'bath-1', kind: 'bathroom', areaM2: 5 },
      ),
      plot(),
      1,
    );
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.availableM2).toBeCloseTo(9 * 11 * 0.82, 1);
  });

  it('refuses a program that asks for more floor than the envelope holds', () => {
    // The exact complaint: rooms that under-fill the land waste it, and rooms
    // that over-fill it do not fit. A program of 20 m² bedrooms on a 99 m²
    // envelope is not a plan, it is a wish.
    const res = reviewProgram(
      p(
        { ref: 'living', kind: 'living', areaM2: 40 },
        { ref: 'kitchen', kind: 'kitchen', areaM2: 30 },
        ...Array.from({ length: 6 }, (_, i) => ({ ref: `bed-${i}`, kind: 'bedroom' as const, areaM2: 20 })),
      ),
      plot(),
      1,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/would not fit/);
    expect(res.requestedM2).toBeGreaterThan(res.availableM2);
  });

  /**
   * A program that asks for a little more than the envelope holds.
   *
   * The packer scales a program's rooms into the envelope, so a program that
   * overshoots comes out smaller than asked rather than broken. Refusing it
   * throws away a plan the user would have got for free: on 2026-11-15 the
   * model asked for 217 m² in an envelope of 216, and the whole programme was
   * dropped for one square metre.
   */
  it('accepts a program that overshoots the envelope a little, and says the rooms came out smaller', () => {
    const res = reviewProgram(
      p(
        { ref: 'living', kind: 'living', areaM2: 26 },
        { ref: 'kitchen', kind: 'kitchen', areaM2: 12 },
        { ref: 'bed-1', kind: 'bedroom', areaM2: 14 },
        { ref: 'bed-2', kind: 'bedroom', areaM2: 14 },
        { ref: 'bed-3', kind: 'bedroom', areaM2: 14 },
        { ref: 'bath-1', kind: 'bathroom', areaM2: 5 },
        { ref: 'bath-2', kind: 'bathroom', areaM2: 5 },
      ),
      plot(),
      1,
    );
    expect(res.ok).toBe(true);
    // 90 m² asked for, 81.18 m² available once circulation is taken out.
    expect(res.requestedM2).toBeGreaterThan(res.availableM2);
    expect(res.warnings.join(' ')).toMatch(/smaller than asked/);
  });

  it('still refuses a program that would have to be scaled past the floor', () => {
    // The other side of the tolerance: far over the envelope is not a house.
    const res = reviewProgram(
      p(
        { ref: 'living', kind: 'living', areaM2: 60 },
        { ref: 'kitchen', kind: 'kitchen', areaM2: 40 },
        ...Array.from({ length: 8 }, (_, i) => ({ ref: `bed-${i}`, kind: 'bedroom' as const, areaM2: 20 })),
      ),
      plot(),
      1,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/would not fit/);
  });

  it('gives the same envelope across the storeys it is told about', () => {
    const program = p({ ref: 'living', kind: 'living', areaM2: 30 }, { ref: 'kitchen', kind: 'kitchen', areaM2: 20 });
    expect(reviewProgram(program, plot(), 1).availableM2).toBeCloseTo(81.18, 1);
    expect(reviewProgram(program, plot(), 2).availableM2).toBeCloseTo(162.36, 1);
  });

  it('reports a dangling adjacency instead of silently dropping it', () => {
    const res = reviewProgram(
      p(
        { ref: 'bed-1', kind: 'bedroom', areaM2: 14, touches: ['bath-9'] },
        { ref: 'bath-1', kind: 'bathroom', areaM2: 5 },
      ),
      plot(),
      1,
    );
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' ')).toContain('bath-9');
  });

  it('reports a room on a storey that does not exist', () => {
    const res = reviewProgram(
      p({ ref: 'living', kind: 'living', areaM2: 22 }, { ref: 'bed-1', kind: 'bedroom', areaM2: 14, floor: 4 }),
      plot(),
      1,
    );
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' ')).toContain('storey 4');
  });

  it('warns about a room too small to use', () => {
    const res = reviewProgram(
      p({ ref: 'living', kind: 'living', areaM2: 22 }, { ref: 'store', kind: 'storage', areaM2: 0.6 }),
      plot(),
      1,
    );
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/under 1\.8/);
  });

  it('refuses everything when the setbacks leave no house', () => {
    const res = reviewProgram(p({ ref: 'living', kind: 'living', areaM2: 20 }), plot({ width: 8 }), 1);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('too small');
  });
});

describe('adjacencyPairs', () => {
  it('reads a one-sided constraint', () => {
    expect(
      adjacencyPairs(
        p(
          { ref: 'a', kind: 'kitchen', areaM2: 10, touches: ['b'] },
          { ref: 'b', kind: 'dining', areaM2: 12 },
        ),
      ),
    ).toEqual([['a', 'b']]);
  });

  it('collapses a mutual constraint to one pair', () => {
    const pairs = adjacencyPairs(
      p(
        { ref: 'a', kind: 'kitchen', areaM2: 10, touches: ['b'] },
        { ref: 'b', kind: 'dining', areaM2: 12, touches: ['a'] },
      ),
    );
    expect(pairs).toHaveLength(1);
  });

  it('is order-independent — B touching A is the same wall as A touching B', () => {
    const forward = adjacencyPairs(
      p(
        { ref: 'a', kind: 'kitchen', areaM2: 10, touches: ['b'] },
        { ref: 'b', kind: 'dining', areaM2: 12 },
      ),
    );
    const backward = adjacencyPairs(
      p(
        { ref: 'b', kind: 'dining', areaM2: 12, touches: ['a'] },
        { ref: 'a', kind: 'kitchen', areaM2: 10 },
      ),
    );
    expect(forward).toEqual(backward);
  });

  it('ignores a self-reference and an unknown ref', () => {
    const pairs = adjacencyPairs(
      p(
        { ref: 'a', kind: 'kitchen', areaM2: 10, touches: ['a', 'nope'] },
        { ref: 'b', kind: 'dining', areaM2: 12 },
      ),
    );
    expect(pairs).toEqual([]);
  });
});
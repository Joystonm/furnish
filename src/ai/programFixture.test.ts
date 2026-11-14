/**
 * The scripted stand-in, checked against the real thing.
 *
 * `e2e/fake-minimax.mjs` answers the room-program call with a plan built from
 * the numbers in the system prompt. That makes it possible to assert the whole
 * chain offline: the prompt the server really writes, the program the stand-in
 * really returns, the parser the browser really runs, and the packer that has
 * to place it.
 *
 * The point is that the stand-in cannot pass by agreeing with a broken prompt.
 * Its areas are scaled from the envelope it is told, so if the app ever sent
 * the wrong plot, these numbers would be wrong too and the test would fail on
 * them rather than quietly succeed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { programSystem, programTool, envelope } from '../../server/program.ts';
import { adjacencyPairs, parseProgram, reviewProgram } from '../model/program.ts';
import { generateFromBrief } from '../model/layout.ts';
import { blankProject } from '../model/ops.ts';
import { validate } from '../model/validate.ts';
import type { DesignBrief, Project, Room } from '../model/types.ts';

/**
 * `roomProgram` is not exported — it is a private of a script that also starts
 * a server. It is lifted out of the source rather than duplicated, so this test
 * cannot drift from the thing that actually answers in the e2e run. A duplicate
 * here would be a second implementation of the fake, which is worse than none.
 */
const FAKE_SOURCE = readFileSync(new URL('../../e2e/fake-minimax.mjs', import.meta.url), 'utf8');

/**
 * One function, lifted whole, brace-matched.
 *
 * The naive `indexOf('\n}')` slice worked while every stand-in function was
 * flat, and silently returned a truncated function the moment one grew a
 * nested block — which reads as "the stand-in misbehaved" rather than "the
 * extractor is wrong". Matching braces cannot truncate.
 */
function fnSource(name: string): string {
  const start = FAKE_SOURCE.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`fake-minimax.mjs no longer defines ${name}`);
  let depth = 0;
  for (let i = FAKE_SOURCE.indexOf('{', start); i < FAKE_SOURCE.length; i++) {
    if (FAKE_SOURCE[i] === '{') depth++;
    else if (FAKE_SOURCE[i] === '}' && --depth === 0) return FAKE_SOURCE.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

function standInRoomProgram(): (system: string) => { rooms: unknown[]; summary?: string } {
  // eslint-disable-next-line no-new-func
  return new Function(`return (${fnSource('roomProgram')})`)() as (system: string) => {
    rooms: unknown[];
    summary?: string;
  };
}

const PLOT = {
  width: 15,
  depth: 20,
  orientation: 0 as const,
  setbacks: { front: 4.5, rear: 4.5, left: 3, right: 3 },
};

const BRIEF: DesignBrief = {
  plot: PLOT,
  floorCount: 1,
  rooms: [
    { kind: 'living', count: 1 },
    { kind: 'kitchen', count: 1 },
    { kind: 'bedroom', count: 3 },
    { kind: 'bathroom', count: 1 },
  ],
  preferredAreas: {},
  style: 'contemporary',
  preferences: { accessibility: false, ventilation: true, privacy: false, daylight: true },
};

const REQUEST = {
  plot: PLOT,
  floorCount: 1,
  style: 'contemporary',
  rooms: [
    { kind: 'living' as const, count: 1 },
    { kind: 'kitchen' as const, count: 1 },
    { kind: 'bedroom' as const, count: 3 },
    { kind: 'bathroom' as const, count: 1 },
  ],
  preferences: { accessibility: false, ventilation: true, privacy: false, daylight: true },
};

describe('the e2e stand-in answers the room-program call for real', () => {
  const system = programSystem(REQUEST);
  const raw = standInRoomProgram()(system);

  it('is offered the room-program tool, and only that tool', () => {
    const tool = programTool();
    expect(tool.name).toBe('propose_room_program');
    // The schema's shape IS the guarantee. A field for a coordinate, an id or
    // a validation override would be the whole architecture undone, so its
    // absence is asserted rather than assumed — at both levels, because a
    // forbidden field on the room is the one that would actually matter.
    const top = Object.keys(tool.input_schema.properties ?? {});
    expect(top.sort()).toEqual(['rooms', 'summary']);
    const items = (tool.input_schema.properties as Record<string, unknown> | undefined)?.rooms as
      | { items?: { properties?: Record<string, unknown>; required?: string[] } }
      | undefined;
    // A missing `rooms` schema is itself a defect, so it is asserted rather
    // than defaulted away: the assertions below would all pass on `{}`.
    expect(items, 'the tool schema has no rooms array').toBeDefined();
    const roomProps = Object.keys(items?.items?.properties ?? {});
    expect(roomProps.sort()).toEqual(['areaM2', 'floor', 'kind', 'note', 'ref', 'touches']);
    for (const forbidden of ['x', 'y', 'z', 'width', 'depth', 'height', 'position', 'rotation', 'id', 'roomId', 'override', 'skipValidation']) {
      expect(roomProps).not.toContain(forbidden);
      expect(top).not.toContain(forbidden);
    }
    // `touches` is a list of names, and `ref` is a name — there is no field
    // through which a model could address an existing object.
    expect(items?.items?.required).toEqual(['ref', 'kind', 'areaM2']);
  });

  it('states the same envelope the review will enforce', () => {
    const env = envelope(PLOT, 1);
    const review = reviewProgram({ rooms: [] }, PLOT, 1);
    expect(system).toContain(`${env.usableTotal} m² usable in total`);
    // The prompt and the refusal threshold must be the same number, or the
    // model is being told to plan more than it is allowed to.
    expect(review.availableM2).toBeCloseTo(env.usableTotal, 1);
  });

  it('returns a program the browser parser accepts', () => {
    const parsed = parseProgram(raw);
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
  });

  it('returns a program that fits the plot it was told about', () => {
    const parsed = parseProgram(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const review = reviewProgram(parsed.program, PLOT, 1);
    expect(review.ok, review.error).toBe(true);
    expect(review.warnings).toEqual([]);
  });

  it('scales its areas to the envelope, so it is not a fixed answer', () => {
    const parsed = parseProgram(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    // The default 9 × 11 m envelope holds 81.2 m²; the unscaled shape is 103.5.
    // Landing under the cap is the only way this passes, and it can only pass
    // because the stand-in read the number out of the prompt.
    const total = parsed.program.rooms.reduce((s, r) => s + r.areaM2, 0);
    expect(total).toBeGreaterThan(70);
    expect(total).toBeLessThan(81.2);
  });

  it('plans the things the deterministic brief cannot', () => {
    const parsed = parseProgram(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const kinds = parsed.program.rooms.map((r) => r.kind);
    // An ensuite, a guest room and an open kitchen/dining pair. The default
    // brief has none of them, so finding all three in the built plan is proof
    // the program reached the packer rather than the fallback.
    expect(kinds).toContain('guest');
    expect(parsed.program.rooms.some((r) => r.ref === 'ensuite')).toBe(true);
    expect(adjacencyPairs(parsed.program)).toContainEqual(['dining', 'kitchen']);
  });

  it('lays out every room it planned, with a way through on every connection', () => {
    const parsed = parseProgram(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const res = generateFromBrief(blankProject('Test'), BRIEF, { program: parsed.program });
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (!res.ok) throw new Error(res.error);

    const { project, report } = res.data;
    const placed = new Set(project.rooms.filter((r) => r.ref).map((r) => r.ref));
    for (const room of parsed.program.rooms) {
      expect(placed.has(room.ref), `${room.ref} was planned but not placed`).toBe(true);
    }
    expect(report.adjacency?.unmet).toEqual([]);

    const byRef = new Map(project.rooms.filter((r) => r.ref).map((r) => [r.ref!, r] as const));
    for (const [a, b] of adjacencyPairs(parsed.program)) {
      const ids = [byRef.get(a)!.id, byRef.get(b)!.id];
      const shared = project.walls.filter((w) => ids.every((id) => w.roomIds.includes(id)));
      const through = shared.filter((w) => w.openings.some((o) => o.kind === 'door' || o.kind === 'doorway' || o.kind === 'opening'));
      expect(through.length, `${a} and ${b} have a way through`).toBeGreaterThan(0);
    }

    expect(validate(project).filter((i) => i.severity === 'error')).toEqual([]);
    expect(project.provenance?.plannedBy).toBe('model');
  });
});

/**
 * The stand-in's deliberately-bad edit, checked offline.
 *
 * `e2e/demo.spec.ts` steps 9–10 assert that the assistant's study overlaps a
 * room and that the constraint engine's own button clears it. That assertion
 * only holds if the study overlaps exactly ONE room, because the engine's
 * correction is offered per pair — a study straddling two rooms produces two
 * issues with two buttons, and clicking the first clears the first.
 *
 * That is not hypothetical: a fixed offset into the host room produced exactly
 * that once the program-driven layout put two rooms side by side, and step 10
 * failed against a working engine. So the property is asserted here, against
 * the real `planFor`, rather than left to the browser to discover.
 */
describe('the stand-in’s overlapping study', () => {
  /**
   * The brief `e2e/demo.spec.ts` step 2 types into the wizard: an 18 × 14 m
   * plot, two storeys, one living room and one bedroom. Using the real one
   * matters — the host room, and therefore where the study lands, depends on
   * the plan the packer produces from it.
   */
  const DEMO_BRIEF: DesignBrief = {
    plot: { width: 18, depth: 14, orientation: 0, setbacks: { front: 3, rear: 3, left: 2, right: 2 } },
    floorCount: 2,
    rooms: [
      { kind: 'living', count: 1 },
      { kind: 'bedroom', count: 1 },
    ],
    preferredAreas: {},
    style: 'contemporary',
    preferences: { accessibility: true, ventilation: false, privacy: false, daylight: false },
  };

  function standInPlanFor(): (text: string) => {
    intent: string;
    steps: Array<{ tool?: string; input?: Record<string, unknown> }>;
  } {
    // `readState` is lifted alongside it, because the two are a pair: `planFor`
    // parses the plan text with it, and evaluating one without the other fails
    // at runtime rather than at load, which is a confusing way to learn a
    // dependency exists.
    // eslint-disable-next-line no-new-func
    return new Function(`const readState = ${fnSource('readState')};\nreturn (${fnSource('planFor')})`)() as never;
  }

  /** The state text the assistant is actually sent, in the shape `readState` parses. */
  const stateFor = (project: Project) =>
    `Active floor: id=${project.floors[0]!.id}\nRooms:\n` +
    project.rooms
      .filter((r) => r.floorId === project.floors[0]!.id)
      .map((r) => `  ${r.id}  ${r.label} x=${r.x} y=${r.y} w=${r.width} d=${r.depth}`)
      .join('\n');

  it('overlaps one room, and the engine’s offered fix clears every overlap', () => {
    // The demo's brief gets its own stand-in program: the fake scales its areas to
    // whatever envelope the prompt states, so asking it about the demo's plot is
    // the only way to get a program that fits it.
    const demoSystem = programSystem({
      plot: DEMO_BRIEF.plot,
      floorCount: DEMO_BRIEF.floorCount,
      style: DEMO_BRIEF.style,
      rooms: DEMO_BRIEF.rooms,
      preferences: DEMO_BRIEF.preferences,
      notes: undefined,
    });
    const demoParsed = parseProgram(standInRoomProgram()(demoSystem));
    if (!demoParsed.ok) throw new Error(demoParsed.error);

    const res = generateFromBrief(blankProject('Demo'), DEMO_BRIEF, { program: demoParsed.program });
    if (!res.ok) throw new Error(res.error);
    const base = res.data.project;

    const plan = standInPlanFor()(stateFor(base));
    const create = plan.steps.find((s) => s.tool === 'create_room');
    expect(create, 'the stand-in must propose a room').toBeDefined();

    const input = create!.input as { x: number; y: number; width: number; depth: number };
    const floorId = base.floors[0]!.id;
    const study: Room = {
      id: ['rm_', 'studystudy'].join(''),
      floorId,
      kind: 'office',
      label: 'Study',
      height: 2.6,
      x: input.x,
      y: input.y,
      width: input.width,
      depth: input.depth,
    };
    const project = { ...base, rooms: [...base.rooms, study] };

    const overlaps = validate(project).filter((i) => i.code === 'room_overlap');
    // Exactly one. Two would mean the demo's step-10 click clears only half the
    // problem, which is a property of the stand-in's placement and not of the
    // engine — and the engine is not what that test is about.
    expect(overlaps.length, `expected one deliberate defect, got: ${overlaps.map((o) => o.message).join(' | ')}`).toBe(1);

    // And the engine must actually be able to fix it — offered fixes are the
    // app's own promise that a click resolves the reported problem.
    const fix = overlaps[0]!.fixes?.[0];
    expect(fix, 'the engine must offer a correction').toBeDefined();
    // `input` is a free-form record by design — the tool registry is what types
    // it — so the numbers are read through a check rather than cast blindly. A
    // fix whose input is not a resize would otherwise silently resize nothing.
    const fi = fix!.input as { roomId?: unknown; x?: unknown; y?: unknown; width?: unknown; depth?: unknown };
    expect(fi.roomId, 'the fix must name a room').toBeTruthy();
    const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
    const shrunk: Project = {
      ...project,
      rooms: project.rooms.map((r) =>
        r.id === fi.roomId
          ? { ...r, x: num(fi.x, r.x), y: num(fi.y, r.y), width: num(fi.width, r.width), depth: num(fi.depth, r.depth) }
          : r,
      ),
    };
    expect(validate(shrunk).filter((i) => i.code === 'room_overlap'), 'the offered fix must clear the overlap').toEqual([]);
  });
});

/**
 * A stand-in for MiniMax's Anthropic-compatible Messages endpoint.
 *
 * It exists so the end-to-end demo can exercise the *whole* assistant path —
 * browser → `/api/chat` → this server → the app's strict parser → the tool
 * registry → the store — without a live API key. What it deliberately does not
 * do is fake the intelligence: it is a script, not a model, and the demo
 * documents that the language understanding was stubbed.
 *
 * It is not a mock of the *shape* either. It parses the compact project state
 * the app actually sent, extracts real floor and room ids from it, and builds
 * its answer from those. If the app sent the wrong state, or ids in a format
 * this cannot read, the plan it returns references ids that do not exist and
 * the app must refuse the plan. The request log is exposed at `/__requests` so
 * the test can assert on what really went over the wire.
 *
 *   node e2e/fake-minimax.mjs            # listens on 8799
 *   PORT=9001 node e2e/fake-minimax.mjs  # or somewhere else
 */
import http from 'node:http';

const PORT = Number(process.env.FAKE_MINIMAX_PORT || process.env.PORT || 8799);

/** Every request body this server has been sent, oldest first. */
const requests = [];

/** Turn the app's compact state text back into the numbers it was built from. */
function readState(text) {
  const floor = text.match(/Active floor:.*?=\s*(fl_[a-z0-9]+)/)?.[1] ?? null;
  const rooms = [...text.matchAll(/^\s{2}(rm_[a-z0-9]+)\s+.*?x=(-?[\d.]+) y=(-?[\d.]+) w=(-?[\d.]+) d=(-?[\d.]+)/gm)].map(
    (m) => ({ id: m[1], x: +m[2], y: +m[3], w: +m[4], d: +m[5] }),
  );
  return { floor, rooms };
}

const asText = (content) =>
  typeof content === 'string' ? content : (content ?? []).map((b) => b.text ?? '').join('');

/**
 * The scripted answer.
 *
 * The study is placed deliberately overlapping the living room. That is the
 * point of the demo's steps 9 and 10: the assistant proposes something the
 * constraint engine rejects, the user sees the real issue, and the user fixes
 * it with the engine's own correction. A plan that was clean on arrival would
 * demonstrate nothing.
 *
 * It must overlap exactly ONE room, and that constraint is load-bearing. The
 * overlap engine offers its correction per *pair*: "shrink this room so it
 * stops crossing that one". A study straddling the boundary between two rooms
 * is two separate issues, each with its own button, and the first button
 * clicked clears only the first — so the demo's step 10 would sit waiting for
 * an overlap the user was told a click would remove. So the study is nudged
 * clear of every neighbour except its host rather than dropped at a fixed
 * offset, which only produced a single overlap when the host happened to be the
 * widest room on the floor.
 */
function planFor(text) {
  const { floor, rooms } = readState(text);
  if (!floor || rooms.length === 0) {
    return {
      intent: 'Add a study.',
      steps: [{ reply: 'I could not read the plan you sent me, so I have not changed anything.' }],
    };
  }
  const host = rooms.reduce((a, b) => (b.w * b.d > a.w * a.d ? b : a));

  // Overlap the host by `OVERLAP`, and nothing else. The study is slid away from
  // any other room's span, so the plan that reaches the constraint engine has
  // one deliberate defect in it rather than two — see the note above.
  const OVERLAP = 1.5;
  const w = 3.2;
  const d = 3.0;
  const study = { x: host.x + host.w - OVERLAP, y: host.y, w, d };

  // Which side has room for the study without reaching a second room. Right
  // first, then left, then inward — the host is the only room it may touch, so
  // the search is over the host's own span plus the strip it may cross.
  //
  // The clearance is deliberate. Stopping at the first position that does not
  // cross leaves the study *touching* its neighbour, and the position is then
  // rounded to three decimals for the tool call — which is enough to push it a
  // fraction of a millimetre into the neighbour. That produced a second,
  // hairline overlap the demo could not clear with one click.
  const CLEAR = 0.05;
  const others = rooms.filter((r) => r !== host);
  const crosses = (x, width) =>
    others.some(
      (r) =>
        r.y < study.y + d - 0.01 &&
        r.y + r.d > study.y + 0.01 &&
        x < r.x + r.w - CLEAR &&
        x + width > r.x + CLEAR,
    );

  // Push the study left until its left edge is the host's left edge, keeping the
  // overlap with the host. Then it can only be touching the host.
  let x = Math.max(host.x, study.x);
  while (crosses(x, w) && x > host.x) x = Math.max(host.x, x - 0.1);
  // Still crossing? Then the host is fully enclosed — place the study on top of
  // it, which overlaps the host by definition and nothing else.
  if (crosses(x, w)) x = host.x;
  study.x = x;

  return {
    intent: 'Add a small study alongside the largest room.',
    steps: [
      {
        tool: 'create_room',
        input: {
          floorId: floor,
          kind: 'office',
          x: +study.x.toFixed(3),
          y: +study.y.toFixed(3),
          width: w,
          depth: d,
        },
        why: 'A 3.2 × 3.0 m study next to the largest room.',
      },
      {
        reply:
          'I added a 3.2 m × 3.0 m study. I placed it from the room positions you sent me rather than from any plan I can see, ' +
          'so open the Checks tab — if it lands on top of another room the engine will say so and offer the correction.',
      },
    ],
  };
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__requests') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(requests, null, 2));
    return;
  }
  if (req.method !== 'POST' || !req.url?.endsWith('/v1/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `no route for ${req.method} ${req.url}` }));
    return;
  }

  let raw = '';
  req.on('data', (c) => {
    raw += c;
  });
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'body was not JSON' }));
      return;
    }
    requests.push({
      url: req.url,
      authorization: req.headers.authorization ?? null,
      contentType: req.headers['content-type'] ?? null,
      model: body.model ?? null,
      toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
      toolChoice: body.tool_choice ?? null,
      system: typeof body.system === 'string' ? body.system : null,
      messages: body.messages ?? [],
    });

    // ── the room-program call ────────────────────────────────────────────
    // Detected by the tool being offered, not by a marker in the prompt, so
    // this branch fires whenever Generate asks for a program. It answers in
    // the tool schema like the real model does — a `tool_use` block — because
    // `/api/room-program` looks for exactly that and nothing else.
    const programTool = (body.tools ?? []).find((t) => t?.name === 'propose_room_program');
    if (programTool) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg_fake_program_000001',
          type: 'message',
          role: 'assistant',
          model: body.model ?? 'MiniMax-M3',
          content: [
            { type: 'thinking', thinking: 'Envelope parsed. Spending it on an ensuite plan.' },
            { type: 'tool_use', id: 'toolu_fake_program_1', name: 'propose_room_program', input: roomProgram(body.system) },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      );
      return;
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userTexts = messages.filter((m) => m.role === 'user').map((m) => asText(m.content));
    const last = userTexts.at(-1) ?? '';
    // The whole conversation, not just the last message. The app's correction
    // is appended to the transcript and then followed by a fresh state block,
    // so reading only the tail would miss exactly the sentence that says what
    // went wrong. A real model sees the whole array; this has to as well.
    const text = userTexts.join('\n');

    let answerText;
    // Markers are read from the newest turn only. On a later round the whole
    // transcript is resent, so a marker left in the original request would fire
    // again and the plan would be applied over and over.
    if (/\b__PROSE__\b/.test(last) || /called no tools/.test(text)) {
      // The failure Furnish used to accept silently: a design request answered
      // with a layout written in words and no operations behind it. Sent both
      // times round, because a model pressed for describing rather than acting
      // answers in words again — which is what makes the app say so on screen.
      answerText = PROSE_LAYOUT;
    } else if (/\b__FULL__\b/.test(last)) {
      // Six rooms in one plan, so the app has something to apply one step at a
      // time and the canvas can be watched building it.
      answerText = JSON.stringify(fullPlanFor(last));
    } else if (/\bREQUEST\b/.test(last)) {
      answerText = JSON.stringify(planFor(last));
    } else {
      // Later rounds of the study plan get the final answer.
      answerText = JSON.stringify({ intent: 'Report.', steps: [{ reply: 'Done — the study is in the plan.' }] });
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_fake_0000000001',
        type: 'message',
        role: 'assistant',
        model: body.model ?? 'MiniMax-M3',
        content: [{ type: 'text', text: answerText }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    );
  });
});

/**
 * The scripted room program.
 *
 * It is built from the numbers in the system prompt — the envelope and the
 * room list the app actually sent — rather than hard-coded, so a wrong
 * envelope produces a program that does not fit and the app must refuse it.
 * That is the failure worth having in a test: the fake is not allowed to
 * accidentally agree with a broken prompt.
 *
 * The plan it returns is the one the e2e asserts on: an ensuite, a guest room
 * and an open kitchen/dining pair. All three are things the deterministic
 * default brief cannot produce, so their presence is proof the program reached
 * the packer rather than the fallback.
 */
function roomProgram(system) {
  const text = typeof system === 'string' ? system : '';
  const usable = Number(text.match(/and ([\d.]+) m² usable in total/)?.[1] ?? 0);
  const asked = text.match(/They asked for: (.*)\.\n/)?.[1] ?? '';
  const bedrooms = Number(asked.match(/(\d+) × Bedroom/)?.[1] ?? 3);
  const kitchens = asked.match(/\d+ × Kitchen/) ? 1 : 0;
  const bathrooms = Number(asked.match(/(\d+) × Bathroom/)?.[1] ?? 1);

  // A fixed shape, scaled to whatever envelope the app said there was. The
  // shape is written out first and the scale factor applied to the total, so
  // the same program fits a 60 m² plot and a 300 m² one — and, crucially, so a
  // program that does NOT fit is something this script cannot accidentally
  // produce. If the app sent the wrong envelope, the areas come out wrong and
  // the test fails on the numbers rather than passing by coincidence.
  const shape = [
    { ref: 'living', kind: 'living', m2: 26, touches: ['dining'], note: 'The front room, off the street door.' },
    { ref: 'dining', kind: 'dining', m2: 14, touches: ['living', 'kitchen'], note: 'Open to the kitchen.' },
  ];
  if (kitchens) shape.push({ ref: 'kitchen', kind: 'kitchen', m2: 13, touches: ['dining'] });

  // The brief's bedroom count decides how many *ordinary* bedrooms there are on
  // top of two the planner always wants: a master that takes its own bathroom,
  // and a guest room. Both are written into the shape rather than derived from
  // the brief, because the e2e asserts on both of them as proof the model
  // contributed something the deterministic brief cannot.
  //
  // That is not a refactor for its own sake. It used to read
  // `i === bedroomsToPlan && bedroomsToPlan > 1 ? 'guest' : 'bedroom'` — so the
  // guest room existed only as an arithmetic accident of the app's default
  // brief asking for three bedrooms. Change that default to one and the guest
  // room silently disappears, taking `roomProgram.spec.ts`'s whole argument
  // with it: the test meant to prove the model planned the house would go on
  // passing while testing one fewer thing.
  const extraBedrooms = Math.max(0, bedrooms - 2);
  shape.push({
    ref: 'bed-1',
    kind: 'bedroom',
    m2: 16,
    touches: ['ensuite'],
    note: 'The master, taking its own bathroom.',
  });
  for (let i = 0; i < extraBedrooms; i++) {
    shape.push({ ref: `bed-${i + 2}`, kind: 'bedroom', m2: 12, touches: ['bath-1'] });
  }
  shape.push({ ref: `bed-${extraBedrooms + 2}`, kind: 'guest', m2: 12, touches: ['bath-1'] });
  shape.push({ ref: 'ensuite', kind: 'bathroom', m2: 5.5, touches: ['bed-1'] });

  for (let i = 1; i <= Math.max(1, bathrooms); i++) {
    shape.push({ ref: `bath-${i}`, kind: 'bathroom', m2: 5, touches: [`bed-${extraBedrooms + 2}`] });
  }

  // 3% under the stated envelope: the brief's own numbers are a target, and
  // `reviewProgram` refuses anything above it outright.
  const nominal = shape.reduce((s, r) => s + r.m2, 0);
  const budget = usable > 0 ? usable * 0.97 : nominal;
  const scale = budget / nominal;

  const rooms = shape.map((r) => ({
    ref: r.ref,
    kind: r.kind,
    areaM2: Math.round(r.m2 * scale * 10) / 10,
    ...(r.touches ? { touches: r.touches } : {}),
    ...(r.note ? { note: r.note } : {}),
  }));

  return {
    summary: `${extraBedrooms + 2} bedrooms — the master takes its own bathroom, the rest share the family one — with the kitchen open to the dining room.`,
    rooms,
  };
}

/**
 * A layout written out in words, with nothing behind it.
 *
 * This is the shape the model actually returns when it is asked to "build the
 * complete design" and drifts into describing instead of calling tools.
 */
const PROSE_LAYOUT =
  'Clean slate on the active floor. Layout plan (all top-left x,y; sizes in m):\n' +
  '- Living room: x=3, y=3, 4.5 x 4.0\n' +
  '- Kitchen: x=3, y=7, 3.0 x 3.0\n' +
  '- Bedroom 1: x=3, y=10, 4.0 x 4.0\n' +
  'Let me build the rooms in parallel.';

/** Six rooms, tiled inside the envelope, each its own operation. */
function fullPlanFor(text) {
  const { floor } = readState(text);
  if (!floor) {
    return { intent: 'Build the layout.', steps: [{ reply: 'I could not read the plan, so I changed nothing.' }] };
  }
  // The default plot is 15 x 20 with 3 m side and 4.5 m front/rear setbacks,
  // so the buildable envelope is x 3..12, y 4.5..15.5. Every room is placed
  // inside it and none overlap, so what the run demonstrates is the applying,
  // not a plan the constraint engine would have refused.
  const rooms = [
    { kind: 'living', x: 3, y: 4.5, width: 5.5, depth: 4.5 },
    { kind: 'kitchen', x: 3, y: 9, width: 3, depth: 3 },
    { kind: 'bathroom', x: 6, y: 9, width: 2.5, depth: 3 },
    { kind: 'storage', x: 8.5, y: 4.5, width: 3.5, depth: 2 },
    { kind: 'bedroom', x: 3, y: 12, width: 4.5, depth: 3.5 },
    { kind: 'bedroom', x: 7.5, y: 12, width: 4.5, depth: 3.5 },
  ];
  return {
    intent: 'Build the whole layout, one room at a time.',
    steps: [
      ...rooms.map((r) => ({ tool: 'create_room', input: { floorId: floor, ...r } })),
      { reply: 'Six rooms placed: living, kitchen, two bedrooms, bathroom and store.' },
    ],
  };
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake minimax listening on http://127.0.0.1:${PORT}`);
});
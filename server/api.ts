/**
 * HTTP surface for the Furnish AI layer.
 *
 * The browser never sees the MiniMax key: it talks only to this app's own
 * `/api/chat` route, which forwards to MiniMax server-side and returns the
 * Anthropic-style message body unchanged.
 *
 * Everything here is deliberately small. The model is a reasoning layer, not
 * a privileged actor — it may only reach the canonical model through the typed
 * tool registry in `src/tools`, which runs in the browser and validates
 * everything before it mutates state.
 */
import express, { type Express, type Request, type Response } from 'express';
import {
  aiDisabledByConfig,
  clientConfig,
  createMessage,
  isConfigured,
  MiniMaxError,
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicTool,
} from './minimax.ts';
import { programSystem, programTool, type ProgramRequest } from './program.ts';
import type { Plot, RoomKind } from '../src/model/types.ts';

/** Hard caps so a malformed client cannot produce an unbounded upstream call. */
const LIMITS = {
  messages: 64,
  blocksPerMessage: 128,
  tools: 96,
  systemChars: 24_000,
  textCharsPerBlock: 400_000,
  maxTokensCeiling: 16_000,
  imageBytes: 4_500_000, // ~3.4 MB after base64 overhead, under the 4 MB API image cap
};

function fail(res: Response, status: number, message: string, detail?: unknown) {
  res.status(status).json({ error: message, ...(detail !== undefined ? { detail } : {}) });
}

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

function validateMessages(raw: unknown): AnthropicMessage[] | string {
  if (!Array.isArray(raw)) return 'messages must be an array';
  if (raw.length === 0) return 'messages must not be empty';
  if (raw.length > LIMITS.messages) return `messages exceeds ${LIMITS.messages} entries`;
  const out: AnthropicMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') return 'each message must be an object';
    const role = (m as any).role;
    if (role !== 'user' && role !== 'assistant') return 'message.role must be "user" or "assistant"';
    const content = (m as any).content;
    if (typeof content === 'string') {
      out.push({ role, content: str(content, LIMITS.textCharsPerBlock) });
      continue;
    }
    if (!Array.isArray(content)) return 'message.content must be a string or an array of blocks';
    if (content.length > LIMITS.blocksPerMessage) {
      return `message.content exceeds ${LIMITS.blocksPerMessage} blocks`;
    }
    const blocks: AnthropicContentBlock[] = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') return 'each content block must be an object';
      const type = (b as any).type;
      switch (type) {
        case 'text':
          blocks.push({ type: 'text', text: str((b as any).text, LIMITS.textCharsPerBlock) });
          break;
        case 'thinking':
          blocks.push({
            type: 'thinking',
            thinking: str((b as any).thinking, LIMITS.textCharsPerBlock),
            ...((b as any).signature ? { signature: String((b as any).signature) } : {}),
          });
          break;
        case 'tool_use':
          if (typeof (b as any).name !== 'string') return 'tool_use block requires a name';
          blocks.push({ type: 'tool_use', id: str((b as any).id, 200), name: (b as any).name, input: (b as any).input ?? {} });
          break;
        case 'tool_result':
          blocks.push({
            type: 'tool_result',
            tool_use_id: str((b as any).tool_use_id, 200),
            content: str((b as any).content, LIMITS.textCharsPerBlock),
          });
          break;
        case 'image': {
          const src = (b as any).source;
          if (!src || typeof src !== 'object') return 'image block requires a source object';
          if (src.type === 'url') {
            blocks.push({ type: 'image', source: { type: 'url', url: str(src.url, 4000) } });
          } else {
            const data = str(src.data, LIMITS.imageBytes);
            if (!data) return 'image.source.data is empty or too large';
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: str(src.media_type, 40) || 'image/png', data },
            });
          }
          break;
        }
        default:
          return `unsupported content block type: ${String(type)}`;
      }
    }
    out.push({ role, content: blocks });
  }
  return out;
}

function validateTools(raw: unknown): AnthropicTool[] | string {
  if (!Array.isArray(raw)) return [];
  if (raw.length > LIMITS.tools) return `tools exceeds ${LIMITS.tools} entries`;
  const out: AnthropicTool[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') return 'each tool must be an object';
    const name = (t as any).name;
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      return 'tool.name must be a 1-64 char [a-zA-Z0-9_-] string';
    }
    const schema = (t as any).input_schema;
    if (!schema || typeof schema !== 'object' || (schema as any).type !== 'object') {
      return `tool "${name}".input_schema must be a JSON Schema object`;
    }
    out.push({ name, description: str((t as any).description, 6000), input_schema: schema });
  }
  return out;
}

export function createApiApp(): Express {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req, res) => {
    const enabled = isConfigured();
    const cfg = clientConfig();
    let host = '';
    try {
      host = new URL(cfg.baseUrl).host;
    } catch {
      /* malformed base url — report blank rather than throwing */
    }
    res.json({
      ok: true,
      aiEnabled: enabled,
      disabledByConfig: aiDisabledByConfig(),
      provider: 'minimax',
      model: enabled ? cfg.model : null,
      endpoint: host ? `${host}/v1/messages` : null,
    });
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    if (!isConfigured()) {
      return fail(
        res,
        503,
        'MiniMax is not configured. Set MINIMAX_API_KEY in the server environment (see .env.example). The studio remains fully usable for manual editing.',
      );
    }

    const body = req.body ?? {};
    const messages = validateMessages(body.messages);
    if (typeof messages === 'string') return fail(res, 400, messages);

    const tools = validateTools(body.tools);
    if (typeof tools === 'string') return fail(res, 400, tools);

    const maxTokens = Math.min(
      Math.max(Number(body.max_tokens) || 4096, 256),
      LIMITS.maxTokensCeiling,
    );
    const temperature =
      typeof body.temperature === 'number'
        ? Math.min(Math.max(body.temperature, 0), 2)
        : undefined;

    const cfg = clientConfig();
    try {
      const message = await createMessage(cfg, {
        model: cfg.model,
        messages,
        max_tokens: maxTokens,
        ...(str(body.system, LIMITS.systemChars) ? { system: str(body.system, LIMITS.systemChars) } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(tools.length ? { tools, tool_choice: { type: 'auto' as const } } : {}),
        ...(body.thinking === true ? { thinking: { type: 'enabled' as const } } : {}),
        ...(body.effort ? { output_config: { effort: body.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } } : {}),
      });
      res.json(message);
    } catch (e) {
      if (e instanceof MiniMaxError) {
        return fail(res, e.status === 0 ? 504 : e.status, e.message);
      }
      return fail(res, 500, `Unexpected server error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  app.post('/api/room-program', async (req: Request, res: Response) => {
    if (!isConfigured()) {
      return fail(
        res,
        503,
        'MiniMax is not configured. Set MINIMAX_API_KEY in the server environment (see .env.example). The studio remains fully usable for manual editing.',
      );
    }

    const parsed = validateProgramRequest(req.body);
    if (typeof parsed === 'string') return fail(res, 400, parsed);

    const cfg = clientConfig();
    try {
      // The tool is the only one offered and `tool_choice` pins it, so the
      // model answers in the schema or the call is a failure. There is no
      // prose path for a layout to arrive in.
      const message = await createMessage(cfg, {
        model: cfg.model,
        messages: [
          {
            role: 'user',
            content: `Plan the rooms for this house.${parsed.notes ? `\n\nTheir own words: "${parsed.notes}"` : ''}`,
          },
        ],
        // Measured, not guessed. With thinking on, MiniMax-M3 spends most of
        // its output budget reasoning: an 8-room program at effort 'high' used
        // 8,022 output tokens, and at 'medium' 9,456 of them were *thinking
        // tokens* alone. The 4,000 this used to allow was consumed before the
        // tool call began, and the call came back `stop_reason: max_tokens`
        // with a single `thinking` block and no program at all — which the
        // route below reports as "did not return a room program", a message
        // that was true and completely unhelpful.
        //
        // The headroom is deliberately generous because the alternative is a
        // silent fallback: a truncated call is not an error, it is a plan the
        // user never got.
        max_tokens: 24_000,
        system: programSystem(parsed),
        // Thinking on, and effort up: this is the one call in Furnish where the
        // reasoning is the product rather than a side effect. A layout decided
        // without it comes back as the defaults, which is the defect.
        thinking: { type: 'enabled' },
        output_config: { effort: 'high' },
        temperature: 0.4,
        tools: [programTool()],
        tool_choice: { type: 'tool', name: programTool().name },
      });

      const call = message.content.find((b) => b.type === 'tool_use' && b.name === 'propose_room_program');
      if (!call || !call.input || typeof call.input !== 'object') {
        return fail(res, 502, 'MiniMax did not return a room program. Nothing was changed.');
      }
      // The shape is checked in the browser by `parseProgram`, which is the same
      // validator the app would use on anything else the model produced. The
      // server forwards what came back; it does not launder it.
      res.json({ program: call.input, usage: message.usage ?? null });
    } catch (e) {
      if (e instanceof MiniMaxError) {
        return fail(res, e.status === 0 ? 504 : e.status, e.message);
      }
      return fail(res, 500, `Unexpected server error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  return app;
}

/** Bounds so a malformed brief cannot produce an unbounded upstream call. */
const PROGRAM_LIMITS = {
  rooms: 12,
  roomsPerKind: 8,
  floors: 4,
  plotSide: 400,
  setback: 40,
  notes: 600,
};

/** A number that must be present, finite and inside `[lo, hi]`. */
function num(raw: unknown, lo: number, hi: number, what: string): number | string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${what} must be a number.`;
  if (n < lo || n > hi) return `${what} must be between ${lo} and ${hi}.`;
  return n;
}

/**
 * Check the brief the browser posted.
 *
 * The plot is the one thing here that genuinely changes the design, so it is
 * validated properly — a model told the envelope is 400 m will plan a
 * different house than one told it is 40. Everything else is small and bounded.
 */
function validateProgramRequest(raw: unknown): ProgramRequest | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'the request body must be an object.';
  const b = raw as Record<string, unknown>;

  const p = b.plot as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return 'plot is required.';
  const sb = p.setbacks as Record<string, unknown> | undefined;
  if (!sb || typeof sb !== 'object') return 'plot.setbacks is required.';

  const w = num(p.width, 4, PROGRAM_LIMITS.plotSide, 'plot.width');
  if (typeof w === 'string') return w;
  const d = num(p.depth, 4, PROGRAM_LIMITS.plotSide, 'plot.depth');
  if (typeof d === 'string') return d;

  const setbacks: Record<'front' | 'rear' | 'left' | 'right', number> = { front: 0, rear: 0, left: 0, right: 0 };
  for (const side of ['front', 'rear', 'left', 'right'] as const) {
    const v = num(sb[side], 0, PROGRAM_LIMITS.setback, `plot.setbacks.${side}`);
    if (typeof v === 'string') return v;
    setbacks[side] = v;
  }
  if (w - setbacks.left - setbacks.right < 4 || d - setbacks.front - setbacks.rear < 4) {
    return 'the setbacks leave too little envelope to plan rooms into.';
  }

  const floorCount = num(b.floorCount ?? 1, 1, PROGRAM_LIMITS.floors, 'floorCount');
  if (typeof floorCount === 'string') return floorCount;

  if (!Array.isArray(b.rooms) || b.rooms.length === 0) return 'rooms is required and must be a non-empty array.';
  if (b.rooms.length > PROGRAM_LIMITS.rooms) return `rooms may not exceed ${PROGRAM_LIMITS.rooms} entries.`;
  const rooms: Array<{ kind: RoomKind; count: number }> = [];
  for (const entry of b.rooms) {
    if (!entry || typeof entry !== 'object') return 'every room entry must be an object.';
    const e = entry as Record<string, unknown>;
    if (typeof e.kind !== 'string' || e.kind.length > 32) return 'every room entry needs a kind.';
    const count = num(e.count ?? 1, 1, PROGRAM_LIMITS.roomsPerKind, `rooms.${e.kind}.count`);
    if (typeof count === 'string') return count;
    rooms.push({ kind: e.kind as RoomKind, count });
  }

  const prefs = (b.preferences ?? {}) as Record<string, unknown>;
  const flag = (k: string) => prefs[k] === true;

  return {
    plot: {
      width: w,
      depth: d,
      orientation: 0,
      setbacks: { front: setbacks.front, rear: setbacks.rear, left: setbacks.left, right: setbacks.right },
    } satisfies Plot,
    floorCount,
    style: str(b.style, 40) || 'contemporary',
    rooms,
    notes: b.notes ? str(b.notes, PROGRAM_LIMITS.notes) : undefined,
    preferences: {
      accessibility: flag('accessibility'),
      ventilation: flag('ventilation'),
      privacy: flag('privacy'),
      daylight: flag('daylight'),
    },
  };
}
/**
 * The room-program prompt and its schema.
 *
 * Furnish's Generate button used to run a deterministic packer with the model
 * nowhere in it, which meant the model could describe a layout in words and
 * change nothing. This module is the fix: the model is asked one bounded
 * question — *what rooms, how big, and which must be neighbours* — and the
 * answer comes back as a typed program that the existing packer consumes.
 *
 * Three things are deliberately NOT in the schema, and their absence is the
 * architecture:
 *
 *   · no coordinates. The model cannot place a room; it can only say how big
 *     one should be. Geometry stays the packer's job and stays deterministic.
 *   · no object ids. `ref` is a name the model invents so it can refer to a
 *     room twice. Real ids are minted by `newId` afterwards, so a model can
 *     never fabricate, collide with, or address an existing object.
 *   · no approval, validation or override fields. There is nothing here that
 *     could wave a check through, because there is nothing here that is a
 *     check.
 *
 * The tool is also the only one offered, with `tool_choice` pinning it, so the
 * model answers in schema or not at all. There is no free-text path for a
 * layout to hide in.
 */
import type { AnthropicTool } from './minimax.ts';
import { DEFAULT_ROOM_AREA, KIND_LABEL } from '../src/model/catalog.ts';
import type { Plot, RoomKind } from '../src/model/types.ts';

/** Room kinds the model may ask for. `corridor` is absent on purpose. */
const ASKS: RoomKind[] = (Object.keys(DEFAULT_ROOM_AREA) as RoomKind[]).filter((k) => k !== 'corridor');

/** A wardrobes-only cupboard is not a room; a hall bigger than the house is. */
const MIN_AREA_M2 = 3;
const MAX_AREA_M2 = 60;

/** Circulation, stairs and structure take their cut before the rooms do. */
const HAZARD_RATIO = 0.82;

export interface ProgramRequest {
  plot: Plot;
  floorCount: number;
  style: string;
  rooms: Array<{ kind: RoomKind; count: number }>;
  notes?: string;
  preferences: { accessibility: boolean; ventilation: boolean; privacy: boolean; daylight: boolean };
}

export function programTool(): AnthropicTool {
  return {
    name: 'propose_room_program',
    description:
      'Propose the rooms of the house: what they are, how big each one is, which storey it goes on, and which rooms must ' +
      'share a wall. This is the whole design decision. Furnish places the rooms itself, deterministically, once you have ' +
      'answered this — so say what the house contains and how it is arranged by relationship, never by position.',
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'One sentence on the shape of this house and why it suits the brief.',
        },
        rooms: {
          type: 'array',
          description: 'Every room in the house, including the ones the brief implied but did not name.',
          items: {
            type: 'object',
            properties: {
              ref: {
                type: 'string',
                description:
                  'A short name unique within this program, used to refer to the room in "touches" — e.g. "bed-2", "ensuite". ' +
                  'A label you make up, NOT an id. Never use an underscore-prefixed id-like string.',
              },
              kind: { type: 'string', enum: ASKS, description: `One of: ${ASKS.join(', ')}.` },
              areaM2: {
                type: 'number',
                description: `Target floor area in m², between ${MIN_AREA_M2} and ${MAX_AREA_M2}. Sized for what the room has to do.`,
              },
              floor: {
                type: 'integer',
                description: 'Storey, counting from 0 for the ground floor. Omit to let Furnish decide.',
              },
              touches: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Refs of rooms that MUST share a wall. Two rooms that touch get a door between them, and Furnish decides the ' +
                  'door width and swing — so use this for the connections that matter (a kitchen beside the dining room, a ' +
                  'bedroom onto its bathroom) and nothing else.',
              },
              note: { type: 'string', description: 'One short clause on why this room is this size.' },
            },
            required: ['ref', 'kind', 'areaM2'],
          },
        },
      },
      required: ['summary', 'rooms'],
    },
  };
}

/** What the envelope actually is, in the numbers the model has to plan against. */
export function envelope(plot: Plot, floorCount: number) {
  const sb = plot.setbacks;
  const width = plot.width - sb.left - sb.right;
  const depth = plot.depth - sb.front - sb.rear;
  const floors = Math.max(1, Math.min(4, floorCount));
  return {
    width: round(width),
    depth: round(depth),
    floors,
    areaPerFloor: round(width * depth),
    usableTotal: round(width * depth * floors * HAZARD_RATIO),
    note: 'usableTotal already allows for corridors, stairs and structure. Do not plan more than this in total.',
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * The system prompt.
 *
 * The load-bearing instruction is that the model is choosing sizes and
 * relationships, and that rooms left out are rooms the user pays for in dead
 * space. The complaint this answers was that plans came out formulaic — three
 * identical bedrooms, a kitchen larger than the living room — because the
 * defaults did, not because anything was wrong with the land.
 */
export function programSystem(req: ProgramRequest): string {
  const env = envelope(req.plot, req.floorCount);
  const asked = req.rooms.map((r) => `${r.count} × ${KIND_LABEL[r.kind] ?? r.kind}`).join(', ') || 'nothing specified';

  return `You are planning the rooms of a house. Furnish draws it; you decide what goes in it.

THE SITE
A ${req.plot.width} × ${req.plot.depth} m plot. After the required setbacks the buildable envelope is ${env.width} × ${env.depth} m, ${env.floors} storey${env.floors === 1 ? '' : 's'}, about ${env.areaPerFloor} m² per floor and ${env.usableTotal} m² usable in total. ${env.note}

THE CLIENT
They asked for: ${asked}.
Style: ${req.style}.
${describePreferences(req.preferences)}
${req.notes ? `\nThey also said: "${req.notes.slice(0, 600)}"\n` : ''}
WHAT YOU ARE DECIDING
For each room: its kind, its area in m², optionally its storey, and which rooms it must share a wall with.

You are not drawing. Furnish places the rooms. Never give a position, a coordinate, an orientation, a distance from a wall, or anything that reads as one. Two rooms listed in each other's "touches" will be built next to each other with a door between them; every other relationship is yours to leave out.

JUDGE THESE THINGS
· Size rooms for their job. A bedroom is 12–18 m²; a kitchen that is genuinely worked in is 12–16; a living room that is actually lived in is 22–30; a bathroom is 4–6; storage is 2–4. Three identical bedrooms is not a design, it is a default — if two bedrooms serve different people, let them differ.
· Spend the envelope. Total areas should come close to ${env.usableTotal} m². Coming in far under leaves dead floor the client pays for in both money and upkeep; coming in over will not fit at all.
· Plan the rooms the brief implies. Someone who says "three bedrooms" has not said whether there is an ensuite, a utility, a hall, or a store — decide those, and decide whether the bathroom serves one bedroom or shares. A plan that leaves out a room nobody mentioned is usually the plan that feels wrong.
· Connect rooms by what happens between them. Kitchen near dining and near the living space; a utility near the kitchen; a bedroom onto the bathroom that serves it; circulation kept out of the rooms people sit in. Use "touches" for these and for nothing else.
· Put rooms on storeys deliberately if there is more than one, and keep a storey coherent — bedrooms and their bathrooms together, not a lone bedroom above the kitchen.

Answer by calling propose_room_program. Do not describe the house in prose.`;
}

function describePreferences(p: ProgramRequest['preferences']): string {
  const on: string[] = [];
  if (p.accessibility) on.push('step-free access matters — keep circulation on one floor and avoid tight turns');
  if (p.ventilation) on.push('cross-ventilation matters — bedrooms and living spaces should not all rely on one façade');
  if (p.privacy) on.push('privacy matters — keep the private rooms together and away from the entrance side');
  if (p.daylight) on.push('daylight matters — prefer rooms that can have a real window rather than internal ones');
  return on.length ? `They have said that ${on.join('; ')}.` : '';
}
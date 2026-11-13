/**
 * From a brief in words to a room program.
 *
 * The program is the list of rooms the house is made of, each with a floor
 * area and a storey. It is the thing the generator lays out and the thing the
 * checker measures the result against, so it is deliberately explicit: you can
 * see every room the brief produced and change any of them by hand.
 *
 * The rules are written down rather than learned, so the program is
 * reproducible and — importantly — inspectable. A person who disagrees with
 * "three bedrooms means three bedrooms" can change the number on screen and
 * watch the plan change with it.
 */

import type { Brief, BriefRoom, RoomKind } from './types';

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** The smallest area a room of each kind is worth having. */
export const MINIMUM_AREA: Record<RoomKind, number> = {
  living: 16,
  kitchen: 8,
  dining: 10,
  bedroom: 9,
  bathroom: 4,
  study: 7,
  hall: 3,
};

export const DEFAULT_BRIEF_TEXT =
  'A three-bedroom family house with a living room, kitchen and dining room on the ground floor, and bedrooms and a bathroom upstairs.';

/**
 * Read a count out of the brief — "3-bed", "three bedroom", "2 storeys".
 *
 * The plurals matter: people write "two storeys", not "two storey", and a
 * reader that misses the "s" reads a house with no upstairs.
 */
export function countIn(text: string, subject: string): number | null {
  const lower = text.toLowerCase();
  const nouns = subject === 'bed' ? 'beds?|bedrooms?' : 'storeys?|stories|floors?';

  for (const [word, value] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}[- ]?(?:${nouns})\\b`).test(lower)) return value;
  }

  const digits = lower.match(new RegExp(`(\\d+)[- ]?(?:${nouns})\\b`));
  if (digits) return Number(digits[1]);
  return null;
}

export function has(text: string, phrase: string): boolean {
  return text.toLowerCase().includes(phrase.toLowerCase());
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function makeRoom(label: string, kind: RoomKind, area: number, floor: number): BriefRoom {
  return { id: slug(label), label, kind, area, floor };
}

/**
 * Build the room program from the brief.
 *
 * The rules, in order:
 *
 * - bedrooms come from "three-bedroom", "3 bed", or the word form;
 * - storeys come from "two storeys" or "2 floors";
 * - the ground floor gets a living room, a kitchen and a dining room;
 * - bedrooms and bathrooms go upstairs when there is an upstairs;
 * - "open plan" folds the dining room into the living room;
 * - a study or office is added when the brief asks for one;
 * - one bathroom per two bedrooms, never fewer than one.
 */
export function programFromBrief(brief: Brief): BriefRoom[] {
  const text = brief.text;
  const bedrooms = countIn(text, 'bed') ?? 3;
  const storeys = Math.max(1, Math.min(4, brief.storeys));
  const openPlan = has(text, 'open plan') || has(text, 'open-plan');

  const rooms: BriefRoom[] = [];
  const ground = 0;
  const upper = storeys > 1 ? storeys - 1 : 0;

  const livingArea = openPlan ? 30 : 20;
  rooms.push(makeRoom('Living room', 'living', livingArea, ground));
  rooms.push(makeRoom('Kitchen', 'kitchen', 11, ground));
  if (!openPlan) rooms.push(makeRoom('Dining room', 'dining', 12, ground));

  if (has(text, 'study') || has(text, 'office')) {
    rooms.push(makeRoom(has(text, 'office') ? 'Office' : 'Study', 'study', 9, ground));
  }

  for (let i = 0; i < bedrooms; i++) {
    rooms.push(makeRoom(`Bedroom ${i + 1}`, 'bedroom', 13, upper));
  }

  const bathrooms = Math.max(1, Math.ceil(bedrooms / 2));
  for (let i = 0; i < bathrooms; i++) {
    rooms.push(makeRoom(`Bathroom ${i + 1}`, 'bathroom', 5, upper));
  }

  // Circulation is what makes a plan walkable, and every storey needs it: a
  // hall on the ground floor, a landing on each floor above. Without a
  // landing upstairs, the bedrooms are rooms you can only reach through one
  // another.
  rooms.push(makeRoom('Hall', 'hall', 7, ground));
  for (let floor = 1; floor < storeys; floor++) {
    rooms.push(makeRoom(`Landing ${floor}`, 'hall', 6, floor));
  }

  return rooms;
}

/** Total area the program asks for on one storey. */
export function floorArea(rooms: BriefRoom[], floor: number): number {
  return rooms.filter((r) => r.floor === floor).reduce((sum, r) => sum + r.area, 0);
}

/**
 * Style palettes.
 *
 * A palette is a *selection of materials that already exist in the catalogue*,
 * never a list of colours. That is the whole point of the file: the assistant
 * is asked which of the five named styles a house should be, and the answer it
 * can give is a name. The colours behind that name live here, in code, where
 * they can be reviewed — so a language model cannot invent a hex code, cannot
 * emit one that will not parse, and cannot claim a palette that was applied
 * when nothing in it was.
 *
 * Every id below is checked against `DEFAULT_MATERIALS` by `paletteFor`, and an
 * unknown id is a hard error rather than a silent skip. A palette that names a
 * material the catalogue does not have is a bug in this file, not a runtime
 * condition to be handled.
 */
import type { DesignStyle } from './types.ts';
import { DEFAULT_MATERIALS } from './catalog.ts';

export const DESIGN_STYLES: DesignStyle[] = ['modern', 'contemporary', 'traditional', 'minimalist', 'japandi'];

export const STYLE_LABEL: Record<DesignStyle, string> = {
  modern: 'Modern',
  contemporary: 'Contemporary',
  traditional: 'Traditional',
  minimalist: 'Minimalist',
  japandi: 'Japandi',
};

export const STYLE_BLURB: Record<DesignStyle, string> = {
  modern: 'Board-formed concrete, pale plaster, polished concrete floors and wool carpet in the bedrooms.',
  contemporary: 'Off-white render, oak floors, and stone through the circulation spaces.',
  traditional: 'Warm brick, white plaster, limestone halls and wool carpet in the bedrooms.',
  minimalist: 'Near-white render, pale plaster and stone almost throughout — the quietest of the five.',
  japandi: 'Cedar cladding, white plaster and oak boards, with timber running through the hall too.',
};

export interface StylePalette {
  /** Every exterior wall in the project. */
  exterior: string;
  /**
   * Every internal wall and partition.
   *
   * Part of the palette rather than left alone because it is a real choice: a
   * warm plaster and a cold plaster read as different rooms, and a palette
   * that only ever touched the facade would leave the interior looking like it
   * came from a different building.
   */
  interior: string;
  /** Applied per room kind, so a wet room still gets tile. */
  floorsByKind: Record<string, string>;
}

/**
 * Floor finish by room kind, per style.
 *
 * Keyed on `RoomKind` rather than one finish for the whole house because a
 * palette that puts carpet in the bathroom is worse than no palette at all.
 * These are the same kinds `FLOOR_MATERIAL_BY_KIND` covers, so every room kind
 * in the model has an entry here.
 */
const FLOORS: Record<DesignStyle, StylePalette['floorsByKind']> = {
  modern: {
    living: 'floor.concrete', dining: 'floor.concrete', kitchen: 'floor.tile',
    bedroom: 'floor.carpet', bathroom: 'floor.tile', guest: 'floor.carpet',
    office: 'floor.oak', prayer: 'floor.carpet', storage: 'floor.concrete',
    utility: 'floor.tile', pantry: 'floor.tile', corridor: 'floor.concrete',
    hall: 'floor.concrete', lobby: 'floor.concrete', garage: 'floor.concrete',
    balcony: 'floor.concrete', terrace: 'floor.stone',
  },
  contemporary: {
    living: 'floor.stone', dining: 'floor.oak', kitchen: 'floor.tile',
    bedroom: 'floor.oak', bathroom: 'floor.tile', guest: 'floor.oak',
    office: 'floor.oak', prayer: 'floor.tile', storage: 'floor.concrete',
    utility: 'floor.tile', pantry: 'floor.tile', corridor: 'floor.stone',
    hall: 'floor.stone', lobby: 'floor.stone', garage: 'floor.concrete',
    balcony: 'floor.concrete', terrace: 'floor.stone',
  },
  traditional: {
    living: 'floor.oak', dining: 'floor.oak', kitchen: 'floor.tile',
    bedroom: 'floor.carpet', bathroom: 'floor.tile', guest: 'floor.carpet',
    office: 'floor.oak', prayer: 'floor.carpet', storage: 'floor.concrete',
    utility: 'floor.tile', pantry: 'floor.tile', corridor: 'floor.stone',
    hall: 'floor.stone', lobby: 'floor.stone', garage: 'floor.concrete',
    balcony: 'floor.concrete', terrace: 'floor.stone',
  },
  minimalist: {
    living: 'floor.stone', dining: 'floor.stone', kitchen: 'floor.tile',
    bedroom: 'floor.oak', bathroom: 'floor.tile', guest: 'floor.oak',
    office: 'floor.oak', prayer: 'floor.tile', storage: 'floor.concrete',
    utility: 'floor.tile', pantry: 'floor.tile', corridor: 'floor.stone',
    hall: 'floor.stone', lobby: 'floor.stone', garage: 'floor.concrete',
    balcony: 'floor.concrete', terrace: 'floor.stone',
  },
  japandi: {
    living: 'floor.oak', dining: 'floor.oak', kitchen: 'floor.tile',
    bedroom: 'floor.oak', bathroom: 'floor.tile', guest: 'floor.oak',
    office: 'floor.oak', prayer: 'floor.tile', storage: 'floor.concrete',
    utility: 'floor.tile', pantry: 'floor.tile', corridor: 'floor.oak',
    hall: 'floor.stone', lobby: 'floor.stone', garage: 'floor.concrete',
    balcony: 'floor.concrete', terrace: 'floor.stone',
  },
};

const PALETTES: Record<DesignStyle, StylePalette> = {
  modern: { exterior: 'exterior.concrete', interior: 'interior.plaster', floorsByKind: FLOORS.modern },
  contemporary: { exterior: 'exterior.render', interior: 'interior.plaster', floorsByKind: FLOORS.contemporary },
  traditional: { exterior: 'exterior.brick', interior: 'interior.plaster', floorsByKind: FLOORS.traditional },
  minimalist: { exterior: 'exterior.render', interior: 'interior.plaster', floorsByKind: FLOORS.minimalist },
  japandi: { exterior: 'exterior.timber', interior: 'interior.plaster', floorsByKind: FLOORS.japandi },
};

export function isDesignStyle(v: unknown): v is DesignStyle {
  return typeof v === 'string' && (DESIGN_STYLES as string[]).includes(v);
}

/**
 * The palette for a style, or null if the style is not one of the five.
 *
 * A null return is the boundary that keeps the model honest: the caller
 * reports "no such style" and changes nothing, rather than falling back to some
 * default and describing the result as though the request had been met.
 */
export function paletteFor(style: string): StylePalette | null {
  if (!isDesignStyle(style)) return null;
  const palette = PALETTES[style];
  // Defence in depth. Every id in this file is a literal, so a typo here would
  // otherwise surface as a wall quietly keeping its old colour.
  const ids = [palette.exterior, palette.interior, ...Object.values(palette.floorsByKind)];
  if (ids.some((id) => !DEFAULT_MATERIALS[id])) return null;
  return palette;
}

/** What a palette will actually change, counted against a live project. */
export interface PalettePreview {
  exteriorWalls: number;
  interiorWalls: number;
  roomsByFloor: Record<string, number>;
  total: number;
}

export function previewPalette(
  style: string,
  project: { walls: Array<{ type: string; material: string }>; rooms: Array<{ kind: string; floorMaterial: string }> },
): PalettePreview | null {
  const palette = paletteFor(style);
  if (!palette) return null;
  let exteriorWalls = 0;
  let interiorWalls = 0;
  for (const w of project.walls) {
    // Boundary walls and railings are site and safety, not finishes — a
    // palette has no business recolouring the neighbour's fence.
    if (w.type === 'boundary' || w.type === 'railing') continue;
    const want = w.type === 'exterior' ? palette.exterior : palette.interior;
    if (w.material === want) continue;
    if (w.type === 'exterior') exteriorWalls++;
    else interiorWalls++;
  }
  const roomsByFloor: Record<string, number> = {};
  let rooms = 0;
  for (const r of project.rooms) {
    const want = palette.floorsByKind[r.kind] ?? 'floor.stone';
    if (r.floorMaterial === want) continue;
    rooms++;
    roomsByFloor[want] = (roomsByFloor[want] ?? 0) + 1;
  }
  return { exteriorWalls, interiorWalls, roomsByFloor, total: exteriorWalls + interiorWalls + rooms };
}
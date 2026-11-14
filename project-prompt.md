# Furnish — complete build prompt

**What this file is.** A single, self-contained specification you can paste into
bolt.new to build Furnish — an AI Home Design Studio. It is written as a build
order with the load-bearing numbers, formulas, types, tools, colour tokens and
acceptance criteria stated exactly, so nothing has to be invented at build time.

**How to use it.** Paste the whole file. Bolt will not build 20,000 lines in one
pass — that is expected. Feed it this file, let it start, then say *"continue"*
and point it at the next numbered section until it is done. The sections are
ordered so that each one only depends on the ones above it.

**Honesty note, carried into the build.** Everything below is transcribed from a
working, verified implementation. Where a behaviour was never verified, or a
feature is deliberately not built, it says so in the same file. Do not delete
those parts — they are the difference between a specification and a sales page.

---

# 0 · THE BRIEF — non-negotiable constraints

These are the rules the build must obey. They are not aspirations; several of
them exist because the opposite was tried and it went wrong.

1. **Read the API key from a server-side environment variable. Never expose the
   API key in browser code.** The key must not appear in the bundle, in any
   client request, in a `VITE_`-prefixed variable, or in the repository. `.env`
   is gitignored; `.env.example` holds placeholders only. The browser talks to
   this app's own `/api/chat` on the same origin; that server holds the key.
2. **The model must never be trusted to provide arbitrary executable code,
   override validation, fabricate object IDs, or bypass user approvals.** The
   model may only *name* an entry in a fixed registry and supply JSON arguments
   that are checked against the live project. There is no `eval`, no code
   execution, no dynamic import of model output anywhere.
3. **Do not pretend the model has directly modified the design when the
   application has not successfully applied the operations.** A reply is not a
   change. The report the panel renders is built from what `runTool` actually
   returned. If a design request ran zero operations, the panel says so on
   screen rather than letting the prose read as a drawn layout.
4. **Never claim a file format is supported unless the export can actually be
   opened and used.** JSON, SVG, PNG and a 3D canvas capture — those four, each
   verified by reopening the produced file. No PDF, no DXF, no IFC.
5. **Do not fabricate screenshots, test results, API capabilities, repository
   findings, or integrations.** A test passes when it executes and passes. A
   format is supported when a test reopens the file.
6. **Do not report a test as passing simply because the code was generated or a
   build command completed.** A green build is not a passing test suite, and a
   passing unit suite is not a working browser.
7. **Manually verify the actual deployed or locally running application.** Open
   it, click through it, look at the 3D view, walk it. A suite that has never
   seen a real canvas proves nothing about the canvas.
8. **Do not claim that generated plans are construction-ready or professionally
   certified.** They are early-design geometry.
9. **Treat local building regulations as configurable constraints only when
   reliable jurisdiction-specific rules are available. Do not claim universal
   code compliance.** The shipped defaults are geometric sanity bounds. Say so
   in the UI.
10. **Do not copy proprietary code or reuse copyrighted demonstration floor plans
    and assets without permission.** Everything is generated: geometry from
    code, all 3D textures painted on a `<canvas>` at runtime, no bundled images.
11. **Never invent implementation details or claim to have inspected
    inaccessible source code.** The two Devpost projects this was modelled on
    were analysed from their public pages and behaviour, not from closed source,
    and the write-up says exactly that.
12. **Do not make WebMCP a dependency.**
13. **Keep a clear record of what has actually been implemented and verified.**
    Maintain `FEATURE_MATRIX.md` and update it whenever the answer changes.

---

# 1 · What the product is

Furnish is a **desktop drafting tool for designing a house**, not a viewer. You
describe a plot and what you need; you get a real, editable 2D floor plan; the
same model is a 3D building you can orbit, walk and stand inside; deterministic
checks tell you what is broken and offer to fix it; and a language model can
propose changes that are validated and applied through exactly the same code
path the mouse uses.

Six properties the whole design falls out of:

- **One model.** Rooms are axis-aligned rectangles in metres. Walls are
  segments. Openings and furniture are derived. The 2D canvas, the 3D scene,
  the measurements and the checks are all *pure functions* of one `Project`
  object — so there is no synchronisation layer, and no synchronisation bug to
  have.
- **Pure operations.** Every edit is `(Project, input) => OpResult`. It returns
  a new project or a typed error. It never touches the store.
- **The tool registry is the boundary.** 28 typed tools. The model picks a name
  and passes JSON. It cannot return code, invent an id, or skip a validation.
- **The model never measures.** Areas, coverage and FAR come from formulas in
  `src/model/measure.ts`. The assistant may *request* a calculation; the number
  displayed is recomputed from the store afterwards.
- **A reply is not a change.** Furnish draws the plan from operations, not words.
- **The work is visible.** Operations are applied across painted frames so the
  canvas builds room by room, not in one jump.

---

# 2 · Stack — exact versions

Do not substitute. Several of these choices are load-bearing.

```jsonc
// package.json dependencies
"dependencies": {
  "@react-three/drei":  "^9.122.0",
  "@react-three/fiber": "^8.18.0",
  "express":           "^4.21.2",
  "react":             "^18.3.1",
  "react-dom":         "^18.3.1",
  "three":             "^0.171.0",
  "zustand":           "^5.0.2"
},
"devDependencies": {
  "@playwright/test":    "^1.64.1",
  "@types/express":      "^5.0.0",
  "@types/node":         "^22.10.5",
  "@types/react":        "^18.3.18",
  "@types/react-dom":    "^18.3.5",
  "@types/three":        "^0.171.0",
  "@vitejs/plugin-react":"^4.3.4",
  "autoprefixer":        "^10.4.20",
  "postcss":             "^8.4.49",
  "tailwindcss":         "^3.4.17",
  "typescript":          "^5.7.3",
  "vite":                "^6.0.7",
  "vitest":              "^2.1.8"
}
```

Node **22.16 or newer** — the production server runs TypeScript directly with
`node --experimental-strip-types server/main.ts`, which is why the server code
must avoid TypeScript features that type-stripping does not support (see §12).

### npm scripts

```jsonc
{
  "dev":     "vite",
  "build":   "tsc --noEmit && vite build",
  "preview": "vite preview",
  "serve":   "node --experimental-strip-types server/main.ts",
  "start":   "npm run build && npm run serve",
  "test":    "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "e2e":     "playwright test",
  "e2e:headed": "playwright test --headed",
  "verify":  "npm run typecheck && npm test && npm run build && npm run e2e"
}
```

### `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiPlugin } from './server/vite-plugin.ts';

export default defineConfig({
  plugins: [react(), apiPlugin()],   // express mounted into Vite's middleware,
                                    // so `npm run dev` has /api/chat too
  server: { port: 5173, host: '127.0.0.1' },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1600 },
});
```

### `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "module": "ESNext",
    "skipLibCheck": true, "moduleResolution": "bundler",
    "allowImportingTsExtensions": true, "resolveJsonModule": true,
    "isolatedModules": true, "noEmit": true, "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true, "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false, "noUncheckedIndexedAccess": false,
    "types": ["node", "vite/client"],
    "baseUrl": ".", "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "server", "vite.config.ts"]
}
```

`noUnusedLocals` is on. A temporary debugging component that destructures a prop
it never reads will fail the build — that is deliberate, not pedantry.

### `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Furnish · AI Home Design Studio</title>
    <meta name="description" content="Describe a plot and what you need; get a real, editable floor plan, a 3D building, deterministic checks, and an assistant that applies changes through the same code your mouse uses." />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `.env.example`

```bash
MINIMAX_API_KEY=
MINIMAX_BASE_URL=https://api.minimax.io/anthropic
MINIMAX_MODEL=MiniMax-M3
# FURNISH_DISABLE_AI=true
PORT=8787
```

---

# 3 · Directory layout — build in this order

```
src/
  model/      canonical model, geometry kernel, ops, layout, measure,
              circulation, validation, serialization, history, ids, catalogue
  store/      the single operation dispatch table (zustand), history wiring
  tools/      the 28-tool registry — the assistant's security boundary
  ai/         orchestrator (10-step pipeline) and the assistant panel
  ui/         App shell, toolbar, navigator, inspector, checks, status bar,
              onboarding, toasts
  ui/canvas2d/ the 2D editor: view transform, poché, symbols, plan canvas,
              context menu, trace overlay
  three/      scene model, R3F scene, four cameras, collision, surfaces,
              parametric furniture
  trace/      image tracing, vectorising, calibration
  export/     SVG, PNG and JSON writers
  persist/    IndexedDB library
server/       Express: /api/chat, /api/health, MiniMax client, .env loader
e2e/          the 12-step demo, pointer-lock regression, editing and
              assistant gesture suites, the scripted model stand-in
scripts/      live-assistant-check.mjs — drives the real service once
```

---

# 4 · The canonical model — `src/model/types.ts`

Metres throughout. **x runs right, y runs DOWN (south).** The origin is the
plot's north-west corner. 3D maps `(x, y) → (x − plotW/2, elevation, y −
plotD/2)`; because y already grows south it becomes +Z in the world with no flip.

```ts
export interface Vec2 { x: number; y: number }
export interface Rect { x: number; y: number; width: number; depth: number }
export type Orientation = 0 | 90 | 180 | 270;   // street edge
export interface Setbacks { front: number; rear: number; left: number; right: number }
export interface Plot { width: number; depth: number; orientation: Orientation; setbacks: Setbacks }

export type RoomKind =
  | 'living' | 'dining' | 'kitchen' | 'bedroom' | 'bathroom' | 'utility'
  | 'office' | 'guest' | 'prayer' | 'storage' | 'corridor' | 'balcony'
  | 'terrace' | 'garage' | 'hall' | 'lobby' | 'pantry';          // 17

export type DesignStyle = 'modern' | 'contemporary' | 'traditional' | 'minimalist' | 'japandi';

export interface DesignBrief {
  plot: Plot;
  floorCount: number;
  rooms: Array<{ kind: RoomKind; count: number; targetArea?: number }>;
  style: DesignStyle;
  budgetUsd?: number;
  preferences: { accessibility: boolean; ventilation: boolean; daylight: boolean; privacy: boolean };
  preferredAreas?: Partial<Record<RoomKind, number>>;
}

export interface Floor {
  id: Id; name: string; order: number;
  elevation: number; height: number;
  roomIds: Id[]; wallIds: Id[]; stairIds: Id[]; outdoorIds: Id[];
}

export interface Opening {
  id: Id;
  kind: 'door' | 'window' | 'doorway';
  /** Distance along the wall from its start point, to the opening's centre. */
  offset: number; width: number; height: number; sill: number;
  swing: 'positive' | 'negative';
  hinge: 'start' | 'end';
  material?: string;
  /** Rooms on each side of the host wall; `null` means outside. */
  connects?: [Id | null, Id | null];
}

export interface Wall {
  id: Id; floorId: Id; type: 'exterior' | 'interior' | 'parapet' | 'railing' | 'boundary';
  a: Vec2; b: Vec2; thickness: number; height: number;
  material?: string;
  openings: Opening[];              // NESTED — not a separate top-level array
  roomIds: Id[];                    // derived by reindex()
}

export interface Room {
  id: Id; floorId: Id; kind: RoomKind; label: string;
  x: number; y: number; width: number; depth: number; height: number;
  floorMaterial?: string;
  wallMaterial?: string;
  outdoor?: boolean;
}

export interface Staircase {
  id: Id; floorId: Id; connectsToFloorId: Id | null;
  x: number; y: number; width: number; run: number; riserCount: number;
  direction: 1 | -1;
  voidWidth: number; voidDepth: number; topAtStart: boolean;
  name?: string;
}

export interface OutdoorSpace {
  id: Id; floorId: Id; kind: 'balcony' | 'terrace' | 'porch';
  x: number; y: number; width: number; depth: number; label: string;
  elevationOffset: number; railingHeight: number;
  servesRoomId?: Id | null;
}

export interface FurnitureItem {
  id: Id; floorId: Id; catalogId: string; label: string;
  x: number; y: number;               // CENTRE point
  width: number; depth: number; height: number;
  rotation: number;                   // degrees
  roomId?: Id | null; color?: string;
}

export interface MaterialDef {
  id: string; label: string; color: string;
  roughness: number; metalness: number; opacity?: number;
  kind: 'plaster' | 'stone' | 'concrete' | 'wood' | 'glass' | 'metal' | 'tile' | 'paint';
}

export type Severity = 'error' | 'warning' | 'info';

export type IssueCode =
  // 23 emitted
  | 'room_degenerate' | 'dimension_implausible' | 'room_out_of_plot' | 'room_overlap'
  | 'wall_zero_length' | 'wall_unbounded' | 'wall_out_of_plot'
  | 'opening_overflows_wall' | 'opening_overlap' | 'door_swing_blocked'
  | 'furniture_crosses_wall' | 'furniture_out_of_room' | 'furniture_overlap'
  | 'no_entrance' | 'room_no_access'
  | 'stair_not_connected' | 'stair_geometry_invalid' | 'floor_disconnected'
  | 'setback_violation' | 'coverage_exceeded' | 'far_exceeded'
  | 'brief_room_missing' | 'window_into_service_space'
  // 4 declared, deliberately not yet emitted
  | 'room_inside_wall' | 'wall_not_shared' | 'opening_out_of_bounds' | 'door_no_access';  // 27 total

export interface SuggestedFix {
  label: string;
  tool: ToolName;                     // typed with the registry's name union
  input: Record<string, unknown>;
}

export interface Issue {
  code: IssueCode; severity: Severity; message: string;
  elements: Id[];
  fix?: SuggestedFix;
  fixes?: SuggestedFix[];             // plural allowed; the panel renders every one
}

export interface RoomMeasurement {
  roomId: Id; label: string; kind: RoomKind; outdoor?: boolean; floorId: Id;
  area: number; perimeter: number; width: number; depth: number;
}

export interface BuildingMeasurements {
  plotArea: number; buildableArea: number;
  netIndoorArea: number; footprintArea: number; grossCoveredArea: number; openSiteArea: number;
  plotCoverage: number; floorAreaRatio: number;
  perFloor: Array<{ floorId: Id; label: string; elevation: number; netArea: number; coveredArea: number; roomCount: number }>;
  rooms: RoomMeasurement[];
}

export interface Underlay {
  id: Id; name: string; dataUrl: string;
  x: number; y: number; width: number; depth: number; opacity: number;
  naturalWidth: number; naturalHeight: number;
  calibration?: Calibration;
}

export interface Calibration {
  /** plan = px * scale + offset  — uniform scale + translation, 2 DoF */
  scale: number; offX: number; offY: number;
  source: { pixelDistance: number; realDistance: number; label: string };
  confirmed: boolean;
  /** Metres by which point B missed after the two-point solve. */
  residual?: number;
}

export interface HistoryEntry {
  label: string; actor: 'user' | 'assistant' | 'system';
  before: Project; after: Project;
  createdIds: Id[]; removedIds: Id[];
  coalesceKey: string | null;
  at: number;
}

export const SCHEMA_VERSION = 1;

export interface Project {
  id: Id; name: string;
  plot: Plot;
  floors: Floor[]; rooms: Room[]; walls: Wall[];
  stairs: Staircase[]; outdoor: OutdoorSpace[]; furniture: FurnitureItem[];
  materials: Record<string, MaterialDef>;
  underlays: Underlay[];
  brief: DesignBrief | null;
  displayUnits: 'm' | 'ft';
  revision: number;
}

export type ElementKind = 'room' | 'wall' | 'opening' | 'stair' | 'outdoor' | 'furniture' | 'floor' | 'project';

export interface Selection { kinds: ElementKind[]; ids: Id[] }
```

---

# 5 · Geometry kernel — `src/model/geometry.ts`

Pure functions only. This is the floor everything else stands on.

```ts
export const EPS = 1e-9;

export const TOL = {
  point:      0.005,   // below this two coordinates are the same point
  length:     0.02,    // below this a wall has no length
  dimension:  0.15,    // room dimensions must exceed this to be a room
  join:       0.02,    // gap between adjacent wall faces before it is a defect
  clearance:  0.01,    // furniture may touch a wall, not overlap it
  snap:       0.05,    // editor snap step
};
```

**Vectors** — `add`, `sub`, `scale`, `dot`, `cross`, `len` (`Math.hypot`), `dist`,
`mid`, `norm` (returns `{0,0}` below `EPS`), `perp(a) = {x: -a.y, y: a.x}`
(left-hand normal in a y-down plan), `rotate(p, deg)`, `clamp`, `round(n, dp=3)`.

**Rects** — `rectArea`, `rectPerimeter`, `rectCenter`, `rectCorners` (TL,TR,BR,BL),
`rectContains(r,p,tol=TOL.point)`, `rectContainsStrict`, `rectContainsRect`,
`rectIntersects(a,b,tol=TOL.clearance)`, `rectOverlapArea` (signed, 0 when
disjoint), `rectIntersection`, `expandRect(r,d)`, `rectUnion`,
`rayRectEntry`, `raySegment`, `pointSegmentDistance`.

**Polygons** — `polygonArea` (shoelace), `polygonPerimeter`, `pointInPolygon`,
`convexHull` (Andrew's monotone chain).

**Oriented boxes (for furniture and door swings)**

```ts
interface OBB { cx: number; cy: number; hw: number; hh: number; deg: number }

function obbOverlap(a: OBB, b: OBB): { overlap: boolean; minOverlap: number; axis: Vec2 }
```
Separating Axis Theorem; returns on the *first* separating axis with
`{overlap:false, minOverlap:0, axis}`. Also `obbOfRect`, `obbOfItem`, `obbAxes`,
`obbCorners`, `obbAabbIntersection`, `aabbOfObb`, and
`footprintOfItem(item)` = `aabbOfObb(obbOfItem(item))` — the **rotated bounding
box**, which is what click-testing uses so a rotated item is pickable over the
space it actually occupies.

**Walls**

```ts
interface WallFrame { dir: Vec2; normal: Vec2; length: number; corners: [Vec2,Vec2,Vec2,Vec2] }

function wallFrame(wall: Wall): WallFrame
// d = sub(w.b, wall.a); length = len(d); dir = length < EPS ? {x:1,y:0} : scale(d, 1/length);
// normal = perp(dir); h = wall.thickness / 2;
// corners = [a + n*h, b + n*h, b + n*-h, a + n*-h]

wallMid, wallLength, wallFootprint, wallOBB   // wallOBB deg = atan2(dir.y, dir.x)*180/PI
wallPointAt(w, t)          // = a + dir * clamp(t, 0, length)
openingFootprint(wall, opening)   // bbox of centre ± dir*half ± normal*(thickness/2)

segmentsOverlap(a, b)      // horizontal if |Δy| < |Δx|; both aligned → (lo(a) < hi(b) - TOL.join) && (lo(b) < hi(a) - TOL.join)
sharedEdgeLength(a, b)     // shared axis-aligned edge length, 0 when disjoint
roomSideOfWall(room, wall) // -1 | 0 | 1
```

**Door swings**

```ts
interface DoorLeaf {
  hinge: Vec2;    // jamb the leaf is fixed to
  far: Vec2;      // other jamb (closed free end)
  openEnd: Vec2;  // free end at 90° open
  arcMid: Vec2;   // 45° point, for the arc
  radius: number; // leaf length
  sweep: 0 | 1;   // SVG arc sweep flag
}

function doorLeaf(wall, opening): DoorLeaf
// side = opening.swing === 'negative' ? -1 : 1
// hingeSign = opening.hinge === 'end' ? 1 : -1
// half = width/2; centre = wall.a + dir*offset
// hinge = centre + dir*(half*hingeSign)
// far   = hinge + dir*(-half*2*hingeSign)
// openDir = scale(scale(normal, side), -hingeSign)
// openEnd = hinge + openDir * leaf
// arcMid  = hinge + norm(dir*-hingeSign + openDir) * leaf * Math.SQRT1_2
// sweep   = cross(far - hinge, openEnd - hinge) < 0 ? 0 : 1

doorSwingPolygon(w, o)       // = convexHull([hinge, far, arcMid, openEnd])
polygonObbOverlap(poly, obb) // SAT against obbAxes plus the polygon's own edges
```

**Display formatting** — this is the layer that makes the UI honest about units:

```ts
function toDisplay(metres, units: 'm'|'ft') { return units === 'ft' ? metres * 3.280839895 : metres }

function formatLength(m: number, units: 'm'|'ft', dp = 2): string {
  if (units === 'm') return `${m.toFixed(dp)} m`;
  const totalInches = m * 39.3700787;
  const feet = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches - feet * 12);
  if (inches === 12) return `${feet + 1}' 0"`;
  return `${feet}' ${inches}"`;
}

function formatArea(sqm: number, units: 'm'|'ft'): string {
  return units === 'ft' ? `${(sqm * 10.7639).toFixed(0)} ft²` : `${sqm.toFixed(1)} m²`;
}

function snapTo(n: number, step = TOL.snap) { return Math.round(n / step) * step }
```

---

# 6 · Ids — `src/model/ids.ts`

```ts
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';   // 36 chars
let counter = 0;

function token(): string {
  counter = (counter + 1) % 0xffffff;
  const time = Date.now().toString(36);
  let rand = '';
  for (let i = 0; i < 4; i++) rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${time}${counter.toString(36)}${rand}`;
}

export const newId = (prefix: IdPrefix) => `${prefix}_${token()}`;

// prefixes: p=project, fl=floor, rm=room, wl=wall, op=opening,
//           st=staircase, od=outdoor, fu=furniture, ul=underlay, is=issue

export const isId = (s: unknown, prefix?: IdPrefix): s is string =>
  typeof s === 'string' && /^[a-z]{2}_[0-9a-z]{6,}$/.test(s) && (!prefix || s.startsWith(`${prefix}_`));

export function idKind(s: string): string | null {
  const m = /^([a-z]{2})_/.exec(s);
  return m ? m[1]! : null;
}

export function __resetIdCounter(): void { counter = 0 }   // tests only
```

---

# 7 · Catalogue — `src/model/catalog.ts`

### 7.1 Constants

```ts
export const WALL_THICKNESS = { exterior: 0.23, interior: 0.1, parapet: 0.15, boundary: 0.15, railing: 0.1 } as const;

export const OPENING_DEFAULTS = {
  interiorDoor: { width: 0.9,  height: 2.1, sill: 0 },
  bathroomDoor: { width: 0.8,  height: 2.1, sill: 0 },
  entranceDoor: { width: 1.1,  height: 2.4, sill: 0 },
  window:       { width: 1.2,  height: 1.4, sill: 0.9 },
  windowWide:   { width: 2.4,  height: 1.6, sill: 0.9 },
  terraceDoor:  { width: 1.8,  height: 2.4, sill: 0 },
} as const;

export const DEFAULT_ROOM_AREA: Record<RoomKind, number> = {
  living: 22, dining: 12, kitchen: 11, bedroom: 14, bathroom: 5, utility: 4,
  office: 8, guest: 10, prayer: 6, storage: 3, corridor: 0,   // corridor sized as leftover circulation
  balcony: 5, terrace: 12, garage: 16, hall: 6, lobby: 5, pantry: 3,
};

export const PALETTE_KINDS: RoomKind[] =
  ['living','kitchen','dining','bedroom','bathroom','hall','office','utility'];

export const PRIVATE_KINDS: RoomKind[] = ['bedroom','bathroom','guest','prayer','storage'];
export const PUBLIC_KINDS:  RoomKind[] = ['living','dining','kitchen','lobby','hall','office'];
export const SERVICE_KINDS: RoomKind[] = ['utility','pantry','storage','garage'];

export const KIND_LABEL: Record<RoomKind, string> = {
  living: 'Living room', dining: 'Dining', kitchen: 'Kitchen', bedroom: 'Bedroom',
  bathroom: 'Bathroom', utility: 'Utility', office: 'Home office', guest: 'Guest room',
  prayer: 'Prayer room', storage: 'Storage', corridor: 'Corridor', balcony: 'Balcony',
  terrace: 'Terrace', garage: 'Garage', hall: 'Hall', lobby: 'Entrance lobby', pantry: 'Pantry',
};

export function defaultRoomFootprint(kind: RoomKind): { width: number; depth: number } {
  if (kind === 'corridor') return { width: 1.2, depth: 3.6 };
  const area = DEFAULT_ROOM_AREA[kind] || 12;
  const ratio = area >= 18 ? 1.5 : area <= 6 ? 1.15 : 1.3;
  const depth  = Math.min(Math.max(Math.sqrt(area / ratio), 2.2), 7);
  const width  = Math.min(Math.max(area / depth, 2.2), 9);
  return { width: round(width, 2), depth: round(depth, 2) };
}
```

### 7.2 Materials — 17, keyed by id, with role inferred from the prefix

```ts
export const DEFAULT_MATERIALS: Record<string, MaterialDef> = {
  'exterior.render':    { label: 'Off-white render',      color: '#e8e3db', roughness: 0.92, metalness: 0,    kind: 'plaster' },
  'exterior.brick':     { label: 'Warm brick',             color: '#a3705a', roughness: 0.95, metalness: 0,    kind: 'stone' },
  'exterior.concrete':  { label: 'Board-formed concrete',  color: '#b3aea6', roughness: 0.88, metalness: 0,    kind: 'concrete' },
  'exterior.timber':    { label: 'Cedar cladding',         color: '#9a6a44', roughness: 0.78, metalness: 0,    kind: 'wood' },
  'interior.plaster':   { label: 'White plaster',          color: '#f4f2ee', roughness: 0.95, metalness: 0,    kind: 'plaster' },
  'interior.partition': { label: 'Partition board',        color: '#eceae6', roughness: 0.9,  metalness: 0,    kind: 'plaster' },
  'glass.clear':        { label: 'Clear glazing',          color: '#cfe0e6', roughness: 0.05, metalness: 0, opacity: 0.28, kind: 'glass' },
  'door.timber':        { label: 'Timber door',            color: '#8a6a4b', roughness: 0.7,  metalness: 0,    kind: 'wood' },
  'frame.dark':         { label: 'Dark aluminium frame',   color: '#3a3a38', roughness: 0.35, metalness: 0.85, kind: 'metal' },
  'floor.oak':          { label: 'Oak flooring',           color: '#c39a6b', roughness: 0.55, metalness: 0,    kind: 'wood' },
  'floor.tile':         { label: 'Porcelain tile',         color: '#d8d5cf', roughness: 0.35, metalness: 0,    kind: 'tile' },
  'floor.stone':        { label: 'Limestone',              color: '#cbc4b8', roughness: 0.6,  metalness: 0,    kind: 'stone' },
  'floor.concrete':     { label: 'Polished concrete',      color: '#a9a49c', roughness: 0.42, metalness: 0,    kind: 'concrete' },
  'floor.carpet':       { label: 'Wool carpet',            color: '#b9b0a4', roughness: 0.98, metalness: 0,    kind: 'plaster' },
  'ground.site':        { label: 'Site',                   color: '#dfdcd3', roughness: 1,    metalness: 0,    kind: 'plaster' },
  'roof.deck':          { label: 'Roof screed',            color: '#8f8a82', roughness: 0.9,  metalness: 0,    kind: 'concrete' },
  'accent.wood':        { label: 'Walnut accent',          color: '#6f4a2f', roughness: 0.5,  metalness: 0,    kind: 'wood' },
};

export const isFloorMaterial  = (m) => m.id.startsWith('floor.');
export const isWallMaterial   = (m) => m.id.startsWith('wall.') || m.id.startsWith('accent.');
export const materialRole     = (m) => m.id.startsWith('floor.') ? 'floor' : m.id.startsWith('accent.') ? 'accent' : 'wall';

export const FLOOR_MATERIAL_BY_KIND: Record<RoomKind, string> = {
  living: 'floor.oak', dining: 'floor.oak', bedroom: 'floor.carpet', bathroom: 'floor.tile',
  kitchen: 'floor.tile', utility: 'floor.tile', office: 'floor.oak', guest: 'floor.carpet',
  prayer: 'floor.carpet', storage: 'floor.concrete', corridor: 'floor.stone', hall: 'floor.stone',
  lobby: 'floor.stone', pantry: 'floor.tile', balcony: 'floor.concrete', terrace: 'floor.stone',
  garage: 'floor.concrete',
};
```

### 7.3 Furniture catalogue — 33 items

```ts
export interface CatalogItem {
  id: string; label: string;
  width: number; depth: number; height: number;   // metres
  roomKinds: RoomKind[];
  category: 'seating'|'sleeping'|'storage'|'table'|'kitchen'|'bath'|'appliance'|'decor';
  color?: string;
  shape: 'box'|'cylinder'|'lshape'|'round'|'panel';
}
```

| id | label | w | d | h | category | shape | roomKinds | colour |
|---|---|---|---|---|---|---|---|---|
| `sofa-3` | 3-seat sofa | 2.10 | 0.90 | 0.82 | seating | box | living | `#8a7f72` |
| `sofa-l` | L-shaped sofa | 2.60 | 1.70 | 0.82 | seating | lshape | living | `#8a7f72` |
| `sofa-2` | 2-seat sofa | 1.60 | 0.90 | 0.82 | seating | box | living, guest | `#8a7f72` |
| `armchair` | Armchair | 0.85 | 0.85 | 0.90 | seating | box | living, office | `#968b7d` |
| `coffee-table` | Coffee table | 1.10 | 0.60 | 0.42 | table | box | living | `#6f5a44` |
| `dining-chair` | Dining chair | 0.45 | 0.45 | 0.90 | seating | box | dining, kitchen | `#7a6a58` |
| `bed-double` | Double bed | 1.50 | 2.00 | 0.60 | sleeping | box | bedroom | `#d9d4cb` |
| `bed-queen` | Queen bed | 1.60 | 2.05 | 0.60 | sleeping | box | bedroom | `#d9d4cb` |
| `bed-single` | Single bed | 0.95 | 2.00 | 0.60 | sleeping | box | bedroom, guest | `#d9d4cb` |
| `nightstand` | Nightstand | 0.45 | 0.40 | 0.55 | storage | box | bedroom | `#8a6a4b` |
| `wardrobe` | Wardrobe | 1.80 | 0.60 | 2.20 | storage | box | bedroom | `#9a8272` |
| `dining-table` | Dining table | 1.80 | 0.90 | 0.75 | table | box | dining | `#7a5c3e` |
| `desk` | Desk | 1.40 | 0.70 | 0.75 | table | box | office, bedroom | `#c7c2b8` |
| `side-table` | Side table | 0.45 | 0.45 | 0.55 | table | box | living, bedroom | `#6f5a44` |
| `kitchen-run` | Kitchen counter run | 3.00 | 0.65 | 0.92 | kitchen | box | kitchen | `#cfccc6` |
| `kitchen-island` | Kitchen island | 2.20 | 1.00 | 0.92 | kitchen | box | kitchen | `#c4c1bb` |
| `fridge` | Refrigerator | 0.75 | 0.70 | 1.85 | appliance | box | kitchen | `#c9c6c0` |
| `stove` | Cooktop | 0.60 | 0.55 | 0.92 | appliance | box | kitchen | `#9a9790` |
| `sink` | Kitchen sink | 0.80 | 0.50 | 0.92 | kitchen | box | kitchen | `#b6b3ac` |
| `upper-cabinet` | Wall cabinet | 1.80 | 0.35 | 0.70 | storage | panel | kitchen | `#d5d2cc` |
| `bathtub` | Bathtub | 1.70 | 0.75 | 0.60 | bath | box | bathroom | `#f2f0ec` |
| `bathtub-compact` | Compact bath | 1.50 | 0.72 | 0.58 | bath | box | bathroom | `#f2f0ec` |
| `shower-corner` | Corner shower | 0.90 | 0.90 | 2.05 | bath | box | bathroom | `#dfe6e8` |
| `basin` | Wash basin | 0.60 | 0.45 | 0.85 | bath | box | bathroom | `#f0eeea` |
| `wc` | Toilet | 0.40 | 0.70 | 0.80 | bath | box | bathroom | `#f2f0ec` |
| `washing-machine` | Washing machine | 0.60 | 0.62 | 0.85 | appliance | box | utility, bathroom | `#dcd9d3` |
| `dryer` | Dryer | 0.60 | 0.62 | 0.85 | appliance | box | utility | `#dcd9d3` |
| `water-heater` | Water heater | 0.50 | 0.50 | 1.40 | appliance | cylinder | utility | `#cfccc6` |
| `shelving` | Shelving unit | 1.20 | 0.40 | 1.90 | storage | panel | storage, utility, garage | `#b5b0a6` |
| `plant-large` | Large plant | 0.60 | 0.60 | 1.50 | decor | cylinder | living, balcony, terrace | `#5f7d55` |
| `rug` | Rug | 2.40 | 1.70 | 0.02 | decor | box | living, bedroom | `#c9bda9` |
| `tv-unit` | TV unit | 1.80 | 0.40 | 0.50 | storage | box | living | `#6d675e` |

---

# 8 · Operations — `src/model/ops.ts`

```ts
export const GOING = 0.26;   // horizontal going per riser (m)
export const RISER = 0.18;   // nominal rise per riser (m)

export type OpResult<T = unknown> =
  | { ok: true;  project: Project; data: T; createdIds: Id[]; removedIds: Id[] }
  | { ok: false; error: string; code: OpErrorCode; hint?: string };

export type OpErrorCode = 'not_found' | 'invalid_input' | 'out_of_range' | 'conflict' | 'too_small' | 'forbidden';

export const DEFAULT_PLOT: Plot = {
  width: 15, depth: 20, orientation: 0,
  setbacks: { front: 4.5, rear: 4.5, left: 3, right: 3 },
};
```

### 8.1 `reindex(project)` — called after **every** operation

This is the single derivation step. Every operation relies on its side effects,
so get it exactly right or everything downstream is subtly wrong.

1. Clone the arrays and bump `revision`.
2. **Walls** — clamp `thickness = max(0.05, w.thickness || 0.10)` and
   `height = max(0.1, w.height || floor.height || 2.9)`. Set
   `band = w.thickness/2 + 0.05`, then for each room on the same floor, check
   whether the wall lies on one of the room's four edges (within `band`) and
   overlaps that edge by more than `TOL.join`; matching rooms go into
   `w.roomIds`. **`wall.roomIds` is derived, never authored.**
3. **Openings** — clamp `offset ∈ [width/2, max(width/2, length - width/2)]`,
   `height = max(0.2, height)`, `sill = max(0, sill)`. Windows get
   `sill = sill > 0 ? sill : 0.9`; doors and doorways get `sill = 0`. If
   `connects` is missing, set it to `[w.roomIds[0] ?? null, w.roomIds[1] ?? null]`.
4. **Rooms** — `height = height || floor.height || 2.9`.
5. **Stairs** — `riserCount = max(2, round(riserCount))`, `width = max(0.6, width)`.
   If `rise > 0` then `climb = riserCount * RISER`; if
   `climb < rise*0.55 || climb > rise*1.5`, then
   `riserCount = max(2, round(rise / RISER))`; then `run = max(0.9, riserCount * GOING)`.
6. Repopulate every floor's `roomIds / wallIds / stairIds / outdoorIds`.
7. **Purge dangling references** — opening `connects` pointing at rooms that no
   longer exist become `null`; stairs pointing at vanished floors become `null`.

### 8.2 Factories

```ts
export function emptyProject(name = 'Untitled home'): Project
export function blankProject(name: string): Project       // emptyProject + one ground floor

export function makeFloor(project: Project, index: number, name?: string): Floor {
  return {
    id: newId('fl'),
    name: name ?? (index === 0 ? 'Ground floor' : `Floor ${index + 1}`),
    elevation: index === 0 ? 0 : project.floors[index - 1]!.elevation + project.floors[index - 1]!.height,
    height: index === 0 ? 3 : 2.9,
    order: index, roomIds: [], wallIds: [], stairIds: [], outdoorIds: [],
  };
}
```

### 8.3 The operation surface

Every one is `(project, …) => OpResult`. It returns a new project or a typed
error, and **never touches the store**.

| operation | input | notes |
|---|---|---|
| `addFloor` | `(name?)` | index = `project.floors.length` |
| `renameFloor` | `(floorId, name)` | empty trim falls back to the old name |
| `removeFloor` | `(floorId)` | `forbidden` if it is the last floor; removes its rooms/walls/stairs/outdoor/furniture; re-orders the rest |
| `setFloorHeight` | `(floorId, height)` | `1.8 ≤ height ≤ 6`; pushes later floors up |
| `setPlot` | `(patch)` | needs `width>0`, `depth>0`, setbacks `≥0`, built envelope `> 1 m` on both axes |
| `createRoom` | `{floorId?, kind, label?, x, y, width, depth, height?}` | `too_small` below `TOL.dimension`; label defaults to `KIND_LABEL[kind]` |
| `resizeRoom` | `{roomId, x?, y?, width?, depth?, anchor?}` | anchor default `'bottom-right'` |
| `moveRoom` | `(roomId, x, y)` | thin wrapper over `resizeRoom` |
| `setRoomLabel` | `(roomId, label, kind?)` | empty trim → `KIND_LABEL[kind]` |
| `removeRoom` | `(roomId)` | also removes walls whose only purpose was this room; returns every removed id |
| `createWall` | `{floorId?, type?, a:{x,y}, b:{x,y}, thickness?, height?, material?}` | refuses `< TOL.length`; `0.05 ≤ thickness ≤ 0.6`; material default `exterior.render` for exterior, else `interior.partition` |
| `moveWall` | `{wallId, a?, b?, dx?, dy?, thickness?, type?}` | refuses collapse or out-of-range thickness |
| `resizeWall` | `(wallId, newLength)` | slides `b` along the original direction, `a` fixed; openings keep their offsets and are re-clamped by `reindex` |
| `removeWall` | `(wallId)` | |
| `addOpening` | `{wallId, kind, offset?, width?, height?, sill?, swing?, hinge?}` | defaults: window `OPENING_DEFAULTS.window`; doorway `{1.4, 2.2, 0}`; door `OPENING_DEFAULTS.interiorDoor`. Refuses `width > wallLength`; refuses `sill + height > wall.height + 0.01`; refuses overlap with an existing opening (`< (w+o.w)/2 - TOL.point`). Default swing `'positive'`, hinge `'start'` |
| `moveOpening` | `{wallId, openingId, offset?, width?, height?, sill?, swing?, hinge?}` | same checks as `addOpening` |
| `removeOpening` | `(wallId, openingId)` | |
| `addStaircase` | `{floorId, connectsToFloorId?, x, y, width?, riserCount?, direction?, name?}` | default `width = 1.1`; `forbidden` if `target.order <= floor.order`; default `riserCount = max(8, round(elevation / RISER))` |
| `removeStaircase` | `(stairId)` | |
| `addOutdoorSpace` | `{floorId, kind, x, y, width, depth, label?, servesRoomId?, elevationOffset?}` | refuses dimensions `≤ 0.4`; `elevationOffset` default `0` off the ground floor, `0.15` on it; `railingHeight = kind === 'porch' ? 0 : 1.05` |
| `removeOutdoorSpace` | `(id)` | |
| `addFurniture` | `{floorId?, roomId?, catalogId, x, y, rotation?, width?, depth?, label?, color?}` | rotation normalised `(mod 360 + 360) mod 360`; refuses an item that cannot physically fit its host room, swapping width/depth on a quarter turn; without a host, homes to the room containing `(x,y)` |
| `removeFurniture` | `(id)` | |
| `moveFurniture` | `{itemId, x?, y?, rotation?, width?, depth?, roomId?, color?}` | re-homes by re-running `roomAt` after the geometry update |
| `applyMaterial` | `(target, materialId)` | `target.kind` = `'room' \| 'wall' \| 'exterior' \| 'floor'`; `'exterior'` rewrites every exterior wall, `'floor'` rewrites every room floor |
| `defineMaterial` | `(def)` | id must match `/^[a-z0-9_.-]{2,40}$/`; colour `#RRGGBB`; defaults roughness `0.8`, metalness `0`, opacity `1`, kind `'paint'` |
| `addUnderlay` / `updateUnderlay` / `removeUnderlay` | | |
| `setBrief` | `(brief)` | plot must have positive width and depth |
| `renameProject` | `(name)` | empty trim → `invalid_input` |
| `setDisplayUnits` | `('m' \| 'ft')` | |

Helpers: `roomAt(project, floorId, x, y)` — smallest area wins, so a balcony
inside a living room resolves to the balcony. `wallNear(project, floorId, x, y,
radius = 0.6)`. `neighboursOf(project, room)` → `Array<{room, shared}>` sorted by
shared edge descending.

---

# 9 · Measurement — `src/model/measure.ts`

Every number Furnish displays about area comes from here. The model can request
these; it can never supply them.

```
plot area          = plot.width × plot.depth
buildable area     = (width − left − right) × (depth − front − rear)
net indoor area    = Σ area of all indoor rooms, all floors
footprint area     = Σ area of ground-floor indoor rooms
                     + Σ covered ground-floor decks (porch, terrace)
gross covered area = Σ area of all indoor rooms, all floors
                     + Σ area of all roofed decks (balcony, terrace)
open site area     = plot area − footprint area
plot coverage      = footprint area ÷ plot area
floor area ratio   = gross covered area ÷ plot area
```

```ts
function isCoveredOutdoor(kind: string, elevation: number): boolean {
  if (kind === 'balcony') return true;
  return elevation > 0.05;      // a ground-level terrace or porch is not counted
}

export function measureRoom(project, roomId): RoomMeasurement | null
// { roomId, label, kind, area, perimeter, width, depth }

export function measureBuilding(project: Project): BuildingMeasurements
// Sums the per-room measurements, adds covered decks, then derives the ratios.
// Also returns perFloor[] = { floorId, label, elevation, netArea, coveredArea, roomCount }
```

Also `buildableRect(project)`, `occupancy(project)` (ground-floor indoor rooms
only), and `freeSpace(project)` — grid-sweeps the envelope on every ground-floor
room edge, marks a cell occupied when a room overlaps it by more than `0.01` in
**both** axes, fuses free cells of a row into strips, and returns only strips
deeper than `0.05`.

---

# 10 · Circulation — `src/model/circulation.ts`

Reachability as a graph, with the outside world as a node — which is the whole
trick, because "this room has a door but it leads outside" is a real and common
mistake that a door count cannot see.

```ts
export const OUTSIDE = '__outside__';

interface CirculationEdge { from: Id; to: Id; openingId: Id; kind: 'door'|'doorway'|'opening'|'exterior' }

const NEEDS_ACCESS = new Set([
  'living','dining','kitchen','bedroom','bathroom','utility','office',
  'guest','prayer','storage','pantry','garage',
]);
```

**`sidesOfOpening(wall, opening, rooms)`** — for each room in `wall.roomIds`,
compute `along = (c.x - a.x)*ux + (c.y - a.y)*uy` and
`lateral = -(c.x - a.x)*uy + (c.y - a.y)*ux`. Skip if
`|lateral| > max(w,d)/2 + thickness` or `|lateral| < 1e-6`. Score by how far
outside the opening the room's centre falls along the wall (`0` when inside),
skip if `score > extent + thickness`, keep the lowest score in the `pos` and
`neg` slots. Return `{ left: neg?.id ?? OUTSIDE, right: pos?.id ?? OUTSIDE }`.

**`buildCirculation(project, floorId)`**

1. Nodes = `[OUTSIDE, ...rooms on the floor]`.
2. For each `door | doorway | opening` on each wall, compute the two sides; skip
   if both are `OUTSIDE`; push **two directed edges**. Edge kind is `'exterior'`
   when either side is `OUTSIDE`, else the opening's kind. A door or doorway
   crossing the `OUTSIDE` boundary sets `hasEntrance`.
3. `doorless` = rooms whose kind is in `NEEDS_ACCESS` and which appear in no edge.
4. `entries` = rooms receiving a front-door edge, **plus** any room containing a
   stair whose `connectsToFloorId === floorId` (fallback: the nearest room by
   centre distance). A connecting stair also contributes a synthetic
   `OUTSIDE → host, kind: 'exterior'` edge.
5. **BFS** from `[OUTSIDE, ...entries]`; anything reached is reachable.
6. `unreachable = entries.size === 0 ? [] : NEEDS_ACCESS rooms not reached`.

Also `pathToRoom(project, floorId, roomId)` → `['Outside', ...labels]` back-tracked
through a `prev` map, plus `overlapsWall`, `wallsOverlapping`, `openingRects`.

---

# 11 · Validation — `src/model/validate.ts`

Deterministic, model-free, a pure function of the project.

```ts
export interface ConstraintRules {
  maxPlotCoverage: number;      // default 0.6
  maxFloorAreaRatio: number;    // default 1.8
  minCorridorWidth: number;     // default 0.9 m
  minWindowRatio: number;       // default 0.12 (glazing ÷ indoor floor area)
  minBathroomClearance: number; // default 0.6 m
  enforcePlotRules: boolean;    // default true
}

const MIN_USABLE_AREA: Partial<Record<RoomKind, number>> = {
  living: 12, dining: 8, kitchen: 6, bedroom: 8, bathroom: 3, utility: 2.5,
  office: 6, guest: 8, prayer: 4, storage: 1.2, hall: 4, lobby: 4, pantry: 2, garage: 12,
};

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;
```

### The 23 emitted checks

| code | severity | fires when | correction offered |
|---|---|---|---|
| `room_degenerate` | error | `width < TOL.dimension \|\| depth < TOL.dimension` | `remove_element {kind:'room'}` |
| `dimension_implausible` | warning | a corridor narrower than `minCorridorWidth` | `resize_room` widening the short axis |
| `dimension_implausible` | warning | `area < MIN_USABLE_AREA[kind]` | `resize_room` scaled by `k = sqrt(target/area)` |
| `room_out_of_plot` | error | the room leaves the plot | — |
| `room_overlap` | error | two rooms on a floor intersect by more than `0.001 m²` | best-of-two shrinks + remove the second |
| `wall_zero_length` | error | `length < TOL.length` | `remove_element {kind:'wall'}` |
| `wall_unbounded` | warning | an interior wall on no room edge | — |
| `wall_out_of_plot` | warning | an endpoint is outside the plot | — |
| `opening_overflows_wall` | error | the opening's span leaves `[-TOL.join, length + TOL.join]` | narrow to fit, or centre it |
| `opening_overflows_wall` | error | `sill + height > wall.height + 0.02` | resize, lowering the sill |
| `opening_overlap` | error | two openings within `(wA+wB)/2 - TOL.join` | — |
| `door_swing_blocked` | warning | the swing polygon hits a wall OBB | flip the swing |
| `door_swing_blocked` | warning | the swing polygon hits a furniture OBB | a swept furniture move |
| `furniture_crosses_wall` | error | an item's footprint meets a wall footprint | a swept furniture move |
| `furniture_out_of_room` | warning | room-stamped furniture has left its host | — |
| `furniture_overlap` | warning | two item OBBs collide (items `≤ 0.05 m` tall ignored) | remove the second |
| `no_entrance` | error | the ground floor has no `door` on any exterior wall | `add_door {wallId, width: 1.1}` |
| `room_no_access` | error | an unreachable room has no doors at all | — |
| `room_no_access` | error | an unreachable room's doors lead into unreachable space | — |
| `stair_not_connected` | error | `!connectsToFloorId` | — |
| `stair_not_connected` | error | `target.order <= from.order` | — |
| `stair_geometry_invalid` | warning | `width < 0.7 m` | — |
| `floor_disconnected` | error | an upper floor has no incoming stair from below | — |
| `setback_violation` | warning | a ground-floor room exits the envelope by more than `0.01 m` | — |
| `coverage_exceeded` | warning | `plotCoverage > maxPlotCoverage` | — |
| `far_exceeded` | warning | `floorAreaRatio > maxFloorAreaRatio` | — |
| `brief_room_missing` | info | the brief asked for `count` of a kind and fewer exist | add the room to the largest free spot |
| `window_into_service_space` | info | ground-floor glazing ÷ indoor floor area is below `minWindowRatio`, excluding corridor/storage/garage/hall | — |

The union declares **27** codes. Four are specified and deliberately not yet
written: `room_inside_wall`, `wall_not_shared`, `opening_out_of_bounds`,
`door_no_access`. Say so in the UI's constraint panel rather than implying the
list is exhaustive.

Every correction is a `{ label, tool: ToolName, input }` and is executed by
calling `runTool(fix.tool, fix.input, 'user')` — the same path the assistant
uses. There is no second, looser route into the model for the UI to take.

Corrections that need to search:

```ts
function growToArea(room, target) {
  const area = room.width * room.depth;
  if (area <= 0) return { width: room.width, depth: room.depth };
  const k = Math.sqrt(target / area);
  return { width: room.width * k, depth: room.depth * k };
}

function clearSpot(item, room, conflict, stillBad): Vec2 | null
// grid step 0.2 m, snapped to 3 decimals; the candidate must satisfy
// rectContainsRect(room.bounds, footprintOfItem(moved)) && !stillBad(obbOfItem(moved)),
// maximising the Euclidean rect gap from the conflict. Returns null if none.

function freeRoomSpot(project, floorId): Rect | null
// subtract every room and every wall footprint from the envelope, keep cells
// ≥ 2 m, sort by area, cap at 4.5 m per side, prefer the floor with the fewest rooms.
```

Final sort: `SEVERITY_ORDER[severity]` then `code.localeCompare`. Helpers
`errorsOnly(issues)`, `issuesFor(issues, id)`, `openingRectsFor(wall)`.

---

# 12 · The wall planner and the layout generator

### 12.1 `src/model/plan.ts` — walls from rooms

**`boundarySegments(rooms)`** — each room contributes four edges (top, bottom,
left, right) with their `facing` (`-2, 2, -1, 1`). For each edge, walk every
other room; if the other is flush on the opposite side (within `TOL.join`),
record the overlap span. Sort the spans and emit the gaps:

```ts
let cursor = e.from;
for (const [s, t] of covers) {
  if (s - cursor > TOL.length) emit(cursor, s);
  cursor = Math.max(cursor, t);
}
emit(cursor, e.to);
```

Notches and L-shapes survive this, which is the point.

```ts
function frontEdges(orientation: Orientation): BoundarySegment['facing'][]
// 0 → [-2] (north/top) · 90 → [1] (east/right) · 180 → [2] (south/bottom) · 270 → [-1] (west/left)
```

**`planFloor(opts)`** — six stages.

```ts
const WALL_PER_WINDOW = 3.0;                                  // one window per 3 m of exterior wall
const LIVING_WALLS = ['n','w','e','s'];                       // sofas and tables want the longest walls first
const BED_WALLS    = ['n','s','w','e'];                       // beds and tubs avoid the door side
const OPEN_PLAN = new Set(['kitchen','dining','living','office','hall','lobby']);
```

1. **Exterior boundary** from `boundarySegments` — each becomes an `exterior`
   wall, `WALL_THICKNESS.exterior` thick, material `exterior.render`.
2. **Interior partitions** — for every room pair on a floor, `sharedEdgeLength`
   above `TOL.length` spawns an `interior` wall.
3. **Entrance door**, ground floor only. Entrance room: `opts.entranceRoomId` →
   `isEntrance` → `lobby` → `hall` → `living` → `indoor[0]`. Rank front-side
   boundary segments touching it, filter to `length > 1.6 m`, longest first; on
   the first wall that fits a 1.1 m door, use `freeCentres` to find a slot,
   prefer the centre, `height: 2.4`, material `door.timber`.
4. **Windows** on every boundary wall `≥ 1.2 m`:
   `count = min(4, max(1, round(L / WALL_PER_WINDOW)))`, capped at `1` for
   bathroom/utility/storage/pantry/garage; `width = min(1.9, max(0.9, (L - 0.5)/count - 0.3))`;
   `height: 1.4`, `sill: 0.9`, material `glass.clear`.
5. **Interior doors** per partition:

```ts
function doorForRooms(kindA, kindB) {
  const servicePair = (bathroom on one side, and [bedroom,corridor,hall,guest] on the other)
    → { kind: 'door', spec: OPENING_DEFAULTS.bathroomDoor };              // 0.8 × 2.1
  const bothOpen = OPEN_PLAN.has(A) && OPEN_PLAN.has(B)
    → { kind: 'opening', spec: { width: 1.5, height: 2.2 } };             // cased opening, no leaf
  otherwise → { kind: 'door', spec: OPENING_DEFAULTS.interiorDoor };       // 0.9 × 2.1
}
```

   Width clamped to `L - 0.4`, minimum `0.6 m` to be placed at all; `offset = L/2`;
   hinge `'start'`; swing `'negative'` if either side is a corridor, else `'positive'`.
6. **Furnish**, when `opts.furnish !== false`.

**`freeCentres(length, width, taken)`** — pad `0.15` either side of each taken
span, sweep a cursor, emit the centre of each surviving gap.

**`furnishFloor`** — `innerRect(room)` subtracts `w.thickness/2 + 0.02` per side
that has a wall. `push(room, catalogId, x, y, rotation)` places by centre, swaps
the footprint on a quarter turn, and refuses when it does not fit, already
overlaps by more than `0.0005 m²`, or hits a door swing. `against(room, id,
sides)` tries each side with `backGap = 0.06` and slide offsets
`[0, ±0.55, ±1.1, ±1.65, ±2.2]`.

| kind | starting arrangement |
|---|---|
| `living` | `sofa-3` if the room is ≥3.4×3.4, else `sofa-2`; `coffee-table` at `sofa.y + sofa.depth/2 + 0.6` |
| `dining` | `dining-table` against `LIVING_WALLS` if both sides are ≥1.5 m |
| `kitchen` | `kitchen-run` (`wide ? [n,w,s,e] : [w,n,s,e]`); `fridge` on any side if ≥2.6×2.6 |
| `bedroom` | `bed-queen` if ≥3.3×3.3 else `bed-double`; `nightstand` at `bed.x − bed.width/2 − night.width/2 − 0.1`; `wardrobe` on `[w,e,n,s]` if `width ≥ 3.0` |
| `guest` | `bed-single` against `BED_WALLS` |
| `bathroom` | `bathtub` if ≥1.7×1.9; `wc` on `[e,w,n,s]`; `basin` on `[s,n,e,w]` |
| `office` | `desk` on `[w,n,e,s]` if `width ≥ 1.8` |
| `utility` | `washing-machine` on `BED_WALLS` if ≥1.2×1.2 |

**`placeStair`** — `riserCount = max(8, round(rise / RISER))`, `run = riserCount *
GOING`; candidates are spaces `≥ 1.1` wide and `≥ run − 0.4` deep, sorted by
lands-in-the-target-room first then by area; `width = min(1.4, spot.width − 0.2)`,
`direction: 1`, `topAtStart: true`.

**`replanFloor(project, floorId)`** — re-runs `planFloor` with furniture,
replacing everything on that floor. The full reset.

**`rebuildWallsFromRooms(project, floorId)`** — re-runs `planFloor` with
`furnish: false`, then strips the planner's own openings and re-homes each old
opening onto a new wall. A host is acceptable when `f.length >= width + 0.2`,
`|cross(dir, f.dir)| <= 0.2`, the centre lies within `[-0.3, f.length + 0.3]`
along the wall, and it runs within `w.thickness + 0.35` across it. Score =
`across + (clash ? 1 : 0) + (claimed ? 0.25 : 0)`. The offset is clamped to
`[w/2 + 0.1, f.length − w/2 − 0.1]` so an opening never sits flush in a corner.
Returns `{ floorId, wallsCreated, wallsRemoved, openingsKept, openingsDropped,
furnitureKept }`. **User furniture survives this.**

### 12.2 `src/model/layout.ts` — brief to plan

```ts
const STAIR_WIDTH = 1.4, CORRIDOR_WIDTH = 1.1, MIN_GRID_CELL = 2.4;
const PUBLIC  = new Set(['living','dining','kitchen','lobby','hall','office','prayer']);
const SERVICE = new Set(['utility','pantry','storage','garage']);
const PRIVATE = new Set(['bedroom','guest','bathroom']);

function bathroomCount(bedrooms, floors) {
  return Math.max(1, Math.min(4, Math.ceil(bedrooms / 2) + (floors > 1 ? 1 : 0)));
}
```

**`pack(box, items)`** — recursive binary space partition. Split the items near-
equal in area; split the box along its **longer** axis in the same ratio;
recurse.

**`allocateFloors(specs, floorCount)`** — the ground floor takes `PUBLIC` and
`SERVICE`; upper floors fill round-robin. If an upper floor would be empty, the
private rooms land on the ground instead.

**`generateFromBrief(project, brief, options)`** — eight steps:

1. **Envelope** from the plot minus setbacks. `conflict` if either axis is
   under `4 m`. `floorCount = clamp(brief.floorCount ?? options.floorCount, 1, 4)`.
2. **Shell floors** — `'Ground floor'` at `3.0 m`, `'First floor'` at `2.9 m`,
   elevations chained.
3. **Band structure (the spine)**

```ts
frontDepth   = Math.min(envD - CORRIDOR_WIDTH, Math.max(3.2, envD * 0.46));
corridorY    = envY + frontDepth;
corridorDepth = CORRIDOR_WIDTH;                 // 1.1 m
rearY        = corridorY + corridorDepth;
rearDepth    = envD - (rearY - envY);
useSpine     = frontDepth >= 3 && rearDepth >= 2.2;
```

4. **Stairwell reservation, before any room is placed**

```ts
stairRun = floors > 1 ? Math.max(8, Math.round((floors[1].elevation - floors[0].elevation) / RISER)) * GOING : 0;
shaft = (floors > 1 && useSpine && stairRun <= frontDepth)
  ? { x: envX + envW - STAIR_WIDTH, y: envY, width: STAIR_WIDTH, depth: frontDepth }
  : null;
```

5. **Fill each floor** — split the floor's specs into `PUBLIC` (front band) and
   the rest (rear band); scale = `(envW * envD) / totalRequestedArea`, tracked
   across floors as `minScale`. With no spine, one warning: *"only one band —
   rooms open into each other"*. On the entrance band, a `living` room is pinned
   to the first sub-box with
   `width = clamp(livingArea / first.depth, 2.6, first.width * 0.75)`.
6. `reindex` → `planFloor` per floor → `reindex` again.
7. **Stairs** between consecutive floors, from the shaft or from `freeSpace`;
   if none fits, push a warning naming both floors.
8. **Report** — `minScale < 0.7` warns that rooms were shrunk to a percentage;
   `minScale > 1.5` warns the plot is underused.

**`emptyFromBrief`** — floors, plot and brief, nothing else. **You draw it.**

**`gridFromBrief`** — score every lattice (`cols ∈ [1, specs.length]`,
`rows = ceil(n/cols)`, `columns = ceil(n/rows)`) with
`|log(cellW/cellD)| + rows * 0.02`, lowest wins, ties shallower. Accept only
when `cellW ≥ 2.4` and `cellD ≥ 2.4`; refuse if no lattice fits. The first room
of row 0 is marked `isEntrance`.

---

# 13 · The store — `src/store/useProject.ts`

Zustand, `create`. One dispatch table for the mouse, the keyboard, undo and the
assistant.

```ts
interface ProjectState {
  project: Project;
  history: HistoryState;
  activity: ActivityEntry[];
  toasts: Toast[];
  selection: Selection;                 // { kinds: ElementKind[]; ids: Id[] }
  activeFloorId: Id;
  activeRoomId: Id | null;
  tool: 'select'|'room'|'wall'|'door'|'window'|'furniture'|'measure'|'pan'|'trace';
  pendingFurnitureId: string | null;
  pendingRoomKind: RoomKind;           // default 'living'
  snapEnabled: boolean;                // default true
  gridEnabled: boolean;                // default true
  ruleOverrides: Partial<ConstraintRules>;
  dirty: boolean;
  aiBusy: boolean;
  viewMode: 'plan' | '3d' | 'split';   // default 'plan'
  // …actions below
}

interface RunOptions {
  label?: string;
  actor?: 'user' | 'assistant' | 'system';
  coalesceKey?: string | null;         // collapses successive calls until COMMIT
  undoable?: boolean;                  // default true
  deferSave?: boolean;                 // skip the IndexedDB write (used during drags)
}
```

### 13.1 The `OperationName` union and the dispatch table

Every entry in `TABLE` maps one name to one pure operation. This is the *only*
route from "an edit should happen" to "the edit happened".

```
createRoom resizeRoom moveRoom setRoomLabel removeRoom
createWall  moveWall   resizeWall removeWall
addOpening  moveOpening removeOpening
addStaircase removeStaircase
addOutdoorSpace removeOutdoorSpace
addFurniture moveFurniture removeFurniture
addFloor renameFloor removeFloor setFloorHeight
setPlot setBrief renameProject setDisplayUnits
applyMaterial defineMaterial
addUnderlay updateUnderlay removeUnderlay
replanFloor rebuildWalls replaceProject importProject
```

`OP_LABELS` gives each one a human undo label (`createRoom: 'Add room'`,
`rebuildWalls: 'Rebuild walls from rooms'`, …).

### 13.2 `run(name, args, opts)`

```ts
const fn = TABLE[name];
if (!fn) return failure('invalid_input', `Unknown operation "${name}".`);

const before = get().project;
const result = fn(before, ...args);

if (!result.ok) { log(…); toast('error', result.error); return failure; }

let history = get().history;
if (opts.undoable !== false) {
  history = push(history, before, result.project, {
    label: opts.label ?? OP_LABELS[name] ?? name,
    actor: opts.actor ?? 'user',
    createdIds: result.createdIds, removedIds: result.removedIds,
    coalesceKey: opts.coalesceKey ?? null,
  });
} else {
  history = commit(history);
}

set({ project: result.project, history, dirty: true,
      activeFloorId: exists(result.project, get().activeFloorId) ? get().activeFloorId
                                                                   : (result.project.floors[0]?.id ?? '') });

log({ actor: opts.actor ?? 'user', label, ok: true, createdIds, removedIds, opCount: 1 });
if (!opts.deferSave) void persist(set, get);
return { ok: true, data: result.data, createdIds: result.createdIds, removedIds: result.removedIds };
```

### 13.3 History — `src/model/history.ts`

Whole-`Project` snapshots. `MAX_HISTORY = 100`. Any new edit clears the redo
stack.

```ts
const gestureOpen = entry.coalesceKey !== null && state.coalesceKey === entry.coalesceKey;
if (gestureOpen && top && top.coalesceKey === entry.coalesceKey) {
  past[last] = { ...entry, before: top.before };    // keep the FIRST before
} else {
  past.push(entry);
}
```

`beginGesture(key)` opens a coalesce run; `endGesture()` calls `commit` and
closes it. A drag is therefore one undo step, not two hundred.

Derived selectors: `selectMeasurements`, `selectIssues`,
`selectActiveFloor`, `selectUndoLabel`, `selectRedoLabel`, `selectCanUndo`,
`selectCanRedo`.

`deleteSelection()` dispatches to `removeRoom | removeWall | removeFurniture |
removeOutdoorSpace | removeStaircase | removeOpening` (the last needs
`[hostWall.id, openingId]`).

`setPendingRoomKind(kind)` with the same kind while the room tool is armed
stands the tool back down to `'select'`.

`MAX_ACTIVITY = 120`. Toasts: clipped to the last 4; 3600 ms for info/success,
7000 ms for error.

---

# 14 · The 2D editor — `src/ui/canvas2d/`

### 14.1 View transform — `view.ts`

```ts
export interface ViewTransform {
  scale: number;      // CSS pixels per metre
  offsetX: number;    // screen x of plan x=0
  offsetY: number;    // screen y of plan y=0
  width: number; height: number;
}
export const MIN_SCALE = 4, MAX_SCALE = 400;
export const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

planToScreen(v, p) → { x: p.x * v.scale + v.offsetX, y: p.y * v.scale + v.offsetY }
screenToPlan(v, p) → { x: (p.x - v.offsetX) / v.scale, y: (p.y - v.offsetY) / v.scale }

fitTransform(width, height, plan, margin = 48)
// scale = clampScale(min((width - margin*2) / plan.width, (height - margin*2) / plan.depth))
// centred on the remaining box

zoomAt(v, px, py, factor)   // next = clampScale(v.scale * factor); k = next / v.scale
                             // offsetX = px - (px - offsetX) * k  (same for Y)

gridStepFor(scale)          // candidates [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]; first c with c*scale >= 28

snapToGeometry(value, candidates, tolerance, axisStep, snapEnabled)
// → { value, snappedTo, guideValue }
```

Wheel zoom factor is `Math.exp(-deltaY * 0.0016)`.

### 14.2 Plan colours — the drafting palette

```ts
const C = {
  plot: '#efece4',   plotEdge: '#b9b2a3',   setback: '#c9c2b1',
  roomStroke: '#8d8577',   roomStrokeSelected: '#2563eb',
  floor: '#fdfcfa',  outdoor: '#f1f4f0',
  wall: '#3f3a33',   wallExterior: '#2b2722',
  opening: '#fbfaf7', glass: '#5b8ba6',
  furniture: '#c9c2b1', furnitureStroke: '#9a9284',
  label: '#3f3a33', labelDim: '#8d8577',
  guide: '#2563eb', measure: '#b45309',
  error: '#dc2626',
} as const;
```

Outdoor space is distinguished by **hatching, not hue** — indoors all share
`#fdfcfa` regardless of kind.

### 14.3 Wall poché — `poche.ts`

```ts
export const WALL_FILL: Record<string, string> = {
  exterior: '#2b2722', interior: '#5f584c', parapet: '#8d8577',
  railing: '#a9a196', boundary: '#b9b2a3',
};

export function wallPiers(wall: Wall, halfM = wall.thickness / 2): Array<Array<[number, number]>>
// Sort openings by offset. For each opening produce the pier polygon spanning
// [offset - width/2, offset + width/2] across both faces at [-halfM, +halfM].
// When two opening slices touch (gap < TOL.point) they merge into one pier, so
// consecutive openings do not render a phantom stretcher between them.
```

The canvas calls it with `pierM = max(wall.thickness / 2, (1.6 / s) * 1.6)` so a
thin wall is never drawn thinner than 1.6 px.

### 14.4 Symbols — `symbols.tsx`

- **`DoorSymbol`** — from `doorLeaf`. Below `opening.width * scale > 26` px of
  leaf, draw a 1.2 px dot on the hinge instead of the arc. Otherwise a real
  circular arc:
  `M fx fy A (r*scale) (r*scale) 0 0 sweep ox oy`, plus the leaf line
  (`strokeWidth 1.1`, round cap) and the sweep (`0.7`, `opacity 0.75`). Wrapped
  in `<g style={{pointerEvents:'none'}}>` so a symbol never steals a click.
- **`WindowSymbol`** — the four corners inset by
  `frame = max(halfM - 0.02, 0.012)` m, stroked `0.8` at `opacity 0.8` with no
  fill (the poché shows through), plus one glazing line across `side: 0` in
  `C.glass` at `strokeWidth 1.4`. Symbols render only when `scale > 14`.
- **`FurnitureGlyph`** — a base `<rect>` plus a per-catalogue detail. Dispatch:
  `cylinder`/`round` → ellipse (+ inner ellipse when `detail && w>16 && h>16`);
  `lshape` → `M0 0 H{w} V{arm} H{arm} V{h} H0 Z` with `arm = max(6, min(w*0.34, h))`;
  `panel` → rect with a midline when `detail && h > 5`; otherwise `SPECIAL`:
  beds → `pillowBand`; sofas/armchair → `backBand`; wardrobe/shelving/
  kitchen-run/tv-unit → `HangLines(3/2/3/2)`; stove → `Burners`;
  sink/basin/washer/dryer → `Bowl`; fridge → `Split at 0.22`; wc → `Wc`;
  bathtub/shower → `Bath`/`Shower`; dining-chair → `Split at 0.18`;
  dining-table → `Chairs`; rug → dashed inset rect.

### 14.5 `PlanCanvas.tsx`

SVG layer order, bottom to top:

1. `<g data-testid="plan-grid">` — when enabled. Minor lines `#e8e4dc @ 0.5 px`,
   every fifth `#d9d3c7 @ 1 px`, spanning the whole canvas.
2. `<defs>`:

```jsx
<marker id="furnish-arrow" markerWidth={7} markerHeight={7} refX={3} refY={3.5} orient="auto">
  <path d="M0,0 L7,3.5 L0,7 Z" fill="#6b6357" />
</marker>
<pattern id="furnish-hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
  <line x1={0} y1={0} x2={0} y2={6} stroke={C.setback} strokeWidth={1} />
</pattern>
```

3. `<g data-testid="plot">` — the plot rect (`C.plot`, stroke `C.plotEdge` at
   1.5), the dashed setback rect (`6 5`, `C.setback`), and a summary label.
4. Underlays — `<image href={u.dataUrl} preserveAspectRatio="none">`; when
   `calibration.confirmed`, position and size come from the calibration
   (`offX`, `offY`, `naturalWidth * scale`, `naturalHeight * scale`).
5. Outdoor spaces, dashed `4 3`.
6. `<g data-testid="rooms">` · 7. `<g data-testid="walls">` · 8. stairs ·
   9. `<g data-testid="furniture">` · 10. `<g data-testid="opening-symbols">`
11. `<OverallDimensions>` · 12. `<ResizeHandles>` · 13. move guide lines ·
14. `<MeasureReadout>` · 15. `<NorthArrow>` at `(width − 60, 44)` rotating by
`−plot.orientation` · 16. `<ScaleBar>` at `(16, height − 18)`, picking the
nearest "nice" number from `[0.25, 0.5, 1, 2, 5, 10, 20, 50, 100]` to
`120 / view.scale` · 17. `<ContextMenu>` and `<TraceOverlay>` · 18. a status
pill: `{scale} px/m · grid {step} m · {n} rooms · {n} walls`.

**Hit testing** — order matters and one of these was a real bug:

```ts
roomAtPoint(rooms, x, y)          // last-to-first, fuzzy contains with TOL.point
furnitureAtPoint(items, x, y)     // last-to-first, against footprintOfItem (rotated AABB)
nearWallAt(project, floorId, x, y, radius = 0.6)      // distance to the centreline
wallUnderPoint(project, floorId, x, y, scale)
  // tests distance to the wall *band* (centreline ± thickness/2) with a
  // "finger margin" of max(0.12, 5/scale) m, and returns the smallest-gap wall
projectWallPoint(wall, p) → { along, side }
handleAt(room, p, scale)          // ResizeEdge within 9 / scale metres
isRoomCorner(room, p, scale)      // true on an X edge AND a Y edge — corners are unambiguous
selectWallOrOpening(wall, along, p)
  // an opening within |o.offset - along| < o.width/2 + 0.12 wins; otherwise the wall
```

**In `onPointerDown`, `wallUnderPoint` is tested BEFORE `roomAtPoint`.** Rooms
used to be tested first, so an interior wall could never be selected, moved or
deleted. Do not reintroduce that.

**Drag state** is one discriminated union:

```ts
type Drag =
  | { kind: 'pan'; startX; startY; view }
  | { kind: 'moveRoom'; id; grabX; grabY }
  | { kind: 'resizeRoom'; id; edge: ResizeEdge; grabX; grabY }
  | { kind: 'moveFurniture'; id; grabX; grabY }
  | { kind: 'moveWall'; id; grab: {x;y} }
  | { kind: 'moveOpening'; id; wallId }
  | { kind: 'drawWall'; wallId; start; cursor }
  | { kind: 'measure'; a; b };
type ResizeEdge = 'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw';
```

Per tool: middle button, the `pan` tool or `altKey` pans. The `room` tool first
tries to pick up existing furniture or a room rather than creating a duplicate.
The `wall` tool picks a wall when you click its **middle** but still draws when
you click near an **end**, so partitions can join. The `door`/`window` tools
require a click within `0.9 m` of a wall and fall back to `select` afterwards.
The `furniture` tool needs `pendingFurnitureId`. `measure` records two points.
The select tool resolves furniture → corner → wall/opening → edge handle → room
→ near wall → clear.

Snap candidates are the union of every room's four edge coordinates and every
wall endpoint, plus the grid step. On `pointerUp`, a `drawWall` shorter than
`0.25 m` is removed rather than committed.

**Room labels**

```ts
const upright = ph > pw * 1.25;
const big = upright ? ph > 78 : pw > 46 && ph > 30;
const mid = upright ? ph > 122 : pw > 60 && ph > 58;
```
`big` → the label at 12 px/500 plus an area line at `+13` px in 10.5 px
(`${area.toFixed(1)} m²` or `${(area * 10.7639).toFixed(0)} ft²`). `mid` → a
third line at `+27` px with `formatLength(width) × formatLength(depth)`. Upright
rooms get `transform: rotate(-90 cx cy)`.

**Furniture** is drawn unrotated inside a translate group and then rotated about
its own centre by `item.rotation`, so the occupied footprint stays stable rather
than the axis-aligned box. The label is rendered **outside** the rotated group so
it is never upside down, and only when
`(quarterTurn ? h > 44 && w > 14 : w > 48 && h > 16)`.

**Resize handles** — eight, 8×8 white rects stroked `C.roomStrokeSelected` at
1.5, corners and edge midpoints, hidden when `pw < 30 || ph < 30`, hit-tested
at `tol = 9 / scale`.

**Overall dimensions** — only when `bounds.width * s >= 110 && bounds.depth * s >= 90`.
Horizontal chain at `y1 + 34/s`, vertical at `x0 − 34/s`, tick `5/s`, witness
lines, and a **45° slash terminator** — not an arrowhead, because an arrowhead
reads as a measurement arrow and a slash reads as a dimension. Vertical labels
rotate `−90`.

### 14.6 `ContextMenu.tsx`

```ts
export interface MenuTarget { kind: ElementKind | 'none'; id: Id; along?: number }
```

Dismissed by a **capture-phase** `window` `pointerdown` outside the host, or
`Escape`. Positioned with `left: max(4, min(x, clientWidth − 236))` and
`top: max(4, min(y, clientHeight − (40 + items.length * 30)))`.

| target | title · detail | items, in order |
|---|---|---|
| room | label · kind + area | `duplicate` (+0.5 m offset) → `replan` (rebuild this floor's walls, toast the kept/dropped counts) → ─ → `delete` |
| wall | `{type} wall` · length + thickness | `door` · `window` (both at `along`) → ─ → `delete` |
| opening | Door/Window · w × h | `flip` (doors) · `centre` → ─ → `delete` |
| furniture | label · w × d · rotation | `rotate` (+90°, swapping w/d) · `duplicate` (+0.3, +0.3) → ─ → `delete` |
| outdoor / stair | label · — | `delete` |
| none | Plan · Nothing under the cursor | `select-all` · `fit` |

Items whose id starts with `-` render as `<div className="section-rule" />`.

---

# 15 · The 3D scene — `src/three/`

### 15.1 `sceneModel.ts` — the model as boxes

```ts
export interface Box {
  x: number; y: number; z: number;      // centre, world metres
  w: number; h: number; d: number;      // full extents, world metres
  ry: number;                           // rotation about vertical, DEGREES clockwise
  color: string; roughness: number; metalness: number; opacity: number;
  kind: 'wall'|'slab'|'room-slab'|'stair'|'furniture'|'deck'|'railing'|'roof'
      | 'glass'|'trim'|'frame'|'lawn'|'paving'|'path';
  ownerId?: string;                     // the model element, when there is exactly one
  floorId: string;                      // REQUIRED on every box
  shape?: 'box'|'cylinder'|'sphere';
  round?: number;                       // bevel radius, metres; 0/absent = hard edges
  rx?: number; rz?: number;             // extra pitch/roll in degrees
  surface?: string;                     // texture family; undefined = flat colour
  glass?: boolean;                      // MeshPhysicalMaterial, not a tinted standard one
  noCollide?: boolean;
}

export interface Collider { x: number; z: number; w: number; d: number; floorId?: string }

export interface SceneGeometry {
  boxes: Box[];
  colliders: Collider[];
  bounds: { width: number; depth: number; height: number };   // the PLOT
  building: {
    minX: number; maxX: number; minZ: number; maxZ: number;
    cx: number; cz: number; cy: number;
    width: number; depth: number; height: number;             // WALLS ONLY
  };
  entrance: { x: number; z: number; width: number } | null;
}

export const PLINTH_HEIGHT = 0.45;
export const JOINT_OVERLAP  = 0.006;   // each solid piece runs 6 mm under its neighbours
export const EAVES_OVERHANG = 0.5;

const PLINTH_PROUD   = 0.04;
const ROOF_THICKNESS = 0.24;
const FASCIA_HEIGHT  = 0.2;
const JOINT_EPS      = 1e-3;

export const STREET_DIR = { 0: {x:0,z:-1}, 90: {x:1,z:0}, 180: {x:0,z:1}, 270: {x:-1,z:0} };

export const frameFor = (plotW: number, plotD: number) => ({
  plotW, plotD,
  tx: (x: number) => x - plotW / 2,
  tz: (y: number) => y - plotD / 2,
});

export function buildScene(project: Project, options: BuildOptions = {}): SceneGeometry
// BuildOptions { visibleFloorIds?, showRoof = true, showFurniture = true, showGround = true }
// The top floor is floors sorted by `order`, last one. A roof is emitted only for it.
```

Colliders come only from `kind` of `wall`, `furniture` or `glass`, excluding
`noCollide`, and **carry their `floorId`** so an upstairs camera is not blocked
by the ground floor.

`building` is computed from `kind === 'wall'` boxes only, swapping `w`/`d` when
`|sin(ry·π/180)| > 0.5`, so a rotated wall's footprint is honoured. An empty
plot falls back to a zero extent at the origin so the camera still has a target.

**Wall splitting.** Walk the wall's local frame; sort the openings by `offset`;
emit **piers** between them, a **sill** below each opening (`sill > 0.01` only)
and a **head** above it (`head < height − 0.01` only). Every piece is the *full*
wall thickness — so the elevation is one continuous plane end to end — and every
piece runs `JOINT_OVERLAP` past both of its joints, so the plane has no seams
in it either. `railing` and `boundary` walls are one box, `metalness 0.35`,
`roughness 0.55`, `kind 'railing'`.

**Corner resolution.** Two walls meeting at 90° leave a `thickness/2 ×
thickness/2` notch. The repair that actually holds is to give the corner its own
solid: both walls stop half a thickness short and a block exactly one thickness
square fills the gap. The **thickest** wall at the junction sets the half-extent,
so a thin partition arriving at a thick exterior is not poked through it; the
colour, surface and `exterior` flag come from whether any participant is
exterior; the corner's height is the shortest participant; `plinthHalf = half +
PLINTH_PROUD`. Collinear walls that butt end-on get `trim = 0`. Corner blocks are
deliberately excluded from the collider list — they are flush with their walls.

**Openings get joinery.** `joineryDepth = thickness + 0.06`,
`fw = 0.055` (jamb/head/stile). Both jambs and the head are `kind 'frame'` at
`FRAME_COLOR #5f574a` (windows) or `DOOR_FRAME_COLOR #6b6154` (doors), roughness
`0.55`. A window also gets an interior sill at `thickness + 0.14`, and a
**mullion** — a 60 mm central stile — when the opening is wider than `1.15 m`.
The glass pane is `kind 'glass'`, `GLASS_COLOR #a8ccdd`, `opacity 0.3`,
`roughness 0.05`, `metalness 0.1`.

**Plinth**, ground-floor exterior only: `h = min(PLINTH_HEIGHT, height * 0.4)`,
`depth = thickness + 0.08`, colour `#a9a294`, `kind 'trim'`, surface `stone`,
roughness `0.88`. Emitted only when `h > 0.02`.

**Colours**

```ts
const WALL_COLORS = { exterior:'#efe9dd', interior:'#f6f2e9', parapet:'#cfc7b6',
                      boundary:'#b9b2a3', railing:'#8e8778' };
const FRAME_COLOR = '#5f574a', DOOR_FRAME_COLOR = '#6b6154';
const PLINTH_COLOR = '#a9a294', ROOF_COLOR = '#84837e', FASCIA_COLOR = '#8a8478';
const LAWN_COLOR = '#a8b48f', PAVING_COLOR = '#c6c0b2', PATH_COLOR = '#d2ccbe';
const GLASS_COLOR = '#a8ccdd', TREAD_COLOR = '#b9ae97';

const KIND_FLOORS = {
  living:'#c9a87c', dining:'#c9a87c', kitchen:'#bfc4c6', bedroom:'#c8ab88', guest:'#c8ab88',
  office:'#c6b79c', prayer:'#c6b79c', storage:'#c4bfb6', utility:'#c4bfb6', pantry:'#c4bfb6',
  corridor:'#c4bfb6', hall:'#c4bfb6', lobby:'#c4bfb6', garage:'#b9b5ad',
  balcony:'#b9ae97', terrace:'#b9ae97',
};
const DEFAULT_FLOOR_COLOR = '#c4bfb6';

const WALL_SURFACE = { exterior:'render', interior:'plaster', parapet:'render',
                       boundary:'concrete', railing:'metal' };
const FLOOR_SURFACE = {
  living:'stone', dining:'oak', kitchen:'tile', bedroom:'oak', bathroom:'tile',
  guest:'oak', office:'oak', prayer:'tile', storage:'concrete', utility:'tile',
  pantry:'tile', corridor:'stone', hall:'stone', lobby:'stone',
  garage:'concrete', balcony:'paving', terrace:'paving',
};
```

**Site.** `lawn` at `y = −0.3`, `h = 0.1`, plot + a 6 m verge, `#a8b48f`,
roughness `1`. A `paving` apron around the building at `+1.3 m` per side,
`y = −0.04`. A `path` from the front door to the street **only when `entrance`
is non-null** — `length = reach + 0.4`, `width = max(1.3, entrance.width + 0.6)`,
overlapping the threshold by `0.2 m` so it tucks under the door frame.

**Roof.** Extent from the rooms and the exterior wall endpoints, plus
`EAVES_OVERHANG * 2` — a 1 m oversail that puts the roof in its own shadow.
`h = 0.24`, `#84837e`, surface `roof`, plus four 0.07-thick fascia bands
`#8a8478`, `0.2` tall.

**`findEntrance`** walks the ground-floor exterior walls. Skip a wall whose
perpendicular `(-dy/len, dx/len)` is no better than `0.2` aligned with the
street bearing — otherwise a wall merely *on* the street side passes. Score the
rest by `facing * 100 + s/len` and keep the best, which prefers a squarely
front-facing wall and breaks ties on the door running furthest along it. Return
`null` when nothing qualifies.

**Stairs** are individual tread boxes, `h = 0.05`, `#b9ae97`, surface `oak`, plus
one solid core block at 90 % width in `#a89d88`, surface `render`.

### 15.2 `textures.ts` — procedural surfaces, no image assets

`SIZE = 192`, anisotropy `8`, `RepeatWrapping`, `SRGBColorSpace`. Maps are
greyscale and the same texture is reused as `bumpMap`. Both the noise and the
texture are memoised in `Map`s.

```ts
const TILE_METRES = 2.2;
export function surfaceRepeat(w: number, h: number): [number, number] {
  const q = (metres: number) => {
    const r = metres / TILE_METRES;
    return Math.max(0.5, Math.min(14, Math.round(r * 2) / 2));   // half-tile quantised
  };
  return [q(w), q(h)];
}
```

Thirteen families, each a per-pixel painter on a `Uint8ClampedArray`:

| surface | base / amplitude | extra |
|---|---|---|
| `plaster` | 0.96 / 0.05 | |
| `render` | 0.93 / 0.09 | |
| `concrete` | 0.90 / 0.11 | × grit, lattice 96, 2 octaves, seed 21, amp 0.06 |
| `roof` | 0.95 / 0.06 | × grit, lattice 64, 2 octaves, seed 33, amp 0.09 |
| `stone` | 0.93 / 0.08 | `joint(2 × 2, depth 0.3)` — four slabs |
| `oak` | six planks, per-plank tone `0.9 + rand()*0.16` | grain noise lattice 8, 4 octaves, seed 55, stretch 9; dark plank seams |
| `tile` | per-cell `0.93 + rand()*0.1` | `joint(6 × 6, depth 0.26)` |
| `carpet` | 0.95 / 0.07 | |
| `fabric` | 0.94 / 0.05 | `+ sin(x·π·64)·sin(y·π·64)·0.03` weave |
| `lawn` | 0.90 / 0.11 | × fine noise lattice 32, 2 octaves, seed 78, amp 0.07 |
| `paving` | 0.91 / 0.10 | × grit lattice 128, seed 12, amp 0.05; `joint(4 × 4, depth 0.22)` |
| `metal` | `0.93 + 0.07·brush` | brush lattice 4, 3 octaves, seed 5, stretch 24 |
| `leaf` | 0.88 / 0.16 | |
| `flat` | 0.97 / 0.04 | |

`joint()` writes a **recessed groove**: where `t = min(|u·cellsU| mod 1 − 0.5|,
|v·cellsV| mod 1 − 0.5|) * 2 > 0.94`, darken by
`k = 1 − depth·(1 − (t − 0.94)/0.06)` — a 6 % band either side of the line.

Material cache key:
`` `${surface}|${color}|${roughness}|${metalness}|${opacity}|${glass}|${rx}x${ry}` ``.
`bumpScale = 0.012`. Glass is a `MeshPhysicalMaterial` with
`roughness 0.04, reflectivity 0.6, clearcoat 1, clearcoatRoughness 0.02,
side DoubleSide, depthWrite false`. Textures are cloned when their repeat
differs from 1 and shared otherwise.

**Sky** — a 256×128 canvas gradient with
`EquirectangularReflectionMapping`:

```
0.00 #7ea7cf · 0.28 #a6c3dd · 0.44 #ccd9e2 · 0.50 #e9e2d1 (horizon haze)
0.58 #e7e2d5 · 0.78 #ded9cb · 1.00 #d5d2c4
```

Set as `scene.background`. **Do not set `scene.environment`** — it was
deliberately rejected: an IBL lookup per pixel is the most expensive thing in
the frame under a software rasteriser. The sky texture is assigned as `envMap`
on glass and on materials with `metalness > 0.3` only
(`envMapIntensity` = `1.5` for glass, `0.85` otherwise).

**Primitives**

```ts
export function primitiveGeometry(shape, w, h, d, round = 0): THREE.BufferGeometry
// shape undefined && round > 0 → roundedBoxGeometry; else CylinderGeometry(w/2,w/2,h,24,1)
// sphere → SphereGeometry(w/2, 20, 14); default BoxGeometry(w,h,d)
// cached by `${shape}|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`

export function roundedBoxGeometry(w, h, d, radius = 0.02)
// ExtrudeGeometry over a rounded-rect Shape with bevelSegments 2, steps 1,
// bevelSize = bevelThickness = r, curveSegments 2; center(); toCreasedNormals(0.6)
```

### 15.3 `furniture.ts` — parametric massing

`Part` is a box/cylinder/sphere in the item-local frame (`x` across width, `z`
across depth, `y` up from the floor), with `round`, `color`, `surface`,
`roughness`, `metalness`, `opacity`, `glass` and a **`solid`** flag. A part with
`solid && h > 0.03` collides; cushions, rugs, books, legs and handles do not.

```ts
const WOOD = '#8a6a45', DARK_WOOD = '#6b4f34', PALE_WOOD = '#c2a67c';
const FABRIC = '#9d9a92', LINEN = '#e8e4da', WHITE = '#f0efec';
const STEEL = '#b9bdc1', DARK = '#3c3a37', GLASSY = '#20211f';
const SOIL = '#4a3f33', LEAF = '#5c7f52', ACCENT = '#b4564a';
const T = 0.018;    // door / shelf / worktop thickness
```

Helpers `box`, `cyl`, `ball`, `soft` (fabric with a 6 cm bevel),
`legs(w, d, h, thickness, color)` (four bevelled, non-solid legs) and
`fronts(w, d, y, h, count, color, surface, handleColor)` — one panel per slot at
`panel = (w − 0.008·(count+1)) / count` and a cylindrical handle at `h * 0.72`.

`furnitureParts(item)` dispatches on `catalogId` to 21 assemblers. A sofa is
legs, a seat cushion, a back cushion, two arms and per-seat cushions and backs
(`seats = max(1, round((w − armW·2) / 0.78))`); a bed is a 0.26 frame, a 0.24
mattress, a 0.72 headboard, one or two pillows and a folded throw; a kitchen
run is a plinth, a carcass, a stone worktop with a 12 mm under-light strip, and
door fronts. An unrecognised id falls back to one rounded box. This is
**parametric massing, not modelled joinery** — say so in the docs.

### 15.4 `collision.ts` — the cameras

```ts
export const CAMERA_RADIUS      = 0.26;        // shoulder width, metres
export const EYE_HEIGHT         = 1.62;
export const WALK_VERGE         = 11;          // metres outside the plot the walk camera may stand
export const PITCH_LIMIT        = (86 * Math.PI) / 180;
export const LOOK_SENSITIVITY   = 0.0032;      // radians per pixel of pointer drag
export const TURN_RATE          = 1.9;         // radians per second on Q / E
```

```ts
export function overlapsCollider(x, z, c: Collider, radius: number): boolean
// clamp (x,z) onto the rect, then dx² + dz² < radius²

export function moveWithCollision(x, z, dx, dz, colliders, radius = CAMERA_RADIUS, filter?): MoveResult
// Per-axis: resolve X with z as the constant lateral, then Z with the RESOLVED X.
// The forbidden span per axis is sliced off the circle, so corner contact is
// exact rather than approximative. A move that does not straddle the interval is
// left alone — for one-axis travel a swept test and an endpoint test agree.
// If the start IS inside a forbidden interval and genuinely penetrates, travel
// out the FAR side (delta > 0 ? min(hi, target) : max(lo, target)); escaping beats
// snapping back, because the wall it is pressed against would win the snap fight
// every frame.
```

```ts
export function snapToFloor(fromY, candidates): number
// Asymmetric snap-UP: a candidate qualifies when within 0.25 m of it vertically
// and within 0.25 m of the current best. Returns fromY unchanged if none qualify.

export function walkableSurfaces(boxes)   // kind ∈ room-slab, slab, stair, deck
export function clampToPlot(x, z, plot, margin = 0.5, verge = 0): {x, z}
export function standBackDistance(width, height, aspect, fovDeg): number
// vFov = fovDeg·π/180; hFov = 2·atan(tan(vFov/2)·max(0.2, aspect));
// span = max(width, height·1.6)   ← a building is photographed at three-quarters,
// so the DIAGONAL has to fit, not the width head-on
// returns span / (2·tan(hFov/2))

export function walkStart(building, plot, colliders, radius, aspect, fovDeg, street): {x, z}
// front = the most-reached face along the street bearing over every collider
// back  = clamp(standBackDistance(...)·1.18, 3.5, 26)
// offset = front − projectionOfCentreOntoStreet + back
// then clampToPlot(..., 0.5, WALK_VERGE), then up to 40 step-outs of 0.25 m
// along the street bearing while still overlapping a collider

export const headingFromYaw = (yawDeg: number) => (yawDeg * Math.PI) / 180;

export function shortestAngle(from, to): number  // (((to - from) % 360) + 540) % 360 - 180

export function roomFootprint(room, frame): {minX, maxX, minZ, maxZ, cx, cz}
export function canViewFromInside(room): boolean
// !room.outdoor && kind ∉ {balcony, terrace, garage} && width > 0.6 && depth > 0.6

export function principalFloorId(rooms, order?): string | null
export function defaultInteriorRoom(rooms, order?): RoomRect | null
// floors lowest-first; within one, rank = PREFERRED_VIEWS.indexOf(kind) with
// ['living','dining','kitchen','office','guest','bedroom','lobby'];
// new best if rank < bestRank, or equal rank with a larger area
export function roomAt(x, z, rooms, frame, floorId?): RoomRect | null   // smallest area wins
```

**`roomViewpoint(room, frame, opts)` — the corner framing rule.** Stand in the
corner furthest from the middle of the building and look at the opposite one. It
is not a taste decision: a 4.4 × 5.0 m living room viewed from 4.56 m out has
a 57° horizontal FOV giving 5.0 m of visible width against a 4.4 m room, so a
head-on shot fills the frame with one blank plane. The corner shot works in both
orientations and in narrow rooms.

```ts
const inset = radius + 0.18;
const fits = maxX - minX > 2 * inset + 0.5 && maxZ - minZ > 2 * inset + 0.5;

const corners: Array<[number, number]> = fits
  ? ([[maxX - inset, maxZ - inset], [maxX - inset, minZ + inset],
      [minX + inset, maxZ - inset], [minX + inset, minZ + inset]] as Array<[number, number]>)
      .sort((a, b) => Math.hypot(b[0] - bc.x, b[1] - bc.z) - Math.hypot(a[0] - bc.x, a[1] - bc.z))
  : [];

const shots: Shot[] = corners.map((at) => ({ at }));
// then, for each corner, two positions stepping in toward the middle:
for (const [x, z] of corners) {
  shots.push({ at: [x + (cx - x) * 0.55, z + (cz - z) * 0.55] });
  shots.push({ at: [x + (cx - x) * 0.25, z + (cz - z) * 0.25] });
}
shots.push({ at: [cx, cz] });                                    // last resort: the middle

const clear = (x, z) => !opts.colliders?.some((c) => overlapsCollider(x, z, c, radius));
const [x, z] = shots.find((s) => clear(s.at[0], s.at[1]))?.at ?? [cx, cz]!;

const y    = elevation + eye;
const aimY = y - Math.max(0.12, Math.min(0.34, (room.height ?? 2.7) * 0.09));
const dx = cx - x, dy = aimY - y, dz = cz - z;
const len = Math.hypot(dx, dy, dz) || 1;

return {
  x, y, z,
  yaw:   (Math.atan2(-dx, -dz) * 180) / Math.PI,     // DEGREES
  pitch: (Math.asin(Math.max(-1, Math.min(1, dy / len))) * 180) / Math.PI,
};
```

**Test the four cases that matter:** it stands in a corner rather than on the
centre line; it picks the corner furthest from the middle of the building; it
does the same in a room deeper than it is wide; and when all four corners are
occupied it steps in off them. Those four tests are in
`src/three/collision.test.ts` and must keep passing.

### 15.5 `Scene.tsx` — four cameras, one scene

```ts
near: 0.05, far: 500
ORBIT_FOV  = 38, WALK_FOV = 68, INSIDE_FOV = 75
```

| mode | behaviour |
|---|---|
| **orbit** | orbit the building centre, framed by `standBackDistance` |
| **top** | plan view; the roof hides itself, and its toggle dims to `opacity-45` with the tooltip *"The roof is hidden in the top-down view, so you can see the plan"* |
| **walk** | pointer-locked first person on the pavement; starts at `walkStart`; W A S D, Q E, Escape |
| **inside** | stands in a room, looks across it, and can be driven by hand |

Lighting: one shadow-casting directional sun, PCF soft shadows, the sky as
`scene.background`, and `scene.fog = new THREE.Fog('#e9e4d6', 22, 118)`.

**Interior lighting is a stand-in and must be labelled as one.** three.js has no
global illumination; the sun is a single directional light and walls shadow it
completely, so an empty interior renders nearly black. What is there instead is
**one hemisphere light added only while the inside camera is active**, standing
in for the light a real room picks up off its own surfaces. It cannot change a
single pixel in the three exterior modes. Its consequence is that the fill is
uniform, so a ceiling far from a window is lit as well as one beside it and rooms
read as evenly lit rather than falling off towards their interior corners.

**THE UNIT RULE — one unit for angles, and it must be radians.**

```ts
const DEG = Math.PI / 180;
```

`roomViewpoint` reports **degrees**, because that is how the room labels and the
compass are written. The running camera state is **radians**, because
`camera.rotation` is. `PITCH_LIMIT`, `LOOK_SENSITIVITY` and `TURN_RATE` are all
radian quantities. Everything crossing that boundary goes through `DEG`:

```ts
interface Flight {
  /** Metres for position, radians for orientation. */
  from: { x: number; y: number; z: number; yaw: number; pitch: number };
  to:   { x: number; y: number; z: number; yaw: number; pitch: number };
  t: number;
}

interface InsideState {
  /** Radians, always — it goes straight into camera.rotation every frame. */
  look: { yaw: number; pitch: number };
}

s.flight = {
  from: { ...s.pos, yaw: s.look.yaw, pitch: s.look.pitch },
  to: { ...to,
        // shortest way round, so crossing the ±180° seam is a two-degree turn
        yaw: s.look.yaw + shortestAngle(s.look.yaw / DEG, to.yaw) * DEG,
        pitch: to.pitch * DEG },
  t: 0,
};

s.look = { yaw: to.yaw * DEG, pitch: to.pitch * DEG };
camera.position.set(to.x, to.y, to.z);
camera.rotation.set(to.pitch * DEG, to.yaw * DEG, 0, 'YXZ');
```

This is not theoretical. Mixing the two produced a silent failure that looked
like a broken renderer: `Math.max(-1.501, Math.min(1.501, -5.69))` evaluates to
`-1.501`, so the clamp *became* the conversion and the camera sat pinned at
`rotation.x = −1.501` (−86°, a world direction of `(0.023, −0.998, 0.066)`)
looking straight at the floor. Every screenshot was a flat grey plane. If the
3D view ever looks like that again, check the units before anything else.

The inside camera also **swallows the click that ends a look-drag**, in the
capture phase, so dragging to look around is never delivered to the room
underneath as a selection.

---

# 16 · Persistence, export and tracing

### 16.1 `src/persist/library.ts` — IndexedDB

```
DB_NAME 'furnish' · DB_VERSION 1
STORE_PROJECTS 'projects'  keyPath 'id', plus an `updatedAt` index
STORE_UNDERLAYS 'underlays' keyed by `u.id` via put(value, key)
```

A `ProjectRecord` holds `{ id, name, updatedAt, createdAt, schemaVersion,
roomCount, floorCount, json }`. Underlay `dataUrl`s are **blanked in the project
JSON and stored separately**, so tracing a large image never forces the project
record to be rewritten. `saveProject`, `loadProject` (which reassembles the
dataUrls), `listProjects` (sorted `updatedAt` descending), `deleteProject`,
`projectSize`, `estimateUsage`, `requestPersistence`. When `indexedDB` is
undefined the whole module degrades to no-ops and sets `degraded = true`
rather than throwing.

### 16.2 `src/export/`

**`planToSvg(project, floorId, options)`** — millimetres (`× 1000`), y down. A
complete document:

```
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="Wmm" height="Dmm"
     viewBox="-margin -margin W+2margin D+2margin">
  <title>{caption}</title>
  <desc>Generated by Furnish from its canonical project model. Units: millimetres.
        Origin at the plot's north-west corner, y increasing south.</desc>
  <rect … fill="#ffffff"/>
  <g transform="translate(margin margin)"> … </g>
</svg>
```

`W = plot.width * 1000`, `D = plot.depth * 1000`, `margin = dimensions ? 1400 : 900`.
Body order: plot rect `#f6f4f0`/`#c9c3b6` → dashed buildable envelope → outdoor
`#eeeade`/`#9a9284` → rooms `#fbfaf7`/`#8d8577` (labels rotate −90° in rooms
deeper than `1.25 ×` their width; 90 for the name, 76 for the area) → walls →
stairs (per-riser line plus a bounding rect with an `#b4622d` top edge) →
furniture `#e7e2d6` → dimension chain → title block. `wallToPath` sorts the
openings and emits filled piers between them, coloured `#3f3a33` for exterior,
`#9a9284` for parapet and railing, `#5c554b` otherwise. `dimLine` uses 60-unit
perpendicular ticks and a `font-size 80` caption.

**Verified** — the test asserts an XML header, exactly one `<svg>`, the
namespace, a closing tag, no `NaN` in the output, and geometry in millimetres.

**JSON** —

```ts
interface SerializedProject {
  format: 'furnish.project';
  schemaVersion: number;   // SCHEMA_VERSION
  exportedAt: string;      // ISO
  project: Project;
}
```

`fromJSON` validates, in order: it parses; `format === 'furnish.project'`;
`schemaVersion <= SCHEMA_VERSION`; `id`, `name` are strings and `plot.width`,
`plot.depth` are numbers; and `floors, rooms, walls, stairs, outdoor, furniture,
underlays` are all arrays. Then it fills in every default — `materials` merged
over `DEFAULT_MATERIALS`, per-floor id arrays to `[]`, per-wall `openings` to
`[]`, `displayUnits` to `'m'` unless `'ft'`, and so on. The test **puts the
export back through this reader**; a format is only supported if it can be
reopened.

**PNG** — `renderSvgToPng` draws the SVG into a canvas via
`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` at
`targetPx = 2048` wide, preserving the viewBox ratio, on white, then
`toBlob('image/png')`. Filenames are slugified:
`` `${slug(name)}-${slug(floor.name)}.png` `` where
`` slug = s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'furnish' ``.
The 3D capture writes `${slug(name)}-3d.png`.

### 16.3 `src/trace/` — image tracing with calibration

**Calibration** is uniform scale plus translation — two degrees of freedom.

```ts
scaleFromLength(a, b, realMetres, placement = {offX: 0, offY: 0}): Calibration | null
// scale = realMetres / pixelDistance(a, b)

calibrateFromTwoPoints(a, b, pa, pb, label): Calibration | null
// planLen = hypot(pb.x - pa.x, pb.y - pa.y); scale = planLen / pd
// offX = pa.x - a.px * scale;  offY = pa.y - a.py * scale
// residual = how far b landed from pb, in metres — PRESERVED, so the UI can
// flag the discrepancy rather than quietly hiding it

recalibrate(current, a, b, realMetres)
// pins the ANCHOR PIXEL at its current plan position, so changing the stated
// length never silently walks the drawing across the plot

pixelToPlan / planToPixel / planToFraction / frameFromCalibration /
fractionToPlan / planToFrameFraction / fractionDistance   // all from scale+offset

parseLengthToMetres(input)
// `14'1"`, `14ft1in`, `14' 1"` → (ft + inch/12)·0.3048
// else /^\s*(-?\d+(?:[.,]\d+)?)\s*(m|metres?|meters?|cm|mm)?\s*$/ with cm /100, mm /1000
```

**Vectorising** — four steps.

1. **Downsample and binarise.** `scale = min(1, workWidth / source.width)`;
   luma `= (R·299 + G·587 + B·114) / 1000`.
2. **Run detection.** Per row, find runs of `g <= threshold` at least
   `minRunPixels` long; measure thickness by walking perpendicular ink up to
   40 px each side; `density = len / span`. Repeat for vertical runs.
3. **Merge collinear runs.** Bucket by axis and `at`; cluster positions within
   `≤ 3` of the centre; merge runs whose start is `≤ end + 6`; take the max
   thickness and density; the output sits at the cluster's mean `at`.
4. **Trace proposals.**

```ts
const DEFAULT_TRACE_SETTINGS = { threshold: 140, minRunPixels: 18, workWidth: 900 };

const lengthScore = Math.min(1, lengthPx / (image.width * 0.25));
const confidence  = clamp(
  0.45 * lengthScore + 0.35 * r.density + 0.2 * (1 - Math.min(1, thicknessPx / 24)),
  0.05, 0.99);
```

`collectAccepted` drops anything unaccepted or without a plan position, refuses
lengths under `0.15 m`, and clamps thickness to `[0.08, 0.6]` m.

The UI offers a per-detection checkbox, an **"Accept likely"** button for
confidence `≥ 0.5`, and only rows that have a plan position are selectable.
Without a confirmed calibration the reason reads *"Detected, but not yet scaled
— measure one known length to give it a real size."*

---

# 17 · The tool registry — `src/tools/registry.ts`

**This is the security boundary.** The model chooses a name from a fixed list and
supplies JSON. It cannot return code, invent an id, bypass a validation failure,
or touch anything not in the list. Every handler resolves through the same
`run` dispatch the mouse uses, so there is exactly one path from "an edit should
happen" to "the edit happened" — and that path enforces undo, the activity log
and persistence.

```ts
export type Permission = 'read' | 'write' | 'destructive';

export interface JsonSchema { type: 'object'; properties: Record<string, unknown>; required?: string[] }

export interface ToolOutcome<T = unknown> {
  ok: boolean;
  summary: string;          // compact and model-readable — this is what the model sees next turn
  data?: T;
  error?: string; errorCode?: string; hint?: string;
  createdIds?: string[]; removedIds?: string[];
}

export interface ToolSpec {
  name: string; title: string; description: string;
  permission: Permission;
  input: JsonSchema;
  output: JsonSchema;
  handler(input: Record<string, unknown>): ToolOutcome;
}
```

### The 28 tools — 13 read, 13 write, 2 destructive

All 28 are advertised, destructive ones included: **hiding destructive tools
would be worse than useless**, because a model that cannot see `remove_element`
invents its own way to express the same intent.

**Read (13)**

| tool | required input | returns |
|---|---|---|
| `inspect_project` | — | the project envelope: plot, active floor, per-floor counts |
| `get_floor_details` | `floorId?` | one floor in full: elevation, height, rooms, walls, openings, stairs |
| `list_rooms` | `floorId?` | every room on the floor with its real id, kind, position, area |
| `inspect_room` | `roomId` | size, area, bounding walls, doors, furniture |
| `inspect_wall` | `wallId` | endpoints, length, thickness, openings with offsets |
| `calculate_room_area` | `roomId` | exact area, perimeter, dimensions — computed, never estimated |
| `calculate_building_areas` | — | plot, buildable, net indoor, footprint, gross covered, open site, coverage, FAR |
| `validate_floor_plan` | `severity?` (`all` \| `errors`) | the issue list with counts |
| `get_layout_issues` | — | the same list with codes, elements and suggested fixes |
| `get_3d_scene_state` | — | box count by kind, building bounds, collider count |
| `list_catalog` | `category?` | every catalogue item with its real footprint |
| `list_materials` | — | every material id and role |
| `export_project` | `pretty?` | the project's shape; the file itself comes from the Export menu |

**Write (13)**

| tool | required input | optional input |
|---|---|---|
| `create_room` | `kind, x, y, width, depth` | `floorId, label, height` — `kind` is `enum(Object.keys(KIND_LABEL))` |
| `resize_room` | `roomId` | `width, depth, x, y, anchor` — anchor is `top-left \| top-right \| bottom-left \| bottom-right \| center`, default `top-left` |
| `move_room` | `roomId, x, y` | — absolute top-left |
| `create_wall` | `a, b` | `floorId, type` (`exterior\|interior\|parapet\|railing`), `thickness` |
| `move_wall` | `wallId` | `dx, dy, a, b, thickness, type` |
| `add_door` | `wallId` | `offset, width, height, swing` — defaults `0.9 × 2.1`, `positive` |
| `add_window` | `wallId` | `offset, width, height, sill` — defaults `1.2 × 1.4`, sill `0.9` |
| `move_opening` | `wallId, openingId` | `offset, width, height, sill, swing` |
| `add_staircase` | `floorId, x, y` | `connectsToFloorId, width, riserCount, direction (−1\|1), name` |
| `add_furniture` | `catalogId, x, y` | `roomId, rotation, color` |
| `move_furniture` | `itemId` | `x, y, rotation, width, depth, color` |
| `apply_material` | `materialId, target` | `elementId` — target is `room\|wall\|exterior\|floor` |
| `undo_last_operation` | — | — steps back in the shared history |

**Destructive (2)** — both prompt the user first.

| tool | required input | notes |
|---|---|---|
| `remove_element` | `id` | `kind` is `room\|wall\|opening\|stair\|outdoor\|furniture`; `wallId` is also required for an opening, which lives inside a wall. `kind` is inferred from the id when omitted. |
| `regenerate_floor` | — | `floorId?` — replaces every room, wall and opening on that floor from the stored brief |

### Running one

```ts
export function runTool(name: string, input: Record<string, unknown> = {},
                        actor: 'assistant' | 'user' = 'assistant'): ToolOutcome
// NEVER throws: an unknown name or a throwing handler comes back as a failed
// outcome, so a caller that forgets to check `ok` still cannot corrupt state.

export function toolDefinitionsForModel(): Array<{ name; description; input_schema }>
// Read tools are advertised first and edits later: the model should look before
// it leaps, and ordering is the cheapest nudge without a longer prompt.
```

`currentActor` is ambient for the duration of one synchronous `runTool` call —
the store's `run` is synchronous, so there is no concurrency — and is restored
in a `finally`. It is what makes the activity feed able to say who did what, and
it is the reason the app can honestly say the model changed something: **the log
entry only exists because the call actually succeeded.**

---

# 18 · The assistant — `src/ai/orchestrator.ts`

### 18.1 Ten steps, run as a bounded loop

```
 1. collect      the user's request
 2. retrieve     the current project state, compacted to what a model needs
 3. compact      a system prompt that states the units, the id rule and the ban on arithmetic
 4. plan         ask the model for a structured plan
 5. validate     strict schema validation of the plan itself
 6. preconditions check every id, dimension and reference against the live model
 7. apply        run the operations through the deterministic registry
 8. recalculate  re-run validation and measurement after every change
 9. report       structured success/failure back to the UI
10. update       the UI shows what actually happened — and only that
```

`MAX_ITERATIONS = 6`, `DEFAULT_STEP_DELAY_MS = 110`.

```ts
export type PlanStep = { tool: string; input: Record<string, unknown>; why?: string } | { reply: string };
export interface Plan { intent: string; steps: PlanStep[]; needsApproval?: boolean }

export type StepStatus =
  | 'pending'|'running'|'applied'|'failed'|'skipped'|'rejected'|'awaiting-approval';

export interface StepReport {
  index: number; tool: string | null; label: string; status: StepStatus;
  summary?: string; error?: string; hint?: string;
  createdIds?: string[]; removedIds?: string[];
}

export interface TurnReport {
  ok: boolean; reply: string; intent: string; steps: StepReport[];
  /** Measurements and issues measured after the last change — never by the model. */
  after: {
    netIndoorArea: number; footprintArea: number; plotCoverage: number;
    floorAreaRatio: number; errorCount: number; warningCount: number;
  };
  cancelled?: boolean;
  /** True when a design request finished without a single operation being applied. */
  changedNothing?: boolean;
  error?: string;
}
```

### 18.2 Step 2 — `compactState(project, activeFloorId, includeFloorDetail)`

The single biggest lever on token cost and on the model's honesty. This is
**not** the project; it is a summary plus, on request, the detail of one floor.
The full model is re-read from the store every turn anyway — what this controls
is what gets *sent*.

```
Project "{name}". Units: METRES. Origin: the plot's north-west corner, x runs right, y runs DOWN (south).
Plot {w} × {d}. Street on the {top(north)|right(east)|bottom(south)|left(west)} edge.
Setbacks front/rear/left/right = {f}/{r}/{l}/{r}.
Floors: {name}={id} (storey {order}, elevation {e}, height {h}); …
Active floor: {name} = {id}.
On the active floor: {n} rooms, {n} walls, {n} furniture items.
Measured now: net indoor {n} m², footprint {n} m², coverage {n}%, FAR {n}.
```

Then, when detail is requested, every room as
`  {id}  {label} ({kind})  x= y= w= d=  {n} m²` and every wall as
`  {id}  {type}  (ax,ay)→(bx,by)  {len} m  {thick} thick  openings: …`.

### 18.3 Step 3 — the system prompt, verbatim

Short on purpose. It states the four things that actually stop the model
producing nonsense.

```
You are the design assistant inside Furnish, an architectural drafting tool.
You do not draw anything yourself. You choose operations from the tools you are given, with real arguments, and Furnish applies them to a real model and validates the result.

Units are METRES throughout. The plan origin is the plot's north-west corner; x increases to the right, y increases DOWNWARD (south).

Rules:
1. Never invent an id. Every room, wall and item has an id that appears in the state you are shown. If you need one you have not seen, call list_rooms, get_floor_details or list_catalog first.
2. Never do arithmetic to invent a measurement. If you need an area, a length, a total or a check, call calculate_room_area, calculate_building_areas or validate_floor_plan. Do not estimate and do not round into something you did not measure.
3. Prefer editing an existing element over adding a duplicate.
4. After a run of edits, call validate_floor_plan and read the result. If it reports errors, fix them rather than declaring success.
5. Never claim something is done unless the tool result for it succeeded. If a tool returns an error, say what failed and what you would do instead.
6. If the request needs something destructive or ambiguous, say so in your reply and stop — do not plan the destructive part.
7. If the user asks for the building to be built, designed, laid out, extended or changed in any way, you MUST call the tools. Writing the layout out in words — "living room at x=3, 4.5 by 4.0", "here is my plan" — changes nothing, because Furnish only redraws the plan from operations that actually ran. Prose belongs in "reply", alongside the tool steps that do the work, never instead of them.

Respond with JSON only, matching this shape:
{"intent":"one sentence","steps":[{"tool":"tool_name","input":{...},"why":"short reason"}],"reply":"what you will tell the user, in plain language"}
Use exactly one step of {"reply":"..."} on its own ONLY when the user asked a question and no change is wanted. Every request to change the building is answered with tool steps.
```

It is an array joined with `\n` in the source, one string per line, `''` for the blank
lines. Rule 7 is the rule that makes rule 5 enforceable: it tells the model in
advance that words are not work.

### 18.4 Step 4 — `isDesignRequest`

Used for exactly one thing: deciding whether a turn that applied *nothing* should
be pressed once for the operations it failed to call.

```ts
const EDIT_VERB =
  /\b(build|design|redesign|re-?design|lay\s?out|arrange|re-?arrange|fix|add|create|insert|place|put|move|shift|slide|resize|enlarge|shrink|extend|stretch|rotate|swap|delete|remove|open|connect|link|fill|split|merge|convert|draw)\b/i;
const AMBIGUOUS_EDIT = /\b(plan|layout|change|set|make|redesign)\b/i;

export function isDesignRequest(request: string): boolean {
  const text = request.trim();
  if (EDIT_VERB.test(text)) return true;
  return AMBIGUOUS_EDIT.test(text) && !looksLikeAQuestion(text);
}
```

`looksLikeAQuestion` is true on a trailing `?` or a leading
`what|which|how|why|who|when|where|is|are|was|were|can|could|does|do|did|has|have|will|would|should|tell me|explain|describe`.
So *"what should I make the bedroom?"* costs no wasted round trip, and
*"build me the complete design"* cannot be answered in prose and change nothing.

### 18.5 Step 5 — `parsePlan(text, toolCalls)`

Both answer styles are real, so both are read; neither is trusted.

```ts
const candidates: string[] = [];
const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
if (fenced?.[1]) candidates.push(fenced[1].trim());
const first = text.indexOf('{');
const last = text.lastIndexOf('}');
if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
if (text.trim().startsWith('{')) candidates.push(text.trim());
```

Ordered most-specific first, and the **first shape failure is kept, never
discarded** — `There is no tool called "X"` is the difference between a fixable
prompt bug and a mystery:

```ts
let shapeError: string | null = null;
let sawJson = false;
for (const candidate of candidates) {
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { continue; }
  sawJson = true;
  const validated = validatePlanShape(parsed);
  if (validated.ok) return validated;
  shapeError ??= validated.error;
}
```

Then three fallbacks, in order:

```ts
const SPEECH_TOOLS = new Set(['reply', 'respond', 'final_answer', 'say', 'answer']);

// 1. Native tool_use blocks — a plan, not a failure, through the SAME validator.
if (toolCalls.length) {
  const operations = toolCalls.filter((c) => !SPEECH_TOOLS.has(c.name.toLowerCase()));
  const steps: unknown[] = toolCalls.map((c) => ({ tool: c.name, input: c.input }));
  if (!operations.length && text) steps.push({ tool: 'reply', input: { reply: text } });
  const assembled = {
    intent: text ? firstSentence(text) : `Apply ${operations.length} change${operations.length === 1 ? '' : 's'}.`,
    steps,
  };
  return validatePlanShape(assembled);
}

// 2. Prose. Can only ever become a reply, never an edit — so accepting it cannot
//    make the app claim a change that did not happen.
if (!sawJson && text.trim()) {
  return validatePlanShape({ intent: firstSentence(text), steps: [{ reply: text.trim() }] });
}

// 3. Neither.
return { ok: false, error: shapeError ?? 'The assistant did not return a plan in the expected JSON shape.' };
```

Note `sawJson`: prose is only reinterpreted as a reply when **no** JSON was
found. A model that emitted a malformed plan is told what was wrong with it,
rather than having its plan quietly reinterpreted as small talk.

`speechText(input)` probes, in order,
`['reply','text','message','content','answer','response']` and returns the first
string that has content — the model puts the message in whichever field it likes.
`firstSentence(text)` collapses whitespace, cuts at the first `[.!?]` followed by
space or end, and caps at 200 characters.

### 18.6 `validatePlanShape(value)` — the single strict gate

```ts
if (!value || typeof value !== 'object' || Array.isArray(value))
  return { ok: false, error: 'A plan must be a JSON object.' };
if (typeof obj.intent !== 'string' || !obj.intent.trim())  …  'A plan needs an "intent".'
if (!Array.isArray(obj.steps))                             …  'A plan needs a "steps" array.'
if (obj.steps.length === 0)                               …  'A plan needs at least one step.'
if (obj.steps.length > 40)                                …  'A plan may not exceed 40 steps.'
```

Then per step:

- a `tool` string in `SPEECH_TOOLS` → `{ reply: speechText(input) }`, **mapped
  here** rather than in the parser, because the model puts a tool named `reply`
  in JSON as readily as it emits a `tool_use` block for one — and it was the JSON
  route that kept failing;
- a `tool` string not in `TOOLS_BY_NAME` → **refused**:
  `There is no tool called "${s.tool}".`;
- `input` not a plain object → refused;
- **required arguments checked here, before anything is applied**, so a malformed
  plan fails as a whole rather than half-executing:
  `const missing = (spec.input.required ?? []).filter((k) => input[k] === undefined);`
  → `"${s.tool}" is missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`;
- a `reply` string → `{ reply }`;
- anything else → `'Every step must be either {tool,input} or {reply}.'`

Success returns `{ intent, steps, needsApproval: obj.needsApproval === true }`.

### 18.7 Step 6 — `checkPreconditions(project, plan)`

Checked against the live project before anything runs. This is where *"the model
invented an id"* becomes a clean refusal instead of a half-applied edit.

| Tool | Refuses when |
|---|---|
| `create_room` | `x + width > plot.width`, `y + depth > plot.depth`, or `x/y` negative → *"a room at (x, y) sized w×d would fall outside the W×D plot"*; or width/depth ≤ 0 |
| `create_wall` | `a` or `b` missing / non-finite → *"both endpoints a and b are required as {x,y}"*; or length < 0.05 m → *"a zero-length wall (0.041 m) is not a wall"* |
| `add_door`, `add_window`, `inspect_wall`, `move_wall`, `add_staircase`, `move_furniture`, `remove_element` | the id does not exist in `walls ∪ floors ∪ furniture ∪ rooms ∪ outdoor ∪ stairs` → *"no element has id X. It may not exist — list what is there first."* |
| `remove_element` with `kind: 'opening'` | also needs `wallId`, and that wall is absent — an opening has its own id but lives inside a wall |
| `resize_room`, `move_room`, `inspect_room`, `calculate_room_area` | `roomId` is not a room |
| `apply_material` | `materialId` is not in `DEFAULT_MATERIALS`, or `elementId` is neither a room nor a wall |
| `regenerate_floor`, `get_floor_details`, `list_rooms` | `floorId` is present and is not a floor |

The id argument name differs per tool and getting it wrong silently refuses
every plan that uses the tool, so it is spelled out rather than derived:

```ts
const idField: Record<string, string> = {
  move_wall: 'wallId',      move_furniture: 'itemId',  add_staircase: 'floorId',
  remove_element: 'id',    add_door: 'wallId',        add_window: 'wallId',
  inspect_wall: 'wallId',
};
```

Refusal is reported as, and logged as:

```
The plan was not applied because it would not have worked:
• create_room: no element has id "r_99". It may not exist — list what is there first.
```

`store.log({ actor: 'assistant', label: 'Plan refused', ok: false, error: problems[0] })`

### 18.8 The browser chat client

The key appears in **no** browser module. This POSTs to the app's own origin.

```ts
const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  signal,
  body: JSON.stringify({
    system,
    messages,
    max_tokens: maxTokens,
    tools: toolDefinitionsForModel(),
    effort: 'medium',
  }),
});
```

The response is an Anthropic-style message. **Both halves are kept**:

```ts
const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
const toolCalls: ToolCall[] = [];
for (const b of blocks) {
  if (b.type !== 'tool_use' || typeof b.name !== 'string' || !b.name) continue;
  const input = b.input;
  toolCalls.push({
    name: b.name,
    input: input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {},
  });
}
if (!text && toolCalls.length === 0) throw new Error('The assistant returned an empty response.');
return { text, toolCalls };
```

An unknown block type is **ignored rather than trusted**: only `tool_use` blocks
with a non-empty name become calls. Keeping only the text is what made the
assistant report *"did not return a plan in the expected JSON shape"* against a
model that had answered perfectly well.

### 18.9 `runAssistantTurn` — the loop

```ts
export const MAX_ITERATIONS = 6;
export const DEFAULT_STEP_DELAY_MS = 110;
```

Per iteration, in order — this is the progress line the user watches:

```
'Reading the project…'                    // once, before the loop
'Asking the assistant for a plan…'        // each round
'Checking the plan…'                      // parsePlan + validatePlanShape
'Checking the plan against the model…'    // checkPreconditions
`Applying ${spec.title.toLowerCase()}…`   // per operation
'Recalculating…'                          // measure + validate, from the store
'Nothing was changed — asking for the operations…'   // the single press
```

First user message is
`` `CURRENT PROJECT STATE\n${state}\n\nREQUEST\n${request}` ``;
every later round is
`` `CURRENT PROJECT STATE (after the previous steps)\n${state}\n\nReport on what you have done so far, call further tools if something is still wrong, or reply with your final answer.` ``

The transcript is **plain text by design** — the app does not replay tool blocks,
so the model's words are what goes back into history. After each successful step
a user-role turn is pushed:
`` `${step.tool} succeeded: ${outcome.summary}` ``
or, on failure,
`` `${step.tool} failed: ${outcome.error}. ${outcome.hint ?? ''}` ``
— and the loop **breaks**. Continuing after a failed step would apply the rest
against a state the model did not expect.

The self-check that makes the assistant reliable rather than merely fluent,
pushed after a round that changed something:

```
Recalculated. 0 errors, 3 warnings. Issues: …  Fix anything outstanding, or give your final reply.
```

or `The plan is clean.` when there are none.

**The delay goes before the operation, not after.** This is not a style choice:

```ts
progress(`Applying ${spec.title.toLowerCase()}…`);
useProject.setState({ aiBusy: true });

// The wait goes *before* the operation, not after it. Setting the flag and
// clearing it around a synchronous call puts both in one task, so React
// commits the room and the clearing together and neither the "the assistant is
// drawing" badge nor the pause is ever painted.
await nextFrame(stepDelay);

let outcome: ToolOutcome;
try { outcome = runTool(step.tool, step.input, 'assistant'); }
finally { useProject.setState({ aiBusy: false }); }
```

```ts
async function nextFrame(ms: number): Promise<void> {
  if (typeof requestAnimationFrame === 'function')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
```

Both waits are skipped when they do not exist — the orchestrator's unit tests run
in node, where there is no frame.

**Destructive steps are gated by a caller-supplied `approve(step, plan)`.** With
no approver, `approved` is `false`, so a destructive step is *rejected*, logged
as `Declined ${spec.title.toLowerCase()}` and listed as `Declined by you.` — never
run by default.

**The step limit is stated when it bites.** A budget that ran out while the model
was still editing on a later round gets an explicit note:

> The assistant reached its step limit of 6 rounds while still making changes.
> Everything it did apply is listed above, but some of what you asked for may
> not have been done.

A first round that does everything is not a cut-off and is not flagged.

### 18.10 The press-once rule

```ts
if (iteration < maxIterations - 1 && !cancelled && !pressedForTools && appliedCount === 0 && isDesignRequest(request)) {
  pressedForTools = true;
  progress('Nothing was changed — asking for the operations…');
  transcript.push({
    role: 'user',
    content:
      'Nothing has been changed: you described a design in words but called no tools, and Furnish only redraws the plan from operations that actually ran. ' +
      'Call the tools now — one per room, wall, opening or item — and put your explanation in "reply" alongside them. ' +
      'If the request genuinely cannot be turned into operations, say which part and why.',
  });
  reply = '';
  continue;
}
```

**One press only** — a model that answers in prose twice is answering in prose,
and a third round would only spend money on the same sentence. It also needs a
round left to spend, or it would fall out of the loop and be mislabelled as the
step limit.

If the second press also changes nothing, the report carries `changedNothing:
true` and the panel says so **under the reply** — so a described design can never
read as a drawn one. That flag is what `e2e/assistant.spec.ts` asserts on screen.

### 18.11 Step 8 + 9 — `measureAndCount`, `defaultReply`

```ts
export function measureAndCount() {
  const project = useProject.getState().project;
  const m = measureBuilding(project);
  const issues = validate(project);
  return {
    netIndoorArea: m.netIndoorArea, footprintArea: m.footprintArea,
    plotCoverage: m.plotCoverage, floorAreaRatio: m.floorAreaRatio,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
  };
}
```

`defaultReply` is used when the model ran tools but said nothing itself. It is
built **from what succeeded and from numbers the app measured** — never from
anything the model asserted:

```
Done — 3 changes applied:
· Add room: Added "Study" 3.2 × 3.6 m at (10.40, 4.10).
· Add door: Added a 0.90 m door in "w_7" at 4.20 m.
· Add window: Added a 1.40 m window in "w_9" at 2.10 m.
The plan now measures 84.62 m² net indoor, 46.2% coverage and FAR 0.91.
No errors in the checks.
```

A failed step is named (`Stopped after Add door failed: …`), and a declined one
is counted. `aiHealth()` GETs `/api/health` for the panel's status line and
returns all-off on any failure rather than throwing.

---

# 19 · The server — `server/`

Five small files. Express 4, Node ≥ 22.16, run with
`node --experimental-strip-types`. Two entry points (`server/main.ts` for
production, `server/vite-plugin.ts` for dev) mount the same `createApiApp()`, so
`npm run dev` is one process on one port and there is no second server to
remember to start.

## 19.1 `server/minimax.ts` — the client

Anthropic-compatible Messages API, verified against
<https://platform.minimax.io/docs/api-reference/text-anthropic-api>.

```
POST {MINIMAX_BASE_URL}/v1/messages
Authorization: Bearer <MINIMAX_API_KEY>
Content-Type: application/json
```

The response is an Anthropic-style message
`{ id, type, role, model, content: ContentBlock[], stop_reason, usage }` where a
`ContentBlock` is one of
`{ type: 'text', text }` · `{ type: 'thinking', thinking }` · `{ type: 'tool_use', id, name, input }`.

Multi-turn tool conversations require the **complete** assistant content array
(thinking + text + `tool_use`) appended to history verbatim — which is why
`AnthropicContentBlock` declares `thinking`, `signature` and `source`, even
though this app only ever reads text and `tool_use`.

```ts
export function clientConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const base = (env.MINIMAX_BASE_URL || 'https://api.minimax.io/anthropic').replace(/\/+$/, '');
  return {
    apiKey: (env.MINIMAX_API_KEY || '').trim(),
    baseUrl: base,
    model: (env.MINIMAX_MODEL || 'MiniMax-M3').trim(),
    timeoutMs: Number(env.MINIMAX_TIMEOUT_MS || 90_000),
    maxRetries: Number(env.MINIMAX_MAX_RETRIES || 2),
  };
}

export function isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FURNISH_DISABLE_AI === 'true') return false;
  return Boolean(env.MINIMAX_API_KEY && env.MINIMAX_API_KEY.trim().length > 0);
}
```

Retry policy — transport faults and server-side failures are retried, client
errors are not, because a bad key or a bad schema will fail identically three
times:

```ts
function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
```

`createMessage` loops `attempt = 0 .. maxRetries`, arms an `AbortController` at
`cfg.timeoutMs` per attempt, and on a non-retryable or final failure throws

```ts
new MiniMaxError(
  `MiniMax request failed (HTTP ${res.status}): ${text.slice(0, 600) || res.statusText}`,
  res.status,
  text,
);
```

Backoff between attempts is `await sleep(400 * 2 ** attempt)` — jitter-free and
deterministic, which matters for a test. An aborted attempt becomes
`MiniMaxError('MiniMax request timed out after 90000ms', 408)`.

`MiniMaxError` is written out longhand, and the reason is load-bearing:

```ts
export class MiniMaxError extends Error {
  // Written out rather than as constructor parameter properties: this file is
  // run directly by `node --experimental-strip-types`, which erases types but
  // cannot erase a parameter property, so the shorthand would stop the server
  // from starting at all.
  readonly status: number;
  readonly detail?: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message); this.name = 'MiniMaxError'; this.status = status; this.detail = detail;
  }
}
```

**This is the single most important server-side implementation note in the
project.** `constructor(public readonly status: number)` is erasable-syntax-hostile
and `--experimental-strip-types` refuses to run the file. No parameter
properties anywhere in `server/`.

`splitContent(content)` returns `{ text, thinking, toolUses }` — used by
`scripts/live-assistant-check.mjs`, not by the app's own client.

## 19.2 `server/api.ts` — the two routes

```ts
const LIMITS = {
  messages: 64,
  blocksPerMessage: 128,
  tools: 96,
  systemChars: 24_000,
  textCharsPerBlock: 400_000,
  maxTokensCeiling: 16_000,
  imageBytes: 4_500_000, // ~3.4 MB after base64 overhead, under the 4 MB API image cap
};
```

`app.use(express.json({ limit: '12mb' }))` — 12 MB so an image block near the
4.5 MB cap still fits once base64-expanded.

```ts
app.get('/api/health', (_req, res) => {
  const enabled = isConfigured();
  const cfg = clientConfig();
  let host = '';
  try { host = new URL(cfg.baseUrl).host; } catch { /* malformed base url — report blank rather than throwing */ }
  res.json({
    ok: true,
    aiEnabled: enabled,
    disabledByConfig: process.env.FURNISH_DISABLE_AI === 'true',
    provider: 'minimax',
    model: enabled ? cfg.model : null,
    endpoint: host ? `${host}/v1/messages` : null,
  });
});
```

`POST /api/chat` returns the upstream message body **unchanged**, so the browser
sees the same Anthropic shape the server did:

```ts
app.post('/api/chat', async (req, res) => {
  if (!isConfigured()) return fail(res, 503,
    'MiniMax is not configured. Set MINIMAX_API_KEY in the server environment (see .env.example). The studio remains fully usable for manual editing.');

  const messages = validateMessages(body.messages);   // string ⇒ the error message
  if (typeof messages === 'string') return fail(res, 400, messages);
  const tools = validateTools(body.tools);
  if (typeof tools === 'string') return fail(res, 400, tools);

  const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 4096, 256), LIMITS.maxTokensCeiling);
  const temperature = typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 2) : undefined;

  const message = await createMessage(cfg, {
    model: cfg.model,
    messages,
    max_tokens: maxTokens,
    ...(str(body.system, LIMITS.systemChars) ? { system: str(body.system, LIMITS.systemChars) } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(tools.length ? { tools, tool_choice: { type: 'auto' as const } } : {}),
    ...(body.thinking === true ? { thinking: { type: 'enabled' as const } } : {}),
    ...(body.effort ? { output_config: { effort: body.effort as 'low'|'medium'|'high'|'xhigh'|'max' } } : {}),
  });
  res.json(message);
});
```

`validateMessages` is a real validator, not a cast: it enforces the array, the
count, the role, the string-or-blocks union, the block count, and then a
`switch` over the five block types with a `default: return \`unsupported content
block type: ${String(type)}\`` arm. `validateTools` enforces
`/^[a-zA-Z0-9_-]{1,64}$/` on each name and requires `input_schema.type === 'object'`.

Status mapping, exactly:

| Upstream / condition | Response |
|---|---|
| not configured | **503** |
| malformed request | **400** |
| `MiniMaxError.status` 0 (network/timeout) | **504** |
| any other `MiniMaxError.status` | that status, verbatim |
| anything else | **500** |

`fail(res, status, message, detail?)` writes `{ error, detail? }`.

## 19.3 `server/env.ts` — `.env` loading

No dependency, no interpolation, no override of real environment variables.
**A variable already in the environment wins**, because that is what a
deployment does and it is how you turn the assistant off for one process without
editing a file on disk.

```ts
export function loadEnv(root: string): string[] {
  const envFile = path.join(root, '.env');
  if (!fs.existsSync(envFile)) return [];
  const applied: string[] = [];
  for (const rawLine of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;                       // no '=', or a line beginning with '='
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!key || key in process.env) continue;
    process.env[key] = value;
    applied.push(key);
  }
  return applied;
}
```

It lives in its own module because **both** entry points call it. When it lived
only in `server/main.ts`, `npm run dev` silently ran with no key, and the
assistant panel correctly reported *"no key"* to someone who could see one in
`.env`. That was a real defect found by running against the live service, and
this file is the fix.

Vite's own `.env` handling cannot help: it exposes variables to the **client
bundle** under a `VITE_` prefix, and the API key must never reach the browser.

## 19.4 `server/vite-plugin.ts`

```ts
export function apiPlugin(): Plugin {
  let mount: ((req, res, next) => void) | null = null;
  return {
    name: 'furnish:api',
    async configureServer(server) {
      const { loadEnv } = await import('./env.ts');
      const applied = loadEnv(server.config.root);
      const { createApiApp } = await import('./api.ts');
      const app = createApiApp();
      mount = (req, res, next) => app(req, res, next);
      server.middlewares.use((rq, rs, nx) => (mount ? mount(rq, rs, nx) : nx()));
      …logging…
    },
  };
}
```

The middleware is registered **inside** an async factory, so the dynamic imports
are awaited before the middleware is used. The startup log distinguishes four
states, including the one that wastes the most time:

```ts
} else if (process.env.MINIMAX_API_KEY !== undefined) {
  log('  AI: MINIMAX_API_KEY is set but empty, so .env was not used.\n' +
      '     An empty value already in the environment wins over the file.\n');
}
```

## 19.5 `server/main.ts`

```ts
loadEnv(root);
const app = createApiApp();

if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('*', (_req, res) => res.status(503).type('text/plain')
    .send('dist/ not found. Run `npm run build` first, or use `npm run dev`.'));
}

const port = Number(process.env.PORT || 8787);
```

The **SPA fallback is `app.get('*')` only** — the API routes are registered
first and `GET /api/*` is not shadowed by it. A missing `dist/` returns a plain
503 with the instruction, rather than an HTML error page that looks like a broken
app.

---

# 20 · The palette and the design language

`tailwind.config.js`, verbatim. Restrained architectural palette: warm paper,
cool graphite, one accent. The comment is in the file on purpose.

```js
content: ['./index.html', './src/**/*.{ts,tsx}'],
theme: { extend: {
  colors: {
    paper: '#fbfaf9',
    surface: '#ffffff',
    line: '#e7e5e1',
    lineStrong: '#d6d3cd',
    ink: '#1c1b19',
    inkSoft: '#57534e',
    inkFaint: '#8a8580',
    accent: { DEFAULT: '#b4622d', soft: '#f3e7de', ink: '#8a4a20' },
    ok: '#3f7d58',
    warn: '#b5842b',
    danger: '#b3402f',
  },
  fontFamily: {
    sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
    mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
  },
  fontSize: { '2xs': ['0.6875rem', { lineHeight: '1rem' }] },
  boxShadow: {
    panel: '0 1px 2px rgba(28,27,25,0.04), 0 8px 24px -12px rgba(28,27,25,0.16)',
    pop: '0 2px 6px rgba(28,27,25,0.08), 0 16px 40px -16px rgba(28,27,25,0.28)',
  },
}},
```

**The canvas background is not in Tailwind.** `.canvas-surface` in `index.css`
is `#f4f1ec` with a 22 × 22 radial-gradient "paper tooth" at
`rgba(28,27,25,0.045)` — the drafting surface is a slightly warmer, slightly
darker paper than the panels that sit on it, and it has grain. This is the one
place the app uses a gradient, and it is texture, not decoration.

**Drafting-tool language:** hairlines, one accent, no gradients, no rounded
cards larger than `var(--ui-radius)` = `6px`, shadows used only to lift a
panel off the canvas. Status colour appears only on chips and issue rows.

`index.css` component classes (all of them, since they are the app's visual
vocabulary): `.panel` · `.panel-head` (`flex h-9 shrink-0 items-center
justify-between border-b border-line px-3`) · `.panel-title` (`text-[11px]
font-semibold uppercase tracking-[0.09em] text-inkFaint`) · `.rail` · `.label` ·
`.hint` · `.metric` (`font-mono text-[13px]`) · `.section-rule` · `.btn` (h-7,
rounded, `border-line bg-surface px-2.5 text-[12px]`) with
`[aria-pressed='true'] @apply border-ink/25 bg-ink/[0.06] text-ink` · `.btn-primary`
· `.btn-accent` (`border-transparent bg-accent text-white`, hover
`bg-accent-ink`) · `.btn-icon` · `.btn-ghost` · `.btn-danger` · `.field` ·
`.field-select` · `.range` (with webkit and moz pseudo-elements) · `.chip` /
`.chip-error` / `.chip-warn` / `.chip-ok` · `.tab` (with an `::after` underline) ·
`.row` · `.issue-row` · `.fade-in` (140 ms) · `.slide-up` (160 ms
`cubic-bezier(0.22,1,0.36,1)`) · `.scroll-y` (9 px webkit scrollbar,
`bg-lineStrong` thumb) · `.canvas-surface`.

Both animations are killed under
`@media (prefers-reduced-motion: reduce)`. `::selection` is
`@apply bg-accent-soft`; `:focus-visible` is
`@apply outline-none ring-2 ring-accent/45 ring-offset-1 ring-offset-paper`.
Number inputs, tables and `.tnum` get `font-variant-numeric: tabular-nums`, so
figures do not jitter while you drag a resize handle.
`font-feature-settings: 'cv05' 1, 'ss01' 1, 'tnum' 0` on `body`.

---

# 21 · The demo — twelve steps, ~45 seconds

This is `e2e/demo.spec.ts`, so the script and the automated check are the same
artifact. Every step below is asserted, not narrated.

**1 · Open the app.** One screen, because a project with nothing in it should
ask rather than show an empty grid. Plot size, storeys and the rooms you need
are on that screen with sensible defaults filled in; units, street edge,
setbacks, room sizes, style, budget and comfort are under **More options**. No
Next, no Back, no review step. All three starts — grid, empty, generate — are
always visible.

**2 · Describe the home.** Plot 18 × 14 m, two storeys, one living room and one
bedroom, step-free access (that last one under **More options**). Everything here
feeds the generator as a **structured brief**, not as a prompt.

**3 · Generate.** A real plan: rooms, walls, openings, doors, starting furniture,
all as project data. The status strip shows net indoor area, footprint, coverage
and floor-area ratio, each from an explicit formula.

**4 · Select and resize a room.** Click → handles → drag. Net area in the status
strip changes as you drag, and the 3D changes with it, because there is one
model.

**5 · Ask the assistant.** Open the panel, type:

> Add a small study next to the largest room.

Watch the progress line move: reading the project → asking for a plan →
checking the plan → checking preconditions → applying → recalculating.

**6 · See it land.** The new room is in the 2D plan, selected, with its id and
area in the inspector. Net indoor area has gone up by the room's area.

**7 · Switch to 3D.** The building, from the same model. Orbit it.

**8 · Stand inside it.** Click **inside**. The camera drops into the largest room
— or whichever room you select in the plan or from the chips along the bottom —
standing in the corner furthest from the middle of the building and looking
across at the opposite one. Drag to look; W A S D walks; scroll steps; Q and E
turn; Escape leaves. Walls and furniture stop you. Click **walk** instead and you
get the unchanged pointer-locked walk on the pavement.

**9 · Run the checks.** Open the **Checks** tab. The study the assistant placed
overlaps another room, and the engine says so and quantifies it:

> "Kitchen" and "Home office" overlap by 4.50 m².

Others appear too — disconnected floors, a room with no door, furniture in a
door swing, setback crossings. Each computed from the model, none asserted by it.

**10 · Correct it.** Press **Shrink Kitchen to 6.10 m wide**. The overlap clears,
the room count is unchanged (it shrank, it did not delete), the area updates.
Every correction the panel offers runs through the same `runTool` the assistant
uses, and is re-validated by `src/model/corrections.test.ts`.

**11 · Save and reload.** Rename, **File → Save now**, reload. The design is
there and the wizard does not come back, because the project was loaded, not
reset.

**12 · Export and verify.** **JSON** — a self-describing file with a format tag
and schema version, checked by putting it back through the app's own importer.
**SVG** — a complete document with real geometry in millimetres. **PNG**, and a
**3D capture** taken from the live canvas.

Then the thirteenth check: **no uncaught page errors** anywhere in the run.

---

# 22 · Tests — what is checked, and the recorded results

Recorded from an actual run of this code, and reproduced in `README.md` and
`FEATURE_MATRIX.md`:

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | clean |
| Unit tests | `npm test` | **508 passed**, 14 files |
| Production build | `npm run build` | succeeds — 1,303.61 kB / 374.11 kB gzip |
| End-to-end | `npm run e2e` | **29 passed** (~3.4 min) |
| All four | `npm run verify` | green |

**A generated file is not a passing test.** None of the numbers above come from
"it built". The unit tests execute the geometry, the operations, the
measurements, the validator and the collision code; the e2e drives a real
Chromium against the real built bundle, reads the DOM, hashes rendered pixels and
opens the files the browser downloaded.

## 22.1 The 14 unit-test files

| File | What it pins down |
|---|---|
| `src/model/ops.test.ts` | every operation's success and typed-error paths, the geometry kernel, `EPS = 1e-9` at the tolerance edges, `reindex()` invariants |
| `src/model/measure.test.ts` | net/gross, footprint, coverage, FAR — by formula, including the multi-floor case |
| `src/model/validate.test.ts` | each emitted code fires on a model built to trip it, and does not fire on a clean one |
| `src/model/corrections.test.ts` | every click-to-fix correction actually clears its own issue, and **changes nothing else** |
| `src/model/circulation.test.ts` | the graph, `OUTSIDE`, openings joining opposite sides, reachability |
| `src/model/layout.test.ts` | `generateFromBrief` is deterministic, respects the plot, respects the brief |
| `src/model/history.test.ts` | undo/redo depth, `MAX_HISTORY`, and the `coalesceKey` behaviour |
| `src/model/serialize.test.ts` | the JSON envelope round-trips; a wrong schema version is refused |
| `src/three/sceneModel.test.ts` | `buildScene` is pure, every `Box` carries a `floorId`, `JOINT_OVERLAP` applied |
| `src/three/collision.test.ts` | `moveWithCollision` per-axis resolution, `roomViewpoint` corner choice and fallbacks |
| `src/tools/registry.test.ts` | all 28 tools: schema shape, permission class, refusal on bad input, `runTool` never throws |
| `src/ai/orchestrator.test.ts` | `parsePlan` in both styles, `validatePlanShape`, `checkPreconditions`, the turn loop, the press-once rule |
| `src/trace/calibrate.test.ts` | `scaleFromLength` and `calibrateFromTwoPoints`, including a rotated image |

`src/export/planSvg.test.ts` additionally asserts the SVG is a **well-formed
document**: one `<svg>`, the namespace declared, the root closed, no `NaN`
anywhere, geometry in millimetres.

## 22.2 The e2e suites — 29 tests

`playwright.config.ts`: `timeout: 180_000`, `expect.timeout: 15_000`,
`fullyParallel: false`, `workers: 1`, `trace: 'retain-on-failure'`, viewport
`1600 × 1000`, and Chromium launched with
`['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-lcd-text']`
— SwiftShader software rendering, which is why frames take 450–1000 ms and why
`timeout` is 180 s.

Two `webServer` entries, both `reuseExistingServer: false`:
`node e2e/fake-minimax.mjs` on `FAKE_MINIMAX_PORT = 8799`, and
`npm run build && node --experimental-strip-types server/main.ts` on
`PORT = 8788` with `MINIMAX_API_KEY: 'e2e-stand-in-key'`,
`MINIMAX_BASE_URL: http://127.0.0.1:8799`, `MINIMAX_MODEL: MiniMax-M3`.
**The e2e never touches the network.**

| Spec | Tests | What it pins down |
|---|---|---|
| `demo.spec.ts` | 12 + 1 | the twelve steps above, then the no-uncaught-errors check |
| `editor.spec.ts` | 10 | picking a wall that sits inside two rooms and deleting it; a door showing as selected; the right-click menu addressing the wall under the cursor; a room placed from the palette and then **picked up again rather than duplicated**; the upright label in a corridor; the empty-plot and grid starts |
| `assistant.spec.ts` | — | a design request answered in words **must say on screen that the plan did not change**; a six-room plan must be *watched* arriving one room at a time |
| `inside.spec.ts` | 2 | the view opens in a named room, moves to another when a room is chosen, leaves on Escape; a drag to look must **not** be delivered to the room underneath as a click |
| `pointer-lock.spec.ts` | — | a regression test for an unhandled rejection that came from drei attaching its trigger to `document`, so a toolbar click asked a canvas React had already detached — appeared in roughly one run in three |

Two accommodations, both recorded with their evidence in comments rather than
worked around silently:

- one click uses `force: true` (the `view-plan` toolbar button). Under software
  rendering Playwright's hit test reports an interception that
  `document.elementsFromPoint` shows does not exist, and a raw mouse click at the
  same coordinates *does* switch the view;
- `workers: 1`, serially, because the twelve steps share one page.

## 22.3 The live MiniMax check

`scripts/live-assistant-check.mjs` drives the real service once, on demand. It is
a script and not a test because it costs money and needs a key.

That exercise found **four real defects, all fixed:**

| Found by | Defect |
|---|---|
| key present, panel said "no key" | the `.env` loader ran only in `server/main.ts`, so `npm run dev` started with an empty environment |
| live turn returned *"did not return a plan in the expected JSON shape"* | M3 answers a tool-bearing request with `tool_use` blocks; the client discarded them and kept only the prose |
| live turn died on `There is no tool called "reply"` | M3 turns the prompt's `{"reply": …}` step shape into a tool call named `reply`; now mapped by an explicit five-name list, in the one validator both answer styles pass through |
| one run in three threw `WrongDocumentError` | drei attached the pointer-lock trigger to `document` |

Observed and **not** resolved: on one live turn the model reported a setback
violation of "2.00 m" for a room whose geometry put it flush against the
envelope, and said so itself rather than guessing. Whether that is a real false
positive in `setback_violation` or a misreading by the model was not determined.
It is recorded rather than quietly dropped.

---

# 23 · Known limitations, stated honestly

Nothing in this section is presented as working. If a rebuild claims these are
fixed, ask which ones and check them.

## 23.1 Not done

- **No multi-user, cloud sync or authentication.** Projects live in the browser
  that made them.
- **No PDF, DXF or IFC export.** SVG, PNG and JSON only.
- **No mobile or tablet layout.** This is a desktop drafting tool.
- **A one-pixel antialiased line remains at every wall junction.** Where two
  walls meet, `resolveCorners` inserts a corner block so the junction is closed
  by three coplanar faces rather than two. Multisampling covers the boundary
  pixel between them and it reads as a faint vertical hairline down the
  elevation. **It is coverage, not a gap:** with `antialias: false` it disappears
  entirely, and the float32 gap between two abutting edges measures
  **2.4 × 10⁻⁷ m**. Overlapping the walls at the junction instead of backing them
  off would remove it, and has not been done.
- **Furniture is parametric massing, not modelled joinery.** A sofa is a seat, a
  back, arms and cushions; a bed is a frame, a mattress and a pillow. Nothing is
  a specific product and nothing is a licensed asset.
- **Interior lighting is a stand-in, not bounce light.** three.js has no global
  illumination. The sun is one directional light and walls shadow it completely,
  so an interior with nothing else in it renders nearly black. A global
  environment map would be the physically honest answer and **was rejected**: an
  IBL lookup per pixel is the most expensive thing in the frame under the
  software rasteriser this is verified on. What is there instead is one hemisphere
  light, added **only while the inside camera is active**, standing in for the
  light a real room would pick up off its own surfaces. It cannot change a single
  pixel in the three exterior modes. Consequence: the fill is uniform, so a
  ceiling far from a window is lit as well as one beside it, and rooms read as
  evenly lit rather than falling off towards their interior corners.
- **The inside camera is not a walkthrough.** It moves between rooms on
  selection and can be driven by hand, but there is **no free navigation between
  storeys**: the camera is placed on one floor and stays there until another room
  is chosen.

## 23.2 Declared but never emitted

Four codes are in the `IssueCode` union with **no emitting site**:
`room_inside_wall`, `wall_not_shared`, `opening_out_of_bounds`, `door_no_access`.
They are documented checks that were specified and not written.

Three others — `opening_overflows_wall`, `door_swing_blocked`,
`stair_not_connected` — are emitted from more than one branch. That is
intentional (distinct causes, distinct sentences), but it means those codes are
not one-to-one with fixes.

## 23.3 Reachable but not exercised

- `Staircase.direction === -1` **cannot be created.** `addStaircase` requires the
  target floor to be strictly above the one it starts on, so a descending flight
  is refused. The field is stored and rendered; no operation path produces −1.
- `setPlot` types `setbacks` as a complete object while merging whatever partial
  it is given, so a caller can supply two sides and keep the other two.

## 23.4 Dead code

- `src/model/validate.ts:324` — the corridor-widening correction has
  `anchor: room.width <= room.depth ? 'top-left' : 'top-left'`. Both branches are
  the same value; the ternary is meaningless.
- `src/model/validate.ts:656-659` — `stairsByFloor` is populated and never read.

## 23.5 Scope statements — keep these in the rebuilt product

These are the sentences the product is not allowed to stop saying:

- Generated plans are **not** construction-ready and are **not** professionally
  certified. They are early-design geometry.
- Constraint thresholds are configurable sanity bounds, **not** rules from any
  jurisdiction. Furnish does not know where you are and does not claim otherwise.
- The bundle is a single **1.30 MB** chunk (374 kB gzipped) with **no code
  splitting**.

---

# 24 · Build order and acceptance criteria

Build in this order. Each milestone is independently verifiable, so a failure is
attributable rather than somewhere in a wall of code.

| # | Milestone | Verify with |
|---|---|---|
| 1 | `types.ts`, `geometry.ts`, `ids.ts` | a unit test per function; `EPS` and `TOL` pinned |
| 2 | `catalog.ts` | 17 materials and 33 items enumerated by length, not by count assertion |
| 3 | `ops.ts` + `reindex()` | every op tested for success **and** typed error; undo/redo depth |
| 4 | `measure.ts`, `circulation.ts`, `validate.ts` | each emitted code fires on a model built to trip it and is silent on a clean one; every correction clears its own issue and changes nothing else |
| 5 | `plan.ts` + `layout.ts` | `generateFromBrief` is deterministic, respects the plot and the brief |
| 6 | the store + history + IndexedDB | a round-trip through `localStorage`-shaped persistence |
| 7 | 2D editor | hit-testing priority, wall-before-room, drag, resize, context menu |
| 8 | 3D scene | `buildScene` purity, `floorId` on every box, `JOINT_OVERLAP` |
| 9 | the four cameras | collision, pointer-lock, top-down, inside |
| 10 | persistence + export + trace | **the exported SVG is opened and parsed**, the JSON is re-imported through the app's own reader, the PNG is read back from the live canvas |
| 11 | the 28-tool registry | every tool: schema shape, permission class, refusal on bad input, `runTool` never throws |
| 12 | the assistant pipeline | both answer styles parse, a malformed plan is refused whole, the press-once rule fires once |
| 13 | the server | `MINIMAX_API_KEY` absent from the built bundle — **grep the bundle** |
| 14 | the e2e | `npm run verify` green |

## 24.1 Acceptance criteria

The build is done when **all** of these hold, each checked by running something:

1. `npm run typecheck` is clean.
2. `npm test` passes, with every operation's typed-error path covered.
3. `npm run build` succeeds.
4. `npx playwright test` passes against the **built** bundle.
5. The exported **SVG opens** in a viewer — asserted by parsing it, not by the
   download event firing.
6. The exported **JSON re-imports** through the app's own reader.
7. The exported **PNG** has the correct signature and is non-trivial in size.
8. A **reload restores the design** from IndexedDB.
9. `grep -r "MINIMAX_API_KEY" dist/` returns **nothing** but the placeholder text
   from the `.env.example` message.
10. A design request answered **in prose only** leaves the plan untouched **and
    says so on screen**.
11. A plan with an **invented element id** is refused whole, with the id quoted,
    and applies **zero** operations.
12. A model-supplied area is **never** displayed as a measurement — every figure
    in the status strip and every figure in the assistant's report is recomputed
    from the store.

## 24.2 What must never be done

Restated from §0, because these are the constraints the whole design exists to
satisfy, and a rebuild is exactly where they get dropped:

- The API key is read from a **server-side** environment variable and never
  appears in browser code.
- The model never supplies executable code, overrides validation, fabricates an
  object id, or bypasses an approval.
- The app never says the model changed the design unless operations actually ran
  and were applied.
- A file format is never claimed as supported unless the export has been opened
  and used.
- No fabricated screenshots, test results, API capabilities, repository findings
  or integrations.
- No test reported as passing because the code was generated or a build
  completed.
- The deployed or locally running application is verified by hand.
- Generated plans are never described as construction-ready or certified.
- Building regulations are configurable constraints only where reliable
  jurisdiction-specific rules exist; universal compliance is never claimed.
- No proprietary code, and no copyrighted demonstration floor plans or assets,
  are copied without permission.
- Implementation details are never invented, and inaccessible source code is
  never claimed to have been inspected.
- WebMCP is not a dependency.
- What is actually implemented and actually verified stays written down.

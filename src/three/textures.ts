/**
 * Procedural surfaces.
 *
 * The scene used to draw every surface as flat-shaded colour, which is exactly
 * what makes a rendered house look like a diagram: a real wall is never one
 * value, and a real floor is never one value either. The cure is texture, and
 * the cheapest honest source of texture here is one we generate ourselves —
 * there are no image assets to ship, licence, or fail to load offline, and a
 * canvas is enough to produce the surface variation that does most of the work.
 *
 * ── Why every map is greyscale ────────────────────────────────────────────────
 * A `map` multiplies the material colour, so a greyscale map in a narrow band
 * around white modulates whatever colour the scene model chose without ever
 * fighting it. One rule covers every surface: the map only says "this bit is a
 * little darker than that bit".
 *
 * ── Three maps per family, not one ───────────────────────────────────────────
 * This used to build one greyscale texture and hand it to three.js as both the
 * `map` and the `bumpMap`. That is wrong in two separate ways, and both of them
 * are why the house looked like white cardboard:
 *
 * 1. `bumpMap` reads the red channel of an **sRGB** texture. three.js gamma-
 *    decodes an sRGB texture on sample, so the height the shader saw was the
 *    square root of the height that was painted — every joint and every grain
 *    arrived with the wrong magnitude and the wrong slope.
 * 2. There was no normal map and no roughness map at all, so every surface in
 *    the building was uniformly rough and uniformly un-directional. A wall that
 *    is rough *everywhere* has no texture worth the name; a wall with a faint
 *    normal across the render and a slightly glossier band where a plasterer's
 *    float passed is what the eye reads as a surface.
 *
 * So each family now paints once and derives the rest from that one greyscale
 * field, which stays the single source of truth:
 *
 *   albedo   the painter's output, sRGB, modulates colour
 *   normal   Sobel gradient of the same field, linear, tangent-space
 *   rough    the same field, inverted and compressed, linear
 *
 * All three tile, all three are seeded, and none of them costs a second
 * painter. The strength of the normal per family is in `NORMAL_STRENGTH`,
 * because plaster wants a whisper and a tile joint wants a trench.
 *
 * ── Determinism ───────────────────────────────────────────────────────────────
 * Every random number comes from a seeded generator, never `Math.random`. An
 * end-to-end test hashes the rendered frame; a texture that shuffled itself
 * between runs would make that hash meaningless.
 */
import * as THREE from 'three';
import { toCreasedNormals } from 'three-stdlib';

/**
 * Surface fidelity.
 *
 * `draft` is the old 192-pixel, colour-and-bump-only path and it is what the
 * automated suite runs on, because that suite drives Chromium through
 * SwiftShader — a software rasteriser where every extra sampler and every extra
 * fragment of shading is paid for in wall-clock. `realistic` is 512 pixels with
 * all three maps, and it is what a machine with a GPU gets by default.
 */
export type SurfaceQuality = 'draft' | 'realistic';

const SIZES: Record<SurfaceQuality, number> = { draft: 192, realistic: 512 };

let quality: SurfaceQuality = 'draft';

/** Texture resolution for the current quality setting. */
export function surfaceSize(): number {
  return SIZES[quality];
}

/**
 * Switch surface fidelity, regenerating every cached map.
 *
 * The caches are cleared rather than converted because the painter writes into
 * a fixed-size buffer; changing the quality means rebuilding at the new size.
 * `materialCache` goes too, since every material holds references into the maps
 * being thrown away.
 */
export function setSurfaceQuality(next: SurfaceQuality): void {
  if (next === quality) return;
  quality = next;
  noiseCache.clear();
  textureCache.clear();
  for (const mat of materialCache.values()) mat.dispose();
  materialCache.clear();
}

export function currentSurfaceQuality(): SurfaceQuality {
  return quality;
}

// ─────────────────────────────────────────────────────────────── primitives ───

/** Small, fast, fully deterministic PRNG. Same seed, same picture, every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tileable fractional noise, in [0,1].
 *
 * "Tileable" is the operative word: a wall is 6 m of the same 192-pixel texture
 * repeated, and any seam in the pattern would show up as a stripe down the
 * elevation. Each octave is a small random lattice sampled with a smoothstep
 * interpolant and wrapped at its own period, so the result tiles exactly.
 */
function noise(size: number, lattice: number, octaves: number, seed: number, stretch = 1): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = lattice * 2 ** o;
    const rand = rng(seed + o * 7919);
    const grid = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) grid[i] = rand();
    const cell = size / n;
    for (let y = 0; y < size; y++) {
      const gy = y / cell;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const ya = y0 % n;
      const yb = (y0 + 1) % n;
      for (let x = 0; x < size; x++) {
        // `stretch` squashes the lattice along x, which is how wood grain and
        // brushed metal get their direction out of the same function.
        const gx = x / cell / stretch;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const xa = x0 % n;
        const xb = (x0 + 1) % n;
        const v00 = grid[ya * n + xa];
        const v10 = grid[ya * n + xb];
        const v01 = grid[yb * n + xa];
        const v11 = grid[yb * n + xb];
        const a = v00 + (v10 - v00) * sx;
        const b = v01 + (v11 - v01) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** How a surface is painted. Values stay in a narrow band around white. */
type Painter = (n: Float32Array, px: Uint8ClampedArray, size: number) => void;

/** Write one greyscale value into the RGBA buffer. */
const put = (px: Uint8ClampedArray, i: number, v: number) => {
  const b = Math.max(0, Math.min(255, Math.round(v * 255)));
  px[i] = b;
  px[i + 1] = b;
  px[i + 2] = b;
  px[i + 3] = 255;
};

/** `0.94 + 0.06·x` for x in [-1,1] — the amplitude of a surface's mottling. */
const band = (n: Float32Array, i: number, base: number, amp: number) => base + amp * (n[i]! * 2 - 1);

/**
 * Dark line at a grid joint, with a soft shoulder so the joint reads as a
 * recessed groove under a bump map rather than as a drawn stripe.
 *
 * `u` and `v` are normalised (0..1 across the map), not pixel indices.
 */
function joint(px: Uint8ClampedArray, size: number, u: number, v: number, cellsU: number, cellsV: number, depth: number) {
  const fu = Math.abs((u * cellsU) % 1 - 0.5) * 2;
  const fv = Math.abs((v * cellsV) % 1 - 0.5) * 2;
  const t = Math.min(fu, fv);
  if (t > 0.94) {
    const i = (v * size + u) * 4;
    const k = 1 - depth * (1 - (t - 0.94) / 0.06);
    put(px, i, px[i]! / 255 * k);
  }
}

const PAINTERS: Record<string, Painter> = {
  // A painted wall: barely there, but not nothing.
  plaster: (n, px) => {
    for (let i = 0; i < n.length; i++) put(px, i * 4, band(n, i, 0.96, 0.05));
  },
  // Exterior render is coarser than interior paint.
  render: (n, px) => {
    for (let i = 0; i < n.length; i++) put(px, i * 4, band(n, i, 0.93, 0.09));
  },
  concrete: (n, px, size) => {
    const grit = noise(size, 96, 2, 21);
    for (let i = 0; i < n.length; i++) put(px, i * 4, band(n, i, 0.9, 0.11) * band(grit, i, 1, 0.06));
  },
  // A roof membrane is nearly uniform: its character is a fine granular
  // speckle and very little else. Sharing the concrete painter gave it
  // concrete's broad blotching, and over a twenty-metre slab that read as
  // camouflage rather than as a roof.
  roof: (n, px, size) => {
    const grit = noise(size, 64, 2, 33);
    for (let i = 0; i < n.length; i++) put(px, i * 4, band(n, i, 0.95, 0.06) * band(grit, i, 1, 0.09));
  },
  // Large-format slabs: joints are the whole character of the surface.
  stone: (n, px, size) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        put(px, i * 4, band(n, i, 0.93, 0.08));
        joint(px, size, x / size, y / size, 2, 2, 0.3);
      }
    }
  },
  // Board floors. Planks run along x, each with its own tone and its own grain
  // offset, which is what stops a wood floor reading as one flat brown field.
  oak: (n, px, size) => {
    const grain = noise(size, 8, 4, 55, 9);
    const rand = rng(9);
    const planks = 6;
    const tone: number[] = [];
    const offset: number[] = [];
    for (let p = 0; p < planks; p++) {
      tone.push(0.9 + rand() * 0.16);
      offset.push(rand());
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const p = Math.floor((y / size) * planks);
        // Grain is sampled at a per-plank phase offset, so no two boards repeat.
        const g = grain[(y * size + ((x + Math.floor(offset[p]! * size)) % size)) % n.length]!;
        const v = tone[p]! * (0.9 + 0.18 * g) * band(n, i, 1, 0.05);
        put(px, i * 4, v);
        if (y % Math.round(size / planks) < 2) put(px, i * 4, 0.55);
      }
    }
  },
  // Ceramic tile: a grid, a grout line, and a per-tile tone so it is not a
  // perfect repeat.
  tile: (n, px, size) => {
    const rand = rng(31);
    const cells = 6;
    const tone = new Float32Array(cells * cells);
    for (let i = 0; i < tone.length; i++) tone[i] = 0.93 + rand() * 0.1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const c = tone[(Math.floor((y / size) * cells) * cells + Math.floor((x / size) * cells)) % tone.length]!;
        put(px, i * 4, c * band(n, i, 1, 0.05));
        joint(px, size, x / size, y / size, cells, cells, 0.26);
      }
    }
  },
  carpet: (n, px) => {
    for (let i = 0; i < n.length; i++) put(px, i * 4, band(n, i, 0.95, 0.07));
  },
  // A woven cloth: two crossed ripples, plus noise for the slubs.
  fabric: (n, px, size) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const weave = Math.sin((x / size) * Math.PI * 64) * Math.sin((y / size) * Math.PI * 64);
        put(px, i * 4, band(n, i, 0.94, 0.05) + weave * 0.03);
      }
    }
  },
  // Grass reads as mottling, not as fur. This map is also the bump map, and a
  // bump map turns any directional noise into furrows: the first attempt
  // stretched the detail fivefold to suggest blades, and the lawn came out
  // combed into long ridges that ran with the texture axis across the entire
  // plot. At the fifteen metres this is actually seen from, what you can make
  // out is tonal variation between patches — so the detail is fine and
  // isotropic, and the broad blotching does the work.
  lawn: (n, px, size) => {
    const fine = noise(size, 32, 2, 78);
    for (let i = 0; i < n.length; i++) put(px, i * 4, band(n, i, 0.9, 0.11) * band(fine, i, 1, 0.07));
  },
  paving: (n, px, size) => {
    const grit = noise(size, 128, 2, 12);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        put(px, i * 4, band(n, i, 0.91, 0.1) * band(grit, i, 1, 0.05));
        joint(px, size, x / size, y / size, 4, 4, 0.22);
      }
    }
  },
  metal: (n, px, size) => {
    const brush = noise(size, 4, 3, 5, 24);
    for (let i = 0; i < n.length; i++) put(px, i * 4, 0.93 + 0.07 * brush[i]!);
  },
  leaf: (n, px) => {
    for (let i = 0; i < n.length; i++) put(px, i * 4, band(n, i, 0.88, 0.16));
  },
  // A plain surface still wants *some* variation, or large flat areas band.
  flat: (n, px) => {
    for (let i = 0; i < n.length; i++) put(px, i * 4, band(n, i, 0.97, 0.04));
  },
};

const NOISE_FOR: Record<string, { lattice: number; octaves: number; seed: number; stretch: number }> = {
  plaster: { lattice: 6, octaves: 4, seed: 3, stretch: 1 },
  render: { lattice: 5, octaves: 4, seed: 11, stretch: 1 },
  concrete: { lattice: 7, octaves: 4, seed: 17, stretch: 1 },
  roof: { lattice: 40, octaves: 3, seed: 33, stretch: 1 },
  stone: { lattice: 4, octaves: 4, seed: 23, stretch: 1 },
  oak: { lattice: 8, octaves: 4, seed: 55, stretch: 1 },
  tile: { lattice: 5, octaves: 3, seed: 31, stretch: 1 },
  carpet: { lattice: 48, octaves: 2, seed: 41, stretch: 1 },
  fabric: { lattice: 24, octaves: 3, seed: 61, stretch: 1 },
  lawn: { lattice: 24, octaves: 3, seed: 77, stretch: 1 },
  paving: { lattice: 6, octaves: 4, seed: 12, stretch: 1 },
  metal: { lattice: 6, octaves: 2, seed: 5, stretch: 1 },
  leaf: { lattice: 10, octaves: 3, seed: 91, stretch: 1 },
  flat: { lattice: 5, octaves: 2, seed: 2, stretch: 1 },
};

const noiseCache = new Map<string, Float32Array>();
const textureCache = new Map<string, SurfaceMaps>();

/**
 * How hard each family pushes its normal map.
 *
 * A plaster wall has a texture you could not photograph; a tile joint is a
 * two-millimetre trench and it should read as one. Running every family at the
 * same strength is what made the old bump-only render read as uniform — the
 * strong families were always too weak and the weak families always too
 * strong. These numbers are the correction.
 */
const NORMAL_STRENGTH: Record<string, number> = {
  plaster: 0.6,
  render: 2.2,
  concrete: 2.0,
  roof: 1.4,
  stone: 3.4,
  oak: 2.6,
  tile: 3.6,
  carpet: 1.6,
  fabric: 1.5,
  lawn: 1.2,
  paving: 3.2,
  metal: 1.8,
  leaf: 1.4,
  flat: 0.5,
};

/**
 * Roughness multiplier per family, relative to the greyscale field.
 *
 * three.js multiplies `material.roughness` by the **green** channel of the
 * roughness map, so a white map means "exactly as rough as the material says".
 * Values above 1 cannot be encoded, so these all sit below 1 and
 * `materialFor` divides the requested roughness by the mean to put the average
 * back where the scene model asked for it. The variation is the point: the
 * recessed joint in a tile floor should be rougher than the glaze around it.
 */
const ROUGH_SPREAD = 0.16;
const ROUGH_MEAN = 0.9;

function noiseFor(surface: string): Float32Array {
  const cached = noiseCache.get(surface);
  if (cached) return cached;
  const spec = NOISE_FOR[surface] ?? NOISE_FOR.flat!;
  const made = noise(surfaceSize(), spec.lattice, spec.octaves, spec.seed, spec.stretch);
  noiseCache.set(surface, made);
  return made;
}

/** The three textures every surface family is built from. */
export interface SurfaceMaps {
  /** sRGB. Modulates the material colour. */
  albedo: THREE.CanvasTexture;
  /** Linear, tangent-space. Null in draft quality, where it costs more than it gives. */
  normal: THREE.CanvasTexture | null;
  /** Linear. Encodes a multiplier on `material.roughness`. */
  rough: THREE.CanvasTexture | null;
}

/** Wrap a pixel index, because the normal gradient of a tiling texture wraps too. */
const wrap = (i: number, size: number) => (i + size) % size;

/**
 * Tangent-space normal map from a height field, by central difference.
 *
 * A Sobel kernel would be marginally better on the diagonals and costs eight
 * reads per texel instead of four; at 512×512 across fourteen families this is
 * built once and never again, so the four-read version wins.
 *
 * Sign convention: three.js samples textures with `flipY` on by default, so a
 * canvas row maps to increasing V upward. The tangent frame's +Y is therefore
 * *up the canvas*, which is why the vertical difference is `up - down` and not
 * the other way round. Getting this backwards produces a surface whose every
 * joint appears lit from underneath — subtle, and easy to miss without a
 * render to check it against.
 */
function normalFromHeight(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const px = new Uint8ClampedArray(size * size * 4);
  const half = strength * 0.5;

  for (let y = 0; y < size; y++) {
    const yUp = wrap(y - 1, size) * size;
    const yDn = wrap(y + 1, size) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const xL = wrap(x - 1, size);
      const xR = wrap(x + 1, size);
      const gx = (height[row + xR]! - height[row + xL]!) * half;
      const gy = (height[yUp + x]! - height[yDn + x]!) * half;

      const inv = 1 / Math.hypot(gx, gy, 1);
      const i = (row + x) * 4;
      px[i] = (gx * inv * 0.5 + 0.5) * 255;
      px[i + 1] = (gy * inv * 0.5 + 0.5) * 255;
      px[i + 2] = (inv * 0.5 + 0.5) * 255;
      px[i + 3] = 255;
    }
  }
  // NOT sRGB. These are vectors, not colours; gamma-decoding them is the bug
  // this whole function exists to stop repeating.
  return textureFrom(px, size, false, 8);
}

/**
 * Roughness map from the same field, inverted.
 *
 * Low spots are rougher than high spots, because that is what happens to a real
 * surface: grout, the groove between floorboards and the weave of a carpet all
 * scatter where the high point of a material would have polished it. The
 * relationship is inverted and compressed rather than used directly, so a
 * family whose painter works in a narrow band around 0.95 still produces a
 * visible spread instead of a flat white map.
 */
function roughFromHeight(height: Float32Array, size: number): THREE.CanvasTexture {
  const px = new Uint8ClampedArray(size * size * 4);

  for (let i = 0; i < height.length; i++) {
    // height runs in a narrow band around ~0.95; expand it across the whole
    // usable range so a subtle painter still yields a visible map.
    const centred = (height[i]! - 0.92) * 6;
    const v = Math.max(0, Math.min(1, ROUGH_MEAN + (0.5 - centred) * ROUGH_SPREAD));
    const b = Math.round(v * 255);
    const o = i * 4;
    px[o] = b;
    px[o + 1] = b; // three reads GREEN for roughness.
    px[o + 2] = b;
    px[o + 3] = 255;
  }
  // Roughness is low-frequency; sampling it hard is pure waste.
  return textureFrom(px, size, false, 4);
}

/** Build one canvas from an RGBA buffer and hand back a tiling texture. */
function textureFrom(
  px: Uint8ClampedArray,
  size: number,
  srgb: boolean,
  anisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(size, size);
    img.data.set(px);
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * The maps for a surface family, or null for a family that wants none.
 * Generated once per family and shared by every material using it.
 */
export function surfaceMaps(surface: string | undefined): SurfaceMaps | null {
  if (!surface) return null;
  const painter = PAINTERS[surface];
  if (!painter) return null;
  const cached = textureCache.get(surface);
  if (cached) return cached;

  const size = surfaceSize();
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  painter(noiseFor(surface), img.data, size);
  ctx.putImageData(img, 0, 0);

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  // The texture modulates a colour, so it is authored in sRGB.
  albedo.colorSpace = THREE.SRGBColorSpace;
  // Eight, not four. The lawn is thirty metres across and the camera looks
  // along it, so the ground is at a grazing angle where the sampled footprint
  // is wildly anisotropic — a one-pixel-tall smear stretched over several
  // metres. At four samples the mip level chosen for that footprint is far too
  // sharp and the lawn combs into long streaks. three.js clamps this to what
  // the driver reports, so asking for more than a given GPU supports costs
  // nothing.
  albedo.anisotropy = 8;

  // The painter's greyscale is the height field. Read it back out of the
  // buffer rather than running the painter twice — it is the same pixels, and
  // running it twice would be the same picture only by accident.
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) height[i] = img.data[i * 4]! / 255;

  const realistic = quality === 'realistic';
  const made: SurfaceMaps = {
    albedo,
    normal: realistic ? normalFromHeight(height, size, NORMAL_STRENGTH[surface] ?? 1.5) : null,
    rough: realistic ? roughFromHeight(height, size) : null,
  };
  textureCache.set(surface, made);
  return made;
}

/** Back-compat accessor for the albedo alone. */
export function surfaceTexture(surface: string | undefined): THREE.Texture | null {
  return surfaceMaps(surface)?.albedo ?? null;
}

// ──────────────────────────────────────────────────────────────── materials ───

/** How many metres of surface one tile of a map covers. */
const TILE_METRES = 2.2;

/**
 * Texture repeat for a face of the given size.
 *
 * Without this every face shows exactly one tile of the map whatever its size,
 * and the picture falls apart at both ends of the scale. A 20 m roof gets one
 * 192-pixel tile stretched across the whole slab, so the coarse octave of its
 * noise becomes metre-wide blotches and the roof reads as camouflage. A 60 mm
 * cabinet rail gets the same tile crushed into a quarter of its pixels, which
 * is not texture, it is aliasing.
 *
 * Fixing it here rather than per-texture matters because repeat lives on the
 * texture, and the texture is shared by every surface of the same family. The
 * values are quantised to half-tiles for the same reason materials are cached:
 * the cache is keyed on repeat, so unrounded values would mint a new material
 * for every distinct box size in the model.
 */
export function surfaceRepeat(w: number, h: number): [number, number] {
  const q = (metres: number) => {
    const r = metres / TILE_METRES;
    return Math.max(0.5, Math.min(14, Math.round(r * 2) / 2));
  };
  return [q(w), q(h)];
}

export interface MaterialSpec {
  surface?: string;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  /** Glass gets a physical material: index of refraction, thickness, no fog. */
  glass?: boolean;
  /** Repeat the surface map to roughly match the part's size on screen. */
  repeat?: number | [number, number];
}

const materialCache = new Map<string, THREE.Material>();

/**
 * One shared material per distinct surface/colour combination.
 *
 * Materials are shared rather than per-mesh because a house is a few hundred
 * meshes and a material per mesh is a few hundred shader programs' worth of
 * state for no visual gain — and the whole point of the texture work is that
 * neighbouring boxes share a surface, so they should share a material.
 */
export function materialFor(spec: MaterialSpec): THREE.Material {
  const [rx, ry] = Array.isArray(spec.repeat) ? spec.repeat : [spec.repeat ?? 1, spec.repeat ?? 1];
  const key = `${spec.surface ?? ''}|${spec.color}|${spec.roughness}|${spec.metalness}|${spec.opacity}|${spec.glass ? 1 : 0}|${rx}x${ry}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const maps = surfaceMaps(spec.surface);
  const params: THREE.MeshStandardMaterialParameters = {
    color: new THREE.Color(spec.color),
    // Divided by the roughness map's mean, because three *multiplies* by the
    // map. Without this every textured surface would come out visibly rougher
    // than the scene model asked for — the map sits below white on purpose so
    // it has room to push variation upwards as well as down.
    //
    // Not clamped back to 1. The roof asks for 0.96 and the lawn for 1.0, and
    // clamping the divisor's output to unity quietly handed both of them 0.9
    // instead — a fifth of a stop of gloss they were not meant to lose. three
    // does not clamp the value it uploads, so letting it past 1 is safe.
    roughness: maps?.rough ? spec.roughness / ROUGH_MEAN : spec.roughness,
    metalness: spec.metalness,
    transparent: spec.opacity < 1,
    opacity: spec.opacity,
  };

  if (maps) {
    // A copy per map, because repeat lives on the texture and the texture is
    // shared by every surface of the same family. The copy shares the source
    // image, so this costs a sampler binding and not an upload.
    const at = (t: THREE.Texture | null) => {
      if (!t) return null;
      if (rx === 1 && ry === 1) return t;
      const c = t.clone();
      c.needsUpdate = true;
      c.repeat.set(rx, ry);
      return c;
    };
    params.map = at(maps.albedo);
    if (maps.normal) {
      params.normalMap = at(maps.normal);
      // 0.012 was the old bump figure in metres; normal maps are unitless
      // tangents, and this is the equivalent perceived strength of a plaster
      // tooth rather than a silhouette.
      params.normalScale = new THREE.Vector2(0.55, 0.55);
    }
    if (maps.rough) params.roughnessMap = at(maps.rough);
  }

  // Reflective surfaces carry the sky explicitly. Everything else takes it from
  // `scene.environment`, which `Scene` sets from the same texture via a PMREM —
  // see `environmentFromSky`. Setting `scene.environment` is what makes a
  // painted render pick up sky from above and warm ground bounce from below
  // instead of reading as a flat swatch under two point lights.
  const reflective = spec.glass || spec.metalness > 0.3;
  if (reflective) params.envMap = skyTexture();
  if (reflective) params.envMapIntensity = spec.glass ? 1.5 : 0.85;

  let mat: THREE.Material;
  if (spec.glass) {
    const glass = new THREE.MeshPhysicalMaterial({
      ...params,
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: spec.opacity,
      // Clear glass reflects more than it tints, which is most of what makes a
      // window read as a window rather than as a grey hole.
      reflectivity: 0.6,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    mat = glass;
  } else {
    mat = new THREE.MeshStandardMaterial(params);
  }
  materialCache.set(key, mat);
  return mat;
}

// ───────────────────────────────────────────────────────────────────── sky ────

let skyCache: THREE.CanvasTexture | null = null;

/**
 * A sky, generated rather than downloaded.
 *
 * `scene.environment` is what turns a `MeshStandardMaterial` from "lit by two
 * lights" into something that behaves like a physical surface: every metal and
 * every pane of glass gets its ambient light and its reflections from here.
 * Without it, chrome is black and glass is a flat grey rectangle.
 *
 * The gradient matches the app's restrained light scheme rather than a
 * photographic sky — warm at the horizon, cooler overhead, and the ground half
 * returning the green of the lawn so bounce light is the right colour.
 */
export function skyTexture(): THREE.CanvasTexture {
  if (skyCache) return skyCache;
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    // Above the horizon: a real sky, blue at the zenith and washed out towards
    // the horizon the way distance actually does it. Below it: not a green
    // field, which is what this used to be. The lawn stops thirty metres out,
    // and everything past that is this texture, so a green lower half drew a
    // green wall behind the house with a hard line where the plot ended. Real
    // ground at that distance is haze, so the lower half fades into the same
    // near-white the fog uses and the plot boundary simply dissolves.
    //
    // The whole ramp is cooler and a little less saturated than the cream it
    // replaced, and the horizon stop is now *exactly* the fog colour set in
    // `Scene` — that equality is what dissolves the plot edge, so if either
    // side of it is re-toned the other has to move with it.
    //
    // The lower half is also what the environment map returns as "ground", so
    // cooling it cools the bounce light every interior surface receives. That
    // is the point: the sun stays warm, and warm light on a cool ambient is
    // what separates daylight from an overcast afternoon.
    sky.addColorStop(0, '#7ba0c6');
    sky.addColorStop(0.28, '#a4bcd6');
    sky.addColorStop(0.44, '#c8d5e0');
    sky.addColorStop(0.5, '#e4e8ec');
    sky.addColorStop(0.58, '#e2e6eb');
    sky.addColorStop(0.78, '#dee2e8');
    sky.addColorStop(1, '#d9dee5');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  skyCache = tex;
  return tex;
}

let envCache: THREE.Texture | null = null;

/**
 * The sky, pre-filtered for image-based lighting.
 *
 * This is the change that decides whether the house looks like a house.
 *
 * A `MeshStandardMaterial` lit only by lights is not a physical surface — it is
 * a diffuse colour multiplied by a cosine. What makes plaster read as plaster
 * and a window frame as a window frame is everything the lighting equations
 * deliberately leave out: the dim blue light a north wall receives from the whole
 * sky at once, the warm bounce a wall receives off the lawn, the grazing
 * highlight that travels across a surface as the camera moves. All of that is
 * `scene.environment`, and all of it was absent — the comment above used to say
 * the ambient "comes from the environment map instead" while no environment map
 * existed anywhere in the scene.
 *
 * A PMREM is required rather than the raw equirectangular canvas: roughness in
 * a PBR shader indexes a pre-blurred mip chain, and sampling a single sharp
 * image at every roughness makes every rough surface sparkle with aliasing.
 * `PMREMGenerator` builds exactly that chain. It runs once, on a 256×128
 * source, which costs a few milliseconds and then nothing per frame.
 *
 * Gate: this is the one genuinely expensive thing in the frame, because it is a
 * lookup per pixel per fragment. On a GPU it is free. Under SwiftShader — which
 * is what the automated suite drives — it is not, so `Scene` only sets it when
 * the renderer reports something other than a software rasteriser.
 */
export function environmentFromSky(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  if (envCache) return envCache;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    // The sky is already an sRGB canvas; compiling it into the equirect input
    // is what PMREM wants, and from then on the chain is linear.
    const source = pmrem.fromEquirectangular(skyTexture());
    envCache = source.texture;
    pmrem.dispose();
    return envCache;
  } catch {
    // A driver without float render targets cannot build a PMREM chain. That
    // is a legitimate outcome, not a failure: the scene falls back to lights.
    return null;
  }
}

/** Drop the cached environment, so it can be rebuilt against a new renderer. */
export function disposeEnvironment(): void {
  envCache?.dispose();
  envCache = null;
}

// ──────────────────────────────────────────────────────────────── geometry ───

const primitiveCache = new Map<string, THREE.BufferGeometry>();

/**
 * The geometry for one part, shared by every identical part.
 *
 * A furnished house is a few hundred meshes, and most of them are the same
 * box or the same cushion. One geometry per mesh is a few hundred GPU buffers
 * for no visual gain — and it is the geometry, not the draw call, that
 * dominates memory once the scene has any detail in it.
 */
export function primitiveGeometry(
  shape: 'box' | 'cylinder' | 'sphere' | undefined,
  w: number,
  h: number,
  d: number,
  round = 0,
): THREE.BufferGeometry {
  if (shape === undefined && round > 0) return roundedBoxGeometry(w, h, d, round);
  const key = `${shape ?? 'box'}|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  const cached = primitiveCache.get(key);
  if (cached) return cached;
  const geom =
    shape === 'cylinder'
      ? new THREE.CylinderGeometry(w / 2, w / 2, h, 24, 1)
      : shape === 'sphere'
        ? new THREE.SphereGeometry(w / 2, 20, 14)
        : new THREE.BoxGeometry(w, h, d);
  primitiveCache.set(key, geom);
  return geom;
}

const roundedCache = new Map<string, THREE.BufferGeometry>();

/**
 * A bevelled box.
 *
 * A perfectly sharp cube is the single clearest tell that a render is made of
 * primitives: real furniture has a highlight that rolls around an edge, and a
 * 90° corner has no room for one. Bevelling by a couple of centimetres is what
 * lets a cushion, a mattress or a cabinet read as a made object.
 *
 * Built by extruding a rounded rectangle and creasing the normals back to hard
 * edges, so the bevel shades as a distinct facet rather than smearing the
 * normals across it.
 */
export function roundedBoxGeometry(w: number, h: number, d: number, radius = 0.02): THREE.BufferGeometry {
  const r = Math.max(0.002, Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}`;
  const cached = roundedCache.get(key);
  if (cached) return cached;

  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-3, d - r * 2),
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: r,
    bevelThickness: r,
    curveSegments: 2,
  });
  geom.center();
  toCreasedNormals(geom, 0.6);
  roundedCache.set(key, geom);
  return geom;
}
/**
 * A tiny deterministic random number generator.
 *
 * The generator is allowed to make choices — which room goes where, where a
 * piece of furniture sits — but it must make the *same* choices every time
 * the same brief is typed. An agent that re-opens the app has to be looking at
 * the same drawing it saw last time, or "it passed yesterday" means nothing.
 *
 * So the seed is a hash of the brief, and the generator never asks for
 * randomness outside this file.
 */

/** FNV-1a, which is short and spreads well enough for a seed. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — one number per call, uniformly in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy. The original is untouched. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/**
 * Rectangle arithmetic.
 *
 * Everything the checker needs to know about two rooms — do they overlap, do
 * they share a wall, is a piece of furniture in a doorway — is a question
 * about rectangles. So the questions are asked here, once, and the answers
 * are exact rather than approximate.
 */

import type { Rect } from './types';

/** How close two numbers have to be to count as the same number, in metres. */
export const EPS = 0.02;

export function area(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.depth);
}

export function right(r: Rect): number {
  return r.x + r.width;
}

export function bottom(r: Rect): number {
  return r.y + r.depth;
}

export function centre(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.depth / 2 };
}

/** The area two rectangles have in common. */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const d = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  if (w <= 0 || d <= 0) return 0;
  return w * d;
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x - EPS && x <= right(r) + EPS && y >= r.y - EPS && y <= bottom(r) + EPS;
}

/** A wall two rooms have in common. */
export interface SharedEdge {
  /** 'vertical' walls run north–south; 'horizontal' walls run east–west. */
  axis: 'vertical' | 'horizontal';
  /** The line the wall stands on. */
  at: number;
  /** The ends of the shared stretch, along the wall. */
  from: number;
  to: number;
  /** How long the shared stretch is. */
  length: number;
}

/**
 * The wall two rooms have in common, if any.
 *
 * Two rooms share a wall when one of them ends exactly where the other
 * begins and their spans along that wall overlap by enough to put a door in.
 * The 0.5 m floor stops a doorway from being cut across a corner, where the
 * frame would stick out into the room next door.
 */
export function sharedEdge(a: Rect, b: Rect, minLength = 0.5): SharedEdge | null {
  const vertical =
    Math.abs(right(a) - b.x) < EPS ? { at: right(a) } : Math.abs(right(b) - a.x) < EPS ? { at: a.x } : null;
  if (vertical) {
    const from = Math.max(a.y, b.y);
    const to = Math.min(bottom(a), bottom(b));
    if (to - from >= minLength) {
      return { axis: 'vertical', at: vertical.at, from, to, length: to - from };
    }
  }

  const horizontal =
    Math.abs(bottom(a) - b.y) < EPS
      ? { at: bottom(a) }
      : Math.abs(bottom(b) - a.y) < EPS
        ? { at: a.y }
        : null;
  if (horizontal) {
    const from = Math.max(a.x, b.x);
    const to = Math.min(right(a), right(b));
    if (to - from >= minLength) {
      return { axis: 'horizontal', at: horizontal.at, from, to, length: to - from };
    }
  }

  return null;
}

/** The rectangle cut out of `r` by removing `cut`. */
export function subtract(r: Rect, cut: Rect): Rect {
  const w = Math.min(right(r), right(cut)) - Math.max(r.x, cut.x);
  const d = Math.min(bottom(r), bottom(cut)) - Math.max(r.y, cut.y);
  if (w <= 0 || d <= 0) return { x: r.x, y: r.y, width: r.width, depth: r.depth };
  // Take the bite out of whichever side is nearest, so the remainder stays
  // one clean rectangle rather than two awkward ones.
  const biteLeft = cut.x - r.x;
  const biteRight = right(r) - right(cut);
  const biteTop = cut.y - r.y;
  const biteBottom = bottom(r) - bottom(cut);
  const smallest = Math.min(biteLeft, biteRight, biteTop, biteBottom);
  const clamped = (value: number) => Math.max(0, value);
  if (smallest === biteLeft) {
    return {
      x: cut.x + cut.width,
      y: r.y,
      width: clamped(r.width - cut.width),
      depth: r.depth,
    };
  }
  if (smallest === biteRight) {
    return { x: r.x, y: r.y, width: clamped(right(r) - cut.x), depth: r.depth };
  }
  if (smallest === biteTop) {
    return {
      x: r.x,
      y: cut.y + cut.depth,
      width: r.width,
      depth: clamped(r.depth - cut.depth),
    };
  }
  return { x: r.x, y: r.y, width: r.width, depth: clamped(bottom(r) - cut.y) };
}

/** A rectangle with the same centre and the given size. */
export function centredOn(r: Rect, width: number, depth: number): Rect {
  const c = centre(r);
  return { x: c.x - width / 2, y: c.y - depth / 2, width, depth };
}

/** Round to millimetres, so two runs of the same maths print the same number. */
export function mm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

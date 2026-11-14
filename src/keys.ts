/**
 * Shared keyboard policy.
 *
 * Two things must not be answered twice, in two places that can drift.
 *
 * `isTypingTarget` used to be private to `main.tsx`, which the 3D view cannot
 * import: that file is the entry point and calls `createRoot`, so importing it
 * would mount a second copy of the entire application. The camera controllers
 * therefore had no way to ask "is the user typing?", and did not — which meant
 * typing `wasd` into the brief's own text fields also walked the viewer through
 * their own house.
 *
 * `MOVEMENT_CODES` is the other half. These are the codes a first-person camera
 * owns, and the editor shortcut table has to know it so it can stand aside.
 */

/**
 * Whether an event came from somewhere the user is typing text.
 *
 * `SELECT` counts because a dropdown is a text entry for every assistive
 * technology, and `isContentEditable` because a rich-text field is a `<div>`.
 */
export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

/** Key codes the first-person cameras drive. */
export const MOVEMENT_CODES: ReadonlySet<string> = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
]);

/**
 * Codes whose browser default is scrolling or caret movement rather than walking.
 *
 * Held down in a first-person camera, an arrow key scrolls the assistant panel
 * behind the canvas and a held `S` scrolls it forever, while the camera walks
 * forward as if nothing happened. Suppressed rather than left, because in a
 * camera mode the panel is behind the user, not what they are reading.
 */
export const SCROLL_CODES: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);
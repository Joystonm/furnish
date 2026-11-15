/**
 * Transient messages.
 *
 * Errors are worded by the operation that produced them, so the toast does not
 * need to invent anything — it just has to be readable and dismissable. Errors
 * linger longer than confirmations because they usually carry something the
 * user needs to act on.
 *
 * `warning` is the awkward one, and the reason it exists as a kind rather than
 * an `info` in a louder font: it is the tone for something that SUCCEEDED but
 * is not what the user would assume happened. The room-program fallback is the
 * case that matters — Furnish produced a perfectly good plan that no model
 * designed, and `success` there would be a lie the user only finds out about
 * later. It is styled apart from both success and error so it cannot be
 * skimmed past as either.
 */
import { useEffect } from 'react';
import { useProject, type Toast } from '../store/useProject.ts';

const LIFETIME = { info: 3200, success: 2600, warning: 11000, error: 7000 } as const;

export function Toasts() {
  const toasts = useProject((s) => s.toasts);
  return (
    // Above the onboarding scrim, which is `z-50` and covers the whole screen.
    // A refusal is no use to anyone if the modal it was triggered from hides
    // it — clicking "Generate the plan" on a plot too small to build on has to
    // say so where the user is already looking.
    //
    // The rows themselves take no clicks: a toast must never swallow a click
    // meant for the dialog underneath it. Only the dismiss button is
    // clickable.
    <div className="pointer-events-none fixed bottom-11 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" data-testid="toasts">
      {toasts.map((t) => (
        <ToastRow key={t.id} id={t.id} kind={t.kind} message={t.message} />
      ))}
    </div>
  );
}

function ToastRow({ id, kind, message }: { id: string; kind: Toast['kind']; message: string }) {
  const dismiss = useProject((s) => s.dismissToast);

  useEffect(() => {
    // The clock starts when the toast has been *painted*, not when it was
    // created and not when it was committed to the DOM.
    //
    // A plain timer from the commit measures the wrong thing: it counts the
    // milliseconds the browser spent unable to paint. Generating a plan keeps
    // the main thread busy for seconds — the rooms, the walls, the 3D scene —
    // and a 3.2 s timer started at commit expires in the middle of that. The
    // toast is then removed at the very moment the page becomes usable again,
    // so the user reads a message that was never on screen.
    //
    // That is not a theoretical failure. It is what the end-to-end run caught,
    // every time: the toast was in the DOM, the page was frozen, and the
    // timer fired the moment the page woke up. The earlier fix — timing from
    // the row's mount rather than from the store's push — narrowed the window
    // but did not close it, because the commit is not the paint either.
    //
    // Two frames are needed rather than one: the first rAF callback runs
    // *before* the paint, the second after it, so by the time the timer is
    // armed there has been a frame in which the toast could be seen.
    //
    // A backgrounded tab never fires rAF, so the toast waits there instead of
    // expiring unseen, and is dismissed a few seconds after the tab is
    // brought back — which is the right answer for a message that was missed.
    let timer = 0;
    let first = 0;
    let second = 0;
    first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        timer = window.setTimeout(() => dismiss(id), LIFETIME[kind]);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearTimeout(timer);
    };
  }, [id, kind, dismiss]);

  // A coloured hairline plus a colour-matched wash behind the text. The wash
  // is what separates a warning from an error at a glance without putting
  // either on a saturated fill that would shout over the plan.
  const tone =
    kind === 'error' ? 'border-danger/25 bg-danger/[0.06] text-danger'
    : kind === 'success' ? 'border-ok/25 bg-ok/[0.06] text-ok'
    : kind === 'warning' ? 'border-warn/30 bg-warn/[0.08] text-warn'
    : 'border-line text-inkSoft';

  return (
    <div className={`slide-up pointer-events-none flex max-w-lg items-start gap-2.5 rounded-card border bg-surface/95 px-3.5 py-2.5 shadow-pop backdrop-blur-md ${tone}`}>
      <span className="min-w-0 flex-1 text-[13px] leading-snug">{message}</span>
      <button className="-mr-1 mt-px shrink-0 cursor-pointer pointer-events-auto rounded-control p-1 text-inkFaint transition-colors hover:bg-raised hover:text-ink" onClick={() => dismiss(id)} aria-label="Dismiss">
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
          <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
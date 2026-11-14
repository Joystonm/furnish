/**
 * The landing page.
 *
 * The studio is the product; this page has one job, which is to earn the trip
 * into it. Two rules shaped every word below.
 *
 * **No invented product.** There is no stock dashboard screenshot, no fake
 * testimonial, no metric nobody measured, and no feature the studio does not
 * have. The plan in the hero is generated in this browser, on this page, by the
 * same `generateFromBrief` the studio calls — see `samplePlan.ts`. Where the
 * product has limits, this page states them instead of hiding them, because a
 * buyer who finds them out later is worse for the product than one who was told.
 *
 * **No webfont.** The README promises that plans never leave the device; a
 * Google Fonts request would hand every visitor's IP to a third party the
 * moment this page loads, which would make that promise untrue for anyone who
 * arrived from a link. The system sans stack costs nothing and asks nothing.
 *
 * Everything is styled from the tokens in `tailwind.config.js`, so the landing
 * page and the studio are the same product on the same day.
 */
import { useMemo, type ReactNode } from 'react';
import { navigate, PROJECTS_PATH } from '../router.ts';
import { buildSamplePlan } from './samplePlan.ts';

export function Home() {
  const sample = useMemo(() => buildSamplePlan(), []);

  return (
    // The scroll container is this element rather than the document, because
    // `html, body, #root` are all `height: 100%` for the studio. It also makes
    // the sticky header work against this element, which is the nearest
    // scrolling ancestor.
    <div className="h-full overflow-y-auto bg-paper text-ink">
      <SiteHeader />

      <main>
        <Hero sample={sample} />
        <HowItWorks />
        <Capabilities />
        <AssistantBand />
        <HonestLimits />
        <ClosingCta />
      </main>

      <SiteFooter />
    </div>
  );
}

// ────────────────────────────────────────────────────────────── the page ───────

function Hero({ sample }: { sample: ReturnType<typeof buildSamplePlan> }) {
  return (
    <section className="relative overflow-hidden">
      {/* One soft wash behind the fold. A gradient mesh was the first instinct
          and it is the wrong one: this is a drafting tool that argues for its
          seriousness with hairlines and whitespace, not with a backdrop. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[380px] opacity-70"
        style={{
          // `accent-soft`, written out because a gradient cannot be composed
          // from utility classes without an arbitrary-value escape.
          background: 'radial-gradient(60rem 24rem at 50% -8rem, #E6F4F1 0%, rgba(247,248,250,0) 70%)',
        }}
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:gap-12 lg:pb-20 lg:pt-16">
        <div>
          <span className="chip border-accent/25 bg-accent-soft text-accent-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            AI Home Design Studio
          </span>

          <h1 className="mt-5 text-[34px] font-semibold leading-[1.06] tracking-[-0.03em] sm:text-[44px] lg:text-[50px]">
            Describe your home.
            <br />
            Get a floor plan you can
            <span className="text-accent"> actually edit.</span>
          </h1>

          <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-inkSoft">
            Furnish turns a short brief into a dimensioned plan — rooms, walls, doors and windows — then gets out
            of the way. Draw over it, walk through it in 3D, run the checks, and export it as SVG, PNG or JSON.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <StudioLink className="btn btn-accent h-10 px-5 text-[14px] font-semibold shadow-raised">
              Open the studio
            </StudioLink>
            <a href="#capabilities" className="btn h-10 px-5 text-[14px]">
              See what&rsquo;s in it
            </a>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-inkFaint">
            <li className="flex items-center gap-1.5">
              <Tick /> No account, no sign-up
            </li>
            <li className="flex items-center gap-1.5">
              <Tick /> Projects stay in your browser
            </li>
            <li className="flex items-center gap-1.5">
              <Tick /> Nothing to install
            </li>
          </ul>
        </div>

        <PlanCard sample={sample} />
      </div>
    </section>
  );
}

/**
 * The hero visual.
 *
 * A plan, drawn by the product. The card is deliberately given a title block
 * and a caption, because a loose drawing in a rounded box reads as decoration
 * and a sheet with a caption reads as the output of a tool.
 */
function PlanCard({ sample }: { sample: ReturnType<typeof buildSamplePlan> }) {
  return (
    <figure className="card overflow-hidden shadow-raised">
      <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
        <div className="flex items-center gap-2">
          <LogoMark className="h-4 w-4 text-accent" />
          <span className="text-[13px] font-medium text-ink">Ground floor</span>
        </div>
        <span className="chip">{sample ? `${sample.storeys} storeys` : '—'}</span>
      </div>

      {sample ? (
        <>
          {/*
            The drawing sits in a box of fixed height rather than being sized by
            its own aspect ratio. The sample plot is nearly square, so letting the
            SVG fill a half-width column made it taller than the box and set the
            height of the entire hero. `preserveAspectRatio` centres it inside
            the box instead, so the card is the same size whatever it is drawing.
          */}
          <div className="flex h-[300px] items-center justify-center bg-raised px-5 py-4 sm:h-[330px]">
            <svg
              viewBox={sample.viewBox}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={`A generated ground floor plan for a ${sample.plotWidthM} by ${sample.plotDepthM} metre plot, with ${sample.roomCount} rooms totalling ${sample.floorAreaM2.toFixed(0)} square metres.`}
              className="h-full w-auto max-w-full drop-shadow-sm"
              dangerouslySetInnerHTML={{ __html: sample.inner }}
            />
          </div>
          <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line bg-surface px-5 py-3">
            <p className="max-w-xs text-[12px] leading-snug text-inkSoft">
              Generated on this page, in your browser, by the same engine the studio uses — the sample house the studio can
              load.
            </p>
            <p className="font-mono text-[12px] tabular-nums text-inkFaint">
              {sample.plotWidthM} × {sample.plotDepthM} m · {sample.roomCount} rooms ·{' '}
              {sample.floorAreaM2.toFixed(0)} m²
            </p>
          </figcaption>
        </>
      ) : (
        /* If the generator ever fails, say so rather than shipping an empty
           frame that reads as a bug in the layout. */
        <div className="flex h-64 items-center justify-center bg-raised px-6 text-center text-[13px] text-inkSoft">
          The sample plan could not be generated in this browser. The studio itself still works — open it and
          press Generate.
        </div>
      )}
    </figure>
  );
}

const STEPS = [
  {
    title: 'Write the brief',
    body: 'Plot size, setbacks, how many storeys, and which rooms you want. One screen, everything visible at once, with the room list and the plot side by side — not a questionnaire.',
  },
  {
    title: 'Get a real plan',
    body: 'A deterministic packer places the rooms and builds the walls, doors and windows between them. Same brief in, same plan out — the geometry is computed, not written by a model.',
  },
  {
    title: 'Take it over',
    body: 'Drag a wall, resize a room, redraw anything. Then switch to 3D and walk the thing you just drew. The plan is the document; you are the author.',
  },
];

function HowItWorks() {
  return (
    <Section id="how" eyebrow="How it works" title="Three steps, and none of them is a wait.">
      <ol className="grid gap-5 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="card p-6">
            <span className="font-mono text-[12px] tabular-nums text-accent">{String(i + 1).padStart(2, '0')}</span>
            <h3 className="mt-3 text-[16px] font-semibold tracking-[-0.01em]">{step.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-inkSoft">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

interface Feature {
  title: string;
  body: string;
  icon: ReactNode;
}

const ICON = 'h-5 w-5 shrink-0';

const FEATURES: Feature[] = [
  {
    title: 'An editor, not a picture',
    body: 'Drag, resize and rotate rooms. Redraw walls. Place doors, windows, stairs and furniture. Every change is a validated operation with undo behind it.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={ICON}>
        <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
        <path d="M3.5 10h9V3.5M12.5 20.5v-9h8" />
      </svg>
    ),
  },
  {
    title: 'Two views, one model',
    body: 'The 3D building and the 2D plan are the same object seen twice. Move a wall in one and it moves in the other — there is no sync layer, because there is only one document.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={ICON}>
        <path d="M12 3.5 21 8v8l-9 4.5L3 16V8z" />
        <path d="M3 8l9 4.5L21 8M12 12.5V20.5" />
      </svg>
    ),
  },
  {
    title: 'Walk through it',
    body: 'Orbit the whole building, look straight down, or take a first-person walk with real collision against walls and furniture. Drop the camera inside a room to see it at eye level. Escape leaves any camera.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={ICON}>
        <circle cx="13" cy="4.2" r="1.9" />
        <path d="M13 7v5l3.5 2.5M13 12l-3.5 3M13 16.5l-2.5 4M13 16.5l3 3.5" />
      </svg>
    ),
  },
  {
    title: 'Trace a plan you already have',
    body: 'Photograph an existing floor plan, calibrate against one known dimension, and the lines come back as rooms. Detections it is unsure of arrive as checkboxes, so you confirm them rather than trusting them.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={ICON}>
        <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
        <path d="M8.5 12.5h7" strokeDasharray="1.6 2" />
      </svg>
    ),
  },
  {
    title: 'Checks that offer the fix',
    body: 'Deterministic, model-free checks on the geometry: a room too small for what it holds, a door with no route to it, circulation that dead-ends. Each one comes with a correction you can apply in a click, then re-checked.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={ICON}>
        <path d="M12 3.2 19.4 6v6.1c0 4.2-3 7.2-7.4 8.7-4.4-1.5-7.4-4.5-7.4-8.7V6z" />
        <path d="m9 12 2.2 2.2L15.2 10" />
      </svg>
    ),
  },
  {
    title: 'Exports that actually open',
    body: 'A millimetre-accurate SVG that opens in any browser, vector editor or CAD program. A PNG of the plan, a PNG of the 3D view, and JSON that re-imports into the same app — verified, not assumed.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={ICON}>
        <path d="M12 3.5v11M8.2 10.8 12 14.6l3.8-3.8" />
        <path d="M4.5 16v2.5A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 2-2V16" />
      </svg>
    ),
  },
];

function Capabilities() {
  return (
    <Section id="capabilities" eyebrow="What's in it" title="A drafting tool, with an assistant attached.">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <article key={f.title} className="card p-6 transition-shadow hover:shadow-panel">
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-accent-soft text-accent-ink">
              {f.icon}
            </div>
            <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{f.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-inkSoft">{f.body}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}

/**
 * The assistant, on a dark band.
 *
 * This is the claim most likely to be wrong in someone else's product, so it
 * gets its own section rather than a bullet. Everything here is a property of
 * the implementation: the model emits typed tool calls, the registry validates
 * them against the model, areas are computed by formula, destructive tools ask
 * first, and a turn that changes nothing says so.
 */
function AssistantBand() {
  return (
    <section className="bg-ink text-paper">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:py-24">
        <div>
          <span className="chip border-white/15 bg-white/5 text-white/70">The assistant</span>
          <h2 className="mt-6 text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[38px]">
            It edits the same editor you do.
          </h2>
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-white/70">
            Ask for a room and Furnish plans the change, checks the plan against the model, and runs it through
            the same operations you use by hand — with the progress on screen as it goes.
          </p>
        </div>

        <ul className="space-y-5">
          {[
            {
              t: 'It cannot write code or bypass the rules',
              d: 'The model reaches the design through typed tools. It has no way to execute anything, loosen a validation, invent an object id, or apply a change the operations reject.',
            },
            {
              t: 'Areas are measured, not asserted',
              d: 'The model may ask for a calculation. It may never supply the answer — every area, total and ratio comes from the geometry by formula.',
            },
            {
              t: 'Destructive operations ask first',
              d: 'The two operations that delete things do not run on a turn. They prompt, and nothing happens until you say yes.',
            },
            {
              t: 'If nothing changed, it says so',
              d: 'A design request answered in prose with no operations behind it gets reported as no change. The panel will not claim it edited your plan when it did not.',
            },
          ].map((row) => (
            <li key={row.t} className="flex gap-3.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-soft">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-3 w-3">
                  <path d="m3.5 8.5 3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-white">{row.t}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-white/60">{row.d}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const LIMITS = [
  {
    t: 'Concept stage, not a permit',
    d: 'A generated plan is early-design geometry. It is not construction-ready and nobody has certified it. Treat it as a starting drawing, not as a set of building instructions.',
  },
  {
    t: 'Constraints are sanity bounds, not law',
    d: 'The thresholds the checks enforce are configurable defaults, not the rules of any jurisdiction. Furnish does not know where you are and does not claim compliance with anything.',
  },
  {
    t: 'No account, no cloud, no sync',
    d: 'Projects are saved in the browser that made them. There is no login, no server-side copy, and nothing to sync between devices. Clearing site data clears your projects.',
  },
  {
    t: 'SVG, PNG and JSON — and that is the list',
    d: 'No PDF, no DXF, no IFC. The 3D capture is a PNG of the live canvas. If you need a format that is not here, it does not exist yet.',
  },
  {
    t: 'A desktop tool',
    d: 'The studio is laid out for a wide screen with a mouse or a trackpad. There is no phone or tablet layout, and pretending otherwise on a page you read on a phone would be a poor start.',
  },
  {
    t: 'Furniture is massing, not product',
    d: 'A sofa is a seat, a back, arms and cushions. Nothing is a specific real product, and nothing here is a licensed asset.',
  },
];

function HonestLimits() {
  return (
    <Section
      id="limits"
      eyebrow="Straight answers"
      title="What it is, and what it isn't."
      lede="Every product page lists only the good parts. Here is the other half, so you can decide whether this is the right tool before you spend an afternoon in it."
    >
      <div className="grid gap-x-8 gap-y-7 md:grid-cols-2">
        {LIMITS.map((l) => (
          <div key={l.t} className="border-t border-line pt-5">
            <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{l.t}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-inkSoft">{l.d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ClosingCta() {
  return (
    <section className="border-t border-line bg-surface">
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h2 className="text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-[42px]">
          Start with a plot and a room list.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-[16px] leading-relaxed text-inkSoft">
          The studio opens in your browser, keeps your work on your machine, and does not ask you to create an
          account to find out whether it is any good.
        </p>
        <StudioLink className="btn btn-accent mx-auto mt-9 h-12 px-7 text-[15px] font-semibold shadow-raised">
          Open the studio
        </StudioLink>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────── chrome ────────

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <a href="/" className="flex items-center gap-2.5">
          <LogoMark className="h-5 w-5 text-accent" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Furnish</span>
        </a>

        <nav className="hidden items-center gap-7 text-[14px] text-inkSoft sm:flex">
          <a href="#how" className="transition-colors hover:text-ink">
            How it works
          </a>
          <a href="#capabilities" className="transition-colors hover:text-ink">
            Features
          </a>
          <a href="#limits" className="transition-colors hover:text-ink">
            What it isn&rsquo;t
          </a>
        </nav>

        <StudioLink className="btn h-9 px-4 text-[13px] font-semibold">Open the studio</StudioLink>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-[13px] text-inkFaint sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2.5">
          <LogoMark className="h-4 w-4 text-inkFaint" />
          <span className="font-medium text-inkSoft">Furnish</span>
          <span>· AI Home Design Studio</span>
        </div>
        <p className="max-w-xl leading-relaxed">
          Built from scratch by studying two public Devpost projects — Alza and ArchMorph — and writing
          everything here. No third-party code, floor plans or assets are reused. Your projects are at{' '}
          <span className="font-mono text-inkSoft">{PROJECTS_PATH}</span>.
        </p>
      </div>
    </footer>
  );
}

// ────────────────────────────────────────────────────────────── pieces ────────

/**
 * A real link to the studio that navigates without reloading the bundle.
 *
 * It points at the dashboard rather than the editor: someone arriving from a
 * link has a project they have never seen, not one in mind, and the studio
 * opens by restoring whatever was last open — which is not necessarily what
 * they came for.
 *
 * It keeps the `href`, so the route is copyable, openable in a new tab and
 * announced correctly — `navigate()` is an enhancement, not a replacement.
 */
function StudioLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <a
      href={PROJECTS_PATH}
      className={className}
      onClick={(e) => {
        // Let the browser handle anything the user asked for that this cannot.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(PROJECTS_PATH);
      }}
    >
      {children}
    </a>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-accent">{eyebrow}</p>
        <h2 className="mt-3 max-w-2xl text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[38px]">
          {title}
        </h2>
        {lede && <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-inkSoft">{lede}</p>}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/** The house mark, matching the one in the toolbar and the favicon. */
function LogoMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" className={className} aria-hidden>
      <path
        d="M4 12.5V8.6l5-3.4 5 3.4v3.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-3.5 w-3.5 text-accent">
      <path d="m3.5 8.5 3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cool neutral greys with one teal accent. The greys are deliberately
        // desaturated and blue-leaning rather than warm: the 2D plan and the 3D
        // render are both cool, and a warm chrome fought both of them.
        //
        // `paper` is the page, `surface` the panels sitting on it, `raised` the
        // third step — inputs, cards, and hover fills. Three steps is enough to
        // build depth without the stack of near-identical greys a larger scale
        // would invite.
        paper: '#F7F8FA',
        surface: '#FFFFFF',
        raised: '#F1F3F6',
        line: '#E3E7EC',
        lineStrong: '#CBD3DD',
        ink: '#0F172A',
        inkSoft: '#475569',
        inkFaint: '#94A3B8',
        // `muted` is an alias, not a new colour. It exists because the style
        // popover reached for it and it was never defined, which left that text
        // and the selected style row rendering with no colour at all.
        muted: '#94A3B8',
        accent: {
          DEFAULT: '#0D9488',
          soft: '#E6F4F1',
          ink: '#0F766E',
        },
        ok: '#059669',
        warn: '#D97706',
        danger: '#DC2626',
      },
      fontFamily: {
        // No webfont is loaded, on purpose: the README promises that plans never
        // leave the device, and a Google Fonts request would send every visitor's
        // IP to a third party to render a label. `system-ui` is a good modern UI
        // face on every platform that matters and is already installed.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        // Controls were `rounded` (4px), which reads as 2015-era utility. 8px on
        // anything you click and 12px on anything that holds other things is the
        // difference between a form and a product.
        control: '8px',
        card: '12px',
      },
      boxShadow: {
        // Two-layer shadows: a tight contact shadow plus a wide diffuse one.
        // A single hard shadow is what makes flat UI look cheap.
        panel: '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px -2px rgba(15,23,42,0.06)',
        pop: '0 2px 4px rgba(15,23,42,0.04), 0 12px 32px -8px rgba(15,23,42,0.16)',
        raised: '0 1px 3px rgba(15,23,42,0.06), 0 8px 24px -8px rgba(15,23,42,0.12)',
        ring: '0 0 0 3px rgba(13,148,136,0.16)',
      },
      transitionTimingFunction: {
        // A slight overshoot-free ease-out. Snappier than Tailwind's default on
        // the way in, which is what makes UI feel responsive rather than damped.
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px) scale(0.99)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out both',
        'slide-up': 'slide-up 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-in': 'pop-in 140ms cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
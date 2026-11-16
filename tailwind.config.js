/** @type {import('tailwindcss').Config} */
// The pages' colours, from their one source (src/renderer/lib/page-colors.js).
const { PAGE_COLORS } = require('./src/renderer/lib/page-colors');
module.exports = {
  darkMode: 'class',
  // Scan the renderer SOURCES, never the generated root app.js: that bundle
  // is gitignored (#1052) and `build:css` runs before `build-renderer` in the
  // prebuild hooks, so on CI's fresh checkout it doesn't exist yet. Scanning
  // it shipped v0.9.10 with ~10KB of CSS and an unstyled window (#1160).
  content: [
    './index.html',
    './src/renderer/**/*.js',
    './resolution-scheduler.js',
    './musickit-web.js',
    './resolver-loader.js',
    './scrobbler-loader.js'
  ],
  theme: {
    extend: {
      // Theme tokens as Tailwind colours (#1383 step 4). Each reads a CSS
      // variable from index.html with a light and a dark value, so a page
      // written with these needs no .dark remap. Prefer them to palette
      // classes (text-gray-500, bg-purple-600, ...) in new code.
      colors: {
        ink: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          success: 'var(--text-success)',
          warning: 'var(--text-warning)',
          danger: 'var(--text-danger)',
          info: 'var(--text-info)',
          'on-accent': 'var(--on-accent)',
          faint: 'var(--icon-faint)',
        },
        surface: {
          page: 'var(--bg-primary)',
          card: 'var(--bg-elevated)',
          subtle: 'var(--bg-secondary)',
          inset: 'var(--bg-inset)',
          hover: 'var(--hover-bg-default)',
          placeholder: 'var(--placeholder-bg)',
        },
        line: {
          DEFAULT: 'var(--border-default)',
          light: 'var(--border-light)',
          strong: 'var(--border-strong)',
          danger: 'var(--border-danger)',
          'danger-hover': 'var(--border-danger-hover)',
        },
        accent: {
          DEFAULT: 'var(--accent-primary)',
          fill: 'var(--accent-fill)',
          'fill-hover': 'var(--accent-fill-hover)',
          tint: 'var(--accent-primary-alpha-10)',
          'tint-hover': 'var(--accent-primary-alpha-15)',
        },
        control: { off: 'var(--control-off)', knob: 'var(--control-knob)' },
        // Text and fills on the always-dark surfaces (the playbar, the queue
        // drawer, the AI panels): the same in both themes.
        'on-dark': {
          primary: 'var(--on-dark-primary)',
          secondary: 'var(--on-dark-secondary)',
          tertiary: 'var(--on-dark-tertiary)',
          disabled: 'var(--on-dark-disabled)',
          love: 'var(--on-dark-love)',
          'love-hover': 'var(--on-dark-love-hover)',
          success: 'var(--on-dark-success)',
          info: 'var(--on-dark-info)',
          star: 'var(--on-dark-star)',
          'star-hover': 'var(--on-dark-star-hover)',
        },
        'surface-dark': { placeholder: 'var(--surface-dark-placeholder)' },
        // A page's colour as a class (text-page-concerts): the hex lives
        // only in lib/page-colors.js.
        page: { concerts: PAGE_COLORS.concerts.color },
        // Faint status backgrounds behind status text (bg-tint-danger with
        // text-ink-danger): the status colour at 12%, or 20% for hover.
        tint: {
          danger: 'var(--tint-danger)',
          'danger-hover': 'var(--tint-danger-hover)',
          success: 'var(--tint-success)',
          warning: 'var(--tint-warning)',
          info: 'var(--tint-info)',
        },
        status: {
          error: 'var(--fill-error)',
          'error-hover': 'var(--fill-error-hover)',
        },
        teal: {
          100: '#d1fcf4',
          400: '#36dcc8',
          500: '#10c9b4',
          600: '#0eb3a0',
        }
      },
      // Motion tokens (index.html --motion-* / --ease-*, #1450): a plain
      // transition-colors / transition-opacity runs on --motion-fast and the
      // standard easing, duration-base / -slow / -deliberate name the others,
      // and ease-out / ease-in / ease-in-out read the tokens. Reduced motion
      // zeroes the durations in one place.
      transitionDuration: {
        DEFAULT: 'var(--motion-fast)',
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)',
        deliberate: 'var(--motion-deliberate)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease-standard)',
        standard: 'var(--ease-standard)',
        out: 'var(--ease-out)',
        in: 'var(--ease-in)',
        'in-out': 'var(--ease-standard)',
      },
    }
  },
  plugins: []
};

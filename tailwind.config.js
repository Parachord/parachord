/** @type {import('tailwindcss').Config} */
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
      }
    }
  },
  plugins: []
};

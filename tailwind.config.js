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
      colors: {
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

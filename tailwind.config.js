/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './app.js',
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

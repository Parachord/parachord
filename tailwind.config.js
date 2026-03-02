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
    extend: {}
  },
  plugins: []
};

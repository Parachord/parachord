// src/renderer/lib/charts-countries.js: Pop of the Tops' country options:
// ISO codes for the iTunes charts, with the full names Last.fm's
// geo charts take. The chart loaders (app.js) and the page's country menu
// (components/charts-page.js) read it.

const CHARTS_COUNTRIES = [
  { code: 'us', name: 'United States', lastfmName: 'United States' },
  { code: 'gb', name: 'United Kingdom', lastfmName: 'United Kingdom' },
  { code: 'ca', name: 'Canada', lastfmName: 'Canada' },
  { code: 'au', name: 'Australia', lastfmName: 'Australia' },
  { code: 'de', name: 'Germany', lastfmName: 'Germany' },
  { code: 'fr', name: 'France', lastfmName: 'France' },
  { code: 'jp', name: 'Japan', lastfmName: 'Japan' },
  { code: 'kr', name: 'South Korea', lastfmName: 'South Korea' },
  { code: 'br', name: 'Brazil', lastfmName: 'Brazil' },
  { code: 'mx', name: 'Mexico', lastfmName: 'Mexico' },
  { code: 'es', name: 'Spain', lastfmName: 'Spain' },
  { code: 'it', name: 'Italy', lastfmName: 'Italy' },
  { code: 'nl', name: 'Netherlands', lastfmName: 'Netherlands' },
  { code: 'se', name: 'Sweden', lastfmName: 'Sweden' },
  { code: 'pl', name: 'Poland', lastfmName: 'Poland' },
];

module.exports = { CHARTS_COUNTRIES };

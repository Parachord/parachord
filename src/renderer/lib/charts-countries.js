// src/renderer/lib/charts-countries.js: Pop of the Tops' countries: ISO
// codes and their English names, in the order the Region menu lists them. A
// plug-in's manifest names the codes it charts (lib/charts.js); the name goes
// along to getCharts as countryName (Last.fm's geo charts take it).

const CHARTS_COUNTRIES = [
  { code: 'us', name: 'United States' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'ca', name: 'Canada' },
  { code: 'au', name: 'Australia' },
  { code: 'de', name: 'Germany' },
  { code: 'fr', name: 'France' },
  { code: 'jp', name: 'Japan' },
  { code: 'kr', name: 'South Korea' },
  { code: 'br', name: 'Brazil' },
  { code: 'mx', name: 'Mexico' },
  { code: 'es', name: 'Spain' },
  { code: 'it', name: 'Italy' },
  { code: 'nl', name: 'Netherlands' },
  { code: 'se', name: 'Sweden' },
  { code: 'pl', name: 'Poland' },
];

module.exports = { CHARTS_COUNTRIES };

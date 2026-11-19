// src/renderer/lib/charts.js: Pop of the Tops' charts from the plug-ins
// (#1539 step 3).
//
// The page used to fetch Apple's most-played feeds and Last.fm's charts by
// name from app.js. Now a plug-in declares capabilities.charts, says what it
// charts in its manifest's top-level `charts` (resolver.charts: { period?,
// tracks?, albums? }, each kind { global, countries }) and implements
// getCharts({ kind, country, countryName, limit }, config)
// (resolver-loader.js). This module is the pure part: which plug-ins chart a
// kind and in what order, which regions one offers, which region to show, and
// the page's item shape.
//
// Which plug-ins: every installed one with the capability, whether or not it
// is turned on for playing (a chart needs no account; Apple Music is off in a
// new install, and its feed was the page's default), minus one the user
// switched off (its Enable switch, or "Use metadata from"). In the user's
// order, active plug-ins first (orderCatalogResolvers). The page shows the
// first one's chart unless the user picks another; when that automatic pick
// fails, the next one is tried.
//
// Pure; loads under plain Node.

'use strict';

const { orderCatalogResolvers } = require('./album-catalog');

// The page's tabs ('albums', 'songs') to the plug-ins' kinds.
const chartKind = (tab) => (tab === 'songs' ? 'tracks' : 'albums');

function chartProviders(loader, kind, { activeIds = [], order = [], isOff = () => false } = {}) {
  if (!loader || typeof loader.getChartResolvers !== 'function') return [];
  const candidates = loader.getChartResolvers().filter((r) => r.charts && r.charts[kind] && !isOff(r.id));
  return orderCatalogResolvers(candidates, { activeIds, order });
}

// The region menu for one plug-in's chart: Global first when it has one, then
// its countries in the app's order (CHARTS_COUNTRIES gives the names).
function regionOptions(resolver, kind, countries = []) {
  const info = resolver && resolver.charts && resolver.charts[kind];
  if (!info) return [];
  const out = info.global ? [{ value: '', label: 'Global' }] : [];
  for (const c of countries) {
    if (info.countries.includes(c.code)) out.push({ value: c.code, label: c.name });
  }
  return out;
}

// The region to ask for: the wanted one when this plug-in charts it ('' is
// Global), else Global, else the United States, else its first country.
function pickRegion(resolver, kind, wanted) {
  const info = resolver && resolver.charts && resolver.charts[kind];
  if (!info) return null;
  if (wanted === '' && info.global) return '';
  if (wanted && info.countries.includes(wanted)) return wanted;
  if (info.global) return '';
  if (info.countries.includes('us')) return 'us';
  return info.countries[0] || null;
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A plug-in's chart items in the page's shape. Ids are unique per chart (the
// rank is in them) and stable across reloads of the same chart, so cached
// art and track sources line up. An album's `mbid` is its release group's
// (ListenBrainz), which opens the album page without a search.
function chartItems(kind, sourceId, region, items) {
  return (items || []).map((item, index) => {
    const base = {
      id: `chart-${sourceId}-${region || 'global'}-${index}-${slug(item.artist)}-${slug(item.title)}`,
      title: item.title,
      artist: item.artist,
      rank: index + 1,
      albumArt: item.albumArt || undefined,
      url: item.url || undefined,
      genres: Array.isArray(item.genres) ? item.genres : [],
      releaseDate: item.releaseDate || null,
      listens: Number(item.listens) || 0,
      listeners: Number(item.listeners) || 0,
      source: sourceId,
    };
    if (kind === 'albums') return item.mbid ? { ...base, releaseGroupId: item.mbid } : base;
    return { ...base, album: item.album || '', mbid: item.mbid || null };
  });
}

const chartCacheKey = (kind, sourceId, region) => `${kind}:${sourceId}:${region || 'global'}`;

module.exports = { chartKind, chartProviders, regionOptions, pickRegion, chartItems, chartCacheKey };

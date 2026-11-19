/**
 * Pop of the Tops › Tracks: a failed chart fetch (Apple's 504, 2026-11-16)
 * settled `loading` but never `loaded`, so the tab kept its skeleton forever
 * and showed no error. Last.fm had the same bug, and with no Last.fm key it
 * never started. A click on Tracks before the cache was ready started no
 * load at all. The error now wins over "not loaded", each source shows
 * ErrorState with Try again, and an effect starts the load once it can.
 */
const fs = require('fs');
const path = require('path');
const { chartLoadView } = require('../../src/renderer/lib/chart-load-view');

const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages moved out of it (#1451)

describe('chartLoadView', () => {
  test('a load in flight is the skeleton, even after an earlier error', () => {
    expect(chartLoadView({ loading: true, loaded: false })).toBe('skeleton');
    expect(chartLoadView({ loading: true, loaded: false, error: new Error('HTTP 504') })).toBe('skeleton');
  });

  test('a failed load that settled is the error, not the skeleton', () => {
    expect(chartLoadView({ loading: false, loaded: false, error: new Error('HTTP 504: Gateway Time-out') })).toBe('error');
  });

  test('a loaded chart is the list', () => {
    expect(chartLoadView({ loading: false, loaded: true })).toBe('list');
  });

  test('a load not started yet is the skeleton', () => {
    expect(chartLoadView({})).toBe('skeleton');
  });
});

describe('the Tracks tab chart in app.js (any plug-in with charts, #1539)', () => {
  const loader = app.slice(
    app.indexOf('const loadSongsCharts = async'),
    app.indexOf('const fetchSongsChartsAlbumArt = async')
  );

  test('a failure with no cache to fall back on records the error, not a dialog', () => {
    expect(loader).toContain('setSongsChartsError(result.error);');
    expect(loader).not.toMatch(/type: 'error'/);
    expect(loader).not.toMatch(/showConfirmDialog/);
    // A new load clears the last error.
    expect(loader).toMatch(/setSongsChartsLoading\(true\);[\s\S]*?setSongsChartsError\(null\);/);
  });

  test('the Tracks tab shows ErrorState with Try again, and the skeleton only by chartLoadView', () => {
    expect(app).toContain('const songsView = chartLoadView({ loading: songsChartsLoading, loaded: songsChartsLoaded, error: songsChartsError });');
    expect(app).toMatch(/body: errorText\(songsChartsError, /);
    expect(app).toContain('onRetry: () => loadSongsCharts({ forceReload: true })');
    expect(app).toContain("chartsTab === 'songs' && songsView === 'skeleton'");
    expect(app).not.toContain('songsChartsLoading || !songsChartsLoaded');
  });
});

describe('the Tracks tab starts its own load', () => {
  const start = app.indexOf("// Load the Tracks tab's chart once it's showing");
  const effect = app.slice(start, app.indexOf(']);', start) + 3);

  test('an effect loads the chart once the cache, the keys and a plug-in with charts are ready', () => {
    expect(start).toBeGreaterThan(-1);
    expect(effect).toMatch(/cacheLoaded && lastfmKeyLoaded && chartSources\.songs\.length > 0 && !songsChartsLoaded && !songsChartsLoading && !songsChartsError/);
    // It re-runs when the cache, key or a chart plug-in lands, so an early click still loads.
    expect(effect).toMatch(/\[activeView, chartsTab, cacheLoaded, lastfmKeyLoaded, chartSourcesKey,/);
  });

  test('the tab and source pickers no longer start loads themselves (no double fetch)', () => {
    const hero = app.slice(app.indexOf("title: 'Pop of the Tops'"), app.indexOf("label: 'Chart region'"));
    expect(hero).not.toContain('loadSongsCharts(');
    expect(hero).toContain('pickChart(chartsTab, { source: v })');
  });
});

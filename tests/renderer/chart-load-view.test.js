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

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

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

describe('the Apple Music tracks chart in app.js', () => {
  const loader = app.slice(
    app.indexOf('const loadAppleMusicSongsCharts = async'),
    app.indexOf('// Navigate to a Charts album release page')
  );

  test('a failure with no cache to fall back on records the error, not a dialog', () => {
    expect(loader).toContain('setAppleMusicSongsChartsError(error);');
    expect(loader).not.toMatch(/type: 'error'/);
    // A new load clears the last error.
    expect(loader).toMatch(/setAppleMusicSongsChartsLoading\(true\);[\s\S]*?setAppleMusicSongsChartsError\(null\);/);
  });

  test('the Tracks tab shows ErrorState with Try again, and the skeleton only by chartLoadView', () => {
    expect(app).toContain("title: 'Couldn’t load the Apple Music chart'");
    expect(app).toMatch(/body: errorText\(appleMusicSongsChartsError, /);
    expect(app).toContain("onRetry: () => loadAppleMusicSongsCharts({ country: chartsCountry, forceReload: true })");
    expect(app).not.toContain('appleMusicSongsChartsLoading || !appleMusicSongsChartsLoaded');
    expect(app).toMatch(/chartsSongsSource === 'apple' && chartLoadView\(\{[^}]*\}\) === 'skeleton'/);
  });
});

describe('the Last.fm tracks chart in app.js', () => {
  const loader = app.slice(
    app.indexOf('const loadLastfmCharts = async'),
    app.indexOf('const loadAppleMusicSongsCharts = async')
  );

  test('no key and a failure with no cache both settle with an error, not a dialog', () => {
    expect(loader).toMatch(/if \(!apiKey\) \{[\s\S]*?setLastfmChartsError\(userError\([\s\S]*?return;/);
    expect(loader).toContain('setLastfmChartsError(error);');
    expect(loader).not.toMatch(/type: 'error'/);
    expect(loader).toMatch(/setLastfmChartsLoading\(true\);[\s\S]*?setLastfmChartsError\(null\);/);
  });

  test('the Tracks tab shows ErrorState with Try again, and the skeleton only by chartLoadView', () => {
    expect(app).toContain("title: 'Couldn’t load the Last.fm chart'");
    expect(app).toMatch(/body: errorText\(lastfmChartsError, /);
    expect(app).toContain("onRetry: () => loadLastfmCharts({ country: chartsCountry, forceReload: true })");
    expect(app).not.toContain('lastfmChartsLoading || !lastfmChartsLoaded');
    expect(app).toMatch(/chartsSongsSource === 'lastfm' && chartLoadView\(\{[^}]*\}\) === 'skeleton'/);
  });
});

describe('the Tracks tab starts its own load', () => {
  const start = app.indexOf("// Load the Tracks tab's chart once it's showing");
  const effect = app.slice(start, app.indexOf(']);', start) + 3);

  test('an effect loads the shown source once the cache (Apple) or key (Last.fm) is ready', () => {
    expect(start).toBeGreaterThan(-1);
    expect(effect).toMatch(/cacheLoaded && !appleMusicSongsChartsLoaded && !appleMusicSongsChartsLoading && !appleMusicSongsChartsError/);
    expect(effect).toMatch(/lastfmKeyLoaded && !lastfmChartsLoaded && !lastfmChartsLoading && !lastfmChartsError/);
    // It re-runs when the cache or key lands, so an early click still loads.
    expect(effect).toMatch(/\[activeView, chartsTab, chartsSongsSource, cacheLoaded, lastfmKeyLoaded,/);
  });

  test('the tab and source pickers no longer start loads themselves (no double fetch)', () => {
    const hero = app.slice(app.indexOf("title: 'Pop of the Tops'"), app.indexOf("label: 'Chart region'"));
    expect(hero).not.toContain('loadAppleMusicSongsCharts(');
    expect(hero).not.toContain('loadLastfmCharts(');
  });
});

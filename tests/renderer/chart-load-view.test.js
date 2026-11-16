/**
 * Pop of the Tops › Tracks › Apple Music: a failed chart fetch (Apple's 504,
 * 2026-11-16) settled `loading` but never `loaded`, so the tab kept its
 * skeleton forever and showed no error. The error now wins over "not loaded"
 * and the tab shows ErrorState with Try again.
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

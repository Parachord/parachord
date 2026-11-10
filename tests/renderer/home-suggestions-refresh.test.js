/**
 * Shuffleupagus suggestions (now the Recommendations page's titled section)
 * refresh only on the Refresh button by default; "Refresh Shuffleupagus
 * suggestions on every visit" (`home_suggestions_auto_refresh`) brings back a
 * new batch per visit.
 */

const fs = require('fs');
const path = require('path');
const { shouldAutoRefreshHomeSuggestions } = require('../../src/renderer/lib/home-suggestions-refresh');

const cached = { albums: [{ title: 'A', artist: 'B' }], artists: [{ name: 'B' }] };

describe('shouldAutoRefreshHomeSuggestions', () => {
  test('keeps cached suggestions on a visit by default', () => {
    expect(shouldAutoRefreshHomeSuggestions({ autoRefresh: false, suggestions: cached })).toBe(false);
  });

  test('refreshes on every visit when the setting is on', () => {
    expect(shouldAutoRefreshHomeSuggestions({ autoRefresh: true, suggestions: cached })).toBe(true);
  });

  test('fetches when there is nothing to show', () => {
    expect(shouldAutoRefreshHomeSuggestions({ autoRefresh: false, suggestions: null })).toBe(true);
    expect(shouldAutoRefreshHomeSuggestions({ autoRefresh: false, suggestions: { albums: [], artists: [] } })).toBe(true);
    expect(shouldAutoRefreshHomeSuggestions()).toBe(true);
  });

  test('fetches when only artists are cached (the Refresh button lives on the album row)', () => {
    expect(shouldAutoRefreshHomeSuggestions({ autoRefresh: false, suggestions: { albums: [], artists: [{ name: 'B' }] } })).toBe(true);
  });
});

describe('app.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  // The fetch flow (component scope: the auto-fetch effect and the
  // Shuffleupagus section's Refresh button both run it).
  const fnStart = src.indexOf('const fetchAiRecommendations = async () => {');
  const flow = src.slice(fnStart, src.indexOf('useEffect(() => {', fnStart));
  // The auto-fetch trigger effect.
  const effectStart = src.indexOf('// The auto-fetch trigger', fnStart);
  const effect = src.slice(effectStart, src.indexOf('}, [activeView, cacheLoaded, metaServices, recommendationsVisitCount]);', effectStart));

  test('the auto-fetch effect asks the decision before fetching', () => {
    expect(fnStart).toBeGreaterThan(-1);
    expect(effectStart).toBeGreaterThan(-1);
    const gate = effect.indexOf('shouldAutoRefreshHomeSuggestions(');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(effect.indexOf('fetchAiRecommendations();'));
    // The Refresh button path fetches with no decision gate (a manual ask).
    expect(flow).toContain('const result = await loadAiRecommendations(onUpdate);');
  });

  test('the setting is loaded with the critical keys and persisted on toggle', () => {
    expect(src).toMatch(/criticalKeys = \[[\s\S]*'home_suggestions_auto_refresh'/);
    expect(src).toMatch(/store\.set\('home_suggestions_auto_refresh', newValue\)/);
  });
});

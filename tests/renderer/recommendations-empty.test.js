/**
 * parachord#1021: with no ListenBrainz recommendation playlist, the
 * Recommendations page showed the user's own most-played tracks. It now shows
 * nothing from ListenBrainz, and says why when no source has anything.
 */

const fs = require('fs');
const path = require('path');
const { emptyRecommendationsMessage } = require('../../src/renderer/lib/recommendations-empty');

describe('emptyRecommendationsMessage', () => {
  test('names the services the user actually connected', () => {
    expect(emptyRecommendationsMessage(true, false)).toMatch(/^ListenBrainz hasn't made recommendations/);
    expect(emptyRecommendationsMessage(true, false)).toMatch(/connect Last\.fm/);
    expect(emptyRecommendationsMessage(true, true)).toMatch(/^Neither ListenBrainz nor Last\.fm/);
    expect(emptyRecommendationsMessage(false, true)).toMatch(/^Last\.fm doesn't have/);
  });
});

describe('app.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const start = src.indexOf('const loadListenbrainzRecommendations = async');
  const loader = src.slice(start, src.indexOf('const loadWeeklyPlaylists', start));

  test('the ListenBrainz loader no longer falls back to the user\'s top recordings', () => {
    expect(start).toBeGreaterThan(-1);
    expect(loader).not.toMatch(/\/stats\/user\//);
  });

  test('an empty merged result is shown as a message and not cached', () => {
    const i = src.indexOf('if (tracks.length === 0) {', src.indexOf('Merged ${listenbrainzTracks.length} ListenBrainz'));
    const block = src.slice(i, i + 500);
    expect(block).toMatch(/error: emptyRecommendationsMessage\(/);
    expect(block).toMatch(/return;/);
    expect(block.indexOf('return;')).toBeLessThan(block.indexOf('recommendationsCache.current =') === -1 ? Infinity : block.indexOf('recommendationsCache.current ='));
  });
});

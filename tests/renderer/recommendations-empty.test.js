/**
 * parachord#1021: with no ListenBrainz recommendation playlist, the
 * Recommendations page showed the user's own most-played tracks. It now shows
 * nothing from ListenBrainz, and says why when no source has anything.
 *
 * Since the sectioned page (the `recommendations` plugin capability), the
 * message takes an options object; the Last.fm/ListenBrainz fetches moved
 * into their plugins (plugins-src/{lastfm,listenbrainz}/implementation.js).
 */

const fs = require('fs');
const path = require('path');
const { emptyRecommendationsMessage } = require('../../src/renderer/lib/recommendations-empty');

describe('emptyRecommendationsMessage', () => {
  test('names the services the user actually connected', () => {
    expect(emptyRecommendationsMessage({ hasListenbrainz: true, hasLastfm: false })).toMatch(/^ListenBrainz hasn't made recommendations/);
    expect(emptyRecommendationsMessage({ hasListenbrainz: true, hasLastfm: false })).toMatch(/connect Last\.fm/);
    expect(emptyRecommendationsMessage({ hasListenbrainz: true, hasLastfm: true })).toMatch(/^Neither ListenBrainz nor Last\.fm/);
    expect(emptyRecommendationsMessage({ hasListenbrainz: false, hasLastfm: true })).toMatch(/^Last\.fm doesn't have/);
  });

  test('a generic message when neither scrobbler is the provider', () => {
    expect(emptyRecommendationsMessage({ hasListenbrainz: false, hasLastfm: false })).toMatch(/^No recommendations right now/);
    expect(emptyRecommendationsMessage()).toMatch(/^No recommendations right now/);
  });
});

describe('app.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('the ListenBrainz fallback to the user\'s top recordings is gone (the fetch moved to the plugin)', () => {
    expect(src).not.toMatch(/const loadListenbrainzRecommendations/);
    expect(src).not.toMatch(/const loadLastfmRecommendations/);
  });

  test('an empty provider result is shown as a message and not cached', () => {
    const i = src.indexOf('if (!anySections && !llmHas && !anyFriends) {', src.indexOf('const loadRecommendations = async'));
    const block = src.slice(i, i + 700);
    expect(i).toBeGreaterThan(-1);
    expect(block).toMatch(/error: emptyRecommendationsMessage\(/);
    expect(block).toMatch(/return;/);
    // The empty result must be set BEFORE the return and never cached as a
    // provider result (the next visit asks again).
    expect(block.indexOf('return;')).toBeLessThan(block.indexOf('recommendationsCache.current =') === -1 ? Infinity : block.indexOf('recommendationsCache.current ='));
  });
});

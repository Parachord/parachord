/**
 * lib/visible-sources.js: the one rule for which source icons a track row
 * shows. Merge track.sources with trackSources[track.id], drop non-sources
 * (missing, noMatch, the __noMatchAll marker), keep playbackResolvers, sort by
 * resolverOrder (unknown ids last), dim below getBestSourceConfidence.
 */
const {
  visibleSources,
  mergedSources,
  hasResolutionResult,
  getBestSourceConfidence,
} = require('../../src/renderer/lib/visible-sources');

const order = ['spotify', 'amazonmusic', 'applemusic', 'youtube'];
const ids = (list) => list.map((s) => s.resolverId);

describe('visibleSources', () => {
  test('merges track.sources with the live trackSources, live winning per resolver', () => {
    const track = { id: 'a', sources: { spotify: { confidence: 0.95, uri: 'old' } } };
    const trackSources = { a: { spotify: { confidence: 1, uri: 'new' }, youtube: { confidence: 1 } } };
    const out = visibleSources(track, { trackSources, playbackResolvers: order, resolverOrder: order });
    expect(ids(out)).toEqual(['spotify', 'youtube']);
    expect(out[0].source.uri).toBe('new');
  });

  test('drops noMatch sentinels, missing values and the __noMatchAll marker', () => {
    const track = { id: 'a', sources: { spotify: { noMatch: true }, youtube: null, applemusic: { confidence: 1 } } };
    const out = visibleSources(track, { trackSources: { a: { __noMatchAll: true } }, playbackResolvers: order, resolverOrder: order });
    expect(ids(out)).toEqual(['applemusic']);
  });

  test('keeps only playbackResolvers (plan-blocked services leave)', () => {
    const track = { id: 'a', sources: { spotify: { confidence: 1 }, amazonmusic: { confidence: 1 }, applemusic: { confidence: 1 } } };
    const out = visibleSources(track, { playbackResolvers: ['spotify'], resolverOrder: order });
    expect(ids(out)).toEqual(['spotify']);
  });

  test('no playbackResolvers array means no plan filter', () => {
    const track = { id: 'a', sources: { amazonmusic: { confidence: 1 } } };
    expect(ids(visibleSources(track, { resolverOrder: order }))).toEqual(['amazonmusic']);
  });

  test('sorts by resolverOrder, ids not in it last', () => {
    const track = { id: 'a', sources: { youtube: { confidence: 1 }, local: { confidence: 1 }, spotify: { confidence: 1 } } };
    const out = visibleSources(track, { playbackResolvers: ['youtube', 'local', 'spotify'], resolverOrder: order });
    expect(ids(out)).toEqual(['spotify', 'youtube', 'local']);
  });

  test('dims a low-confidence match: below getBestSourceConfidence, or unscored', () => {
    const best = getBestSourceConfidence({});
    const track = { id: 'a', sources: { spotify: { confidence: best }, youtube: { confidence: best - 0.01 }, applemusic: {} } };
    const out = visibleSources(track, { playbackResolvers: order, resolverOrder: order });
    expect(out.map((s) => [s.resolverId, s.dim])).toEqual([['spotify', false], ['applemusic', true], ['youtube', true]]);
  });

  test('a track without an id or sources gives nothing', () => {
    expect(visibleSources({}, {})).toEqual([]);
    expect(visibleSources(null)).toEqual([]);
  });
});

describe('mergedSources / hasResolutionResult', () => {
  test('mergedSources keeps only real sources', () => {
    expect(mergedSources({ id: 'a', sources: { x: { noMatch: true } } }, { a: { y: { confidence: 1 } } })).toEqual({ y: { confidence: 1 } });
  });

  test('hasResolutionResult is false only while nothing at all has come back', () => {
    expect(hasResolutionResult({ id: 'a', sources: {} }, {})).toBe(false);
    expect(hasResolutionResult({ id: 'a', sources: { x: { noMatch: true } } }, {})).toBe(true);
    expect(hasResolutionResult({ id: 'a' }, { a: { __noMatchAll: true } })).toBe(true);
  });
});

describe('the lists use it', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', rel), 'utf8');

  test('Search\'s card dots: the shared rule and the plugin colours, no colour map of their own', () => {
    const page = read('components/search-page.js');
    const at = page.indexOf('// Source dots, bottom right (hidden on hover)');
    expect(at).toBeGreaterThan(-1);
    const dots = page.slice(at, at + 1500);
    expect(dots).toMatch(/visibleSources\(track, \{ trackSources, playbackResolvers: activeResolvers, resolverOrder \}\)\.slice\(0, 4\)/);
    expect(dots).toMatch(/allResolvers\.find\(r => r\.id === resolverId\)\?\.color/);
    expect(dots).not.toMatch(/#1DB954|const colors = \{/);
  });

  test('every page list calls it, through the shared TrackRow', () => {
    // TrackRow (track-lists.js) runs the rule; the page lists render it.
    expect(read('components/track-lists.js')).toMatch(/sourceRowState\(track, sources \|\| \{\}\)/);
    for (const rel of ['components/collection-page.js', 'components/playlist-view-page.js', 'components/search-page.js', 'components/cards.js']) {
      expect(read(rel)).toMatch(/React\.createElement\(TrackRow, \{/);
      expect(read(rel)).not.toMatch(/sourceRowState\(/);
    }
  });
});

describe('sourceRowState', () => {
  const { sourceRowState } = require('../../src/renderer/lib/visible-sources');
  const opts = (trackSources = {}) => ({ trackSources, playbackResolvers: ['spotify'], resolverOrder: order });

  test('resolving while nothing has come back', () => {
    expect(sourceRowState({ id: 'a', sources: {} }, opts()).state).toBe('resolving');
  });
  test('unplayable when every service said no match', () => {
    expect(sourceRowState({ id: 'a' }, opts({ a: { __noMatchAll: true } })).state).toBe('unplayable');
    expect(sourceRowState({ id: 'a', sources: { spotify: { noMatch: true } } }, opts()).state).toBe('unplayable');
  });
  test('unplayable when the only matches are on services the plan can\'t play', () => {
    expect(sourceRowState({ id: 'a', sources: { amazonmusic: { confidence: 1 } } }, opts()).state).toBe('unplayable');
  });
  test('playable with at least one icon', () => {
    const r = sourceRowState({ id: 'a', sources: { spotify: { confidence: 1 } } }, opts());
    expect(r.state).toBe('playable');
    expect(ids(r.shown)).toEqual(['spotify']);
  });
});

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

  test('dims below getBestSourceConfidence only; no confidence number is not dimmed', () => {
    const best = getBestSourceConfidence({});
    const track = { id: 'a', sources: { spotify: { confidence: best }, youtube: { confidence: best - 0.01 }, applemusic: {} } };
    const out = visibleSources(track, { playbackResolvers: order, resolverOrder: order });
    expect(out.map((s) => [s.resolverId, s.dim])).toEqual([['spotify', false], ['applemusic', false], ['youtube', true]]);
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

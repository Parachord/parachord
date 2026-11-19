/**
 * A purchase-only source: a track a plug-in found but whose service won't
 * stream it. Bandcamp marks a buy-only track `streamable: false` (plug-in
 * 1.5.0; Radiohead's own "Nude"). The app keeps it (the track-sources cache,
 * the playbar's Buy) and never plays it: one rule, isPlayableSource
 * (src/renderer/lib/playable-source.js), on every path that plays.
 */

const fs = require('fs');
const path = require('path');
const { isPlayableSource, isFoundSource } = require('../../src/renderer/lib/playable-source');
const {
  playableSourceIds, fallbackAfter, hasPlayableSource, sourcesChangedOnRecheck,
} = require('../../src/renderer/lib/playback-helpers');
const { visibleSources, sourceRowState } = require('../../src/renderer/lib/visible-sources');
const { purchaseSource } = require('../../src/renderer/lib/purchase-source');

const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src/renderer', rel), 'utf8');

const buyOnly = {
  title: 'Nude', artist: 'Radiohead', confidence: 0.95, streamable: false,
  bandcampUrl: 'https://radiohead.bandcamp.com/track/nude', purchaseUrl: 'https://radiohead.bandcamp.com/track/nude',
};
const spotify = { title: 'Nude', artist: 'Radiohead', confidence: 1, spotifyId: 'abc' };
const track = (sources) => ({ id: 'radiohead-nude', title: 'Nude', artist: 'Radiohead', sources });

describe('isPlayableSource', () => {
  test('streamable false is the only flag that makes a found source unplayable', () => {
    expect(isPlayableSource(buyOnly)).toBe(false);
    expect(isFoundSource(buyOnly)).toBe(true);
    expect(isPlayableSource(spotify)).toBe(true);
    expect(isPlayableSource({ ...spotify, streamable: true })).toBe(true);
    // Sources from before the flag existed have none, and stay playable.
    expect(isPlayableSource({ bandcampUrl: 'https://x.bandcamp.com/track/y' })).toBe(true);
  });

  test('a no-match sentinel or a missing value is not a source at all', () => {
    for (const v of [null, undefined, { noMatch: true }, 'bandcamp']) {
      expect(isPlayableSource(v)).toBe(false);
      expect(isFoundSource(v)).toBe(false);
    }
  });
});

describe('source selection skips it', () => {
  test("handlePlay's candidates, its fallbacks and the playable-track check", () => {
    expect(playableSourceIds({ bandcamp: buyOnly, spotify })).toEqual(['spotify']);
    expect(playableSourceIds({ bandcamp: buyOnly })).toEqual([]);
    expect(fallbackAfter({ spotify, bandcamp: buyOnly }, 'spotify').ids).toEqual([]);
    expect(hasPlayableSource(track({ bandcamp: buyOnly }))).toBe(false);
    expect(hasPlayableSource(track({ bandcamp: buyOnly, spotify }))).toBe(true);
  });

  test('a purchase-only source found on a re-check still counts as new, so it is cached', () => {
    expect(sourcesChangedOnRecheck({ spotify }, { spotify, bandcamp: buyOnly })).toBe(true);
    expect(sourcesChangedOnRecheck({ bandcamp: buyOnly }, { bandcamp: buyOnly })).toBe(false);
  });

  test('every playing path in the engine goes through isPlayableSource', () => {
    const engine = read('hooks/use-playback-engine.js');
    // No source filter of its own: the old ones read only `?.noMatch`.
    expect(engine).not.toMatch(/sources\[id\]\?\.noMatch/);
    expect(engine).toMatch(/isPlayableSource\(trackOrSource\.sources\[id\]\)/);
    // A purchase-only source handed over as the thing to play is resolved
    // like a track with no sources.
    expect(engine).toMatch(/!isPlayableSource\(trackOrSource\)\) \{[\s\S]{0,200}sources: \{\} \}/);
  });

  test('the playbar\'s "Play from" list skips it, and Buy still sees it', () => {
    const playbar = read('components/playbar.js');
    expect(playbar).toMatch(/if \(!isPlayableSource\(currentTrack\.sources\[resId\]\)\) return false;/);
    expect(playbar).toMatch(/pickPurchaseSource\(\{ resolvers: allResolvers, sources: effectiveSources/);
  });

  test('the playing-resolver guess for volume offsets prefers a source that plays', () => {
    expect(read('hooks/use-volume.js')).toMatch(/active\.includes\(resId\) && isPlayableSource\(track\.sources\[resId\]\)/);
  });
});

describe('icons and the row state', () => {
  test('no icon for a purchase-only source', () => {
    const shown = visibleSources(track({ bandcamp: buyOnly, spotify }), { resolverOrder: ['bandcamp', 'spotify'] });
    expect(shown.map((s) => s.resolverId)).toEqual(['spotify']);
  });

  test('a row whose only source is purchase-only is greyed, not resolving', () => {
    expect(sourceRowState(track({ bandcamp: buyOnly }), {}).state).toBe('unplayable');
    expect(sourceRowState(track({ bandcamp: buyOnly, spotify }), {}).state).toBe('playable');
  });

  test('a purchase-only source in the live resolutions is hidden too', () => {
    const t = track({});
    const shown = visibleSources(t, { trackSources: { [t.id]: { bandcamp: buyOnly } } });
    expect(shown).toEqual([]);
  });
});

describe('the other services are still asked', () => {
  test("the background pass doesn't count a purchase-only source as playable", () => {
    const app = read('app.js');
    const at = app.indexOf('const hasAnyValidSource = (track) => {');
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 800)).toMatch(/if \(!isPlayableSource\(source\)\) continue;/);
  });

  test("a link's purchase-only answer stays purchase-only on the track's source", () => {
    const app = read('app.js');
    expect(app).toMatch(/trackMeta\.streamable === false\) sourceData\.streamable = false;/);
  });
});

describe('Buy', () => {
  const resolvers = [{ id: 'spotify', name: 'Spotify', capabilities: {} }, { id: 'bandcamp', name: 'Bandcamp', capabilities: { purchase: true } }];

  test('is offered from a purchase-only source', () => {
    expect(purchaseSource({ resolvers, sources: { bandcamp: buyOnly, spotify }, track: track({}) })).toEqual({
      resolverId: 'bandcamp', resolverName: 'Bandcamp', purchaseUrl: 'https://radiohead.bandcamp.com/track/nude',
    });
  });

  test('under the same rules as any source: not for another artist', () => {
    expect(purchaseSource({ resolvers, sources: { bandcamp: { ...buyOnly, artist: 'Someone Else' } }, track: track({}) })).toBeNull();
  });
});

describe('the playbar never names a purchase-only source as the one playing', () => {
  function resolverIdFor(t, active) {
    global.React = require('react');
    global.ReactDOM = require('react-dom');
    const ReactDOMServer = require('react-dom/server');
    const { useVolume } = require('../../src/renderer/hooks/use-volume.js');
    const ref = (current = null) => ({ current });
    let out;
    const Probe = () => {
      out = useVolume({
        cacheLoaded: false, activeResolversRef: ref(active), resolverOrderRef: ref(['bandcamp', 'spotify']),
        spotifyTokenRef: ref(), audioRef: ref(), currentTrackRef: ref(), isPlayingRef: ref(), usesSharedAudio: () => false,
      });
      return out.volume;
    };
    ReactDOMServer.renderToStaticMarkup(global.React.createElement(Probe));
    return out.determineResolverIdFromTrack(t);
  }

  test('a playable source wins over a purchase-only one ranked above it', () => {
    expect(resolverIdFor(track({ bandcamp: buyOnly, spotify }), ['bandcamp', 'spotify'])).toBe('spotify');
  });

  test('only a purchase-only source names nothing', () => {
    expect(resolverIdFor(track({ bandcamp: buyOnly }), ['bandcamp'])).toBeNull();
    expect(resolverIdFor(track({ bandcamp: buyOnly }), [])).toBeNull();
  });
});

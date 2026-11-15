/**
 * A pull that can't find a playlist's source on the provider. Imported
 * playlists used to lose `syncedFrom` here, and the startup repair restored it
 * on the next launch, so 19 of one person's Spotify imports flipped on every
 * restart and every sync logged "no longer on spotify". Imported playlists now
 * keep the link; others still give it up so the push loops can recreate them.
 */

const { detachMissingSources } = require('../../sync-engine/missing-sources');

const fromSpotify = (id, externalId) => ({ id, title: id, syncedFrom: { resolver: 'spotify', externalId } });
const remote = (...ids) => ids.map((externalId) => ({ externalId }));

describe('detachMissingSources', () => {
  test('an imported playlist missing from the list keeps its link', () => {
    const playlists = [fromSpotify('spotify-abc', 'abc'), ...['b', 'c', 'd', 'e'].map((x) => fromSpotify(`spotify-${x}`, x))];
    const out = detachMissingSources(playlists, remote('b', 'c', 'd', 'e'), 'spotify');
    expect(out.playlists[0].syncedFrom).toEqual({ resolver: 'spotify', externalId: 'abc' });
    expect(out.kept.map((p) => p.id)).toEqual(['spotify-abc']);
    expect(out.detached).toEqual([]);
  });

  test('a playlist that is not an import of this provider still gives up the link', () => {
    const local = fromSpotify('local-123', 'xyz');
    const playlists = [local, ...['b', 'c', 'd', 'e'].map((x) => fromSpotify(`spotify-${x}`, x))];
    const out = detachMissingSources(playlists, remote('b', 'c', 'd', 'e'), 'spotify');
    expect(out.playlists[0].syncedFrom).toBeNull();
    expect(out.detached.map((p) => p.id)).toEqual(['local-123']);
    expect(playlists[0].syncedFrom).not.toBeNull(); // the input is not mutated
  });

  test('an import of ANOTHER provider is not this provider\'s import', () => {
    const am = fromSpotify('applemusic-p.1', 'xyz');
    const playlists = [am, ...['b', 'c', 'd', 'e'].map((x) => fromSpotify(`spotify-${x}`, x))];
    const out = detachMissingSources(playlists, remote('b', 'c', 'd', 'e'), 'spotify');
    expect(out.playlists[0].syncedFrom).toBeNull();
  });

  test('a response missing too many looks partial and detaches nothing', () => {
    const playlists = ['a', 'b', 'c', 'd', 'e'].map((x) => fromSpotify(`local-${x}`, x));
    const out = detachMissingSources(playlists, remote('e'), 'spotify');
    expect(out.looksPartial).toBe(true);
    expect(out.playlists).toBe(playlists);
    expect(out.detached).toEqual([]);
  });

  test('playlists that are present, or sourced elsewhere, are untouched', () => {
    const playlists = [fromSpotify('spotify-a', 'a'), { id: 'lb-1', syncedFrom: { resolver: 'listenbrainz', externalId: 'q' } }, { id: 'local-2' }];
    const out = detachMissingSources(playlists, remote('a'), 'spotify');
    expect(out.playlists).toEqual(playlists);
    expect(out.missingCount).toBe(0);
  });
});

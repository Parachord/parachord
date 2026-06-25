/**
 * N-way incremental write primitives — Layer B provider surface
 * (Parachord/parachord#911, Step 2 / PR-1).
 *
 * Covers the capability-dispatch REMOVAL primitives + nativeIdOf + the
 * throwing-defaults helper:
 *   - withIncrementalDefaults: the desktop equivalent of the Kotlin interface
 *     default — an unimplemented primitive throws (ports IncrementalPrimitive-
 *     DefaultsTest cases 19-21).
 *   - nativeIdOf purity per provider.
 *   - Spotify removePlaylistTracksByNativeId — DELETE-by-URI HTTP shape
 *     (mirrors SpotifyClientPlaylistRemoveTest).
 *   - ListenBrainz removePlaylistTracksByPosition — descending positional
 *     delete HTTP shape.
 *
 * The add / remotePlaylistExists / searchForTrackId primitives are tied to the
 * reconcile driver's hydration + probe flows and land with PR-4's integration
 * tests. Nothing wires any of this into the live sync path yet.
 */

const spotify = require('../../sync-providers/spotify.js');
const applemusic = require('../../sync-providers/applemusic.js');
const listenbrainz = require('../../sync-providers/listenbrainz.js');
const { withIncrementalDefaults, INCREMENTAL_PRIMITIVES } = require('../../sync-providers/incremental-primitives.js');

describe('withIncrementalDefaults — throwing defaults (cases 19-21)', () => {
  test('an unimplemented primitive throws, not silently no-ops', async () => {
    const stub = withIncrementalDefaults({ id: 'stub', capabilities: { trackRemoveMode: 'ByNativeId' } });
    await expect(stub.addPlaylistTracks('ext', ['a'])).rejects.toThrow(/addPlaylistTracks not implemented by stub/);
    await expect(stub.removePlaylistTracksByNativeId('ext', ['a'])).rejects.toThrow(/not implemented/);
    await expect(stub.removePlaylistTracksByPosition('ext', [0])).rejects.toThrow(/not implemented/);
    await expect(stub.replacePlaylistTracks('ext', ['a'])).rejects.toThrow(/not implemented/);
    await expect(stub.remotePlaylistExists('ext')).rejects.toThrow(/not implemented/);
    await expect(stub.searchForTrackId('t', 'a')).rejects.toThrow(/not implemented/);
  });

  test('a primitive the provider DOES define is preserved untouched', async () => {
    const wrapped = withIncrementalDefaults({
      id: 'p',
      capabilities: {},
      addPlaylistTracks: async () => 'kept',
    });
    await expect(wrapped.addPlaylistTracks('ext', ['a'])).resolves.toBe('kept');
    // …while the undefined ones still throw.
    await expect(wrapped.replacePlaylistTracks('ext', [])).rejects.toThrow(/not implemented/);
  });

  test('nativeIdOf is NOT defaulted (a throwing stub there would mask a real gap)', () => {
    const wrapped = withIncrementalDefaults({ id: 'p', capabilities: {} });
    expect(wrapped.nativeIdOf).toBeUndefined();
  });

  test('non-destructive — input object is not mutated', () => {
    const input = { id: 'p', capabilities: {} };
    withIncrementalDefaults(input);
    expect(input.addPlaylistTracks).toBeUndefined();
  });

  test('throws on a non-object provider', () => {
    expect(() => withIncrementalDefaults(null)).toThrow();
    expect(() => withIncrementalDefaults('nope')).toThrow();
  });

  test('exports the canonical primitive list', () => {
    expect(INCREMENTAL_PRIMITIVES).toContain('removePlaylistTracksByNativeId');
    expect(INCREMENTAL_PRIMITIVES).not.toContain('nativeIdOf');
  });
});

describe('nativeIdOf — pure native-id accessors', () => {
  test('Spotify: spotifyUri wins, else builds from spotifyId, else null', () => {
    expect(spotify.nativeIdOf({ spotifyUri: 'spotify:track:abc' })).toBe('spotify:track:abc');
    expect(spotify.nativeIdOf({ spotifyId: 'xyz' })).toBe('spotify:track:xyz');
    expect(spotify.nativeIdOf({})).toBeNull();
    expect(spotify.nativeIdOf(null)).toBeNull();
  });

  test('ListenBrainz: recordingMbid (trim+lower), else mbid, else null', () => {
    expect(listenbrainz.nativeIdOf({ recordingMbid: '  ABC-123  ' })).toBe('abc-123');
    expect(listenbrainz.nativeIdOf({ mbid: 'DEF' })).toBe('def');
    expect(listenbrainz.nativeIdOf({})).toBeNull();
  });

  test('Apple Music: appleMusicId, else appleMusicCatalogId, else null', () => {
    expect(applemusic.nativeIdOf({ appleMusicId: '123' })).toBe('123');
    expect(applemusic.nativeIdOf({ appleMusicCatalogId: '456' })).toBe('456');
    expect(applemusic.nativeIdOf({})).toBeNull();
  });
});

describe('Spotify removePlaylistTracksByNativeId — DELETE-by-URI HTTP shape', () => {
  let realFetch;
  beforeEach(() => {
    realFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  test('issues DELETE /playlists/{id}/tracks with { tracks: [{ uri }] } and returns snapshotId', async () => {
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, text: async () => JSON.stringify({ snapshot_id: 'snap2' }) };
    };
    const result = await spotify.removePlaylistTracksByNativeId(
      'PID',
      ['spotify:track:1', 'spotify:track:2'],
      'tok'
    );
    expect(calls.length).toBe(1);
    expect(calls[0].opts.method).toBe('DELETE');
    expect(calls[0].url).toContain('/playlists/PID/tracks');
    expect(calls[0].opts.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0].opts.body)).toEqual({
      tracks: [{ uri: 'spotify:track:1' }, { uri: 'spotify:track:2' }],
    });
    expect(result).toEqual({ success: true, snapshotId: 'snap2' });
  });

  test('empty id list is a no-op (no DELETE)', async () => {
    let called = false;
    global.fetch = async () => {
      called = true;
      return { ok: true, status: 200, text: async () => '' };
    };
    const result = await spotify.removePlaylistTracksByNativeId('PID', [], 'tok');
    expect(called).toBe(false);
    expect(result.success).toBe(true);
  });
});

describe('ListenBrainz removePlaylistTracksByPosition — descending positional delete', () => {
  let realFetch;
  beforeEach(() => {
    realFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  test('deletes positions DESCENDING (so earlier deletes do not shift later indices)', async () => {
    const deleteIndices = [];
    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/item/delete')) {
        deleteIndices.push(JSON.parse(opts.body));
        return { ok: true, status: 200, text: async () => '' };
      }
      // Final snapshot re-fetch (GET the playlist).
      return {
        ok: true,
        status: 200,
        json: async () => ({
          playlist: { extension: { 'https://musicbrainz.org/doc/jspf#playlist': { last_modified_at: 't2' } } },
        }),
      };
    };
    const result = await listenbrainz.removePlaylistTracksByPosition('MBID', [0, 2, 1], 'tok');
    // Issued 2 → 1 → 0, each count 1.
    expect(deleteIndices).toEqual([
      { index: 2, count: 1 },
      { index: 1, count: 1 },
      { index: 0, count: 1 },
    ]);
    expect(result.snapshotId).toBe('t2');
  });

  test('skips invalid positions and no-ops on an empty list', async () => {
    let deletes = 0;
    global.fetch = async (url) => {
      if (typeof url === 'string' && url.includes('/item/delete')) deletes++;
      return { ok: true, status: 200, json: async () => ({ playlist: {} }) };
    };
    await listenbrainz.removePlaylistTracksByPosition('MBID', [-1, 1.5, null], 'tok');
    expect(deletes).toBe(0);
  });
});

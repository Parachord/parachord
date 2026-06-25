/**
 * Provider capability surface for N-way materialize dispatch
 * (Parachord/parachord#911, Step 1).
 *
 * The N-way materialize executor dispatches removals purely on
 * `capabilities.trackRemoveMode` (+ canReorder / supportsPlaylistDelete /
 * supportsPlaylistRename) and NEVER branches on provider id. These tests pin
 * each provider's declared HONEST WORST CASE so a drift (e.g. someone marking
 * Apple Music removable) is caught — that would let the engine attempt a
 * remove AM can't honor, which the design forbids.
 *
 * Pure metadata assertions — the providers require cleanly (no electron /
 * network at module load).
 */

const spotify = require('../../sync-providers/spotify.js');
const applemusic = require('../../sync-providers/applemusic.js');
const listenbrainz = require('../../sync-providers/listenbrainz.js');

const VALID_REMOVE_MODES = ['ByNativeId', 'ByPosition', 'Unsupported', 'ReplaceOnly'];

describe('provider capabilities — N-way fields present + typed', () => {
  const providers = [
    ['spotify', spotify],
    ['applemusic', applemusic],
    ['listenbrainz', listenbrainz],
  ];

  for (const [name, p] of providers) {
    describe(name, () => {
      const caps = p.capabilities;

      test('declares the full base capability surface', () => {
        for (const key of ['tracks', 'albums', 'artists', 'playlists', 'playlistFolders']) {
          expect(typeof caps[key]).toBe('boolean');
        }
      });

      test('trackRemoveMode is one of the valid modes', () => {
        expect(VALID_REMOVE_MODES).toContain(caps.trackRemoveMode);
      });

      test('canReorder / supportsPlaylistDelete / supportsPlaylistRename are booleans', () => {
        expect(typeof caps.canReorder).toBe('boolean');
        expect(typeof caps.supportsPlaylistDelete).toBe('boolean');
        expect(typeof caps.supportsPlaylistRename).toBe('boolean');
      });
    });
  }
});

describe('provider capabilities — the honest worst case per provider', () => {
  test('Spotify: full track-level control', () => {
    expect(spotify.capabilities).toMatchObject({
      trackRemoveMode: 'ByNativeId',
      canReorder: true,
      supportsPlaylistDelete: true,
      supportsPlaylistRename: true,
    });
  });

  test('Apple Music: add-only, nothing else (the load-bearing worst case)', () => {
    expect(applemusic.capabilities).toMatchObject({
      trackRemoveMode: 'Unsupported',
      canReorder: false,
      supportsPlaylistDelete: false,
      supportsPlaylistRename: false,
    });
  });

  test('ListenBrainz: positional removal, no reorder, delete+rename ok', () => {
    expect(listenbrainz.capabilities).toMatchObject({
      trackRemoveMode: 'ByPosition',
      canReorder: false,
      supportsPlaylistDelete: true,
      supportsPlaylistRename: true,
      playlistFolders: false, // was previously missing
    });
  });
});

describe('source-authority gate property (the reason these fields exist)', () => {
  // An add-only source must never be granted drop-authority — its un-
  // materialized adds + transient partial fetches would read as deletions.
  // The gate is `trackRemoveMode !== 'Unsupported'`; assert AM is the one
  // that declines and the others qualify.
  const removalCapable = (p) => p.capabilities.trackRemoveMode !== 'Unsupported';
  test('Apple Music is NOT removal-capable; Spotify + LB are', () => {
    expect(removalCapable(applemusic)).toBe(false);
    expect(removalCapable(spotify)).toBe(true);
    expect(removalCapable(listenbrainz)).toBe(true);
  });
});

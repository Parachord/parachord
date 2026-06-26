/**
 * Playlist push-candidate eligibility + the LB re-export opt-in gate
 * (Parachord/parachord#911, parity with mobile ec526bb /
 * PlaylistSelectionTest). The eligibility accept-list is the cross-engine
 * parity anchor; the opt-in gate (autoMirrorsByDefault / isReexportOptInRequired)
 * is the load-bearing no-auto-flood guard the renderer push loops apply.
 */

const {
  REEXPORT_PROVIDERS,
  isPlaylistPushCandidate,
  autoMirrorsByDefault,
  isReexportOptInRequired,
} = require('../../sync-engine/playlist-push-candidate');

const pl = (id, extra = {}) => ({ id, ...extra });

describe('isPlaylistPushCandidate — accept-list (LB re-export added)', () => {
  test('local-* / hosted push to any provider', () => {
    for (const provider of ['spotify', 'applemusic', 'listenbrainz']) {
      expect(isPlaylistPushCandidate(pl('local-123'), provider)).toBe(true);
      expect(isPlaylistPushCandidate(pl('hosted-abc', { sourceUrl: 'https://x/y.xspf' }), provider)).toBe(true);
    }
  });

  test('spotify-* push to applemusic + listenbrainz, NOT back to spotify', () => {
    expect(isPlaylistPushCandidate(pl('spotify-AAA'), 'applemusic')).toBe(true);
    expect(isPlaylistPushCandidate(pl('spotify-AAA'), 'listenbrainz')).toBe(true);
    expect(isPlaylistPushCandidate(pl('spotify-AAA'), 'spotify')).toBe(false); // not base, not LB
  });

  test('applemusic-* push to listenbrainz only', () => {
    expect(isPlaylistPushCandidate(pl('applemusic-p.AAA'), 'listenbrainz')).toBe(true);
    expect(isPlaylistPushCandidate(pl('applemusic-p.AAA'), 'spotify')).toBe(false);
    expect(isPlaylistPushCandidate(pl('applemusic-p.AAA'), 'applemusic')).toBe(false);
  });

  test('NEW: listenbrainz-* is ELIGIBLE for Spotify + Apple Music', () => {
    expect(isPlaylistPushCandidate(pl('listenbrainz-mbid-1'), 'spotify')).toBe(true);
    expect(isPlaylistPushCandidate(pl('listenbrainz-mbid-1'), 'applemusic')).toBe(true);
  });

  test('Spotify keeps the don\'t-write-back guard for a playlist that already has a Spotify id', () => {
    expect(isPlaylistPushCandidate(pl('listenbrainz-mbid-1', { spotifyId: 'sp1' }), 'spotify')).toBe(false);
    expect(isPlaylistPushCandidate(pl('local-1', { sources: { spotify: { spotifyId: 'sp1' } } }), 'spotify')).toBe(false);
    // …but it can still go to Apple Music.
    expect(isPlaylistPushCandidate(pl('listenbrainz-mbid-1', { spotifyId: 'sp1' }), 'applemusic')).toBe(true);
  });
});

describe('autoMirrorsByDefault — only listenbrainz-* is opt-in', () => {
  test('false ONLY for listenbrainz-*', () => {
    expect(autoMirrorsByDefault(pl('listenbrainz-mbid-1'))).toBe(false);
  });
  test('true for local- / spotify- / applemusic- / hosted', () => {
    expect(autoMirrorsByDefault(pl('local-1'))).toBe(true);
    expect(autoMirrorsByDefault(pl('spotify-AAA'))).toBe(true);
    expect(autoMirrorsByDefault(pl('applemusic-p.AAA'))).toBe(true);
    expect(autoMirrorsByDefault(pl('hosted-abc', { sourceUrl: 'https://x' }))).toBe(true);
    expect(autoMirrorsByDefault(pl(undefined))).toBe(true); // no id → not LB-origin
  });
});

describe('isReexportOptInRequired — the no-auto-flood gate', () => {
  test('TRUE for a listenbrainz-* playlist targeting a streaming provider', () => {
    expect(isReexportOptInRequired(pl('listenbrainz-mbid-1'), 'spotify')).toBe(true);
    expect(isReexportOptInRequired(pl('listenbrainz-mbid-1'), 'applemusic')).toBe(true);
  });

  test('FALSE for listenbrainz-* targeting listenbrainz (id-prefix guard owns that)', () => {
    expect(isReexportOptInRequired(pl('listenbrainz-mbid-1'), 'listenbrainz')).toBe(false);
  });

  test('FALSE for non-LB playlists (they auto-mirror as before)', () => {
    expect(isReexportOptInRequired(pl('local-1'), 'spotify')).toBe(false);
    expect(isReexportOptInRequired(pl('spotify-AAA'), 'applemusic')).toBe(false);
    expect(isReexportOptInRequired(pl('hosted-abc', { sourceUrl: 'https://x' }), 'spotify')).toBe(false);
  });

  test('REEXPORT_PROVIDERS is exactly the streaming services', () => {
    expect(new Set(REEXPORT_PROVIDERS)).toEqual(new Set(['spotify', 'applemusic']));
  });
});

describe('opt-in gate decision (what the push loop computes)', () => {
  // The renderer push loop skips a create iff isReexportOptInRequired AND the
  // playlist is NOT opted into this provider. These assert that combined rule.
  const gatedSkip = (playlist, providerId, optedInProviders) =>
    isReexportOptInRequired(playlist, providerId) && !(optedInProviders || []).includes(providerId);

  test('a LB playlist with NO opt-in is skipped for Spotify/AM (no auto-flood)', () => {
    expect(gatedSkip(pl('listenbrainz-mbid-1'), 'spotify', [])).toBe(true);
    expect(gatedSkip(pl('listenbrainz-mbid-1'), 'applemusic', undefined)).toBe(true);
  });

  test('a LB playlist explicitly opted into a provider is NOT skipped', () => {
    expect(gatedSkip(pl('listenbrainz-mbid-1'), 'spotify', ['spotify'])).toBe(false);
    expect(gatedSkip(pl('listenbrainz-mbid-1'), 'applemusic', ['spotify', 'applemusic'])).toBe(false);
  });

  test('a non-LB playlist is never skipped by this gate', () => {
    expect(gatedSkip(pl('local-1'), 'spotify', [])).toBe(false);
    expect(gatedSkip(pl('spotify-AAA'), 'applemusic', [])).toBe(false);
  });

  // The SAME predicate must guard every main-process create/link SIDE-DOOR, not
  // just the renderer push loops — an adversarial review found relinkOrphansFor
  // (the "Clean up duplicates" path) auto-linked an un-opted listenbrainz-*
  // playlist to a same-named owned Spotify/AM remote, then re-exported it via
  // the un-gated `locallyModified` push branch. These pin the relink/gateway
  // decision (main.js relinkOrphansFor orphan filter + sync:create-playlist).
  test('relink/gateway side-door: an un-opted listenbrainz-* orphan is NOT a relink candidate for streaming', () => {
    expect(gatedSkip(pl('listenbrainz-mbid-1'), 'spotify', [])).toBe(true);
    expect(gatedSkip(pl('listenbrainz-mbid-1'), 'applemusic', [])).toBe(true);
  });

  test('relink/gateway side-door: an OPTED-IN listenbrainz-* playlist still relinks/creates', () => {
    expect(gatedSkip(pl('listenbrainz-mbid-1'), 'spotify', ['spotify'])).toBe(false);
  });

  test('relink/gateway side-door: a non-LB orphan relinks freely (e.g. local- name-match)', () => {
    expect(gatedSkip(pl('local-1'), 'spotify', [])).toBe(false);
  });
});

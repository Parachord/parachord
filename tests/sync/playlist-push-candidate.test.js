/**
 * Playlist push-candidate eligibility + the LB re-export opt-in gate
 * (Parachord/parachord#911, parity with mobile ec526bb /
 * PlaylistSelectionTest). The eligibility accept-list is the cross-engine
 * parity anchor; the opt-in gate (autoMirrorsByDefault / isReexportOptInRequired)
 * is the load-bearing no-auto-flood guard the renderer push loops apply.
 */

const {
  REEXPORT_PROVIDERS,
  SYNC_CHANNEL_PROVIDERS,
  isPlaylistPushCandidate,
  autoMirrorsByDefault,
  isReexportOptInRequired,
  computeSyncChannels,
  channelGateBlocksCreate,
  channelOverrideExcludes,
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

describe('channelGateBlocksCreate — the unified channel/opt-in gate', () => {
  test('an OVERRIDE is authoritative — block any provider not in it', () => {
    expect(channelGateBlocksCreate(pl('local-1'), 'applemusic', ['spotify'])).toBe(true); // AM not chosen
    expect(channelGateBlocksCreate(pl('local-1'), 'spotify', ['spotify'])).toBe(false); // chosen
    expect(channelGateBlocksCreate(pl('listenbrainz-1'), 'spotify', ['spotify'])).toBe(false); // LB opted in via override
    expect(channelGateBlocksCreate(pl('listenbrainz-1'), 'applemusic', ['spotify'])).toBe(true); // LB not chosen for AM
  });

  test('an EMPTY override blocks all providers (the user turned everything off)', () => {
    expect(channelGateBlocksCreate(pl('local-1'), 'spotify', [])).toBe(true);
    expect(channelGateBlocksCreate(pl('local-1'), 'applemusic', [])).toBe(true);
  });

  test('NO override → default: non-LB auto-mirrors, listenbrainz-* is opt-in-gated for streaming', () => {
    expect(channelGateBlocksCreate(pl('local-1'), 'spotify', null)).toBe(false);
    expect(channelGateBlocksCreate(pl('local-1'), 'spotify', undefined)).toBe(false);
    expect(channelGateBlocksCreate(pl('listenbrainz-1'), 'spotify', null)).toBe(true); // no flood
    expect(channelGateBlocksCreate(pl('listenbrainz-1'), 'listenbrainz', null)).toBe(false); // own provider
  });

  test('a hosted-XSPF mirror is opt-in for ListenBrainz (no empty-playlist auto-create)', () => {
    // The bug: a read-only hosted XSPF whose tracks have no MBIDs was auto-creating
    // an EMPTY LB playlist (which then synced to mobile). LB is opt-in for it now.
    expect(channelGateBlocksCreate(pl('hosted-abc'), 'listenbrainz', null)).toBe(true);
    expect(channelGateBlocksCreate(pl('hosted-abc'), 'listenbrainz', undefined)).toBe(true);
    // Streaming mirrors still auto-mirror (the documented hosted-XSPF → Spotify path).
    expect(channelGateBlocksCreate(pl('hosted-abc'), 'spotify', null)).toBe(false);
    expect(channelGateBlocksCreate(pl('hosted-abc'), 'applemusic', null)).toBe(false);
    // But an explicit override that includes LB still opts in.
    expect(channelGateBlocksCreate(pl('hosted-abc'), 'listenbrainz', ['listenbrainz'])).toBe(false);
    expect(channelGateBlocksCreate(pl('hosted-abc'), 'listenbrainz', ['spotify'])).toBe(true);
  });
});

describe('channelOverrideExcludes — the EDIT/update push gate (closes the disable race)', () => {
  test('blocks ONLY when an override explicitly excludes the provider', () => {
    expect(channelOverrideExcludes(['spotify'], 'applemusic')).toBe(true); // AM excluded → stop editing it
    expect(channelOverrideExcludes(['spotify'], 'spotify')).toBe(false); // still chosen
    expect(channelOverrideExcludes([], 'spotify')).toBe(true); // turned everything off
  });

  test('an already-linked mirror with NO override keeps syncing edits (unlike the create gate)', () => {
    // Critical contract: a previously-opted-in LB→Spotify mirror with no override
    // must KEEP getting edits — the create gate would block it (opt-in), the edit
    // gate must not.
    expect(channelOverrideExcludes(null, 'spotify')).toBe(false);
    expect(channelOverrideExcludes(undefined, 'spotify')).toBe(false);
    expect(channelGateBlocksCreate(pl('listenbrainz-1'), 'spotify', null)).toBe(true); // create: blocked
    expect(channelOverrideExcludes(null, 'spotify')).toBe(false); // edit: allowed
  });
});

describe('computeSyncChannels — the Sync menu channel states', () => {
  const enabled = ['spotify', 'applemusic', 'listenbrainz'];

  test('reports connected / available / enabled per provider (override authoritative)', () => {
    const channels = computeSyncChannels(pl('listenbrainz-1'), {
      enabledProviders: enabled,
      override: ['spotify'], // user chose Spotify only
      currentMirrors: ['listenbrainz'],
    });
    const byId = Object.fromEntries(channels.map((c) => [c.providerId, c]));
    expect(byId.spotify).toMatchObject({ connected: true, enabled: true, available: true });
    expect(byId.applemusic).toMatchObject({ connected: true, enabled: false, available: true });
    expect(byId.listenbrainz).toMatchObject({ connected: true, enabled: false, available: true }); // source, available
    expect(channels.map((c) => c.providerId)).toEqual(SYNC_CHANNEL_PROVIDERS);
  });

  test('with NO override, enabled reflects the current mirrors', () => {
    const channels = computeSyncChannels(pl('spotify-AAA'), {
      enabledProviders: ['spotify', 'applemusic'],
      override: null,
      currentMirrors: ['spotify', 'applemusic'],
    });
    const byId = Object.fromEntries(channels.map((c) => [c.providerId, c]));
    expect(byId.spotify.enabled).toBe(true);
    expect(byId.applemusic.enabled).toBe(true);
    expect(byId.listenbrainz).toMatchObject({ connected: false, enabled: false, available: true }); // spotify-* → LB eligible
  });

  test('available=false for a provider this playlist cannot push to (e.g. applemusic-* → spotify)', () => {
    const channels = computeSyncChannels(pl('applemusic-p.A'), { enabledProviders: enabled });
    const byId = Object.fromEntries(channels.map((c) => [c.providerId, c]));
    expect(byId.spotify.available).toBe(false);
    expect(byId.applemusic.available).toBe(true); // is the source
    expect(byId.listenbrainz.available).toBe(true);
  });

  test('the SOURCE channel is shown but is NOT a push target (locked in the menu)', () => {
    // listenbrainz-* → LB is the source: available (shown) but not a push target.
    const lb = computeSyncChannels(pl('listenbrainz-1'), { enabledProviders: enabled })
      .find((c) => c.providerId === 'listenbrainz');
    expect(lb).toMatchObject({ available: true, isSource: true, pushTarget: false });
    // …while its streaming channels ARE push targets.
    const sp = computeSyncChannels(pl('listenbrainz-1'), { enabledProviders: enabled })
      .find((c) => c.providerId === 'spotify');
    expect(sp).toMatchObject({ available: true, isSource: false, pushTarget: true });
  });
});

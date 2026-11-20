/**
 * main-process/ipc/sync-start.js — the inbound sync engine surface, driven with
 * fakes: the check-auth token paths (incl. the #986 "only 401 means re-auth"
 * rule), the sync:start gates (in-progress, auth, Spotify scopes), and the
 * activeSyncs cancellation wiring end-to-end.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerSyncStartIpc } = require('../../main-process/ipc/sync-start');

const SPOTIFY_SCOPES = ['user-library-read', 'user-follow-read', 'playlist-read-private'];

function makeHarness({ provider = {}, storeData = {}, spotifyToken = 'SP-TOK', generatedToken = 'AM-DEV', SyncEngineSyncGate = null, syncLinks = () => ({}), shortCircuit = () => true, stagger = ({ selectedRemote }) => selectedRemote } = {}) {
  const store = {
    data: { ...storeData },
    // A copy, like electron-store (conf parses the file on every get).
    reads: {},
    get(k) { this.reads[k] = (this.reads[k] || 0) + 1; return this.data[k] === undefined ? undefined : structuredClone(this.data[k]); },
    set(k, v) { this.data[k] = v; },
  };
  const handlers = new Map();
  const sent = [];
  const event = { sender: { send: (channel, payload) => sent.push({ channel, payload }) } };

  const calls = { syncDataType: [], collectionWrites: [] };
  const providerObj = provider === null ? null : {
    id: 'fake',
    displayName: 'Fake',
    capabilities: { playlists: true, tracks: true, albums: true, artists: true },
    fetchPlaylists: async () => ({ playlists: [] }),
    checkAuth: async () => true,
    syncTracks: async () => ({}),
    syncAlbums: async () => ({}),
    syncArtists: async () => ({}),
    ...(provider || {}),
  };
  const SyncEngine = {
    getProvider: () => providerObj,
    getAllProviders: () => (providerObj ? [providerObj] : []),
    staggerPlaylistsForCycle: stagger,
    canShortCircuitPlaylistUpdate: shortCircuit,
    syncDataType: async (...args) => {
      calls.syncDataType.push(args);
      if (SyncEngineSyncGate) await SyncEngineSyncGate;
      return { data: [], stats: { added: 0, removed: 0, updated: 0 } };
    },
  };

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-start-userdata-'));
  fs.writeFileSync(path.join(userDataDir, 'collection.json'), JSON.stringify({ tracks: [], albums: [], artists: [] }));
  const app = { getPath: () => userDataDir };

  registerSyncStartIpc({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
    SyncEngine,
    store,
    app,
    ensureValidSpotifyToken: async () => spotifyToken,
    getGeneratedMusicKitToken: async () => generatedToken,
    writeCollectionAtomic: async (p, collection) => { calls.collectionWrites.push({ p, collection }); },
    getSyncLinks: syncLinks,
    legacyPlaylistSyncEnabled: () => true,
    getChannelOverride: () => undefined,
  });
  return { handlers, store, event, sent, calls, providerObj };
}

describe('registration + sync:get-providers', () => {
  test('registers the inbound sync surface', () => {
    const { handlers } = makeHarness();
    expect([...handlers.keys()].sort()).toEqual(['sync:cancel', 'sync:check-auth', 'sync:get-providers', 'sync:start']);
  });

  test('sync:get-providers maps id/displayName/capabilities', async () => {
    const { handlers } = makeHarness();
    await expect(handlers.get('sync:get-providers')()).resolves.toEqual([
      { id: 'fake', displayName: 'Fake', capabilities: { playlists: true, tracks: true, albums: true, artists: true } },
    ]);
  });
});

describe('sync:check-auth', () => {
  test('unknown provider', async () => {
    const { handlers } = makeHarness({ provider: null });
    await expect(handlers.get('sync:check-auth')(null, 'nope')).resolves.toEqual({ authenticated: false, error: 'Provider not found' });
  });

  test('spotify: stored token + checkAuthStatus ok', async () => {
    const { handlers } = makeHarness({
      storeData: { spotify_token: 'SP-TOK' },
      provider: { checkAuthStatus: async () => ({ ok: true, status: 200 }) },
    });
    await expect(handlers.get('sync:check-auth')(null, 'spotify')).resolves.toEqual({ authenticated: true, status: 200 });
  });

  test('#986: only a 401 counts as unauthenticated — 403/429/5xx treat the token as valid', async () => {
    const { handlers } = makeHarness({
      storeData: { spotify_token: 'SP-TOK' },
      provider: { checkAuthStatus: async () => ({ ok: false, status: 429 }) },
    });
    await expect(handlers.get('sync:check-auth')(null, 'spotify')).resolves.toEqual({ authenticated: true, status: 429 });
  });

  test('a 401 is reported as unauthenticated', async () => {
    const { handlers } = makeHarness({
      storeData: { spotify_token: 'SP-TOK' },
      provider: { checkAuthStatus: async () => ({ ok: false, status: 401 }) },
    });
    await expect(handlers.get('sync:check-auth')(null, 'spotify')).resolves.toEqual({ authenticated: false, status: 401 });
  });

  test('providers without checkAuthStatus fall back to checkAuth', async () => {
    const { handlers } = makeHarness({
      storeData: { spotify_token: 'SP-TOK' },
      provider: { checkAuth: async () => true },
    });
    await expect(handlers.get('sync:check-auth')(null, 'spotify')).resolves.toEqual({ authenticated: true });
  });

  test('applemusic: missing dev token names the MusicKit key problem', async () => {
    const { handlers } = makeHarness({ generatedToken: null, storeData: { applemusic_user_token: 'AM-USER' } });
    await expect(handlers.get('sync:check-auth')(null, 'applemusic')).resolves.toEqual({
      authenticated: false,
      error: 'Missing developer token (MusicKit key may not be bundled in this build)',
    });
  });

  test('applemusic: dev + user token present → authenticated', async () => {
    const { handlers } = makeHarness({ storeData: { applemusic_user_token: 'AM-USER' } });
    await expect(handlers.get('sync:check-auth')(null, 'applemusic')).resolves.toEqual({ authenticated: true });
  });

  test('#1288 applemusic: a refusal keeps the status and a readable error, and is not treated as valid', async () => {
    const { handlers } = makeHarness({
      storeData: { applemusic_user_token: 'U' },
      provider: {
        checkAuthStatus: async () => ({ ok: false, status: 403 }),
        describeAuthFailure: (s) => `refused (HTTP ${s})`,
      },
    });
    await expect(handlers.get('sync:check-auth')(null, 'applemusic')).resolves.toEqual({
      authenticated: false, status: 403, error: 'refused (HTTP 403)',
    });
  });

  test('applemusic: a 403 traced to the user token says so, so the renderer may sign in again', async () => {
    const seen = [];
    const { handlers } = makeHarness({
      storeData: { applemusic_user_token: 'U' },
      provider: {
        checkAuthStatus: async () => ({ ok: false, status: 403, tokenRejected: true }),
        describeAuthFailure: (s, opts) => { seen.push(opts); return `reconnect (HTTP ${s})`; },
      },
    });
    await expect(handlers.get('sync:check-auth')(null, 'applemusic')).resolves.toEqual({
      authenticated: false, status: 403, error: 'reconnect (HTTP 403)', tokenRejected: true,
    });
    expect(seen).toEqual([{ tokenRejected: true }]);
  });

  test('#1288 applemusic: ok passes the status through', async () => {
    const { handlers } = makeHarness({
      storeData: { applemusic_user_token: 'U' },
      provider: { checkAuthStatus: async () => ({ ok: true, status: 200 }), describeAuthFailure: () => 'x' },
    });
    await expect(handlers.get('sync:check-auth')(null, 'applemusic')).resolves.toEqual({ authenticated: true, status: 200 });
  });

  test('listenbrainz: token lives in the scrobbler config and the error says so', async () => {
    const noToken = makeHarness();
    await expect(noToken.handlers.get('sync:check-auth')(null, 'listenbrainz')).resolves.toEqual({
      authenticated: false,
      error: 'No ListenBrainz user token configured (set it in the ListenBrainz scrobbler settings)',
    });
    const withToken = makeHarness({ storeData: { 'scrobbler-config-listenbrainz': { userToken: 'LB-TOK' } } });
    await expect(withToken.handlers.get('sync:check-auth')(null, 'listenbrainz')).resolves.toEqual({ authenticated: true });
  });

  test('no token at all → No token found', async () => {
    const { handlers } = makeHarness({ spotifyToken: null });
    await expect(handlers.get('sync:check-auth')(null, 'spotify')).resolves.toEqual({ authenticated: false, error: 'No token found' });
  });
});

describe('sync:start gates', () => {
  test('unknown provider', async () => {
    const { handlers } = makeHarness({ provider: null });
    await expect(handlers.get('sync:start')(null, 'nope', {})).resolves.toEqual({ success: false, error: 'Provider not found' });
  });

  test('no token → Not authenticated', async () => {
    const { handlers } = makeHarness({ spotifyToken: null });
    await expect(handlers.get('sync:start')({ sender: { send() {} } }, 'spotify', {})).resolves.toEqual({ success: false, error: 'Not authenticated' });
  });

  test('spotify: no stored scopes → missing_scopes (legacy-auth prompt)', async () => {
    const { handlers } = makeHarness();
    const result = await handlers.get('sync:start')({ sender: { send() {} } }, 'spotify', {});
    expect(result).toMatchObject({ success: false, errorCode: 'missing_scopes' });
    expect(result.error).toContain('disconnect and reconnect Spotify');
  });

  test('spotify: stored scopes missing one of the required → missing_scopes', async () => {
    const { handlers } = makeHarness({ storeData: { spotify_token_scopes: ['user-library-read', 'user-follow-read'] } });
    const result = await handlers.get('sync:start')({ sender: { send() {} } }, 'spotify', {});
    expect(result.errorCode).toBe('missing_scopes');
  });

  test('spotify: all required scopes present → the sync proceeds past the scope gate', async () => {
    const { handlers } = makeHarness({ storeData: { spotify_token_scopes: SPOTIFY_SCOPES } });
    const result = await handlers.get('sync:start')({ sender: { send() {} } }, 'spotify', {});
    expect(result.errorCode).toBeUndefined();
    expect(result.success).toBe(true);
  });
});

describe('sync:start finds mirrors deleted on the provider (#1269)', () => {
  const LB = { 'scrobbler-config-listenbrainz': { userToken: 'LB-TOK' } };
  const event = { sender: { send() {} } };
  const stored = (id, externalId) => ({ id, title: id, syncedTo: { listenbrainz: { externalId } } });

  function run(provider, settings = { syncPlaylists: true }) {
    const harness = makeHarness({
      provider: { fetchPlaylists: async () => ({ playlists: [{ externalId: 'there', name: 'There', tracks: [] }] }), ...provider },
      storeData: { ...LB, local_playlists: [stored('kept', 'there'), stored('deleted', 'gone')] },
    });
    return harness.handlers.get('sync:start')(event, 'listenbrainz', { settings }).then((result) => ({ result, harness }));
  }

  test('saves the flag on a confirmed deleted mirror, and only there', async () => {
    const asked = [];
    const { result, harness } = await run({
      playlistStatus: async (id, token) => { asked.push([id, token]); return { exists: false, isPublic: null }; },
    });
    expect(result.success).toBe(true);
    expect(asked).toEqual([['gone', 'LB-TOK']]);
    const saved = harness.store.data.local_playlists;
    expect(saved.find((p) => p.id === 'deleted').syncedTo.listenbrainz.pendingAction).toBe('remote-deleted');
    expect(saved.find((p) => p.id === 'kept').syncedTo.listenbrainz.pendingAction).toBeUndefined();
  });

  test('a mirror the provider still has is not flagged, though the list left it out', async () => {
    const { result, harness } = await run({ playlistStatus: async () => ({ exists: true, isPublic: false }) });
    expect(result.success).toBe(true);
    expect(harness.store.data.local_playlists.find((p) => p.id === 'deleted').syncedTo.listenbrainz.pendingAction).toBeUndefined();
  });

  test('a failing check does not fail the sync', async () => {
    const { result, harness } = await run({ playlistStatus: async () => { throw new Error('boom'); } });
    expect(result.success).toBe(true);
    expect(harness.store.data.local_playlists.find((p) => p.id === 'deleted').syncedTo.listenbrainz.pendingAction).toBeUndefined();
  });

  test('nothing is checked when playlists are not being synced', async () => {
    const asked = [];
    await run({ playlistStatus: async (id) => { asked.push(id); return { exists: false, isPublic: null }; } }, { syncPlaylists: false });
    expect(asked).toEqual([]);
  });
});

describe('sync:start and playlists missing from the provider list', () => {
  const LB = { 'scrobbler-config-listenbrainz': { userToken: 'LB-TOK' } };
  const event = { sender: { send() {} } };
  const from = (id, externalId) => ({ id, title: id, syncedFrom: { resolver: 'listenbrainz', externalId } });

  test('an imported playlist keeps its link; a copied one gives it up', async () => {
    const present = ['p1', 'p2', 'p3', 'p4'].map((x) => from(`listenbrainz-${x}`, x));
    const harness = makeHarness({
      provider: { fetchPlaylists: async () => ({ playlists: ['p1', 'p2', 'p3', 'p4'].map((externalId) => ({ externalId, name: externalId, tracks: [] })) }) },
      storeData: { ...LB, local_playlists: [from('listenbrainz-gone', 'gone'), from('local-copy', 'gone2'), ...present] },
    });
    const result = await harness.handlers.get('sync:start')(event, 'listenbrainz', { settings: { syncPlaylists: true } });
    expect(result.success).toBe(true);
    const saved = harness.store.data.local_playlists;
    expect(saved.find((p) => p.id === 'listenbrainz-gone').syncedFrom).toEqual({ resolver: 'listenbrainz', externalId: 'gone' });
    expect(saved.find((p) => p.id === 'local-copy').syncedFrom).toBeNull();
  });
});

describe('sync:start does not save over a link written during the pull', () => {
  const LB = { 'scrobbler-config-listenbrainz': { userToken: 'LB-TOK' } };
  const event = { sender: { send() {} } };

  test('a push that links a playlist mid-pull keeps its link', async () => {
    const links = {};
    let harness;
    harness = makeHarness({
      provider: {
        fetchPlaylists: async () => {
          // Another provider's push loop links the hosted playlist meanwhile.
          harness.store.data.local_playlists = harness.store.data.local_playlists.map((p) => (p.id === 'hosted-1'
            ? { ...p, syncedTo: { ...p.syncedTo, applemusic: { externalId: 'p.1', syncedAt: 5 } } }
            : p));
          links['hosted-1'] = { applemusic: { externalId: 'p.1' } };
          return { playlists: [] };
        },
      },
      storeData: { ...LB, local_playlists: [{ id: 'hosted-1', title: 'Hosted', syncedTo: { spotify: { externalId: 'sp1' } } }] },
      syncLinks: () => links,
    });
    const result = await harness.handlers.get('sync:start')(event, 'listenbrainz', { settings: { syncPlaylists: true } });
    expect(result.success).toBe(true);
    const saved = harness.store.data.local_playlists.find((p) => p.id === 'hosted-1');
    expect(saved.syncedTo.applemusic).toEqual({ externalId: 'p.1', syncedAt: 5 });
    expect(saved.syncedTo.spotify).toEqual({ externalId: 'sp1' });
  });
});

describe('sync:start pulls a changed import without asking', () => {
  const LB = { 'scrobbler-config-listenbrainz': { userToken: 'LB-TOK' } };
  const event = { sender: { send() {} } };
  const OLD = [{ title: 'Old', artist: 'A' }];
  const NEW = [{ title: 'New 1', artist: 'B' }, { title: 'New 2', artist: 'C' }];
  const imported = (externalId, over = {}) => ({
    id: `listenbrainz-${externalId}`,
    title: externalId,
    tracks: OLD,
    syncedFrom: { resolver: 'listenbrainz', externalId, snapshotId: 'snap-1' },
    syncSources: { listenbrainz: { syncedAt: 1000 } },
    lastModified: 1000,
    locallyModified: false,
    hasUpdates: false,
    ...over,
  });
  const remote = (externalId) => ({ id: `listenbrainz-${externalId}`, externalId, name: externalId, snapshotId: 'snap-2', trackCount: NEW.length });

  function run({ local, remotes, fetchPlaylistTracks, stagger }) {
    const fetched = [];
    const harness = makeHarness({
      ...(stagger ? { stagger } : {}),
      shortCircuit: ({ localPlaylist, remotePlaylist }) => localPlaylist.syncedFrom?.snapshotId === remotePlaylist.snapshotId,
      provider: {
        fetchPlaylists: async () => ({ playlists: remotes }),
        fetchPlaylistTracks: async (externalId) => {
          fetched.push(externalId);
          return fetchPlaylistTracks ? fetchPlaylistTracks(externalId, harness) : NEW;
        },
      },
      storeData: { ...LB, local_playlists: local },
    });
    return harness.handlers.get('sync:start')(event, 'listenbrainz', { settings: { syncPlaylists: true } })
      .then((result) => ({ result, harness, fetched, saved: (id) => harness.store.data.local_playlists.find((p) => p.id === id) }));
  }

  test('an unedited import takes the new tracks and snapshot, with no update flag left', async () => {
    const { result, saved } = await run({ local: [imported('abc')], remotes: [remote('abc')] });
    expect(result.success).toBe(true);
    const pl = saved('listenbrainz-abc');
    expect(pl.tracks).toEqual(NEW);
    expect(pl.syncedFrom.snapshotId).toBe('snap-2');
    expect(pl.hasUpdates).toBe(false);
    expect(result.results.playlists.updated).toBe(1);
  });

  test('a pulled rebuild keeps the playlist’s created date (Daily Brew read "Created" yesterday)', async () => {
    const JUNE = Date.parse('2026-06-27T18:41:56Z');
    const YESTERDAY = Date.parse('2026-11-19T10:13:14Z');
    const TODAY = Date.parse('2026-11-20T10:18:00Z');
    const local = imported('abc', { createdAt: YESTERDAY, syncSources: { listenbrainz: { syncedAt: 1000, addedAt: JUNE } } });
    const { saved } = await run({
      local: [local],
      remotes: [remote('abc')],
      fetchPlaylistTracks: () => [{ title: 'New 1', artist: 'B', addedAt: TODAY }, { title: 'Kept', artist: 'C', addedAt: YESTERDAY }],
    });
    expect(saved('listenbrainz-abc').tracks.map((t) => t.title)).toEqual(['New 1', 'Kept']);
    expect(saved('listenbrainz-abc').createdAt).toBe(JUNE);
  });

  test('a background cycle checks every snapshot: a rebuilt playlist is pulled though 20 others were waiting longer', async () => {
    const unchanged = Array.from({ length: 20 }, (_, i) => imported(`same${i}`, {
      syncedFrom: { resolver: 'listenbrainz', externalId: `same${i}`, snapshotId: 'snap-2' },
      syncSources: { listenbrainz: { syncedAt: 100 + i } },
    }));
    const daily = imported('daily', { syncSources: { listenbrainz: { syncedAt: 999999 } } });
    const { harness, fetched, saved } = await run({
      local: [...unchanged, daily],
      remotes: [...unchanged.map((p) => remote(p.syncedFrom.externalId)), remote('daily')],
      // The real batching (15 a cycle, longest unchecked first), under which
      // the 20 others would have taken the whole batch before.
      stagger: require('../../sync-engine').staggerPlaylistsForCycle,
    });
    expect(fetched).toEqual(['daily']);
    expect(saved('listenbrainz-daily').tracks).toEqual(NEW);
    for (let i = 0; i < 20; i++) {
      expect(saved(`listenbrainz-same${i}`).syncSources.listenbrainz.syncedAt).toBeGreaterThan(1000);
      expect(saved(`listenbrainz-same${i}`).tracks).toEqual(OLD);
    }
    expect(harness.store.reads.local_playlists).toBeLessThan(10);
  });

  test('a playlist stuck with the old update flag is pulled on the next sync', async () => {
    const { saved } = await run({ local: [imported('abc', { hasUpdates: true })], remotes: [remote('abc')] });
    expect(saved('listenbrainz-abc').tracks).toEqual(NEW);
    expect(saved('listenbrainz-abc').hasUpdates).toBe(false);
  });

  test('an import edited here is not overwritten: it is flagged as a conflict', async () => {
    const edited = imported('abc', { tracks: [], locallyModified: true, lastModified: 2000 });
    const { saved, fetched } = await run({ local: [edited], remotes: [remote('abc')] });
    const pl = saved('listenbrainz-abc');
    expect(fetched).toEqual([]);
    expect(pl.tracks).toEqual([]);
    expect(pl.syncedFrom.snapshotId).toBe('snap-1');
    expect(pl.hasUpdates).toBe(true);
  });

  test('an edit saved while the tracks were being fetched wins', async () => {
    const { saved } = await run({
      local: [imported('abc')],
      remotes: [remote('abc')],
      fetchPlaylistTracks: (externalId, harness) => {
        harness.store.data.local_playlists = harness.store.data.local_playlists.map((p) => (p.id === 'listenbrainz-abc'
          ? { ...p, tracks: [], locallyModified: true, lastModified: 3000 }
          : p));
        return NEW;
      },
    });
    const pl = saved('listenbrainz-abc');
    expect(pl.tracks).toEqual([]);
    expect(pl.syncedFrom.snapshotId).toBe('snap-1');
    expect(pl.hasUpdates).toBe(true);
  });

  test('an edit saved later in the same sync is not saved over by the pull', async () => {
    const { saved } = await run({
      local: [imported('abc'), imported('def')],
      remotes: [remote('abc'), remote('def')],
      fetchPlaylistTracks: (externalId, harness) => {
        if (externalId === 'def') {
          // The person edits "abc" after its pull, while "def" is fetched.
          harness.store.data.local_playlists = harness.store.data.local_playlists.map((p) => (p.id === 'listenbrainz-abc'
            ? { ...p, tracks: [], locallyModified: true, lastModified: 3000 }
            : p));
        }
        return NEW;
      },
    });
    expect(saved('listenbrainz-abc').tracks).toEqual([]);
    expect(saved('listenbrainz-abc').hasUpdates).toBe(true);
    expect(saved('listenbrainz-def').tracks).toEqual(NEW);
  });

  test('a new import records its tracks as agreed with the source', async () => {
    const { tracksFingerprint } = require('../../sync-engine/auto-pull');
    const { saved } = await run({ local: [], remotes: [remote('abc')] });
    expect(saved('listenbrainz-abc').syncedFrom.tracksFingerprint).toBe(tracksFingerprint(NEW));
  });

  test('an edit is still protected after a sync that found nothing new', async () => {
    const { tracksFingerprint } = require('../../sync-engine/auto-pull');
    // Edited here after an import that recorded its fingerprint; an unchanged
    // sync since then moved syncedAt past the edit and the push loop cleared
    // locallyModified once the other mirrors caught up.
    const edited = imported('abc', {
      tracks: [],
      syncedFrom: { resolver: 'listenbrainz', externalId: 'abc', snapshotId: 'snap-1', tracksFingerprint: tracksFingerprint(OLD) },
      syncSources: { listenbrainz: { syncedAt: 9000 } },
      lastModified: 2000,
      locallyModified: false,
    });
    const { saved, fetched } = await run({ local: [edited], remotes: [remote('abc')] });
    expect(fetched).toEqual([]);
    expect(saved('listenbrainz-abc').tracks).toEqual([]);
    expect(saved('listenbrainz-abc').hasUpdates).toBe(true);
  });

  test('a new import keeps the service\'s playlist cover', async () => {
    const { saved } = await run({ local: [], remotes: [{ ...remote('abc'), coverArt: 'https://img/abc.jpg' }] });
    expect(saved('listenbrainz-abc').coverArt).toBe('https://img/abc.jpg');
  });

  test('a later sync picks up a changed cover, and a removed one gives the mosaic back', async () => {
    const withCover = { ...imported('abc'), coverArt: 'https://img/old.jpg' };
    const changed = await run({ local: [withCover], remotes: [{ ...remote('abc'), coverArt: 'https://img/new.jpg' }] });
    expect(changed.saved('listenbrainz-abc').coverArt).toBe('https://img/new.jpg');
    const removed = await run({ local: [withCover], remotes: [{ ...remote('abc'), coverArt: null }] });
    expect(removed.saved('listenbrainz-abc').coverArt).toBeNull();
  });

  test('a service that reports no cover leaves the playlist\'s own alone', async () => {
    const withCover = { ...imported('abc'), coverArt: 'https://img/own.jpg' };
    const { saved } = await run({ local: [withCover], remotes: [remote('abc')] });
    expect(saved('listenbrainz-abc').coverArt).toBe('https://img/own.jpg');
  });

  test('a legacy edited import survives an unchanged sync, then comes out of a remote change as a conflict', async () => {
    // Imported before the fingerprint: only the old timestamp rule knows it
    // was edited, and an unchanged sync moves syncedAt past the edit.
    const legacy = imported('abc', {
      tracks: [],
      syncedFrom: { resolver: 'listenbrainz', externalId: 'abc', snapshotId: 'snap-1' },
      syncSources: { listenbrainz: { syncedAt: 50 } },
      locallyModified: true,
      lastModified: 100,
    });
    let snapshot = 'snap-1';
    const fetched = [];
    const harness = makeHarness({
      shortCircuit: ({ localPlaylist, remotePlaylist }) => localPlaylist.syncedFrom?.snapshotId === remotePlaylist.snapshotId,
      provider: {
        fetchPlaylists: async () => ({ playlists: [{ ...remote('abc'), snapshotId: snapshot }] }),
        fetchPlaylistTracks: async (externalId) => { fetched.push(externalId); return NEW; },
      },
      storeData: { ...LB, local_playlists: [legacy] },
    });
    const sync = () => harness.handlers.get('sync:start')(event, 'listenbrainz', { settings: { syncPlaylists: true } });
    const saved = () => harness.store.data.local_playlists.find((p) => p.id === 'listenbrainz-abc');

    await sync(); // unchanged: short-circuits, moves syncedAt
    expect(saved().syncSources.listenbrainz.syncedAt).toBeGreaterThan(100);
    // The push loop clears the flag once other mirrors catch up.
    harness.store.data.local_playlists = harness.store.data.local_playlists.map((p) => ({ ...p, locallyModified: false }));

    snapshot = 'snap-2';
    await sync();
    expect(fetched).toEqual([]);
    expect(saved().tracks).toEqual([]);
    expect(saved().syncedFrom.snapshotId).toBe('snap-1');
    expect(saved().hasUpdates).toBe(true);
  });

  test('a legacy unedited import is seeded on its first sync and pulled on a later change', async () => {
    const legacy = imported('abc', { syncedFrom: { resolver: 'listenbrainz', externalId: 'abc', snapshotId: 'snap-1' } });
    const { tracksFingerprint } = require('../../sync-engine/auto-pull');
    const { saved } = await run({ local: [legacy], remotes: [{ ...remote('abc'), snapshotId: 'snap-1' }] });
    expect(saved('listenbrainz-abc').syncedFrom.tracksFingerprint).toBe(tracksFingerprint(OLD));
  });

  test('a fetch the service refuses (429 after retries) fails that playlist and leaves it for the next sync', async () => {
    const { result, saved } = await run({
      local: [imported('abc', { hasUpdates: true })],
      remotes: [remote('abc')],
      fetchPlaylistTracks: () => { throw new Error('Spotify API rate limit exceeded after maximum retries'); },
    });
    expect(result.success).toBe(true);
    expect(result.results.playlists.failed).toBe(1);
    const pl = saved('listenbrainz-abc');
    expect(pl.tracks).toEqual(OLD);
    expect(pl.syncedFrom.snapshotId).toBe('snap-1');
  });

  test('a save during the sync that only moved lastModified (the sources flush) still takes the pull', async () => {
    const { saved } = await run({
      local: [imported('abc'), imported('def')],
      remotes: [remote('abc'), remote('def')],
      fetchPlaylistTracks: (externalId, harness) => {
        if (externalId === 'def') {
          harness.store.data.local_playlists = harness.store.data.local_playlists.map((p) => (p.id === 'listenbrainz-abc'
            ? { ...p, lastModified: 3000, tracks: p.tracks.map((t) => ({ ...t, sources: { x: {} } })) }
            : p));
        }
        return NEW;
      },
    });
    expect(saved('listenbrainz-abc').tracks).toEqual(NEW);
    expect(saved('listenbrainz-abc').hasUpdates).toBe(false);
  });

  test('a hosted XSPF is never pulled from the service', async () => {
    const hosted = imported('abc', { sourceUrl: 'https://example.com/list.xspf', source: 'hosted' });
    const { saved, fetched } = await run({ local: [hosted], remotes: [remote('abc')] });
    expect(fetched).toEqual([]);
    expect(saved('listenbrainz-abc').tracks).toEqual(OLD);
  });
});

describe('activeSyncs wiring', () => {
  const LB_STORE = { 'scrobbler-config-listenbrainz': { userToken: 'LB-TOK' } };

  test('a second sync:start for the same provider is refused while one runs', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { handlers, event } = makeHarness({
      storeData: LB_STORE,
      provider: { fetchPlaylists: async () => { await gate; return { playlists: [] }; } },
    });
    const first = handlers.get('sync:start')(event, 'listenbrainz', {});
    const second = await handlers.get('sync:start')(event, 'listenbrainz', {});
    expect(second).toEqual({ success: false, error: 'Sync already in progress' });
    release();
    await expect(first).resolves.toMatchObject({ success: true });
  });

  test('sync:cancel flags the active sync (#799) and the running start returns cancelled:true', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { handlers, event } = makeHarness({
      storeData: LB_STORE,
      SyncEngineSyncGate: gate,
    });
    const first = handlers.get('sync:start')(event, 'listenbrainz', {});
    await new Promise((r) => setTimeout(r, 20)); // let it reach the tracks phase
    const cancelled = await handlers.get('sync:cancel')(null, 'listenbrainz');
    expect(cancelled).toEqual({ success: true });
    release();
    await expect(first).resolves.toMatchObject({ success: true, cancelled: true });
    await expect(handlers.get('sync:cancel')(null, 'listenbrainz')).resolves.toEqual({ success: false, error: 'No active sync' });
  });
});

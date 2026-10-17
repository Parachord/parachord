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

function makeHarness({ provider = {}, storeData = {}, spotifyToken = 'SP-TOK', generatedToken = 'AM-DEV', SyncEngineSyncGate = null } = {}) {
  const store = {
    data: { ...storeData },
    get(k) { return this.data[k]; },
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
    staggerPlaylistsForCycle: (x) => x,
    canShortCircuitPlaylistUpdate: () => true,
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
    getSyncLinks: () => ({}),
    legacyPlaylistSyncEnabled: () => true,
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

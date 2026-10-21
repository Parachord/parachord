/**
 * Registration smoke test — every main-process IPC module, registered together.
 *
 * The unit suites drive individual handlers with hand-built deps, so two
 * failure classes are invisible to them until a real user's sync hits the
 * line:
 *   1. a dep the registration forgot to inject (#1049 missed
 *      buildAppleMusicRefreshCb — defined-but-undefined, "not a function"
 *      only when the handler runs it);
 *   2. two modules claiming the same channel (impossible to see while the
 *      handlers all lived in one main.js; now that they are six modules a
 *      copy/paste channel name would silently shadow a handler —
 *      ipcMain.handle throws on duplicates in production, so the shared
 *      fake below reproduces exactly that).
 *
 * Here every register*Ipc is called with permissive fakes against ONE shared
 * ipcMain, then every registered handler is invoked once with generic args.
 * Only the missing-injection error classes fail the test (ReferenceError,
 * "X is not a function", "cannot read properties of undefined/null");
 * handler-specific failures from the generic args (unknown provider, not
 * authenticated, …) are expected and ignored — the dedicated suites cover
 * those paths.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerStoreIpc } = require('../../main-process/ipc/store');
const { registerMusicKitIpc } = require('../../main-process/ipc/musickit');
const { registerLocalFilesIpc } = require('../../main-process/ipc/local-files');
const { registerSyncCreateIpc } = require('../../main-process/ipc/sync-create');
const { registerSyncStartIpc } = require('../../main-process/ipc/sync-start');
const { registerSyncPlaylistsIpc } = require('../../main-process/ipc/sync-playlists');
const { registerDiscordPresenceIpc } = require('../../main-process/ipc/discord-presence');
const { registerAuthServerIpc } = require('../../main-process/ipc/auth-server');
const { registerEmbeddedPlayerIpc } = require('../../main-process/ipc/embedded-player');
const { createSyncLinks } = require('../../main-process/sync-links');

// Error classes that mean "the registration forgot something":
// an undefined free variable, an undefined injected dep, or a dep object
// missing the member a handler dereferences.
const MISSING_INJECTION = /is not defined|is not a function|Cannot read propert(y|ies) of (undefined|null)/;

function makeSharedIpcMain() {
  const handlers = new Map();
  // `handle` (invoke) and `on` (send) share one channel map so a channel
  // claimed twice — in either API — fails exactly like production, where
  // ipcMain throws on a duplicate `handle` and the last `on` listener would
  // silently shadow earlier ones.
  const ipcMain = {
    handle(channel, fn) {
      if (handlers.has(channel)) {
        throw new Error(`Duplicate IPC channel registration: "${channel}"`);
      }
      handlers.set(channel, fn);
    },
    on(channel, fn) {
      if (handlers.has(channel)) {
        throw new Error(`Duplicate IPC channel registration: "${channel}"`);
      }
      handlers.set(channel, fn);
    },
  };
  return { ipcMain, handlers };
}

function makeFakes() {
  const data = new Map();
  const store = {
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
    delete: (k) => data.delete(k),
    clear: () => data.clear(),
    get store() { return Object.fromEntries(data); },
  };

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-smoke-userdata-'));
  const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-smoke-plugins-'));

  // A service/bridge whose every method awaits to an empty object. Handlers
  // that check for null providers bail before touching it; handlers that
  // call through get benign {} results.
  const anyObjectService = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return async () => ({});
    },
  });

  // A permissive SyncEngine provider: present, playlist-capable, and shaped
  // so the thin sync handlers run PAST their guards into the token/refresh
  // wiring (where the historical missed injections lived) without any real
  // network. Methods that get destructured get real shapes; everything else
  // awaits to {}.
  const providerOverrides = {
    fetchPlaylists: async () => ({ playlists: [], folders: [] }),
  };
  const anyProvider = new Proxy({ id: 'spotify', displayName: 'Spotify', capabilities: { playlists: true } }, {
    get: (target, prop) => {
      if (prop in target) return target[prop];
      if (prop in providerOverrides) return providerOverrides[prop];
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return async () => ({});
    },
  });

  const syncLinks = createSyncLinks({ store });

  return {
    store,
    app: { getPath: () => userDataDir },
    getPluginsCacheDir: () => pluginsDir,
    getMusicKitBridge: () => anyObjectService,
    getDeveloperToken: async () => 'DEV_TOKEN',
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getMainWindow: () => null,
    waitForLocalFilesService: async () => anyObjectService,
    safeSendToRenderer: () => {},
    SyncEngine: { getProvider: () => anyProvider, getAllProviders: () => [] },
    legacyPlaylistSyncEnabled: () => true,
    getChannelOverride: () => null,
    resolveProviderToken: async () => ({ token: 'TOKEN', refreshTokenCb: async () => 'TOKEN2' }),
    lbHydrationOpts: () => undefined,
    achordion: {
      buildLocalPlaylistMirrorContext: () => ({}),
      pushPlaylistLinksToAchordion: async () => {},
    },
    syncLinks,
    ensureValidSpotifyToken: async () => 'SPOTIFY_TOKEN',
    getGeneratedMusicKitToken: async () => 'GENERATED_TOKEN',
    writeCollectionAtomic: async () => {},
    awaitGeneratedMusicKitToken: async () => 'GENERATED_TOKEN',
    readGeneratedMusicKitToken: () => 'GENERATED_TOKEN',
    relinkOrphansFor: async () => ({}),
    removePlaylistSyncState: () => {},
    buildAppleMusicRefreshCb: () => async () => {},
    deleteRemotePlaylistBestEffort: async () => ({ success: true }),
  };
}

// Generic argument shapes that satisfy the common handler signatures
// (event, providerId[, name, description, tracks, localPlaylistId]). One pass
// per provider id — provider-specific branches inside handlers (spotify
// scopes, applemusic dev/user token + refresh wiring, listenbrainz config)
// only run for their own id, and the historical missed injections lived in
// exactly those branches.
const PROVIDER_ARG_SETS = [
  ['spotify', 'name', 'description', [], 'local-playlist-1'],
  ['applemusic', 'name', 'description', [], 'local-playlist-1'],
  ['listenbrainz', 'name', 'description', [], 'local-playlist-1'],
];

describe('registration smoke — all IPC modules together', () => {
  const { ipcMain, handlers } = makeSharedIpcMain();
  const fakes = makeFakes();

  registerStoreIpc({ ipcMain, store: fakes.store, app: fakes.app, getPluginsCacheDir: fakes.getPluginsCacheDir });
  registerMusicKitIpc({ ipcMain, getMusicKitBridge: fakes.getMusicKitBridge, getDeveloperToken: fakes.getDeveloperToken });
  registerLocalFilesIpc({
    ipcMain, dialog: fakes.dialog, getMainWindow: fakes.getMainWindow,
    waitForLocalFilesService: fakes.waitForLocalFilesService, safeSendToRenderer: fakes.safeSendToRenderer,
  });
  registerSyncCreateIpc({
    ipcMain, SyncEngine: fakes.SyncEngine, legacyPlaylistSyncEnabled: fakes.legacyPlaylistSyncEnabled,
    getChannelOverride: fakes.getChannelOverride, resolveProviderToken: fakes.resolveProviderToken,
    lbHydrationOpts: fakes.lbHydrationOpts, achordion: fakes.achordion, syncLinks: fakes.syncLinks,
  });
  registerSyncStartIpc({
    ipcMain, SyncEngine: fakes.SyncEngine, store: fakes.store, app: fakes.app,
    ensureValidSpotifyToken: fakes.ensureValidSpotifyToken,
    getGeneratedMusicKitToken: fakes.getGeneratedMusicKitToken,
    writeCollectionAtomic: fakes.writeCollectionAtomic, getSyncLinks: fakes.syncLinks.getSyncLinks,
    legacyPlaylistSyncEnabled: fakes.legacyPlaylistSyncEnabled, getChannelOverride: fakes.getChannelOverride,
  });
  registerSyncPlaylistsIpc({
    ipcMain, SyncEngine: fakes.SyncEngine, store: fakes.store,
    ensureValidSpotifyToken: fakes.ensureValidSpotifyToken,
    awaitGeneratedMusicKitToken: fakes.awaitGeneratedMusicKitToken,
    readGeneratedMusicKitToken: fakes.readGeneratedMusicKitToken,
    lbHydrationOpts: fakes.lbHydrationOpts, getChannelOverride: fakes.getChannelOverride,
    legacyPlaylistSyncEnabled: fakes.legacyPlaylistSyncEnabled, relinkOrphansFor: fakes.relinkOrphansFor,
    removePlaylistSyncState: fakes.removePlaylistSyncState,
    buildAppleMusicRefreshCb: fakes.buildAppleMusicRefreshCb,
    deleteRemotePlaylistBestEffort: fakes.deleteRemotePlaylistBestEffort,
    achordion: fakes.achordion, syncLinks: fakes.syncLinks,
  });
  registerEmbeddedPlayerIpc({
    ipcMain, safeSendToRenderer: fakes.safeSendToRenderer,
    mediaKeysEnabled: () => true,
  });
  fakes.syncLinks.registerSyncLinksIpc({ ipcMain });
  // The presence manager injected here is a stub, not the real one — the
  // smoke run invokes every handler, and set-enabled must not open a real
  // Discord socket attempt from inside jest.
  registerDiscordPresenceIpc({
    ipcMain, store: fakes.store,
    createPresence: () => ({
      setEnabled: () => ({ enabled: true, status: 'connected' }),
      getStatus: () => ({ enabled: false, status: 'off', connected: false, connecting: false }),
      setTrack: () => {},
      updateState: () => {},
      setPlaybackStatus: () => {},
      setPosition: () => {},
      clear: () => {},
      dispose: () => {},
    }),
  });

  registerAuthServerIpc({
    ipcMain, store: fakes.store,
    getAuthServerState: () => ({ port: 8888, listening: true, error: null }),
  });

  test('the full decomposed surface registers with no duplicate channels', () => {
    // Eight IPC modules + the sync-links factory. If a module silently stops
    // registering (or two claim one channel), this count or the shared
    // ipcMain above catches it.
    expect(handlers.size).toBeGreaterThanOrEqual(65);
    expect([...handlers.keys()].filter((c) => c.startsWith('discordrpc:')).length).toBe(7);
    expect([...handlers.keys()].filter((c) => c.startsWith('auth-server:')).length).toBe(2);
    expect([...handlers.keys()].filter((c) => c.startsWith('sync:')).length).toBeGreaterThanOrEqual(20);
  });

  test.each([...handlers.keys()])('%s does not throw a missing-injection error on a minimal invocation', async (channel) => {
    await expect((async () => {
      for (const args of PROVIDER_ARG_SETS) {
        try {
          await handlers.get(channel)(null, ...args);
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          if (MISSING_INJECTION.test(msg)) {
            throw new Error(`${channel} [${args[0]}]: ${msg}`);
          }
          // Any other failure is the handler legitimately rejecting the
          // generic args (unknown provider, not authenticated, cancelled
          // dialog, …) — not this test's concern.
        }
      }
    })()).resolves.toBeUndefined();
  });
});

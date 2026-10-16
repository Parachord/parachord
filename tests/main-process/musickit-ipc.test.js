/**
 * main-process/ipc/musickit.js — the MusicKit IPC surface, driven directly with
 * an injected fake bridge (no electron require in the module, by design).
 *
 * Verifies the full channel surface, per-channel delegation (method + args +
 * result spread), the uniform error shape, and the fetch-user-token
 * developer-token gate.
 */

const { registerMusicKitIpc } = require('../../main-process/ipc/musickit');

// channel → [bridge method, ...args the IPC layer passes through]. Handlers with
// non-uniform result shapes are asserted separately below.
const UNIFORM_CHANNELS = {
  'musickit:check-auth': ['getAuthStatus', true],
  'musickit:authorize': ['authorize'],
  'musickit:fetch-user-token': ['fetchUserToken', 'DEV_TOKEN'],
  'musickit:search': ['search', 'radiohead', 25],
  'musickit:resolve': ['resolve', 'artist', 'title', 'album'],
  'musickit:play': ['play', 'songId'],
  'musickit:pause': ['pause'],
  'musickit:resume': ['resume'],
  'musickit:stop': ['stop_playback'],
  'musickit:skip-next': ['skipToNext'],
  'musickit:skip-previous': ['skipToPrevious'],
  'musickit:seek': ['seek', 42000],
  'musickit:get-playback-state': ['getPlaybackState'],
  'musickit:get-now-playing': ['getNowPlaying'],
  'musickit:add-to-queue': ['addToQueue', 'songId'],
  'musickit:set-volume': ['setVolume', 55],
};

const ALL_CHANNELS = {
  ...UNIFORM_CHANNELS,
  'musickit:available': ['isAvailable'],
  'musickit:start': ['start'],
  'musickit:get-cached-auth': ['getCachedAuthStatus'],
  'musickit:unauthorize': ['unauthorize'],
};

function makeHarness({ developerToken = 'DEV_TOKEN', bridgeImpl } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };

  const calls = [];
  const bridge = {};
  // Methods whose real contracts differ from the marker-returning norm:
  // isAvailable passes through bare; start returns a boolean; unauthorize's
  // return is ignored; getCachedAuthStatus is SYNCHRONOUS (the handler does
  // not await it).
  const SPECIAL = {
    isAvailable: () => true,
    start: async () => true,
    unauthorize: async () => undefined,
    getCachedAuthStatus: () => null,
  };
  for (const [channel, [method, ...args]] of Object.entries(ALL_CHANNELS)) {
    if (SPECIAL[method] && !bridgeImpl) {
      bridge[method] = SPECIAL[method];
      continue;
    }
    bridge[method] = bridgeImpl
      ? async (...given) => bridgeImpl(method, given)
      : async (...given) => {
          calls.push({ method, given });
          return { marker: `${method}-result` };
        };
  }

  const getMusicKitBridge = () => bridge;
  const getDeveloperToken = developerToken === null
    ? async () => null
    : developerToken instanceof Error
      ? async () => { throw developerToken; }
      : async () => developerToken;

  registerMusicKitIpc({ ipcMain, getMusicKitBridge, getDeveloperToken });
  return { handlers, calls, bridge };
}

describe('musickit IPC surface', () => {
  test('registers exactly the full channel surface (token-status stays in main.js)', () => {
    const { handlers } = makeHarness();
    expect([...handlers.keys()].sort()).toEqual(Object.keys(ALL_CHANNELS).sort());
  });

  test.each(Object.entries(UNIFORM_CHANNELS))('%s delegates to the bridge and spreads the result', async (channel, [method, ...args]) => {
    const { handlers, calls } = makeHarness();
    const result = await handlers.get(channel)(null, ...args);
    expect(result).toEqual({ success: true, marker: `${method}-result` });
    expect(calls).toEqual([{ method, given: args }]);
  });

  test('the non-uniform handlers keep their exact contracts', async () => {
    const { handlers } = makeHarness();
    // start: { success: <started> } — no result spread
    expect(await handlers.get('musickit:start')()).toEqual({ success: true });
    // unauthorize: plain success, no result spread
    expect(await handlers.get('musickit:unauthorize')()).toEqual({ success: true });
  });

  test('get-cached-auth spreads a hit and reports a miss without throwing', async () => {
    const { handlers, bridge } = makeHarness();
    expect(await handlers.get('musickit:get-cached-auth')()).toEqual({ success: false, cached: false, authorized: false });
    bridge.getCachedAuthStatus = () => ({ authorized: true, userToken: 'tok' });
    expect(await handlers.get('musickit:get-cached-auth')()).toEqual({ success: true, cached: true, authorized: true, userToken: 'tok' });
  });

  test('available is a bare pass-through (no success wrapper)', async () => {
    const { handlers, bridge } = makeHarness();
    expect(await handlers.get('musickit:available')()).toBe(true);
    bridge.isAvailable = () => false;
    expect(await handlers.get('musickit:available')()).toBe(false);
  });

  test('a bridge error becomes { success: false, error } without throwing (available is a bare pass-through and propagates)', async () => {
    const { handlers } = makeHarness({ bridgeImpl: async () => { throw new Error('bridge exploded'); } });
    for (const channel of Object.keys(UNIFORM_CHANNELS)) {
      await expect(handlers.get(channel)(null)).resolves.toEqual({ success: false, error: 'bridge exploded' });
    }
    await expect(handlers.get('musickit:available')()).rejects.toThrow('bridge exploded');
  });

  test('fetch-user-token passes the resolved developer token to the bridge', async () => {
    const { handlers, calls } = makeHarness({ developerToken: 'a-real-token' });
    const result = await handlers.get('musickit:fetch-user-token')();
    expect(result).toEqual({ success: true, marker: 'fetchUserToken-result' });
    expect(calls).toEqual([{ method: 'fetchUserToken', given: ['a-real-token'] }]);
  });

  test('fetch-user-token with no developer token fails without touching the bridge', async () => {
    const { handlers, calls } = makeHarness({ developerToken: null });
    await expect(handlers.get('musickit:fetch-user-token')()).resolves.toEqual({
      success: false,
      error: 'No developer token available',
    });
    expect(calls).toEqual([]);
  });

  test('check-auth forwards forceRefresh (the cache-bypass flag survives the move)', async () => {
    const { handlers, calls } = makeHarness();
    await handlers.get('musickit:check-auth')(null, true);
    await handlers.get('musickit:check-auth')(null, false);
    expect(calls.map((c) => c.given[0])).toEqual([true, false]);
  });
});

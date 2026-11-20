/**
 * The plug-in host contract (#1561; docs/architecture/plugins.md "The plug-in
 * host contract"), held for Amazon Music, its first plugin: the same .axe
 * runs two ways.
 *   - On a host with the contract (a phone, or this desktop build): bridges
 *     come only from this.host, built by the real ResolverLoader from a
 *     supplier, and there is no window.electron at all.
 *   - On an older desktop build (no this.host): bridges come from
 *     window.electron, as before.
 * Search, the status read, the app version and cleanup's Widevine stop must
 * work both ways.
 */

const ResolverLoader = require('../../resolver-loader');
const {
  loadAmazonAxe,
  instantiateAmazonPlugin,
  amazonWebSessionMock,
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();
const TRACKS = [{ asin: 'B001', uniqueId: 'u1', title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', duration: 320 }];

// The mock installs itself as window.electron.webSession; take it back out,
// so the plugin can only reach it through this.host.
function phoneBridge(opts) {
  const ws = amazonWebSessionMock({ tracks: TRACKS, ...opts });
  global.window = {};
  return ws;
}

function loadWithHost(bridges, extra = {}) {
  const loader = new ResolverLoader({
    host: { platform: 'android', appVersion: () => '1.7.0', getConfig: () => ({}), openExternal: async () => true, bridges, ...extra },
  });
  return loader.createResolverInstance(axe);
}

afterEach(() => {
  delete global.window;
});

describe('Amazon Music on a host with the contract (no window.electron)', () => {
  test('the loader hands it webSession, and widevine only when the host has one', () => {
    const ws = phoneBridge();
    const withoutPlayer = loadWithHost({ webSession: () => ws });
    expect(Object.keys(withoutPlayer.host).sort()).toEqual(['appVersion', 'getConfig', 'openExternal', 'platform', 'webSession']);
    const withPlayer = loadWithHost({ webSession: () => ws, widevine: () => ({ stop() {} }), localFiles: () => ({}) });
    // localFiles is supplied but undeclared, so the plugin never sees it.
    expect(Object.keys(withPlayer.host).sort()).toEqual(['appVersion', 'getConfig', 'openExternal', 'platform', 'webSession', 'widevine']);
  });

  test('search runs over this.host.webSession', async () => {
    const ws = phoneBridge();
    const resolver = loadWithHost({ webSession: () => ws });
    const results = await resolver.search('daft punk one more time', {});
    expect(ws.pageFetch.mock.calls.length + ws.load.mock.calls.length).toBeGreaterThan(0);
    expect(results.map((t) => t.title)).toContain('One More Time');
  });

  test('the status read runs over this.host.webSession', async () => {
    const ws = phoneBridge();
    const resolver = loadWithHost({ webSession: () => ws });
    const status = await resolver.getStatus({});
    expect(ws.state).toHaveBeenCalled();
    expect(status).toEqual(expect.any(Object));
  });

  test('with no bridge on this.host it reads as unavailable, never a window.electron call', async () => {
    global.window = { electron: { webSession: { state: () => { throw new Error('must not be reached'); } } } };
    const resolver = loadWithHost({});
    expect(resolver.host.webSession).toBeUndefined();
    expect(resolver.hostBridge('webSession')).toBeNull();
    expect(await resolver.search('daft punk', {})).toEqual([]);
  });

  test('the app version comes from this.host', async () => {
    phoneBridge();
    const resolver = loadWithHost({});
    expect(await resolver.appVersion()).toBe('1.7.0');
  });

  test('cleanup stops the host’s Widevine player when it has one, and is fine without', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    global.window = { __parachordWidevine: { stop: () => { throw new Error('must not be reached'); } } };
    await loadWithHost({ widevine: () => ({ stop }) }).cleanup();
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(loadWithHost({}).cleanup()).resolves.toBeUndefined();
  });
});

describe('Amazon Music on an older desktop build (no this.host)', () => {
  test('search runs over window.electron.webSession', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    expect(resolver.host).toBeUndefined();
    const results = await resolver.search('daft punk one more time', {});
    expect(results.map((t) => t.title)).toContain('One More Time');
    expect(ws.state).toHaveBeenCalled();
  });

  test('a loader with no supplier sets this.host to null, and the fallback still works', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = new ResolverLoader().createResolverInstance(axe);
    expect(resolver.host).toBeNull();
    const results = await resolver.search('daft punk one more time', {});
    expect(results.map((t) => t.title)).toContain('One More Time');
    expect(ws.state).toHaveBeenCalled();
  });

  test('the app version comes from window.electron.updater, else "dev"', async () => {
    global.window = { electron: { updater: { getVersion: async () => '0.9.13' } } };
    expect(await instantiateAmazonPlugin(axe).appVersion()).toBe('0.9.13');
    global.window = {};
    expect(await instantiateAmazonPlugin(axe).appVersion()).toBe('dev');
  });

  test('cleanup stops window.__parachordWidevine', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    global.window = { __parachordWidevine: { stop } };
    await instantiateAmazonPlugin(axe).cleanup();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

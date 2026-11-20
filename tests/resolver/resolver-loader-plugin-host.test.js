/**
 * The loader's half of the plug-in host contract (#1561;
 * docs/architecture/plugins.md "The plug-in host contract"): each plugin's
 * frozen `this.host`, holding the core plus exactly the bridges its manifest
 * declares that the host supplies.
 */

const ResolverLoader = require('../../resolver-loader');

const supplier = (over = {}) => ({
  platform: 'desktop',
  appVersion: () => '0.9.14',
  getConfig: (id) => ({ pluginId: id }),
  openExternal: jest.fn().mockResolvedValue(true),
  bridges: { webSession: () => ({ name: 'ws' }), widevine: () => ({ name: 'wv' }), localFiles: () => ({ name: 'lf' }) },
  ...over,
});

const axe = (requires, implementation = {}) => ({
  manifest: { id: 'probe', name: 'Probe', version: '1.0.0' },
  capabilities: {},
  ...(requires ? { requires } : {}),
  implementation: { readHost: 'function () { return this.host; }', ...implementation },
});

const CORE = ['appVersion', 'getConfig', 'openExternal', 'platform'];

describe('this.host', () => {
  test('a plugin that declares nothing gets the core only, even when the host has bridges', () => {
    const r = new ResolverLoader({ host: supplier() }).createResolverInstance(axe());
    expect(Object.keys(r.readHost()).sort()).toEqual(CORE);
    expect(r.readHost().platform).toBe('desktop');
  });

  test('declared bridges, required and optional, are keys named as declared; undeclared ones are absent', () => {
    const r = new ResolverLoader({ host: supplier() }).createResolverInstance(
      axe({ hostBridges: ['webSession'], optionalHostBridges: ['widevine'] }));
    expect(Object.keys(r.host).sort()).toEqual([...CORE, 'webSession', 'widevine'].sort());
    expect(r.host.webSession).toEqual({ name: 'ws' });
    expect(r.host.widevine).toEqual({ name: 'wv' });
    expect('localFiles' in r.host).toBe(false);
  });

  test('an optional bridge the host lacks is left off', () => {
    const r = new ResolverLoader({ host: supplier({ bridges: { webSession: () => ({}) } }) }).createResolverInstance(
      axe({ hostBridges: ['webSession'], optionalHostBridges: ['widevine'] }));
    expect('widevine' in r.host).toBe(false);
  });

  test('a bridge is read when asked, so one the host sets up after load is the live object', () => {
    let live = null;
    const r = new ResolverLoader({ host: supplier({ bridges: { widevine: () => live } }) }).createResolverInstance(
      axe({ optionalHostBridges: ['widevine'] }));
    expect(r.host.widevine).toBeNull();
    live = { stop() {} };
    expect(r.host.widevine).toBe(live);
  });

  test('frozen: a plugin can’t add to it or swap a bridge out', () => {
    const r = new ResolverLoader({ host: supplier() }).createResolverInstance(axe({ hostBridges: ['webSession'] }));
    expect(Object.isFrozen(r.host)).toBe(true);
    const before = r.host.webSession;
    try { r.host.webSession = { evil: true }; } catch (e) { /* strict mode throws */ }
    try { r.host.localFiles = {}; } catch (e) { /* strict mode throws */ }
    expect(r.host.webSession).toEqual(before);
    expect('localFiles' in r.host).toBe(false);
  });

  test('a bridge name can’t shadow the core', () => {
    const r = new ResolverLoader({ host: supplier({ bridges: { getConfig: () => 'shadow' } }) }).createResolverInstance(
      axe({ hostBridges: ['getConfig'] }));
    expect(typeof r.host.getConfig).toBe('function');
  });

  test('each plugin gets its own object, with its own id bound into getConfig', async () => {
    const loader = new ResolverLoader({ host: supplier() });
    const a = loader.createResolverInstance(axe());
    const b = loader.createResolverInstance({ ...axe(), manifest: { id: 'other', name: 'Other', version: '1.0.0' } });
    expect(a.host).not.toBe(b.host);
    expect(await a.host.getConfig()).toEqual({ pluginId: 'probe' });
    expect(await b.host.getConfig()).toEqual({ pluginId: 'other' });
  });

  test('appVersion is "dev" when the host can’t say; getConfig is {} when there is none', async () => {
    const r = new ResolverLoader({ host: supplier({ appVersion: () => null, getConfig: () => null }) }).createResolverInstance(axe());
    expect(await r.host.appVersion()).toBe('dev');
    expect(await r.host.getConfig()).toEqual({});
  });

  test('openExternal opens https links only', async () => {
    const s = supplier();
    const r = new ResolverLoader({ host: s }).createResolverInstance(axe());
    await r.host.openExternal('https://example.com/a');
    expect(s.openExternal).toHaveBeenCalledWith('https://example.com/a');
    for (const bad of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 42, null]) {
      await expect(r.host.openExternal(bad)).rejects.toThrow('https');
    }
    expect(s.openExternal).toHaveBeenCalledTimes(1);
  });

  test('no supplier: this.host is null (tests, older call sites)', () => {
    const r = new ResolverLoader().createResolverInstance(axe({ hostBridges: ['webSession'] }));
    expect(r.host).toBeNull();
  });

  test('a malformed declaration is no declaration', () => {
    const loader = new ResolverLoader({ host: supplier() });
    for (const requires of [{ hostBridges: 'webSession' }, { hostBridges: [''] }, ['webSession'], { optionalHostBridges: [3] }]) {
      expect(Object.keys(loader.createResolverInstance(axe(requires)).host).sort()).toEqual(CORE);
    }
  });

  test('`host` is a reserved implementation key', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = new ResolverLoader({ host: supplier() }).createResolverInstance(
      axe(null, { host: 'function () { return "clobbered"; }' }));
    expect(typeof r.host).toBe('object');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"host"'));
    warn.mockRestore();
  });

  test('init gets the same object as its second argument', async () => {
    const loader = new ResolverLoader({ host: supplier() });
    await loader.loadResolver(axe(null, { init: 'async function (config, host) { this.seen = host; }' }));
    await loader.initResolver('probe', {}, { getConfig: async () => ({ from: 'caller' }) });
    const r = loader.getResolver('probe');
    expect(r.seen).toBe(r.host);
  });

  test('without a built host, init still gets the caller’s (playback telemetry on an old path)', async () => {
    const loader = new ResolverLoader();
    await loader.loadResolver(axe(null, { init: 'async function (config, host) { this.seen = host; }' }));
    const callers = { getConfig: async () => ({}) };
    await loader.initResolver('probe', {}, callers);
    expect(loader.getResolver('probe').seen).toBe(callers);
  });
});

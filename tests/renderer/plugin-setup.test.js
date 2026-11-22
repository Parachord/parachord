/**
 * #1522: Settings › Plug-Ins' "Needs setup" mark comes from one map built in
 * app.js (lib/plugin-setup.js), never a branch per service; and every
 * sign-out that turns its plug-in off goes through one deactivate path
 * (lib/deactivate-resolver.js).
 */
const fs = require('fs');
const path = require('path');

const { statusSignedIn, signedInMap, needsSetup, needsSetupMap } = require('../../src/renderer/lib/plugin-setup');
const { deactivateResolver } = require('../../src/renderer/lib/deactivate-resolver');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('src/renderer/app.js');
const page = read('src/renderer/components/settings-page.js');

// A plug-in nobody has heard of, reporting its own status.
const withStatus = { id: 'fakeservice', capabilities: { resolve: true, status: true } };

describe('setup state follows the plug-in status surface', () => {
  test('a status plug-in reporting signed out needs setup', () => {
    expect(needsSetupMap([withStatus], { statuses: { fakeservice: { signedIn: false } } })).toEqual({ fakeservice: true });
  });

  test('a status plug-in reporting signed in does not', () => {
    expect(needsSetupMap([withStatus], { statuses: { fakeservice: { signedIn: true, statusLabel: 'Signed in' } } })).toEqual({});
  });

  test('no verdict yet (not read, failed read, a reply without signedIn) is not marked', () => {
    expect(needsSetupMap([withStatus], {})).toEqual({});
    expect(needsSetupMap([withStatus], { statuses: { fakeservice: { failed: true } } })).toEqual({});
    expect(needsSetupMap([withStatus], { statuses: { fakeservice: { statusLabel: 'Checking' } } })).toEqual({});
    expect(statusSignedIn(null)).toBe(null);
  });

  test('the plug-in reply wins over what the host holds for the same id', () => {
    expect(signedInMap({ fakeservice: true }, { fakeservice: { signedIn: false } })).toEqual({ fakeservice: false });
    expect(signedInMap({ fakeservice: true }, { fakeservice: { failed: true } })).toEqual({ fakeservice: true });
  });

  test('a host sign-in or host fact decides for a plug-in without status', () => {
    const r = { id: 'hosted', capabilities: { resolve: true } };
    expect(needsSetupMap([r], { host: { hosted: false } })).toEqual({ hosted: true });
    expect(needsSetupMap([r], { host: { hosted: true } })).toEqual({});
  });

  test('otherwise the manifest decides: isConfigured, then the settings fields it needs', () => {
    const answers = (ok) => ({ id: 'selfconfig', capabilities: {}, isConfigured: () => ok });
    expect(needsSetup(answers(false), {})).toBe(true);
    expect(needsSetup(answers(true), {})).toBe(false);
    // isConfigured throwing is treated as configured, as the grid always did.
    expect(needsSetup({ id: 'x', capabilities: {}, isConfigured: () => { throw new Error('boom'); } }, {})).toBe(false);
    const fields = { id: 'server', capabilities: {}, configurable: { serverUrl: { label: 'Server' } } };
    expect(needsSetupMap([fields], { configs: {} })).toEqual({ server: true });
    expect(needsSetupMap([fields], { configs: { server: { serverUrl: 'http://x' } } })).toEqual({});
    // Nothing to fill in: set up.
    expect(needsSetupMap([{ id: 'free', capabilities: { resolve: true } }], {})).toEqual({});
  });
});

describe('the Plug-Ins grid reads the map', () => {
  test('settings-page.js has no per-service setup condition', () => {
    const start = page.indexOf('const needsConfiguration');
    expect(start).toBeGreaterThan(-1);
    // A signed-out plug-in's tile says "Sign in" instead (#1614).
    expect(page.slice(start, page.indexOf('\n', start))).toBe('const needsConfiguration = isActive && !signInNeeded && !!(pluginNeedsSetup && pluginNeedsSetup[resolver.id]);');
    for (const gone of ['spotifyConnected', 'appleMusicConnected', 'soundcloudConnected', 'watchFolders', 'pluginStatuses']) {
      expect(page).not.toContain(gone);
    }
  });

  test('app.js builds it from the host sign-ins, the music folders, the status replies and the saved settings', () => {
    const memo = app.slice(app.indexOf('const pluginNeedsSetup = useMemo('), app.indexOf('const pluginSetupNeeded = useMemo('));
    expect(memo).toContain('PluginSetup.needsSetupMap(loadedResolvers, {');
    expect(memo).toContain('host: { ...hostSignIns, [GettingStartedModel.LOCAL_FILES_ID]: watchFolders.length > 0 }');
    expect(memo).toContain('statuses: pluginStatuses');
    expect(memo).toContain('configs: metaServiceConfigs');
    const callSite = app.slice(app.indexOf('React.createElement(SettingsPage, {'), app.indexOf('...settingsPageHandlers'));
    expect(callSite).toContain('pluginNeedsSetup,');
    // Home's accounts are the same facts.
    expect(app).toContain('const pluginAccounts = useMemo(() => PluginSetup.signedInMap(hostSignIns, pluginStatuses), [hostSignIns, pluginStatuses]);');
  });
});

describe('deactivateResolver', () => {
  const host = (active, saved) => {
    const state = { active, removed: [] };
    const ref = { current: saved };
    return {
      state,
      ref,
      fns: {
        removeResolverSources: (id) => state.removed.push(id),
        setActiveResolvers: (fn) => { state.active = fn(state.active); },
        savedActiveResolversRef: ref,
      },
    };
  };

  test('removes the id from both active lists and drops its sources', () => {
    const h = host(['spotify', 'bandcamp', 'fakeservice'], ['fakeservice', 'bandcamp']);
    deactivateResolver(h.fns, 'fakeservice');
    expect(h.state.active).toEqual(['spotify', 'bandcamp']);
    expect(h.ref.current).toEqual(['bandcamp']);
    expect(h.state.removed).toEqual(['fakeservice']);
  });

  test('leaves an unset saved list unset', () => {
    const h = host(['fakeservice'], null);
    deactivateResolver(h.fns, 'fakeservice');
    expect(h.state.active).toEqual([]);
    expect(h.ref.current).toBe(null);
  });

  test('Spotify, SoundCloud and Apple Music sign-outs call it, with no copy of the lines left', () => {
    for (const [fn, id] of [['disconnectSpotify', 'spotify'], ['disconnectSoundcloud', 'soundcloud'], ['disconnectAppleMusic', 'applemusic']]) {
      const start = app.indexOf(`const ${fn} = async () => {`);
      expect(start).toBeGreaterThan(-1);
      const body = app.slice(start, app.indexOf('\n  };\n', start));
      expect(body).toContain(`deactivateResolver('${id}');`);
      expect(body).not.toContain('savedActiveResolversRef');
      expect(body).not.toContain('setActiveResolvers');
    }
  });
});

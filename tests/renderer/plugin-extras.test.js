// The plug-in settings dialog's shared extra sections (#1498 step 5,
// components/plugin-extras.js): each is chosen by a capability or a manifest
// field, never by the plug-in's id. Each test renders the whole dialog under
// Node for a made-up plug-in (an id no code knows) that declares one signal,
// and for the same plug-in without it: the section shows only with the
// signal, so a new plug-in that declares it gets it with no dialog change.

const fs = require('fs');
const path = require('path');

global.React = require('react');
global.ReactDOM = require('react-dom');
const { renderToStaticMarkup } = require('react-dom/server');

const { PluginSettingsDialog } = require('../../src/renderer/components/plugin-settings-dialog');
const ROOT = path.join(__dirname, '..', '..');
const dialogSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/components/plugin-settings-dialog.js'), 'utf8');

// Every prop the dialog destructures, with a harmless default.
const PROP_NAMES = dialogSrc.match(/const \{\n([\s\S]*?)\n {2}\} = props;/)[1]
  .split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
const noop = () => {};
const DEFAULTS = {
  activeResolvers: [], allResolvers: [], metaServices: [], metaServiceConfigs: {}, pluginStatuses: {},
  dynamicModelOptions: {}, installingResolvers: new Set(), watchFolders: [], localFilesStats: { totalTracks: 0, lastScan: null },
  scanProgress: { current: 0, total: 0, file: '' }, resolverSyncSettings: {}, syncSignedOut: {}, scrobblerConfigs: {},
  scrobblerLovePushEnabled: {}, loveBackfillRunning: {}, loveBackfillProgress: {}, loveImportRunning: {}, loveImportProgress: {},
  collectionData: { tracks: [] }, collectionDataRef: { current: { tracks: [] } }, lovePushedKeysRef: { current: {} },
  loveImportCursorRef: { current: {} }, resolverConfigCache: { current: {} }, resolverLoaderRef: { current: null },
  audioRef: { current: null }, currentTrackRef: { current: null }, authServerStatus: { port: 8888 },
  playbackOffResolvers: [], recommendationsOffResolvers: [], metadataOffResolvers: [], playbackLimits: {},
  hostAccounts: {}, marketplaceManifest: { plugins: [] }, isScanning: false,
  getServiceColor: () => null,
};

const render = (plugin, extra = {}) => {
  const props = {};
  for (const name of PROP_NAMES) props[name] = name in DEFAULTS ? DEFAULTS[name] : noop;
  return renderToStaticMarkup(React.createElement(PluginSettingsDialog, { ...props, selectedResolver: plugin, ...extra }));
};

// A plug-in no code knows by name.
const base = (over = {}) => ({
  id: 'newservice', name: 'New Service', version: '1.0.0', color: '#336699', description: 'A new service.',
  capabilities: { resolve: true, search: true }, settings: {}, configurable: {}, ...over,
});

beforeEach(() => {
  global.window = { scrobblers: [], electron: {} };
});
afterEach(() => { delete global.window; });

describe('each extra section shows for its signal and not otherwise', () => {
  test('library sync: capabilities.librarySync', () => {
    expect(render(base({ capabilities: { resolve: true, librarySync: true } }))).toContain('Sync your library');
    expect(render(base())).not.toContain('Sync your library');
  });

  test('a sign-in the app runs: settings.account.type "sign-in" with a host account', () => {
    const plugin = base({ settings: { account: { type: 'sign-in', signInHint: 'Sign in to play from New Service' } } });
    const hostAccounts = { newservice: { signedIn: false, signIn: noop, signOut: noop } };
    const html = render(plugin, { hostAccounts });
    expect(html).toContain('New Service account');
    expect(html).toContain('Sign in to play from New Service');
    // No host account for it: nothing to draw.
    expect(render(plugin)).not.toContain('New Service account');
    // A host account but no manifest field: not drawn either.
    expect(render(base(), { hostAccounts })).not.toContain('New Service account');
  });

  test('client keys: settings.clientKeys, open until saved, with its redirect URIs', () => {
    const plugin = base({
      configurable: { clientId: { label: 'Client ID', placeholder: 'Your client ID' } },
      settings: {
        account: { type: 'sign-in' },
        clientKeys: { fields: ['clientId'], label: 'Client ID', help: 'Bring your own.', steps: ['Make an app'], redirectUris: ['http://127.0.0.1:{port}/callback'], redirectHint: 'Add it.' },
      },
    });
    const keys = { source: 'none', values: { clientId: '' }, setValue: noop, save: noop, clear: noop };
    const html = render(plugin, { hostAccounts: { newservice: { signedIn: false, signIn: noop, signOut: noop, keys } } });
    expect(html).toContain('Bring your own.');
    expect(html).toContain('Make an app');
    expect(html).toContain('http://127.0.0.1:8888/callback');
    // Sign-in waits for the keys.
    expect(html).toContain('Add your client ID below first');
    // Saved: folded under its name.
    const saved = render(plugin, { hostAccounts: { newservice: { signedIn: false, signIn: noop, signOut: noop, keys: { ...keys, source: 'user' } } } });
    expect(saved).not.toContain('Bring your own.');
    expect(saved).toContain('aria-expanded="false"');
    // Without the manifest field there's no keys section.
    const { clientKeys: _k, ...settings } = plugin.settings;
    expect(render({ ...plugin, settings }, { hostAccounts: { newservice: { signedIn: false, signIn: noop, signOut: noop, keys } } })).not.toContain('Bring your own.');
  });

  test('open at startup: settings.startup with a host startup', () => {
    const plugin = base({ settings: { account: { type: 'sign-in' }, startup: { hint: 'Opens it.' } } });
    const hostAccounts = { newservice: { signedIn: true, signOut: noop, startup: { on: false, toggle: noop } } };
    expect(render(plugin, { hostAccounts })).toContain('Open New Service at startup');
    expect(render(base({ settings: { account: { type: 'sign-in' } } }), { hostAccounts })).not.toContain('at startup');
  });

  test('a username account: settings.account.type "username"', () => {
    const plugin = base({
      type: 'meta-service', capabilities: { recommendations: true },
      configurable: { username: { label: 'New Service username' }, apiKey: { label: 'API key', advanced: true } },
      settings: { account: { type: 'username', usage: 'your picks come from it' } },
    });
    const hostAccounts = { newservice: { connect: noop, remove: noop } };
    const out = render(plugin, { hostAccounts });
    expect(out).toContain('New Service username');
    expect(out).toContain('Enter your New Service username below');
    // Its optional key, under Advanced.
    expect(out).toContain('Advanced');
    const saved = render(plugin, { hostAccounts, metaServiceConfigs: { newservice: { username: 'ada' } } });
    expect(saved).toContain('ada · your picks come from it');
    expect(render(base({ type: 'meta-service' }), { hostAccounts })).not.toContain('username below');
  });

  test('Advanced: configurable fields marked advanced, last', () => {
    const plugin = base({
      configurable: { token: { label: 'Developer token', advanced: true } },
      settings: { account: { type: 'sign-in', advancedHint: 'Add a token.' } },
    });
    const advanced = { values: {}, setValue: noop, save: noop };
    const html = render(plugin, { hostAccounts: { newservice: { signedIn: true, signOut: noop, advanced } } });
    expect(html).toContain('>Advanced<');
    const noField = base({ settings: { account: { type: 'sign-in' } } });
    expect(render(noField, { hostAccounts: { newservice: { signedIn: true, signOut: noop, advanced } } })).not.toContain('>Advanced<');
  });

  test('install callout: settings.installCallout', () => {
    const plugin = base({
      type: 'meta-service', capabilities: { chat: true },
      settings: { requiresAuth: false, authType: 'none', installCallout: { title: 'Install it first', text: 'Get the app.', url: 'https://example.org', linkLabel: 'Download it' } },
    });
    const html = render(plugin);
    expect(html).toContain('Install it first');
    expect(html).toContain('Download it');
    expect(render(base({ type: 'meta-service', capabilities: { chat: true }, settings: { requiresAuth: false } }))).not.toContain('Install it first');
  });

  test('watch folders: settings.watchFolders', () => {
    expect(render(base({ settings: { watchFolders: true } }))).toContain('Watch folders');
    expect(render(base())).not.toContain('Watch folders');
  });

  test('a scrobbling-only plug-in draws its scrobbler as its account', () => {
    global.window.scrobblers = [{ id: 'newservice', name: 'New Service', connectWithPassword: noop }];
    const html = render(base({ type: 'meta-service', capabilities: { scrobbling: true }, homepage: 'https://example.org' }));
    expect(html).toContain('New Service account');
    expect(html).toContain('Enter your username and password below');
    expect(html).toContain('Create account');
  });

  test('a key field: its placeholder and where to get one come from the manifest', () => {
    const plugin = base({
      type: 'meta-service', capabilities: { chat: true },
      settings: { requiresAuth: true, authType: 'apikey', configurable: { apiKey: { type: 'password', label: 'API key', placeholder: 'nk-…', helpUrl: 'https://example.org/keys' } } },
    });
    const html = render(plugin);
    expect(html).toContain('placeholder="nk-…"');
    expect(html).toContain('Get your API key');
    // No key field (a local AI: Ollama): only its other fields.
    const local = render(base({ type: 'meta-service', capabilities: { chat: true }, settings: { requiresAuth: false, authType: 'none', configurable: { endpoint: { type: 'text', label: 'Server URL' } } } }));
    expect(local).toContain('Server URL');
    expect(local).not.toContain('API Configuration');
  });

  test('Remove: every plug-in but one whose manifest says settings.removable: false', () => {
    expect(render(base())).toContain('>Remove<');
    expect(render(base({ settings: { removable: false } }))).not.toContain('>Remove<');
  });
});

test('the shipped manifests declare the signals their sections need', () => {
  const m = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins-src', id, 'manifest.json'), 'utf8'));
  expect(m('spotify').capabilities.librarySync).toBe(true);
  expect(m('applemusic').capabilities.librarySync).toBe(true);
  expect(m('spotify').settings.clientKeys.fields).toEqual(['clientId']);
  expect(m('soundcloud').settings.clientKeys.fields).toEqual(['clientId', 'clientSecret']);
  expect(m('spotify').settings.startup.hint).toBeTruthy();
  for (const id of ['spotify', 'soundcloud', 'applemusic']) expect(m(id).settings.account.type).toBe('sign-in');
  for (const id of ['lastfm', 'listenbrainz']) expect(m(id).settings.account.type).toBe('username');
  expect(m('applemusic').settings.configurable.developerToken.advanced).toBe(true);
  expect(m('ollama').settings.installCallout.url).toBeTruthy();
  expect(m('localfiles').settings.watchFolders).toBe(true);
  for (const id of ['spotify', 'localfiles']) expect(m(id).settings.removable).toBe(false);
  for (const id of ['chatgpt', 'gemini', 'claude']) {
    expect(m(id).settings.configurable.apiKey.placeholder).toBeTruthy();
    expect(m(id).settings.configurable.apiKey.helpUrl).toMatch(/^https:\/\//);
  }
});

test('the scrobbler card picks its sign-in by what the scrobbler implements, never its id', () => {
  const cards = fs.readFileSync(path.join(ROOT, 'src/renderer/components/settings-cards.js'), 'utf8');
  expect(cards).not.toMatch(/scrobbler\.id === '/);
  expect(cards).toMatch(/typeof scrobbler\.connectWithPassword === 'function'/);
  expect(cards).toMatch(/typeof scrobbler\.startAuth === 'function'/);
});

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
    expect(html).toContain('Create a New Service account');
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

describe('one layout (the #1498 contact-sheet review)', () => {
  test('a username account comes before its nested Scrobbling sign-in', () => {
    global.window.scrobblers = [{ id: 'newservice', name: 'New Service', startAuth: noop }];
    const plugin = base({
      type: 'meta-service', capabilities: { scrobbling: true, recommendations: true },
      configurable: { username: { label: 'New Service username' }, apiKey: { label: 'API key', advanced: true } },
      settings: { account: { type: 'username', usage: 'your picks come from it' } },
    });
    const html = render(plugin, { hostAccounts: { newservice: { connect: noop, remove: noop } }, metaServiceConfigs: { newservice: { enabled: true } } });
    const account = html.indexOf('New Service username');
    const scrobbling = html.indexOf('data-section="scrobbling"');
    expect(account).toBeGreaterThan(-1);
    expect(scrobbling).toBeGreaterThan(account);
    // Still nested (NestedSettings' line on its left).
    expect(html.slice(scrobbling, scrobbling + 200)).toContain('border-l-2');
    // Advanced stays last.
    expect(html.indexOf('>Advanced<')).toBeGreaterThan(scrobbling);
  });

  test('a sign-in note is the account row\'s own line, never a coloured paragraph', () => {
    const plugin = base({ settings: { account: { type: 'sign-in', signInHint: 'Sign in here' } } });
    const html = render(plugin, { hostAccounts: { newservice: { signedIn: false, signIn: noop, signOut: noop, status: 'Sign in in a window to play here', note: { tone: 'info', text: 'A loose note' } } } });
    expect(html).toContain('Sign in in a window to play here');
    expect(html).not.toContain('A loose note');
    expect(html).not.toContain('var(--text-info)');
  });

  test.each([
    ['an AI key', { type: 'meta-service', capabilities: { chat: true }, settings: { requiresAuth: true, authType: 'apikey', configurable: { apiKey: { type: 'password', label: 'API key', description: 'Your key.' }, model: { type: 'select', label: 'Model', options: [{ value: 'a', label: 'A' }] } } } }],
    ['a concert key', { type: 'meta-service', capabilities: { concerts: true }, settings: { requiresAuth: true, authType: 'apikey', configurable: { appId: { type: 'text', label: 'App ID', helpUrl: 'https://example.org' } } } }],
    ['a server and account', { settings: { requiresAuth: true, authType: 'userpass', configurable: { serverUrl: { type: 'text', label: 'Server URL' }, username: { type: 'text', label: 'Username' }, password: { type: 'password', label: 'Password' } } } }],
  ])('%s: flat stacked fields, no heading of its own, no grey card', (_name, over) => {
    const html = render(base(over));
    expect(html).not.toContain('API Configuration');
    // The footer is the dialog's one grey surface.
    expect((html.match(/background-color:var\(--hover-bg-default\)/g) || []).length).toBe(1);
  });

  test('the dialog and the scrobbler card draw no section headings or inline label links of their own', () => {
    expect(dialogSrc).not.toContain("'API Configuration'");
    expect(dialogSrc).not.toMatch(/borderRadius: '10px'/);
    const cards = fs.readFileSync(path.join(ROOT, 'src/renderer/components/settings-cards.js'), 'utf8');
    expect(cards).not.toContain('ml-2 text-accent hover:underline');
    expect(cards).toMatch(/React\.createElement\(StackedField, \{\s*label: 'User token'/);
  });
});

describe('one help-link style (HelpLink in fields.js)', () => {
  const HELP = /<a href="#" data-help-link="" style="color:var\(--accent-primary\);font-size:12px;font-weight:500;text-decoration:none">([^<]*) →<\/a>/g;
  const links = (html) => [...html.matchAll(HELP)].map((m) => m[1]);
  const allAnchors = (html) => (html.match(/<a /g) || []).length;

  test.each([
    ['a key', base({ type: 'meta-service', capabilities: { chat: true }, settings: { requiresAuth: true, authType: 'apikey', configurable: { apiKey: { type: 'password', label: 'API key', helpUrl: 'https://example.org' } } } }), ['Get your API key']],
    ['an optional advanced key', base({ type: 'meta-service', capabilities: { recommendations: true }, configurable: { username: { label: 'U' }, userToken: { label: 'User token', advanced: true, helpUrl: 'https://example.org' } }, settings: { account: { type: 'username' } } }), []],
    ['client keys', base({ configurable: { clientId: { label: 'Client ID' } }, settings: { account: { type: 'sign-in' }, clientKeys: { fields: ['clientId'], help: 'Bring one.', helpUrl: 'https://example.org', helpLinkLabel: 'Open the dashboard' } } }), ['Open the dashboard']],
  ])('%s: every link is the HelpLink', (_n, plugin, expected) => {
    const hostAccounts = { newservice: { signedIn: false, signIn: noop, signOut: noop, connect: noop, remove: noop, keys: { source: 'none', values: {}, setValue: noop, save: noop, clear: noop } } };
    const html = render(plugin, { hostAccounts });
    expect(links(html)).toEqual(expected);
    expect(allAnchors(html)).toBe(expected.length);
  });

  test('a scrobbler\'s token and sign-up links are HelpLinks too', () => {
    global.window.scrobblers = [{ id: 'newservice', name: 'New Service', connectWithPassword: noop }];
    const html = render(base({ type: 'meta-service', capabilities: { scrobbling: true }, homepage: 'https://example.org' }));
    expect(links(html)).toEqual(['Create a New Service account']);
    expect(allAnchors(html)).toBe(1);
    global.window.scrobblers = [{ id: 'newservice', name: 'New Service', connect: noop }];
    const token = render(base({ type: 'meta-service', capabilities: { scrobbling: true }, configurable: { userToken: { label: 'User token', helpUrl: 'https://example.org' } } }));
    expect(links(token)).toEqual(['Get your user token']);
  });

  test('no other link style is left in the dialog\'s parts', () => {
    for (const f of ['plugin-settings-dialog.js', 'plugin-extras.js', 'settings-cards.js']) {
      const src = fs.readFileSync(path.join(ROOT, 'src/renderer/components', f), 'utf8');
      expect([f, /createElement\('a',|\be\('a',/.test(src)]).toEqual([f, false]);
    }
  });
});

describe('a meta service\'s "Needs …" line', () => {
  const { metaServiceFromAxe } = require('../../src/renderer/lib/meta-service');
  test('the one builder carries manifest.requirement, and the dialog shows it', () => {
    const svc = metaServiceFromAxe({ manifest: { id: 'newservice', name: 'New Service', type: 'meta-service', requirement: '  Needs your own key.  ' }, capabilities: { chat: true }, settings: {} });
    expect(svc.requirement).toBe('Needs your own key.');
    expect(render(svc)).toContain('Needs your own key.');
    expect(metaServiceFromAxe({ manifest: { id: 'x' }, capabilities: {} }).requirement).toBeNull();
  });

  test('every path that builds a meta service uses it', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
    expect((app.match(/metaServiceFromAxe\(axe/g) || []).length).toBe(3);
    // No hand-built copy that would drop a field again.
    expect(app).not.toMatch(/description: axe\.manifest\.description,/);
  });

  test('every shipped meta service with a requirement reaches its dialog', () => {
    for (const id of fs.readdirSync(path.join(ROOT, 'plugins-src'))) {
      const f = path.join(ROOT, 'plugins-src', id, 'manifest.json');
      if (!fs.existsSync(f)) continue;
      const axe = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (axe.manifest.type !== 'meta-service' || !axe.manifest.requirement) continue;
      expect([id, render(metaServiceFromAxe(axe)).includes(axe.manifest.requirement.replace(/'/g, '&#x27;'))]).toEqual([id, true]);
    }
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

// An Advanced key field shows what's typed, else what's saved, and Save stores
// what it shows: an untouched field keeps its saved key. Saving only the typed
// values stored it as empty, so pressing Save (say after buying Last.fm Pro)
// cleared the keys, and re-saving the username after Remove wiped them too.
describe('Advanced keys: Save keeps an untouched field', () => {
  const { shownKeyValues } = require('../../src/renderer/components/plugin-extras');
  const fields = [['apiKey', {}], ['apiSecret', {}]];

  test('an untouched field keeps the saved value; a typed one replaces it', () => {
    expect(shownKeyValues(fields, {}, { apiKey: 'savedK', apiSecret: 'savedS' })).toEqual({ apiKey: 'savedK', apiSecret: 'savedS' });
    expect(shownKeyValues(fields, { apiKey: 'newK' }, { apiKey: 'savedK', apiSecret: 'savedS' })).toEqual({ apiKey: 'newK', apiSecret: 'savedS' });
    expect(shownKeyValues(fields, {}, {})).toEqual({ apiKey: '', apiSecret: '' });
    expect(shownKeyValues(fields, undefined, undefined)).toEqual({ apiKey: '', apiSecret: '' });
  });

  test('both Saves send what the fields show, never only the typed values', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/plugin-extras.js'), 'utf8');
    expect(src).toContain('onSave: async () => { await account.saveAdvanced(shownAdvanced); setValues({}); }');
    expect(src).not.toContain('account.saveAdvanced(values)');
    expect(src).toMatch(/account\.connect\(\{ \.\.\.values, \.\.\.shownKeys, username:/);
  });
});

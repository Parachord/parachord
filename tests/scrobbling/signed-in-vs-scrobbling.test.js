/**
 * "Scrobble to X" pauses scrobbling only; loved-track syncing needs only the
 * sign-in (isSignedIn), so switching scrobbling off no longer stops loves
 * (2026-11-17). And the username row's Remove forgets the username only.
 */
const fs = require('fs');
const path = require('path');
const loader = require('../../scrobbler-loader');

function withConfig(config) {
  global.window = { electron: { store: { get: async () => config } } };
}
afterEach(() => { delete global.window; });

describe('isSignedIn ignores the scrobbling switch; isEnabled does not', () => {
  test('ListenBrainz: a token is signed in, switched on or off', async () => {
    const lb = new loader.ListenBrainzScrobbler();
    withConfig({ enabled: false, userToken: 'tok' });
    expect(await lb.isSignedIn()).toBe(true);
    expect(await lb.isEnabled()).toBe(false);
    withConfig({ enabled: true });
    expect(await lb.isSignedIn()).toBe(false);
  });
  test('Last.fm: a session (with the app key) is signed in, switched on or off', async () => {
    const lf = new loader.LastFmScrobbler();
    lf.apiKey = 'k';
    withConfig({ enabled: false, sessionKey: 's' });
    expect(await lf.isSignedIn()).toBe(true);
    expect(await lf.isEnabled()).toBe(false);
    withConfig({ enabled: true, sessionKey: null });
    expect(await lf.isSignedIn()).toBe(false);
  });
});

describe('app.js', () => {
  const app = require('../helpers/renderer-source').appWithPages();
  test('every loved-tracks path asks isSignedIn, never isEnabled', () => {
    // Every path that writes loves (the live push for each provider, the
    // backfill, the import's cross-service check) asks the love provider,
    // and Last.fm's and ListenBrainz's providers ask their scrobbler's
    // sign-in (lib/love-providers.js, #1559). The import's own read needs no
    // sign-in, only a username (2026-11-23).
    expect(app).toContain('if (!(await provider.isSignedIn())) return;');
    expect(app).toContain("if (!(await provider.isSignedIn())) { showToast(`Sign in to ${pluginName(service)} to sync loved tracks`); return; }");
    expect(app).toContain('otherConnected = await getLoveProvider(id).isSignedIn();');
    const providers = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/lib/love-providers.js'), 'utf8');
    expect((providers.match(/isSignedIn: \(\) => scrobbler\.isSignedIn\(\)/g) || []).length).toBe(2);
    expect(app + providers).not.toMatch(/Scrobbler\.isEnabled\(\)|scrobbler\.isEnabled\(\)|otherScrobbler\.isEnabled\(\)/);
  });
  test('Remove forgets the username only: Enable and the API keys stay', () => {
    for (const svc of ['lastfm', 'listenbrainz']) {
      expect(app).toContain(`const { username: _username, ...rest } = metaServiceConfigs.${svc} || {};`);
      expect(app).toContain(`await saveMetaServiceConfig('${svc}', { ...rest, enabled: rest.enabled !== false });`);
    }
  });
});

/**
 * The loved-tracks rows (parachord#1071; one layout for every love provider,
 * signed in or not, 2026-11-23; their own shared section since #1559 step 3,
 * components/plugin-extras.js LovedTracks). Rendered under Node with the
 * state the dialog gives them (lib/love-providers.js loveRowState): the
 * import needs only an account to read (Last.fm and ListenBrainz publish a
 * user's loves; a server, set up), so it shows signed out too; pushing loves
 * needs the sign-in, so its switch is off and locked signed out (#1614).
 */

global.React = require('react');
global.ReactDOM = require('react-dom');
global.ReactVirtual = require('@tanstack/react-virtual');

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { LovedTracks } = require('../../src/renderer/components/plugin-extras');
const LP = require('../../src/renderer/lib/love-providers');

const noop = () => {};
const connected = { enabled: true, sessionKey: 'sk', username: 'u' };
const signedOut = { enabled: false, username: undefined, authError: 'Session expired' };

beforeAll(() => {
  LP.registerLoveProvider(LP.lastfmLoveProvider({ id: 'lastfm', isSignedIn: async () => true, loveTrack: noop, getLovedTracksPage: noop }));
});
afterAll(() => LP.clearLoveProviders());

const lastfm = { id: 'lastfm', capabilities: { lovedTracks: true }, loves: { contract: 1, verb: 'Love', needs: 'name', canImport: true } };

// The rows as the dialog draws them for Last.fm with this scrobbling config
// and this plug-in account config.
const render = ({ scrobblerConfig = connected, pluginConfig = {}, ...props } = {}) => renderToStaticMarkup(
  React.createElement(LovedTracks, {
    name: 'Last.fm',
    words: LP.loveWords('Love'),
    canImport: true,
    state: LP.loveRowState(lastfm, { name: 'Last.fm', scrobblerConfig, pluginConfig }),
    onImport: noop,
    ...props,
  })
);

const row = (markup, label) => {
  const i = markup.indexOf(label);
  return i < 0 ? null : markup.slice(Math.max(0, i - 400), i + 900);
};

describe('the loved-tracks rows', () => {
  test('Import: a row with an Import button, "Import new" once loves were imported', () => {
    const r = row(render(), 'Import loved tracks');
    expect(r).toMatch(/>Import<\/button>/);
    expect(row(render({ hasImported: true }), 'Import loved tracks')).toMatch(/>Import new<\/button>/);
  });

  test('Import shows its progress in the row, the button busy', () => {
    const r = row(render({ importRunning: true, importProgress: { done: 120, total: 840 } }), 'Import loved tracks');
    expect(r).toContain('Importing… 120 of 840');
    expect(r).toContain('aria-busy="true"');
    expect(row(render({ importRunning: true, importProgress: { done: 3, total: 41, phase: 'lookup' } }), 'Import loved tracks')).toContain('Looking up names… 3 of 41');
    expect(row(render({ importRunning: true, importProgress: { done: 0, total: 0, phase: 'confirm' } }), 'Import loved tracks')).toContain('Waiting for confirmation…');
  });

  test('signed out of scrobbling, Import still works from the account\'s username', () => {
    const markup = render({ scrobblerConfig: signedOut, pluginConfig: { username: 'jh' }, onSetPush: noop, pushEnabled: true, onSend: noop, unpushedCount: 4 });
    const r = row(markup, 'Import loved tracks');
    expect(r).toMatch(/<button[^>]*>Import<\/button>/);
    expect(r).not.toMatch(/<button[^>]* disabled=""[^>]*>Import<\/button>/);
    // Push needs the sign-in: off and locked, and it says why.
    const push = row(markup, 'Push loves to Last.fm');
    expect(push).toContain('role="switch"');
    expect(push).toContain('aria-checked="false"');
    expect(push).toMatch(/role="switch"[^>]* disabled=""|disabled=""[^>]*role="switch"/);
    expect(push).toContain('Sign in to scrobble first');
    // Nothing to send while signed out.
    expect(markup).not.toContain('loved tracks to Last.fm</');
  });

  test('without any username, Import says to add one and is disabled', () => {
    const r = row(render({ scrobblerConfig: signedOut }), 'Import loved tracks');
    expect(r).toContain('Add your Last.fm username first');
    expect(r).toMatch(/<button[^>]* disabled=""[^>]*>Import<\/button>/);
  });

  test('signed in: Push is a working switch, and Send offers the loves not yet sent', () => {
    const markup = render({ onSetPush: noop, pushEnabled: true, onSend: noop, unpushedCount: 1946 });
    const push = row(markup, 'Push loves to Last.fm');
    expect(push).toContain('aria-checked="true"');
    expect(push).toContain('Love it on Last.fm when you love it here');
    expect(push).not.toMatch(/role="switch"[^>]* disabled=""|disabled=""[^>]*role="switch"/);
    expect(markup).toContain('Send 1,946 loved tracks to Last.fm');
    expect(row(markup, 'Send 1,946 loved tracks to Last.fm')).toMatch(/>Send<\/button>/);
    expect(markup).toContain('Loves from before you turned this on. Last.fm dates them today.');
  });

  test('one control per job: a switch, never a checkbox or a text-link button', () => {
    const markup = render({ onSetPush: noop, onSend: noop, unpushedCount: 3 });
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain('Backfill');
  });

  test('no Import for a provider that can\'t list its loves', () => {
    expect(render({ canImport: false })).not.toContain('Import loved tracks');
  });

  test('a plug-in\'s own loves (a server): ready once it\'s set up, with its verb\'s words', () => {
    const server = { id: 'myserver', loves: { contract: 1, verb: 'Star', needs: 'serviceId', canImport: true }, loveTrack: noop, getLovedPage: noop, isConfigured: (c) => !!(c && c.serverUrl) };
    const draw = (pluginConfig) => renderToStaticMarkup(React.createElement(LovedTracks, {
      name: 'My Server', words: LP.loveWords('Star'), canImport: true,
      state: LP.loveRowState(server, { name: 'My Server', pluginConfig }),
      onImport: noop, onSetPush: noop, onSend: noop, unpushedCount: 2,
    }));
    const notSetUp = draw({});
    expect(notSetUp).toContain('Import starred tracks');
    expect(notSetUp).toContain('Set up My Server first');
    expect(notSetUp).not.toContain('Send 2 starred tracks');
    const ready = draw({ serverUrl: 'http://s' });
    expect(ready).toContain('Add your My Server stars to your Collection');
    expect(ready).toContain('Push stars to My Server');
    expect(ready).toContain('Star it on My Server when you love it here');
    expect(ready).toContain('Send 2 starred tracks to My Server');
  });
});

describe('the dialog', () => {
  const dialog = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/plugin-settings-dialog.js'), 'utf8');
  const cards = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/settings-cards.js'), 'utf8');

  test('draws the rows once, for any love provider, wired to whichever plug-in is open (a reverted wiring fails this)', () => {
    expect(dialog).toContain('lovesOf(selectedResolver) && (() => {');
    expect(dialog).toContain('onImport: () => runLoveImport(id),');
    expect(dialog).toContain('importRunning: !!loveImportRunning[id],');
    expect(dialog).toContain('hasImported: !!loveImportCursorRef.current?.[id],');
    // A plug-in that signs in (Apple Music) is ready when the app knows it's signed in (#1559 step 5).
    expect(dialog).toContain("state: loveRowState(selectedResolver, { name, scrobblerConfig: scrobblerConfigs[id], pluginConfig: metaServiceConfigs[id], signedIn }),");
  });

  test('the scrobbler card no longer draws them', () => {
    expect(cards).not.toContain('Import loved tracks');
    expect(cards).not.toContain('onRunLoveImport');
  });
});

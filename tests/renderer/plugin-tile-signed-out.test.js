/**
 * The rule behind #1614: a plug-in that needs a sign-in never shows as
 * enabled until it's signed in. On Settings › Plug-Ins its tile reads as off
 * (greyed, no Enabled check, no priority number, not draggable) and says
 * "Sign in"; it stays in the active list and keeps doing what works signed
 * out. "Signed out" is app.js's pluginAccounts: the host's own sign-ins
 * (Spotify, SoundCloud, Apple Music) with each status plug-in's reply
 * (Amazon) laid over them; no verdict never counts.
 */
const fs = require('fs');
const path = require('path');

global.React = require('react');
const ReactDOMServer = require('react-dom/server');
const { ResolverCard } = require('../../src/renderer/components/settings-cards');

const resolver = { id: 'amazonmusic', name: 'Amazon Music', color: '#25D1DA', icon: 'A' };
const render = (props) => ReactDOMServer.renderToStaticMarkup(React.createElement(ResolverCard, { resolver, onClick() {}, ...props }));

describe('the tile of a plug-in that is on but signed out', () => {
  test('reads as off and says "Sign in"', () => {
    const html = render({ isActive: true, signInNeeded: true, priorityNumber: null });
    expect(html).toContain('grayscale');
    expect(html).toContain('Sign in');
    expect(html).not.toContain('data-tooltip="Enabled"');
    expect(html).not.toContain('Available');
    expect(html).not.toContain('Setup required');
  });

  test('signed in, it is the enabled tile as before', () => {
    const html = render({ isActive: true, priorityNumber: 2 });
    expect(html).not.toContain('grayscale');
    expect(html).toContain('data-tooltip="Enabled"');
    expect(html).not.toContain('Sign in');
  });
});

describe('the Plug-Ins page', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'settings-page.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

  test('a signed-out plug-in takes no priority number and sits with the unnumbered ones', () => {
    expect(page).toContain('const signedOut = (id) => activeResolvers.includes(id) && !!pluginAccounts && pluginAccounts[id] === false;');
    expect(page).toContain('const unnumbered = (id) => notPlayingResolverIds.includes(id) || signedOut(id);');
    expect(page).toContain('const playingInOrder = installedInOrder.filter(resolverId => !unnumbered(resolverId));');
  });

  test('its tile is not draggable, reads as signed out, and still opens its dialog', () => {
    expect(page).toContain('const signInNeeded = signedOut(resolver.id);');
    expect(page).toContain('const reorderable = isActive && !signInNeeded && !notPlayingResolverIds.includes(resolver.id);');
    expect(page).toContain('signInNeeded: signInNeeded,');
  });

  test('app.js hands the page and the dialog the same sign-in map', () => {
    const settings = app.slice(app.indexOf("activeView === 'settings' && React.createElement(SettingsPage, {"));
    expect(settings.slice(0, 4000)).toMatch(/\n\s+pluginAccounts,\n/);
    const dialog = app.slice(app.indexOf('selectedResolver && React.createElement(PluginSettingsDialog, {'));
    expect(dialog.slice(0, 2500)).toMatch(/\n\s+pluginAccounts,\n/);
  });
});

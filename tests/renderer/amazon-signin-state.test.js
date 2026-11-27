/**
 * Amazon Music sign-in, the renderer half: an enabled Amazon resolver that
 * isn't signed in shows "Setup required" in the resolver grid, like Spotify and
 * Apple Music when they aren't connected. Since #1356 M10 the status is the
 * plugin's (capabilities.status): the tile's setup flag reads the plugin's
 * reply, not the old IPC status.
 */

const fs = require('fs');
const path = require('path');

const src = require('../helpers/renderer-source').appWithPages();

// The prompt flow itself (the quiet after a sign-in window closed without a
// session, the status read after every attempt, only a loaded plug-in with a
// signIn) is every plug-in's since #1624: tests/renderer/plugin-sign-in-flow.test.js
// drives it, and tests/renderer/service-branches-1523.test.js its app.js wiring.

describe('resolver grid', () => {
  test('an enabled Amazon resolver that is not signed in needs configuration (the plugin reply)', () => {
    // #1522: the grid reads app.js's pluginNeedsSetup map, built from the
    // plugin's own status reply (lib/plugin-setup.js), not a branch on its id.
    const { needsSetupMap } = require('../../src/renderer/lib/plugin-setup');
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins-src/amazonmusic/manifest.json'), 'utf8'));
    const amazon = { id: 'amazonmusic', capabilities: m.capabilities };
    expect(needsSetupMap([amazon], { statuses: { amazonmusic: { signedIn: false } } })).toEqual({ amazonmusic: true });
    expect(needsSetupMap([amazon], { statuses: { amazonmusic: { signedIn: true } } })).toEqual({});
    // Unknown status (not fetched yet, or the plugin threw: the loader's
    // failed marker) is not flagged.
    expect(needsSetupMap([amazon], { statuses: {} })).toEqual({});
    expect(needsSetupMap([amazon], { statuses: { amazonmusic: { failed: true } } })).toEqual({});
    expect(src).toMatch(/PluginSetup\.needsSetupMap\(loadedResolvers, \{/);
    expect(src).not.toMatch(/amazonMusicStatus/);
  });
});

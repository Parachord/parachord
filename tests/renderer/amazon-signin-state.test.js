/**
 * Amazon Music sign-in, the renderer half. A sign-in window that closes
 * without a session must not reopen the prompt at once (the loop users saw
 * when the 2FA page closed early), and an enabled Amazon resolver that isn't
 * signed in shows "Setup required" in the resolver grid, like Spotify and
 * Apple Music when they aren't connected. Since #1356 M10 the status is the
 * plugin's (capabilities.status): the tile's setup flag reads the plugin's
 * reply, not the old IPC status.
 */

const fs = require('fs');
const path = require('path');

const src = require('../helpers/renderer-source').appWithPages();

describe('manageAmazonMusic', () => {
  const start = src.indexOf('const manageAmazonMusic = async');
  const body = src.slice(start, src.indexOf('window.__parachordManageAmazonMusic = manageAmazonMusic', start));

  test('a sign-in window closed without a session backs off the background prompt', () => {
    expect(start).toBeGreaterThan(-1);
    const success = body.indexOf('if (login && login.signedIn)');
    const backoff = body.indexOf('amazonManageDeclinedUntilRef.current = Date.now()', success);
    expect(success).toBeGreaterThan(-1);
    expect(backoff).toBeGreaterThan(success); // after the success return, i.e. on the failed path
  });

  test('every sign-in attempt refreshes the status the resolver grid reads', () => {
    const open = body.indexOf('await loaded.signIn()');
    expect(body.indexOf("refreshPluginStatus('amazonmusic')", open)).toBeGreaterThan(open);
  });

  test('the flow runs only when the plugin and its session surface are loaded', () => {
    expect(body).toMatch(/getResolver\('amazonmusic'\)/);
    expect(body).toMatch(/if \(!loaded \|\| typeof loaded\.signIn !== 'function'\) return false;/);
  });
});

describe('resolver grid', () => {
  test('an enabled Amazon resolver that is not signed in needs configuration (the plugin reply)', () => {
    expect(src).toMatch(/resolver\.id === 'amazonmusic' && pluginStatuses\.amazonmusic && pluginStatuses\.amazonmusic\.signedIn === false\)\s*\{/);
    // Unknown status (not fetched yet, or the plugin threw — a null reply) is
    // not flagged.
    expect(src).not.toMatch(/amazonMusicStatus/);
  });
});

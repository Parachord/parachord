/**
 * Amazon Music sign-in, the renderer half. A sign-in window that closes
 * without a session must not reopen the prompt at once (the loop users saw
 * when the 2FA page closed early), and an enabled Amazon resolver that isn't
 * signed in shows "Setup required" in the resolver grid, like Spotify and
 * Apple Music when they aren't connected.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

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
    const open = body.indexOf('amazonMusic.openLogin()');
    expect(body.indexOf('refreshAmazonMusicStatus()', open)).toBeGreaterThan(open);
  });
});

describe('resolver grid', () => {
  test('an enabled Amazon resolver that is not signed in needs configuration', () => {
    expect(src).toMatch(/resolver\.id === 'amazonmusic' && amazonMusicStatus && !amazonMusicStatus\.web\?\.signedIn\)\s*\{[^}]*needsConfiguration = true/);
  });
});

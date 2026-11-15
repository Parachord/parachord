/**
 * amazonWebPlayer.isSignedIn wiring (the host half that remains after the
 * #1356 moves: sign-in, playlist import, recommendations, dmls, the
 * diagnostic capture). The track search moved into the plugin in M5 and the
 * album/artist catalog flows (searchAlbums / searchArtistImage /
 * lookupAlbum) in M6 — their pins live in tests/resolver/
 * amazon-music-plugin-*.test.js, driving the plugin against a mocked
 * window.electron.webSession bridge.
 *
 * The module is loaded with plain require: electron is pulled lazily behind
 * electron() inside the stubbed methods, so no electron mock is needed for
 * these calls.
 */

const amazonWebPlayer = require('../../amazon-web-player');


// isSignedIn composes the host's facts (webSession.state() →
// { url, signInUrl, cookieNames }) with Amazon's pure verdict
// (amazonAuthCookieState over the cookie NAMES, pageBlocksPlayback over the
// sign-in window's URL). A page is never proof of a session: the old hedge
// for renamed cookies trusted any non-wall music.amazon.com page, and Amazon
// Music's logged-out home page is one, so the app reported signed in before
// the user had signed in at all.
describe('amazonWebPlayer.isSignedIn', () => {
  let stateSpy;
  let jar;
  let state;

  beforeEach(() => {
    jar = [];
    // state() is the host's facts read (names only, empty values dropped —
    // the same filtering the host's cookieNames() does).
    state = { url: null, signInUrl: null, cookieNames: [] };
    stateSpy = jest.spyOn(amazonWebPlayer.webSession, 'state').mockImplementation(async () => ({
      ...state,
      cookieNames: [...new Set(jar.filter(c => c.value).map(c => c.name))]
    }));
    amazonWebPlayer.cookieWarned = true; // keep the rotation warning out of test output
  });

  afterEach(() => {
    stateSpy.mockRestore();
    amazonWebPlayer.cookieWarned = false;
  });

  test('the logged-out home page with no auth cookie is signed out', async () => {
    jar = [{ name: 'session-id', value: '1' }, { name: 'ubid-main', value: '2' }];
    state.signInUrl = 'https://music.amazon.com/';
    state.url = 'https://music.amazon.com/search/x/songs'; // the view's URL is never consulted
    await expect(amazonWebPlayer.isSignedIn()).resolves.toBe(false);
  });

  test('known auth cookies are signed in, unless the sign-in window is still on a wall', async () => {
    jar = [{ name: 'at-main', value: 'a' }, { name: 'sess-at-main', value: 'b' }];
    await expect(amazonWebPlayer.isSignedIn()).resolves.toBe(true);
    state.signInUrl = 'https://www.amazon.com/ap/mfa?arb=x';
    await expect(amazonWebPlayer.isSignedIn()).resolves.toBe(false);
    state.signInUrl = 'https://music.amazon.com/identity/who-is-listening';
    await expect(amazonWebPlayer.isSignedIn()).resolves.toBe(false);
  });

  test('renamed auth cookies still count as a session', async () => {
    jar = [{ name: 'x-main', value: 'a' }, { name: 'at-v2', value: 'b' }];
    await expect(amazonWebPlayer.isSignedIn()).resolves.toBe(true);
  });

  test('an emptied auth cookie (a deletion in flight) is not a session', async () => {
    jar = [{ name: 'at-main', value: '' }];
    await expect(amazonWebPlayer.isSignedIn()).resolves.toBe(false);
  });
});

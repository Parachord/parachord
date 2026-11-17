/**
 * amazonWebPlayer.isSignedIn wiring (the host half that remains after the
 * #1356 moves: recommendations, dmls, the diagnostic capture, sign-in). The
 * track search moved into the plugin in M5, the album/artist catalog flows
 * (searchAlbums / searchArtistImage / lookupAlbum) in M6 and the playlist
 * import in M7 — their pins live in tests/resolver/
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

// ── The plan read (#1220, the #1356 M9 stopgap) ──────────────────────────────
// amazon-dmls.getPlan's semantics, ported onto the ONE host web-session
// instance's fetch: not-signed-in without auth cookies, config.json's tier
// mapped by amazonPlanFromTier, 30-min cache (1 min when unknown), a forced
// re-read (opening Settings) that comes back without a tier keeps a known
// plan, single-flight, the change callback firing on a reading that differs,
// and sign-out forgetting the reading. Dies with the teardown milestone's
// status move; the plugin's own gate is pinned separately in
// tests/resolver/amazon-music-plugin-drm.test.js.
describe('amazonWebPlayer.getPlan (the host-side stopgap)', () => {
  let stateSpy;
  let fetchSpy;
  let jar;
  let state;
  let configText;

  beforeEach(() => {
    jar = [{ name: 'at-main', value: 'a' }];
    state = { url: null, signInUrl: null, cookieNames: [] };
    configText = JSON.stringify({ tier: 'PRIME' });
    stateSpy = jest.spyOn(amazonWebPlayer.webSession, 'state').mockImplementation(async () => ({
      ...state,
      cookieNames: [...new Set(jar.filter(c => c.value).map(c => c.name))]
    }));
    fetchSpy = jest.spyOn(amazonWebPlayer.webSession, 'fetch').mockImplementation(async (request) => ({
      success: true, status: 200, headers: {}, text: configText
    }));
    amazonWebPlayer.planState = null;
    amazonWebPlayer.planPromise = null;
    amazonWebPlayer.planChange = null;
  });

  afterEach(() => {
    stateSpy.mockRestore();
    fetchSpy.mockRestore();
    amazonWebPlayer.planState = null;
    amazonWebPlayer.planPromise = null;
  });

  const configWithTier = (tier) => JSON.stringify({
    customerId: 'CUST1', marketplaceId: 'MKT', musicTerritory: 'US', siteRegion: 'NA', deviceId: '1435',
    ...(tier === undefined ? {} : { tier })
  });

  test('reads the tier from config.json over the host instance\'s fetch', async () => {
    configText = configWithTier('UNLIMITED_HD');
    await expect(amazonWebPlayer.getPlan()).resolves.toBe('unlimited');
    expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://music.amazon.com/config.json' }));
  });

  test('needs the auth cookies — not-signed-in without a config read', async () => {
    jar = [{ name: 'session-id', value: '1' }];
    await expect(amazonWebPlayer.getPlan()).rejects.toMatchObject({ reason: 'not-signed-in' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('caches a known plan for 30 minutes and an unknown one for a minute', async () => {
    const t0 = 1_000_000;
    configText = configWithTier('PRIME');
    expect(await amazonWebPlayer.getPlan({}, t0)).toBe('prime');
    expect(await amazonWebPlayer.getPlan({}, t0 + 29 * 60 * 1000)).toBe('prime'); // no fetch: cached
    configText = configWithTier('UNLIMITED');
    expect(await amazonWebPlayer.getPlan({}, t0 + 31 * 60 * 1000)).toBe('unlimited');

    amazonWebPlayer.planState = null;
    configText = ''; // a failed read
    expect(await amazonWebPlayer.getPlan({}, t0)).toBe('unknown');
    configText = configWithTier('UNLIMITED_HD');
    expect(await amazonWebPlayer.getPlan({}, t0 + 61 * 1000)).toBe('unlimited');
  });

  test('a forced re-read (opening Settings) sees an upgrade at once; a failed one keeps a known plan', async () => {
    const t0 = 2_000_000;
    configText = configWithTier('PRIME');
    expect(await amazonWebPlayer.getPlan({}, t0)).toBe('prime');
    configText = configWithTier('UNLIMITED');
    expect(await amazonWebPlayer.getPlan({ refresh: true }, t0 + 1000)).toBe('unlimited');
    configText = ''; // offline / a bad reply
    expect(await amazonWebPlayer.getPlan({ refresh: true }, t0 + 2000)).toBe('unlimited');
    // The scheduled re-read still judges it: past the TTL, no tier is unknown.
    configText = '';
    expect(await amazonWebPlayer.getPlan({}, t0 + 31 * 60 * 1000)).toBe('unknown');
  });

  test('a plan change is reported, a repeat reading is not', async () => {
    const onPlanChange = jest.fn();
    amazonWebPlayer.setPlanChangeListener(onPlanChange);
    configText = configWithTier('PRIME');
    await amazonWebPlayer.getPlan();
    configText = configWithTier('PRIME');
    await amazonWebPlayer.getPlan({ refresh: true });
    configText = configWithTier('UNLIMITED_HD');
    await amazonWebPlayer.getPlan({ refresh: true });
    expect(onPlanChange).toHaveBeenCalledTimes(2);
    expect(onPlanChange.mock.calls.map((c) => c[0])).toEqual([
      { plan: 'prime', previous: null },
      { plan: 'unlimited', previous: 'prime' }
    ]);
  });

  test('sign-out forgets the plan', async () => {
    configText = configWithTier('PRIME');
    await amazonWebPlayer.getPlan();
    expect(amazonWebPlayer.planState).toMatchObject({ plan: 'prime' });
    amazonWebPlayer.planState = null; // what signOut() resets
    expect(amazonWebPlayer.planState).toBeNull();
  });
});

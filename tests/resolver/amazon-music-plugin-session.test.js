/**
 * The Amazon plugin's session surfaces (#1356 M10; plugins-src/amazonmusic/
 * implementation.js): the sign-in verdict, the sign-in window's completion
 * gate, the not-signed-in prompt rule, the status reply (capabilities.status)
 * and sign-out — driving the plugin methods against a mocked
 * window.electron.webSession bridge (the preload wrappers' shapes;
 * docs/architecture/web-session.md, "The IPC bridge").
 *
 * Pinned here (ported from where each rule used to live):
 *   - signInLanded (from tests/resolver/amazon-music-logic.test.js — the
 *     positive-signal rule: the cookie-rotation hedge, the walls, the
 *     stability count) and onMusicHost's HOST-only equality
 *   - pageBlocksPlayback (from tests/resolver/amazon-music-logic.test.js —
 *     the wall enumeration: the profile picker, the sign-in portal's every
 *     /ap/ step, 2FA included)
 *   - isSignedIn (from tests/resolver/amazon-web-player.test.js — the host's
 *     composition died with M10's surface move): cookies first, then the
 *     sign-in window's URL
 *   - signInPromptDecision (from tests/renderer/amazon-signin-prompt.test.js —
 *     src/renderer/lib/amazon-signin-prompt.js died with the move): the
 *     hiccup grace, the streak gap, the at-once prompts
 *   - getStatus: the M3 reply shape over the plugin's own plan read (the
 *     mapping amazonPlaybackLimit ran in the renderer), the fresh re-read,
 *     the wording ('Setup required', the Prime/unknown labels and messages),
 *     searchesHeldBack, and the cdm probe
 *   - signOut: the final telemetry accounting BEFORE the clear, the
 *     session-state drop, the generation re-learn
 */

const {
  loadAmazonAxe,
  instantiateAmazonPlugin
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();

const PRIME_MESSAGE = 'Amazon Prime: Amazon is used for album art, artist photos and links. Playing Amazon tracks in Parachord needs Music Unlimited.';
const UNKNOWN_MESSAGE = "Parachord couldn't confirm your Amazon Music plan, so Amazon playback is off until it can. Playing Amazon tracks in Parachord needs Music Unlimited.";

// A webSession bridge mock for the session surfaces: state() answers the
// signed-in facts, fetch() answers config.json (the plan read), signIn()
// records the call (the test drives decide itself), clear() the sign-out.
function sessionBridge(opts = {}) {
  const ws = {
    state: jest.fn().mockResolvedValue({
      success: true,
      url: 'viewUrl' in opts ? opts.viewUrl : 'https://music.amazon.com/search/x/songs',
      signInUrl: 'signInUrl' in opts ? opts.signInUrl : null,
      cookieNames: 'cookieNames' in opts ? opts.cookieNames
        : (opts.signedIn === false ? ['session-id', 'ubid-main'] : ['at-main', 'sess-at-main']),
      generation: 'generation' in opts ? opts.generation : 0
    }),
    fetch: jest.fn().mockImplementation(async (id, request) => {
      if (id !== 'amazon-music') throw new Error('the plugin must drive its own session id');
      if (opts.fetchResult !== undefined) return opts.fetchResult;
      return {
        success: true, status: 200, headers: {},
        text: JSON.stringify({ customerId: 'CUST1', tier: 'tier' in opts ? opts.tier : 'UNLIMITED_HD' })
      };
    }),
    signIn: jest.fn(),
    clear: jest.fn().mockResolvedValue('clearResult' in opts ? opts.clearResult : { success: true })
  };
  global.window = { electron: { webSession: ws } };
  if (opts.cdmProbe === 'reject') {
    global.window.navigator = { requestMediaKeySystemAccess: jest.fn().mockRejectedValue(new Error('no CDM')) };
  } else if (opts.cdmProbe !== 'none') {
    global.window.navigator = { requestMediaKeySystemAccess: jest.fn().mockResolvedValue({ keySystem: 'com.widevine.alpha' }) };
  }
  return ws;
}

afterEach(() => {
  delete global.window;
});

const plugin = () => instantiateAmazonPlugin(axe);

// ── _lib: the sign-in window's completion gate ──────────────────────────────

describe('signInLanded (the plugin _lib copy)', () => {
  const lib = plugin().lib;
  const home = 'https://music.amazon.com/';
  const track = 'https://music.amazon.com/tracks/B000SNWG5Q';

  test('a stable non-wall page with an auth cookie lands', () => {
    let v = lib.signInLanded({ url: home, hasCookie: true });
    expect(v).toEqual({ landed: false, stableTicks: 1 });
    v = lib.signInLanded({ url: home, lastUrl: home, stableTicks: v.stableTicks, hasCookie: true });
    expect(v).toEqual({ landed: true, stableTicks: 2 });
  });

  test('the bare home path without a cookie waits a third tick (the logged-out first paint)', () => {
    let v = lib.signInLanded({ url: home, hasCookie: false });
    v = lib.signInLanded({ url: home, lastUrl: home, stableTicks: v.stableTicks, hasCookie: false });
    expect(v.landed).toBe(false);
    v = lib.signInLanded({ url: home, lastUrl: home, stableTicks: v.stableTicks, hasCookie: false });
    expect(v.landed).toBe(true); // rotation fallback: nothing but stability
  });

  test('a page off the home path lands after two stable ticks without a cookie', () => {
    let v = lib.signInLanded({ url: track, hasCookie: false });
    v = lib.signInLanded({ url: track, lastUrl: track, stableTicks: v.stableTicks, hasCookie: false });
    expect(v.landed).toBe(true);
  });

  test('walls, foreign URLs and navigation churn reset the stability count', () => {
    // A wall URL never lands, cookies or not — the profile is not chosen yet.
    expect(lib.signInLanded({
      url: 'https://music.amazon.com/identity/who-is-listening',
      lastUrl: 'https://music.amazon.com/identity/who-is-listening',
      stableTicks: 5, hasCookie: true
    })).toEqual({ landed: false, stableTicks: 0 });
    // Off amazon.com (the password step) resets too — and the sign-in
    // portal's URLs carry music.amazon.com in their return_to query, so the
    // host check must never be a substring match.
    expect(lib.signInLanded({
      url: 'https://www.amazon.com/ap/signin?openid.return_to=https%3A%2F%2Fmusic.amazon.com%2F',
      lastUrl: 'https://www.amazon.com/ap/signin', stableTicks: 5, hasCookie: true
    })).toEqual({ landed: false, stableTicks: 0 });
    // A URL that changed this tick is not stable yet.
    expect(lib.signInLanded({ url: track, lastUrl: home, stableTicks: 3, hasCookie: true }))
      .toEqual({ landed: false, stableTicks: 1 });
  });
});

// ── _lib: the wall predicate ────────────────────────────────────────────────

describe('pageBlocksPlayback (the plugin _lib copy)', () => {
  const lib = plugin().lib;

  test('profile picker and sign-in are not a finished session', () => {
    expect(lib.pageBlocksPlayback('https://music.amazon.com/identity/who-is-listening')).toBe('not-signed-in');
    expect(lib.pageBlocksPlayback('https://www.amazon.com/ap/signin?openid.return_to=music')).toBe('not-signed-in');
  });

  test('the player home is usable', () => {
    expect(lib.pageBlocksPlayback('https://music.amazon.com/')).toBeNull();
    expect(lib.pageBlocksPlayback('https://music.amazon.com/tracks/B000SNWG5Q')).toBeNull();
  });

  test('every step of the Amazon sign-in portal is a wall, 2FA included', () => {
    const rt = '?openid.return_to=https%3A%2F%2Fmusic.amazon.com%2F';
    for (const path of ['/ap/mfa', '/ap/cvf/approval', '/ap/cvf/request', '/ap/challenge', '/ap/accountfixup']) {
      expect(lib.pageBlocksPlayback(`https://www.amazon.com${path}${rt}`)).toBe('not-signed-in');
    }
    expect(lib.pageBlocksPlayback('https://www.amazon.co.uk/ap/mfa?arb=x')).toBe('not-signed-in');
    expect(lib.pageBlocksPlayback('https://music.amazon.com/albums/B0AP123')).toBeNull();
  });
});

// ── _lib: the prompt rule ───────────────────────────────────────────────────

describe('signInPromptDecision (the plugin _lib copy)', () => {
  const lib = plugin().lib;
  const none = { firstAt: 0, lastAt: 0 };
  const T = 1_000_000;

  test('a not-signed-in with live cookies is a hiccup: no prompt, a streak starts', () => {
    expect(lib.signInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak: none, now: T }))
      .toEqual({ prompt: false, streak: { firstAt: T, lastAt: T } });
  });

  test('no cookies, or another reason, prompts at once', () => {
    expect(lib.signInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: false, streak: none, now: T }).prompt).toBe(true);
    expect(lib.signInPromptDecision({ reason: 'not-ready', cookiesSignedIn: true, streak: none, now: T }).prompt).toBe(true);
    expect(lib.signInPromptDecision({ reason: undefined, cookiesSignedIn: true, streak: none, now: T }).prompt).toBe(true);
  });

  test('a streak lasting the grace period prompts (the profile picker waiting)', () => {
    let streak = none;
    let prompt = false;
    for (let t = 0; t < lib.HICCUP_GRACE_MS; t += 10_000) {
      ({ prompt, streak } = lib.signInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak, now: T + t }));
      expect(prompt).toBe(false);
    }
    ({ prompt, streak } = lib.signInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak, now: T + lib.HICCUP_GRACE_MS }));
    expect(prompt).toBe(true);
    expect(streak).toEqual(none); // the prompt resets the streak
  });

  test('two separate hiccups minutes apart never add up to a prompt', () => {
    const { streak } = lib.signInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak: none, now: T });
    const later = T + lib.STREAK_GAP_MS + 1;
    const second = lib.signInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak, now: later });
    expect(second.prompt).toBe(false);
    expect(second.streak).toEqual({ firstAt: later, lastAt: later }); // a fresh streak
  });

  test('the renderer reaches the rule through the plugin method', () => {
    const p = plugin();
    expect(p.signInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak: { firstAt: 0, lastAt: 0 }, now: 5 }))
      .toEqual({ prompt: false, streak: { firstAt: 5, lastAt: 5 } });
  });
});

// ── isSignedIn: the plugin's composition of the host's facts ────────────────

describe('isSignedIn', () => {
  test('the logged-out home page with no auth cookie is signed out', async () => {
    const ws = sessionBridge({
      signedIn: false,
      signInUrl: 'https://music.amazon.com/',
      viewUrl: 'https://music.amazon.com/search/x/songs' // the view's URL is never consulted
    });
    await expect(plugin().isSignedIn()).resolves.toBe(false);
    expect(ws.state).toHaveBeenCalledWith('amazon-music');
  });

  test('known auth cookies are signed in, unless the sign-in window is still on a wall', async () => {
    sessionBridge({ cookieNames: ['at-main', 'sess-at-main'] });
    await expect(plugin().isSignedIn()).resolves.toBe(true);
    sessionBridge({ cookieNames: ['at-main'], signInUrl: 'https://www.amazon.com/ap/mfa?arb=x' });
    await expect(plugin().isSignedIn()).resolves.toBe(false);
    sessionBridge({ cookieNames: ['at-main'], signInUrl: 'https://music.amazon.com/identity/who-is-listening' });
    await expect(plugin().isSignedIn()).resolves.toBe(false);
  });

  test('renamed auth cookies still count as a session (the rotation hedge, warned once)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      sessionBridge({ cookieNames: ['session-id', 'x-main', 'at-v2'] });
      const p = plugin();
      await expect(p.isSignedIn()).resolves.toBe(true);
      await expect(p.isSignedIn()).resolves.toBe(true);
      expect(warn).toHaveBeenCalledTimes(1); // once per instance, not per read
    } finally {
      warn.mockRestore();
    }
  });

  test('a logged-out jar is signed out (the old page-based hedge said signed in)', async () => {
    sessionBridge({ cookieNames: ['session-id', 'session-id-time', 'ubid-main', 'i18n-prefs'] });
    await expect(plugin().isSignedIn()).resolves.toBe(false);
    sessionBridge({ cookieNames: ['session-token'] });
    await expect(plugin().isSignedIn()).resolves.toBe(false);
    sessionBridge({ cookieNames: [] });
    await expect(plugin().isSignedIn()).resolves.toBe(false);
  });
});

// ── signIn: the visible window over the bridge's protocol ───────────────────

describe('signIn', () => {
  test('opens the window on the plugin session with its own decide rule', async () => {
    const ws = sessionBridge({});
    const seen = [];
    ws.signIn.mockImplementation(async (id, url, opts) => {
      expect(id).toBe('amazon-music');
      expect(url).toBe('https://music.amazon.com/');
      expect(opts.window).toEqual({ width: 980, height: 760 }); // the title is host config, never a caller choice
      expect(typeof opts.decide).toBe('function');
      const jarIn = ['at-main', 'sess-at-main'];
      const jarOut = ['session-id', 'ubid-main'];
      // A logged-out first paint of / (no cookie, on the home path) must not
      // land at two ticks; a third stable tick is the rotation fallback.
      seen.push(opts.decide({ url: 'https://music.amazon.com/', cookieNames: jarOut }));
      seen.push(opts.decide({ url: 'https://music.amazon.com/', cookieNames: jarOut }));
      seen.push(opts.decide({ url: 'https://music.amazon.com/', cookieNames: jarIn }));
      return { success: true, signedIn: seen[seen.length - 1] };
    });
    const reply = await plugin().signIn();
    expect(seen).toEqual([false, false, true]); // the positive-signal rule
    expect(reply).toEqual({ success: true, signedIn: true });
  });

  test('a wall never lands, stable or not; churn resets the count', async () => {
    const ws = sessionBridge({});
    let seen;
    ws.signIn.mockImplementation(async (id, url, opts) => {
      seen = [
        opts.decide({ url: 'https://www.amazon.com/ap/mfa', cookieNames: ['at-main'] }),
        opts.decide({ url: 'https://www.amazon.com/ap/mfa', cookieNames: ['at-main'] }),
        opts.decide({ url: 'https://www.amazon.com/ap/mfa', cookieNames: ['at-main'] }),
        // Off the wall but the URL changed this tick: not stable yet.
        opts.decide({ url: 'https://music.amazon.com/albums/B0AP123', cookieNames: ['at-main'] }),
        opts.decide({ url: 'https://music.amazon.com/albums/B0AP123', cookieNames: ['at-main'] })
      ];
      return { success: true, signedIn: seen[seen.length - 1] };
    });
    const reply = await plugin().signIn();
    expect(seen).toEqual([false, false, false, false, true]);
    expect(reply.signedIn).toBe(true);
  });

  test('rotated auth cookie names land (the cookie hedge)', async () => {
    const ws = sessionBridge({});
    let seen;
    ws.signIn.mockImplementation(async (id, url, opts) => {
      seen = [
        opts.decide({ url: 'https://music.amazon.com/', cookieNames: ['session-id', 'x-main', 'at-v2'] }),
        opts.decide({ url: 'https://music.amazon.com/', cookieNames: ['session-id', 'x-main', 'at-v2'] })
      ];
      return { success: true, signedIn: seen[seen.length - 1] };
    });
    const reply = await plugin().signIn();
    expect(seen).toEqual([false, true]); // two stable ticks AND an auth-shaped cookie
    expect(reply.signedIn).toBe(true);
  });

  test('no bridge answers a failed reply, never a throw', async () => {
    global.window = { electron: { webSession: {} } };
    await expect(plugin().signIn()).resolves.toEqual({ success: false, error: 'no web-session bridge' });
  });
});

// ── _lib: the plan mapping (config.json's tier → the plan and its wording) ─

describe('amazonPlanFromTier / tierFromConfig / amazonPlanMessage (the plugin _lib copies)', () => {
  const lib = plugin().lib;

  test('maps the tier: UNLIMITED… plays, PRIME is prime, anything else unknown (which blocks)', () => {
    for (const [tier, plan] of [
      ['UNLIMITED', 'unlimited'],
      ['UNLIMITED_HD', 'unlimited'],
      [' unlimited_hd ', 'unlimited'],
      ['PRIME', 'prime'],
      ['prime', 'prime'],
      ['PRIME_PLUS', 'unknown'],
      ['FREE', 'unknown'],
      ['', 'unknown'],
      [null, 'unknown'],
      [undefined, 'unknown']
    ]) {
      expect(lib.amazonPlanFromTier(tier)).toBe(plan);
    }
  });

  test('unwraps an object-shaped tier, and one wording per blocked plan; none for unlimited', () => {
    expect(lib.amazonPlanFromTier(lib.tierFromConfig({ tier: { name: 'UNLIMITED_HD' } }))).toBe('unlimited');
    expect(lib.amazonPlanFromTier(lib.tierFromConfig({ tier: { tier: 'PRIME' } }))).toBe('prime');
    expect(lib.amazonPlanFromTier(lib.tierFromConfig({}))).toBe('unknown');
    expect(lib.amazonPlanMessage('prime')).toBe(PRIME_MESSAGE);
    expect(lib.amazonPlanMessage('unknown')).toBe(UNKNOWN_MESSAGE);
    expect(lib.amazonPlanMessage('unlimited')).toBeNull();
  });
});

// ── getPlan: the plugin's own plan read (the old host stopgap's semantics) ─

describe('getPlan', () => {
  test('reads the tier from config.json over the bridge', async () => {
    const ws = sessionBridge({ tier: 'UNLIMITED_HD' });
    await expect(plugin().getPlan()).resolves.toBe('unlimited');
    expect(ws.fetch).toHaveBeenCalledWith('amazon-music', expect.objectContaining({ url: 'https://music.amazon.com/config.json' }));
  });

  test('caches a refused reading for a minute only, an unlimited one for half an hour', async () => {
    const t0 = 1_000_000;
    const ws = sessionBridge({ tier: 'PRIME' });
    const p = plugin();
    const now = Date.now;
    Date.now = () => t0;
    try {
      expect(await p.getPlan()).toBe('prime');
      expect(await p.getPlan()).toBe('prime'); // no second fetch: cached
      expect(ws.fetch).toHaveBeenCalledTimes(1);
      ws.fetch.mockResolvedValue({ success: true, status: 200, headers: {}, text: JSON.stringify({ tier: 'UNLIMITED' }) });
      expect(await p.getPlan()).toBe('prime'); // still inside the 1-min TTL
      Date.now = () => t0 + 61 * 1000;
      expect(await p.getPlan()).toBe('unlimited');
    } finally {
      Date.now = now;
    }
  });

  test('a forced re-read skips the cache, and a no-tier read keeps a known plan', async () => {
    const ws = sessionBridge({ tier: 'PRIME' });
    const p = plugin();
    expect(await p.getPlan()).toBe('prime');
    ws.fetch.mockResolvedValue({ success: true, status: 200, headers: {}, text: JSON.stringify({ tier: 'UNLIMITED' }) });
    expect(await p.getPlan({ refresh: true })).toBe('unlimited');
    // Offline / a bad reply: no tier in the answer keeps the known plan —
    // an Unlimited account must not be locked out because Settings opened.
    ws.fetch.mockResolvedValue({ success: true, status: 200, headers: {}, text: '' });
    expect(await p.getPlan({ refresh: true })).toBe('unlimited');
  });
});

// ── getStatus: the M3 status reply over the plugin's own plan read ──────────

describe('getStatus', () => {
  test('signed out: Setup required, no limit, no plan read, and the sign-in hint', async () => {
    const ws = sessionBridge({ signedIn: false });
    const reply = await plugin().getStatus();
    expect(reply).toEqual({
      signedIn: false,
      playbackLimit: null,
      statusLabel: 'Setup required',
      statusMessage: 'Sign in with your Amazon Music account, then choose a profile if Amazon asks.',
      cdm: true
    });
    // config.json needs the session: a signed-out reply reads no plan.
    expect(ws.fetch).not.toHaveBeenCalled();
  });

  test('signed out with no CDM: the build wording instead of the sign-in hint', async () => {
    sessionBridge({ signedIn: false, cdmProbe: 'reject' });
    const reply = await plugin().getStatus();
    expect(reply.cdm).toBe(false);
    expect(reply.statusMessage).toBe('This build cannot play DRM-protected Amazon streams');
  });

  test('signed in on Music Unlimited: unblocked, searches held back, no label of its own', async () => {
    sessionBridge({ tier: 'UNLIMITED_HD' });
    const reply = await plugin().getStatus();
    expect(reply.signedIn).toBe(true);
    expect(reply.playbackLimit).toEqual({ blocked: false, planKey: 'unlimited', label: null, message: null, searchesHeldBack: true });
    expect(reply.statusLabel).toBeNull(); // pluginStatusRow derives 'Signed in'
    expect(reply.statusMessage).toBeNull();
  });

  test('Prime blocks with the tile label and the one wording', async () => {
    sessionBridge({ tier: 'PRIME' });
    const reply = await plugin().getStatus();
    expect(reply.playbackLimit).toEqual({
      blocked: true, planKey: 'prime', label: 'Prime: no playback', message: PRIME_MESSAGE, searchesHeldBack: true
    });
    expect(reply.statusMessage).toBe(PRIME_MESSAGE);
  });

  test('an unknown plan blocks too, with its own label', async () => {
    sessionBridge({ tier: 'PRIME_PLUS' });
    expect((await plugin().getStatus()).playbackLimit).toEqual({
      blocked: true, planKey: 'unknown', label: 'Plan not confirmed', message: UNKNOWN_MESSAGE, searchesHeldBack: true
    });
    sessionBridge({ fetchResult: { success: true, status: 200, headers: {}, text: '' } }); // a bad reply reads as no tier
    expect((await plugin().getStatus()).playbackLimit).toMatchObject({ blocked: true, planKey: 'unknown', label: 'Plan not confirmed' });
  });

  test('the plan is read FRESH on every status call (the old refreshPlan)', async () => {
    const ws = sessionBridge({ tier: 'PRIME' });
    const p = plugin();
    expect((await p.getStatus()).playbackLimit).toMatchObject({ planKey: 'prime' });
    expect((await p.getStatus()).playbackLimit).toMatchObject({ planKey: 'prime' });
    expect(ws.fetch).toHaveBeenCalledTimes(2); // not the 30-minute cache
  });

  test('the plan mapping rides the limit the renderer reads (pluginStatusLimit)', () => {
    // The renderer's mapper over the plugin's reply: the same entry the old
    // per-service amazonPlaybackLimit built from the host status.
    const { pluginStatusLimit } = require('../../src/renderer/lib/playback-limits');
    sessionBridge({ tier: 'PRIME' });
    return plugin().getStatus().then((reply) => {
      expect(pluginStatusLimit(reply)).toEqual({
        blocked: true, planKey: 'prime', label: 'Prime: no playback', message: PRIME_MESSAGE, searchesHeldBack: true
      });
    });
  });
});

// ── cdmAvailable: the plugin's EME probe ────────────────────────────────────

describe('cdmAvailable', () => {
  test('a passing EME probe says the build has a CDM, cached per instance', async () => {
    const ws = sessionBridge({});
    const p = plugin();
    await expect(p.cdmAvailable()).resolves.toBe(true);
    await expect(p.cdmAvailable()).resolves.toBe(true);
    expect(global.window.navigator.requestMediaKeySystemAccess).toHaveBeenCalledTimes(1);
    expect(global.window.navigator.requestMediaKeySystemAccess).toHaveBeenCalledWith('com.widevine.alpha', [{
      initDataTypes: ['cenc'],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
    }]);
  });

  test('a rejected probe (stock Electron, no CDM) is false — never a throw', async () => {
    sessionBridge({ cdmProbe: 'reject' });
    await expect(plugin().cdmAvailable()).resolves.toBe(false);
  });

  test('a false is not latched — the next probe sees a CDM that finished installing', async () => {
    // The first-launch window (#1440 review, finding 1): the startup status
    // read probes while castlabs is still downloading the CDM, the probe
    // rejects, and the download finishes later — the old host read saw it
    // turn true because it re-read components.status() on every getStatus,
    // so the plugin must re-probe a false instead of caching it.
    const ws = sessionBridge({});
    let installed = false;
    global.window.navigator.requestMediaKeySystemAccess = jest.fn().mockImplementation(async () => {
      if (!installed) throw new Error('the CDM is still installing');
      return { keySystem: 'com.widevine.alpha' };
    });
    const p = plugin();
    await expect(p.cdmAvailable()).resolves.toBe(false); // the download is mid-flight
    installed = true; // castlabs finishes
    await expect(p.cdmAvailable()).resolves.toBe(true);
    await expect(p.cdmAvailable()).resolves.toBe(true); // a true latches
    expect(global.window.navigator.requestMediaKeySystemAccess).toHaveBeenCalledTimes(2);
  });

  test('no navigator at all is false', async () => {
    sessionBridge({ cdmProbe: 'none' });
    await expect(plugin().cdmAvailable()).resolves.toBe(false);
  });
});

// ── signOut: the final accounting first, the drop, then the clear ───────────

describe('signOut', () => {
  test('the final telemetry accounting posts BEFORE the partition clears, then the state drops', async () => {
    const ws = sessionBridge({ tier: 'PRIME' });
    const p = plugin();
    // Session-scoped state worth dropping: a cached plan, a template, the
    // telemetry instance a stream leaves behind.
    await p.getStatus();
    p._specSearchTemplate = { url: 'https://gql.music.amazon.com/', body: '{}', headers: {}, at: Date.now() };
    p._musicHomeVariant = 'browse';
    let postLanded;
    const finalPost = new Promise((r) => { postLanded = r; });
    const onStopped = jest.fn(() => finalPost);
    p._telemetry = { onStopped };
    let signOutDone = false;
    const done = p.signOut().then((r) => { signOutDone = true; return r; });
    // The drop and the post ran; the clear has NOT — it waits for the post.
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(ws.clear).not.toHaveBeenCalled();
    postLanded(); // the accounting is out
    const reply = await done;
    expect(signOutDone).toBe(true);
    expect(reply).toEqual({ success: true });
    expect(ws.clear).toHaveBeenCalledWith('amazon-music');
    // The accounting is first: it needs the live session the clear destroys.
    expect(onStopped.mock.invocationCallOrder[0]).toBeLessThan(ws.clear.mock.invocationCallOrder[0]);
    expect(p._planState).toBeNull();
    expect(p._specSearchTemplate).toBeNull();
    expect(p._musicHomeVariant).toBeNull();
    expect(p._telemetry).toBeNull();
    expect(p._lastSearchText).toBeNull();
  });

  test('the real seam: the final pair\u2019s fetch goes out before clear() (review, note 2)', async () => {
    // The fire-and-forget post raced the clear on the next line — the clear
    // went out first and the accounting's fetch lost its cookies. signOut
    // awaits the post now; this pins the real telemetry's fetch (not a stub)
    // landing before ws.clear.
    const ws = sessionBridge({});
    const p = plugin();
    p._drmSessionContext = { csrfToken: 't', csrfRnd: 'r', csrfTs: 's', deviceId: 'd', deviceType: 'dt', territoryId: 'US', region: 'na', tier: 'UNLIMITED_HD' };
    p.telemetry().onPlayStarted({ asin: 'B000TEST01', albumAsin: 'B000ALBUM1', durationMs: 120000 });
    const reply = await p.signOut();
    expect(reply).toEqual({ success: true });
    expect(ws.fetch).toHaveBeenCalled();
    const telemetryCalls = ws.fetch.mock.calls.filter(([, req]) => req && req.url === 'https://music.amazon.com/telemetry/v1/events');
    // onPlayStarted posted streamingInitiated; the FINAL pair is the
    // trackStreamed one the sign-out accounting owes.
    const finalPost = telemetryCalls.find(([, req]) => req.body.includes('trackStreamed'));
    expect(finalPost).toBeTruthy();
    // The accounting's fetch precedes the clear that destroys its session.
    expect(ws.fetch.mock.invocationCallOrder[ws.fetch.mock.calls.indexOf(finalPost)])
      .toBeLessThan(ws.clear.mock.invocationCallOrder[0]);
  });

  test('the generation re-learn: a state read after the sign-out must not drop twice', async () => {
    const ws = sessionBridge({});
    const p = plugin();
    const onStopped = jest.fn();
    p._telemetry = { onStopped };
    await p.signOut();
    ws.state.mockResolvedValue({ success: true, url: null, signInUrl: null, cookieNames: [], generation: 1 });
    await p.sessionState(); // clear() bumped the generation — not a second drop
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(p._sessionGeneration).toBe(1);
  });

  test('a failed clear answers a failed reply, never a throw', async () => {
    sessionBridge({ clearResult: { success: false, error: 'locked' } });
    await expect(plugin().signOut()).resolves.toEqual({ success: false, error: 'locked' });
  });

  test('no bridge answers a failed reply, never a throw', async () => {
    global.window = { electron: { webSession: {} } };
    await expect(plugin().signOut()).resolves.toEqual({ success: false, error: 'no web-session bridge' });
  });
});

// ── The session-generation drop (sign-out seen mid-flight) ───────────────────

describe('the generation drop', () => {
  test('a state read observing a new generation drops the session-scoped state', async () => {
    const ws = sessionBridge({ generation: 0 });
    const p = plugin();
    await p.sessionState(); // learns generation 0
    p._planState = { plan: 'prime', at: Date.now() };
    p._specSearchTemplate = { url: 'https://gql.music.amazon.com/', body: '{}', headers: {}, at: Date.now() };
    p._musicHomeVariant = 'browse';
    p._lastSearchText = 'the old account search';
    ws.state.mockResolvedValue({ success: true, url: null, signInUrl: null, cookieNames: ['at-main'], generation: 1 });
    await p.sessionState();
    expect(p._planState).toBeNull();
    expect(p._specSearchTemplate).toBeNull();
    expect(p._musicHomeVariant).toBeNull();
    expect(p._lastSearchText).toBeNull();
    expect(ws.clear).not.toHaveBeenCalled(); // the drop alone — clear() is signOut's
  });
});

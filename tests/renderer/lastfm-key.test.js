/**
 * Last.fm API key fallback (#1538): src/renderer/lib/lastfm-key.js and the
 * scrobbler's use of it.
 *
 * From 1 December 2026 a Last.fm API key needs Last.fm Pro. When Last.fm turns
 * the person's own key down (error 10 or 26), reads drop it and retry once
 * with the built-in key. Session calls (scrobble, now playing, love) keep the
 * pair their session was made with, and sign out only when that key's refusal
 * repeats. A refused built-in key throws "Last.fm unavailable", never an empty
 * answer. No scrobble is lost.
 *
 * No real keys: every key, secret and session here is a placeholder.
 */

const fs = require('fs');
const path = require('path');

global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  createLastfmKeys, createLastfmFetch, lastfmErrorCode, lastfmApiGetUrl,
  OWN_KEY_REFUSED_NOTICE, OWN_KEY_REFUSED_HINT, RATE_LIMIT_NOTICE, KEY_REFUSED_CODES,
} = require('../../src/renderer/lib/lastfm-key');

const OWN = { apiKey: 'own-key', apiSecret: 'own-secret' };
const BUILTIN = { apiKey: 'builtin-key', apiSecret: 'builtin-secret' };

const keysWith = ({ own = OWN, builtin = BUILTIN } = {}) => {
  const keys = createLastfmKeys();
  if (builtin) keys.setBuiltin(builtin);
  if (own) keys.setOwn(own);
  return keys;
};

describe('createLastfmKeys: which pair', () => {
  test('the person’s key and secret first, the built-in pair otherwise', () => {
    expect(keysWith().readPair()).toEqual({ ...OWN, own: true });
    expect(keysWith().signedPair()).toEqual({ ...OWN, own: true });
    expect(keysWith({ own: null }).readPair()).toEqual({ ...BUILTIN, own: false });
  });

  test('a key without a secret reads with the key but signs with the built-in pair, never a mix', () => {
    const keys = keysWith({ own: { apiKey: 'own-key', apiSecret: '' } });
    expect(keys.readPair().apiKey).toBe('own-key');
    expect(keys.signedPair()).toEqual({ ...BUILTIN, own: false });
  });

  test('the built-in key and secret can arrive separately', () => {
    const keys = createLastfmKeys();
    keys.setBuiltin({ apiKey: 'builtin-key' });
    keys.setBuiltin({ apiKey: 'builtin-key', apiSecret: 'builtin-secret' });
    keys.setBuiltin({ apiKey: null });
    expect(keys.signedPair()).toEqual({ ...BUILTIN, own: false });
  });

  test('pairForKey gives a session its own pair, whatever reads are doing', () => {
    const keys = keysWith();
    keys.noteReply(keys.readPair(), 10);
    expect(keys.pairForKey('own-key')).toEqual({ ...OWN, own: true });
    expect(keys.pairForKey('builtin-key')).toEqual({ ...BUILTIN, own: false });
    expect(keys.pairForKey('a-key-no-longer-held')).toBeNull();
    expect(keys.storedSignedPair()).toEqual({ ...OWN, own: true });
  });
});

describe('noteReply: what a refusal does to reads', () => {
  test.each(KEY_REFUSED_CODES)('error %i on the person’s key switches reads and sign-in to the built-in pair', (code) => {
    const keys = keysWith();
    expect(keys.noteReply(keys.readPair(), code)).toBe('retry');
    expect(keys.ownKeyRefused()).toBe(true);
    expect(keys.readPair()).toEqual({ ...BUILTIN, own: false });
    expect(keys.signedPair()).toEqual({ ...BUILTIN, own: false });
    expect(keys.apiKey()).toBe('builtin-key');
  });

  test.each(KEY_REFUSED_CODES)('error %i on the built-in key does not switch: unavailable', (code) => {
    const keys = keysWith({ own: null });
    expect(keys.noteReply(keys.readPair(), code)).toBe('unavailable');
    expect(keys.readPair()).toEqual({ ...BUILTIN, own: false });
  });

  test.each([29, 9, 4, 6, 11, null])('error %p does not switch', (code) => {
    const keys = keysWith();
    expect(keys.noteReply(keys.readPair(), code)).toBe('ok');
    expect(keys.ownKeyRefused()).toBe(false);
    expect(keys.readPair().own).toBe(true);
  });

  test('the person’s key refused with no built-in key left: unavailable', () => {
    const keys = keysWith({ builtin: null });
    expect(keys.noteReply(keys.readPair(), 10)).toBe('unavailable');
  });

  test('a different key saved after the refusal is tried afresh', () => {
    const keys = keysWith();
    keys.noteReply(keys.readPair(), 10);
    keys.setOwn({ apiKey: 'new-own-key', apiSecret: 'new-own-secret' });
    expect(keys.ownKeyRefused()).toBe(false);
    expect(keys.readPair()).toEqual({ apiKey: 'new-own-key', apiSecret: 'new-own-secret', own: true });
  });

  test('saving the keys again clears the refused state, so the same key is tried again', () => {
    const keys = keysWith();
    const changes = [];
    keys.onChange((refused) => changes.push(refused));
    keys.noteReply(keys.readPair(), 10);
    keys.clearRefusal();
    expect(keys.ownKeyRefused()).toBe(false);
    expect(keys.readPair()).toEqual({ ...OWN, own: true });
    expect(changes).toEqual([true, false]);
  });
});

describe('the notice', () => {
  test('the toast fires once per session, however many keys are refused', () => {
    const keys = keysWith();
    const toast = jest.fn();
    keys.onFirstRefusal(toast);
    keys.noteReply({ ...OWN, own: true }, 10);
    keys.noteReply({ ...OWN, own: true }, 26);
    keys.setOwn({ apiKey: 'new-own-key', apiSecret: 'x' });
    keys.noteReply(keys.readPair(), 10);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  test('the Advanced line follows every change: a second refused key shows it again', () => {
    const keys = keysWith();
    const changes = [];
    keys.onChange((refused) => changes.push(refused));
    keys.noteReply(keys.readPair(), 10); // first key refused
    keys.setOwn({ apiKey: 'new-own-key', apiSecret: 'x' }); // a new one: tried afresh
    keys.noteReply(keys.readPair(), 26); // refused too
    expect(changes).toEqual([true, false, true]);
    expect(keys.ownKeyRefused()).toBe(true);
  });

  test('the copy says what happened and what to do, without blaming Pro', () => {
    expect(OWN_KEY_REFUSED_NOTICE).toBe('Last.fm turned down your own API key, so Parachord is using its own for now. Your key may need Last.fm Pro: check it or remove it in the Last.fm plug-in.');
    expect(OWN_KEY_REFUSED_HINT).toMatch(/^Last\.fm turned down your own API key, so Parachord is using its own for now\. Your key may need Last\.fm Pro/);
    for (const line of [OWN_KEY_REFUSED_NOTICE, OWN_KEY_REFUSED_HINT, RATE_LIMIT_NOTICE]) {
      expect(line).not.toMatch(/—|\.\.\.|'|since/);
    }
    // The rate limit no longer sends people to a key of their own.
    expect(RATE_LIMIT_NOTICE).toBe('Last.fm asked Parachord to slow down. Try again in a moment.');
    expect(RATE_LIMIT_NOTICE).not.toMatch(/API key|Settings/);
  });

  test('the toast offers a way to the Last.fm plug-in; the rate-limit toast uses the new copy', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    expect(app).toMatch(/showToastRef\.current\?\.\(LASTFM_OWN_KEY_REFUSED_NOTICE, 'warning',\s*\{ label: 'Open Last\.fm', onClick: \(\) => openPluginSettingsRef\.current\?\.\('lastfm'\) \}/);
    expect(app).toMatch(/showToast\(LASTFM_RATE_LIMIT_NOTICE, 'warning'\)/);
    expect(app).not.toMatch(/Add your own API key in Settings to avoid this/);
    // Saving or clearing the keys tries them again.
    for (const fn of ['saveLastfmApiKeys', 'clearLastfmApiKeys', 'connectLastfm']) {
      const i = app.indexOf(`const ${fn} = async`);
      expect(app.slice(i, app.indexOf('\n  };', i))).toMatch(/window\.lastfmKeys\?\.clearRefusal\(\);/);
    }
  });

  test('the Advanced section shows the notice, with a username and without one', () => {
    global.window = { scrobblers: [], electron: {} };
    const { UsernameAccount } = require('../../src/renderer/components/plugin-extras');
    const plugin = {
      id: 'lastfm', name: 'Last.fm',
      settings: {
        account: { type: 'username', advancedHint: 'Optional hint.' },
        configurable: { username: { type: 'text', label: 'Username' }, apiKey: { type: 'text', label: 'API key', advanced: true } },
      },
    };
    const account = { connect: async () => true, remove: () => {}, advancedOpen: true, setAdvancedOpen: () => {}, advancedNotice: OWN_KEY_REFUSED_HINT };
    for (const config of [{ username: 'someone', apiKey: 'own-key' }, { apiKey: 'own-key' }]) {
      const html = renderToStaticMarkup(React.createElement(UsernameAccount, { plugin, config, account: { ...account, saveAdvanced: config.username ? () => {} : undefined } }));
      expect(html).toContain('Last.fm turned down your own API key');
      expect(html).not.toContain('Optional hint.');
    }
    delete global.window;
  });
});

describe('call: the retry for reads', () => {
  const refused = (code) => ({ code, result: null });

  test('a refused own key retries exactly once, with the built-in pair', async () => {
    const keys = keysWith();
    const attempt = jest.fn()
      .mockResolvedValueOnce(refused(10))
      .mockResolvedValueOnce({ code: null, result: 'answer' });
    await expect(keys.call({ signed: true }, attempt)).resolves.toBe('answer');
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt.mock.calls[0][0]).toEqual({ ...OWN, own: true });
    expect(attempt.mock.calls[1][0]).toEqual({ ...BUILTIN, own: false });
  });

  test('both keys refused: two requests, then a thrown "unavailable", no loop', async () => {
    const keys = keysWith();
    const attempt = jest.fn().mockResolvedValue(refused(26));
    await expect(keys.call({}, attempt)).rejects.toMatchObject({ lastfmUnavailable: true, lastfmError: 26 });
    expect(attempt).toHaveBeenCalledTimes(2);
    attempt.mockClear();
    await expect(keys.call({}, attempt)).rejects.toMatchObject({ lastfmUnavailable: true });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  test('the built-in key refused: one request, then a thrown error with readable text', async () => {
    const keys = keysWith({ own: null });
    const attempt = jest.fn().mockResolvedValue(refused(10));
    const err = await keys.call({}, attempt).catch((e) => e);
    expect(err.lastfmUnavailable).toBe(true);
    expect(err.userMessage).toMatch(/Last\.fm isn’t available/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  test('a rate limit (29) or session error (9) is the caller’s: no retry, no switch', async () => {
    for (const code of [29, 9]) {
      const keys = keysWith();
      const attempt = jest.fn().mockResolvedValue({ code, result: { error: code } });
      await expect(keys.call({}, attempt)).resolves.toEqual({ error: code });
      expect(attempt).toHaveBeenCalledTimes(1);
      expect(keys.ownKeyRefused()).toBe(false);
    }
  });
});

describe('createLastfmFetch: the ws.audioscrobbler.com interceptor', () => {
  const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    clone() { return { json: async () => body }; },
    json: async () => body,
  });
  const url = (key, extra = '') => `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=Cher&api_key=${key}&format=json${extra}`;
  const sentKey = (u) => new URL(u).searchParams.get('api_key');

  test('a refused own key: the request is sent again once with the built-in key', async () => {
    const keys = keysWith();
    const inner = jest.fn()
      .mockResolvedValueOnce(jsonResponse(403, { error: 10, message: 'Invalid API key' }))
      .mockResolvedValueOnce(jsonResponse(200, { artist: { name: 'Cher' } }));
    const response = await createLastfmFetch({ fetch: inner, keys })(url('own-key'));
    expect(response.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(sentKey(inner.mock.calls[0][0])).toBe('own-key');
    expect(sentKey(inner.mock.calls[1][0])).toBe('builtin-key');
    expect(new URL(inner.mock.calls[1][0]).searchParams.get('artist')).toBe('Cher');
  });

  test('a URL built with the refused key, or an earlier key of the person’s, goes out with the current choice', async () => {
    const keys = keysWith();
    keys.noteReply(keys.readPair(), 10);
    const inner = jest.fn().mockResolvedValue(jsonResponse(200, {}));
    const wrapped = createLastfmFetch({ fetch: inner, keys });
    await wrapped(url('own-key'));
    expect(sentKey(inner.mock.calls[0][0])).toBe('builtin-key');
    keys.setOwn({ apiKey: 'new-own-key', apiSecret: 'x' });
    await wrapped(url('own-key'));
    expect(sentKey(inner.mock.calls[1][0])).toBe('new-own-key');
  });

  test('a refused built-in key throws, never a reply a caller could cache as a miss', async () => {
    const keys = keysWith({ own: null });
    const inner = jest.fn().mockResolvedValue(jsonResponse(403, { error: 26, message: 'Suspended API key' }));
    await expect(createLastfmFetch({ fetch: inner, keys })(url('builtin-key'))).rejects.toMatchObject({ lastfmUnavailable: true });
    expect(inner).toHaveBeenCalledTimes(1);
  });

  test('other errors are handed back untouched (a 429, a not-found)', async () => {
    const keys = keysWith();
    const limited = jsonResponse(429, { error: 29 });
    const inner = jest.fn().mockResolvedValue(limited);
    await expect(createLastfmFetch({ fetch: inner, keys })(url('own-key'))).resolves.toBe(limited);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(keys.ownKeyRefused()).toBe(false);
  });

  test('other hosts, POSTs, someone else’s key and signed URLs pass straight through', async () => {
    const keys = keysWith();
    keys.noteReply(keys.readPair(), 10); // reads would otherwise be re-keyed
    const inner = jest.fn().mockResolvedValue(jsonResponse(403, { error: 10 }));
    const wrapped = createLastfmFetch({ fetch: inner, keys });
    const inputs = [
      'https://musicbrainz.org/ws/2/artist?query=x',
      url('own-key'),
      url('another-apps-key'),
      url('own-key', '&api_sig=abc'),
      url('own-key', '&sk=session'),
    ];
    await wrapped(inputs[0]);
    await wrapped(inputs[1], { method: 'POST' });
    await wrapped(inputs[2]);
    await wrapped(inputs[3]);
    await wrapped(inputs[4]);
    expect(inner).toHaveBeenCalledTimes(5);
    expect(inner.mock.calls.map((c) => c[0])).toEqual(inputs);
    expect(lastfmApiGetUrl(url('own-key', '&api_sig=abc'), undefined, keys)).toBeNull();
  });

  test('lastfmErrorCode reads the error number', () => {
    expect(lastfmErrorCode({ error: 10 })).toBe(10);
    expect(lastfmErrorCode({ error: '26' })).toBe(26);
    expect(lastfmErrorCode({ artist: {} })).toBeNull();
    expect(lastfmErrorCode(null)).toBeNull();
  });
});

describe('the scrobbler: session calls keep their session’s pair', () => {
  const { LastFmScrobbler, ScrobbleManager } = require('../../scrobbler-loader');
  let stores;
  let calls;
  let events;
  const install = (replies) => {
    calls = [];
    events = [];
    global.window = {
      electron: {
        store: { get: async (k) => stores[k], set: async (k, v) => { stores[k] = v; } },
        proxyFetch: async (u, init) => { calls.push({ url: u, body: init && init.body }); return replies.shift(); },
        crypto: { md5: async (s) => `md5(${s})` },
      },
      dispatchEvent: (ev) => events.push(ev),
    };
    global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
  };
  const reply = (status, body) => ({ success: status < 300, status, text: JSON.stringify(body) });
  const ok = () => reply(200, { scrobbles: {} });
  const refusedReply = (code = 10) => reply(403, { error: code, message: 'Invalid API key' });
  const sent = (call) => new URLSearchParams(call.body);
  const session = () => stores['scrobbler-config-lastfm'];
  const scrobblerWith = (keys, config) => {
    stores = { 'scrobbler-config-lastfm': config };
    const scrobbler = new LastFmScrobbler();
    scrobbler.setKeySource(keys);
    return scrobbler;
  };
  const track = { artist: 'A', title: 'T' };

  afterEach(() => { delete global.window; delete global.CustomEvent; });

  test('a Pro user’s signed calls use their own pair, even after a read was refused once', async () => {
    install([ok()]);
    const keys = keysWith();
    const scrobbler = scrobblerWith(keys, { enabled: true, sessionKey: 'sk', sessionApiKey: 'own-key' });
    keys.noteReply(keys.readPair(), 10); // one refused read: reads switch...
    await scrobbler.scrobble(track, 1); // ...the session doesn't
    expect(sent(calls[0]).get('api_key')).toBe('own-key');
    expect(sent(calls[0]).get('api_sig')).toMatch(/own-secret\)$/);
    expect(session().sessionKey).toBe('sk');
  });

  test('a session made with the built-in key keeps using the built-in pair', async () => {
    install([ok()]);
    const scrobbler = scrobblerWith(keysWith(), { enabled: true, sessionKey: 'sk', sessionApiKey: 'builtin-key' });
    await scrobbler.scrobble(track, 1);
    expect(sent(calls[0]).get('api_key')).toBe('builtin-key');
    expect(sent(calls[0]).get('api_sig')).toMatch(/builtin-secret\)$/);
  });

  test('an older session signs with the saved pair and records it from the first call that works', async () => {
    install([ok(), ok()]);
    const keys = keysWith();
    const scrobbler = scrobblerWith(keys, { enabled: true, sessionKey: 'sk' });
    keys.noteReply(keys.readPair(), 10); // a refused read doesn't move it
    await scrobbler.scrobble(track, 1);
    expect(sent(calls[0]).get('api_key')).toBe('own-key');
    expect(session().sessionApiKey).toBe('own-key');
  });

  test('a single 10 or 26 on a read never signs out a session', async () => {
    install([ok()]);
    const keys = keysWith();
    const scrobbler = scrobblerWith(keys, { enabled: true, sessionKey: 'sk', sessionApiKey: 'own-key' });
    const inner = jest.fn().mockResolvedValue({ ok: false, status: 403, clone: () => ({ json: async () => ({ error: 26 }) }) });
    await createLastfmFetch({ fetch: inner, keys })('https://ws.audioscrobbler.com/2.0/?method=user.getinfo&api_key=own-key&format=json').catch(() => {});
    await scrobbler.scrobble(track, 1);
    expect(session()).toMatchObject({ sessionKey: 'sk', enabled: true });
    expect(events).toEqual([]);
  });

  test('one refusal of the session’s own key keeps the session; the second in a row signs out', async () => {
    install([refusedReply(10), refusedReply(26)]);
    const keys = keysWith();
    const scrobbler = scrobblerWith(keys, { enabled: true, sessionKey: 'sk', sessionApiKey: 'own-key' });
    const first = await scrobbler.scrobble(track, 1).catch((e) => e);
    expect(first.authErrorTransient).toBe(true);
    expect(session().sessionKey).toBe('sk');
    expect(keys.ownKeyRefused()).toBe(true); // reads switched at once
    const second = await scrobbler.scrobble(track, 2).catch((e) => e);
    expect(second.authError).toBe(true);
    expect(calls).toHaveLength(2);
    // Both went out with the session's own pair: no switch mid-session.
    expect(calls.map((c) => sent(c).get('api_key'))).toEqual(['own-key', 'own-key']);
    expect(session()).toMatchObject({ sessionKey: null, enabled: false });
    expect(events.map((ev) => ev.type)).toEqual(['scrobbler-auth-error']);
    expect(events[0].detail.userMessage).toMatch(/Sign in to Last\.fm again/);
    expect(await scrobbler.isEnabled()).toBe(false);
  });

  test('a refusal between successes never adds up to a sign-out', async () => {
    install([refusedReply(10), ok(), refusedReply(10)]);
    const scrobbler = scrobblerWith(keysWith(), { enabled: true, sessionKey: 'sk', sessionApiKey: 'own-key' });
    for (let i = 0; i < 3; i += 1) await scrobbler.scrobble(track, i).catch(() => {});
    expect(session().sessionKey).toBe('sk');
  });

  test('the built-in session key refused: "unavailable", the session kept', async () => {
    install([refusedReply(26)]);
    const scrobbler = scrobblerWith(keysWith({ own: null }), { enabled: true, sessionKey: 'sk', sessionApiKey: 'builtin-key' });
    await expect(scrobbler.scrobble(track, 1)).rejects.toMatchObject({ lastfmUnavailable: true });
    expect(session().sessionKey).toBe('sk');
  });

  test('a re-sign-in after the refusal makes a session with the built-in pair, and records it', async () => {
    install([reply(200, { token: 'tok' }), reply(200, { session: { key: 'new-sk', name: 'someone' } })]);
    const keys = keysWith();
    keys.noteReply(keys.readPair(), 10);
    const scrobbler = scrobblerWith(keys, {});
    const token = await scrobbler.getAuthToken();
    expect(scrobbler.getAuthUrl(token)).toContain('api_key=builtin-key');
    const s = await scrobbler.getSession(token);
    expect(new URL(calls[1].url).searchParams.get('api_sig')).toMatch(/builtin-secret\)$/);
    expect(s.apiKey).toBe('builtin-key');
  });

  test('sign-in with a refused own key retries the token with the built-in pair', async () => {
    install([refusedReply(10), reply(200, { token: 'tok' })]);
    const scrobbler = scrobblerWith(keysWith(), {});
    expect(await scrobbler.getAuthToken()).toBe('tok');
    expect(calls.map((c) => new URL(c.url).searchParams.get('api_key'))).toEqual(['own-key', 'builtin-key']);
  });

  describe('no scrobble is lost', () => {
    const managerWith = (scrobbler) => {
      const manager = new ScrobbleManager();
      manager.registerPlugin(scrobbler);
      manager.currentTrack = { ...track, duration: 200 };
      manager.trackStartTime = 1000;
      return manager;
    };
    const queued = () => stores['scrobble-failed-queue'] || [];

    test('the scrobble that triggers the key sign-out is queued', async () => {
      install([refusedReply(10), refusedReply(10)]);
      const scrobbler = scrobblerWith(keysWith(), { enabled: true, sessionKey: 'sk', sessionApiKey: 'own-key' });
      await scrobbler.scrobble(track, 1).catch(() => {}); // first refusal
      const manager = managerWith(scrobbler);
      await manager.submitScrobble(); // second: signs out
      expect(session().sessionKey).toBeNull();
      expect(queued()).toHaveLength(1);
      expect(queued()[0]).toMatchObject({ pluginId: 'lastfm', track: { artist: 'A', title: 'T' } });
    });

    test('the scrobble on the third error-9 strike is queued', async () => {
      install([refusedReply(9), refusedReply(9), refusedReply(9)]);
      const scrobbler = scrobblerWith(keysWith(), { enabled: true, sessionKey: 'sk', sessionApiKey: 'own-key' });
      await scrobbler.scrobble(track, 1).catch(() => {});
      await scrobbler.scrobble(track, 2).catch(() => {});
      const manager = managerWith(scrobbler);
      await manager.submitScrobble();
      expect(session().sessionKey).toBeNull();
      expect(queued()).toHaveLength(1);
    });

    test('a queued scrobble waits for a signed-out scrobbler instead of being dropped', async () => {
      install([]);
      const scrobbler = scrobblerWith(keysWith(), { enabled: false, sessionKey: null });
      stores['scrobble-failed-queue'] = [{ pluginId: 'lastfm', track, timestamp: 1, attempts: 1, queuedAt: Date.now() }];
      const manager = new ScrobbleManager();
      manager.registerPlugin(scrobbler);
      await manager.retryFailedScrobbles();
      expect(queued()).toHaveLength(1);
      expect(calls).toHaveLength(0);
    });
  });
});

// Every Last.fm key choice goes through the helper, so a new call site can't
// bypass the fallback.
describe('source check: one key chooser', () => {
  const root = path.join(__dirname, '../..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const app = read('src/renderer/app.js');

  test('the renderer installs the interceptor and chooses keys only through window.lastfmKeys', () => {
    expect(app).toMatch(/window\.lastfmKeys = keys;/);
    expect(app).toMatch(/window\.fetch = createLastfmFetch\(\{ fetch: window\.fetch, keys \}\)/);
    const getter = app.match(/const getLastfmApiKey = \(\) => \{[\s\S]*?\n  \};/);
    expect(getter).not.toBeNull();
    expect(getter[0]).toMatch(/lastfmKeys\.apiKey\(\)/);
    expect(getter[0]).not.toMatch(/metaServiceConfigs/);
  });

  test('app.js never picks the person’s key or the built-in key itself', () => {
    // The built-in key is read once at launch, to feed the helper.
    expect(app.match(/LASTFM_API_KEY/g)).toHaveLength(1);
    expect(app).toMatch(/lastfmApiKey\.current = lfmKey;\s*\n\s*window\.lastfmKeys\?\.setBuiltin\(\{ apiKey: lfmKey \}\)/);
    // No "the person's key, else …" fallbacks and no direct scrobbler keys.
    expect(app).not.toMatch(/lastfm\??\.apiKey\s*(\|\||\?\?)\s*(getLastfmApiKey|lastfmApiKey|window|await)/);
    expect(app).not.toMatch(/saved\.apiKey\s*\|\|/);
    expect(app).not.toMatch(/setApiCredentials\(/);
    // Every Last.fm API key in app.js comes from getLastfmApiKey().
    for (const line of app.split('\n').filter((l) => /const apiKey = /.test(l))) {
      if (/lastfm|LASTFM|audioscrobbler/i.test(line) || /config\.get\(/.test(line)) {
        expect(line).toMatch(/getLastfmApiKey\(\)/);
      }
    }
    for (const line of app.split('\n').filter((l) => /ws\.audioscrobbler\.com/.test(l) && /api_key=/.test(l))) {
      expect(line).toMatch(/api_key=\$\{apiKey\}/);
    }
  });

  test('the scrobbler reads its pair from the key source', () => {
    const src = read('scrobbler-loader.js');
    const lastfm = src.slice(src.indexOf('class LastFmScrobbler'), src.indexOf('class LibreFmScrobbler'));
    const reads = lastfm.split('\n').filter((l) => /this\.api(Key|Secret)\b/.test(l));
    // Only the constructor, setApiCredentials and credentials() touch them.
    expect(reads.every((l) => /this\.api(Key|Secret) = (null|apiKey|apiSecret);|return \{ apiKey: this\.apiKey, apiSecret: this\.apiSecret, own: false \};/.test(l))).toBe(true);
    expect(src).toMatch(/lastfmScrobbler\.setKeySource\(config\.lastfmKeys\)/);
    expect(app).toMatch(/initializeScrobblers\(\{ \.\.\.config, lastfmKeys: window\.lastfmKeys \}\)/);
  });

  test('spinoff-pool and the plug-in take the key they are given', () => {
    for (const p of ['src/renderer/lib/spinoff-pool.js', 'plugins-src/lastfm/implementation.js']) {
      const src = read(p);
      expect(src).not.toMatch(/process\.env|config\.get\(|metaServiceConfigs|LASTFM_API|electron\.store/);
      expect(src).not.toMatch(/['"`][0-9a-f]{32}['"`]/);
    }
    expect(read('plugins-src/lastfm/implementation.js')).toMatch(/const apiKey = config && config\.apiKey;/);
    expect(app).toMatch(/if \(resolverId === 'lastfm'\) \{\s*\n\s*const apiKey = getLastfmApiKey\(\);/);
  });

  test('no other source file talks to the Last.fm API', () => {
    const known = new Set([
      'src/renderer/app.js', 'src/renderer/lib/spinoff-pool.js',
      'src/renderer/lib/lastfm-key.js', 'scrobbler-loader.js', 'plugins-src/lastfm/implementation.js',
    ]);
    const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) => {
      const rel = path.join(dir, d.name);
      if (d.isDirectory()) return walk(rel);
      return /\.js$/.test(d.name) && !/\.generated\.js$/.test(d.name) ? [rel] : [];
    });
    const files = [...walk('src'), ...walk('plugins-src'), 'scrobbler-loader.js', 'resolver-loader.js'];
    const talking = files.filter((f) => /ws\.audioscrobbler\.com/.test(read(f)));
    for (const f of talking) expect(known).toContain(f);
  });
});

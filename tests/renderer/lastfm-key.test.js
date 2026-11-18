/**
 * Last.fm API key fallback (#1538): src/renderer/lib/lastfm-key.js.
 *
 * From 1 December 2026 a Last.fm API key needs Last.fm Pro. When Last.fm turns
 * the person's own key down (error 10 or 26), the app drops it for the session,
 * retries once with the built-in pair, and says so once. A refused built-in key
 * throws "Last.fm unavailable", never an empty answer.
 *
 * No real keys: every key and secret here is a placeholder.
 */

const fs = require('fs');
const path = require('path');
const {
  createLastfmKeys, createLastfmFetch, lastfmErrorCode, lastfmApiGetUrl,
  OWN_KEY_REFUSED_NOTICE, OWN_KEY_REFUSED_HINT, KEY_REFUSED_CODES,
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
});

describe('noteReply: what a refusal does', () => {
  test.each(KEY_REFUSED_CODES)('error %i on the person’s key switches to the built-in key and pair', (code) => {
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
});

describe('the notice', () => {
  test('fires once per session, however many requests are refused', () => {
    const keys = keysWith();
    const seen = jest.fn();
    keys.onFallback(seen);
    keys.noteReply({ ...OWN, own: true }, 10);
    keys.noteReply({ ...OWN, own: true }, 26);
    keys.setOwn({ apiKey: 'new-own-key', apiSecret: 'x' });
    keys.noteReply(keys.readPair(), 10);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test('the copy follows the UI rules', () => {
    for (const line of [OWN_KEY_REFUSED_NOTICE, OWN_KEY_REFUSED_HINT]) {
      expect(line).not.toMatch(/—|\.\.\.|'/);
      expect(line).toMatch(/Last\.fm Pro/);
    }
  });
});

describe('call: the retry', () => {
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
    // The next request goes straight to the built-in key: one request.
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
  const url = (key) => `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=Cher&api_key=${key}&format=json`;
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
    // The rest of the query is kept.
    expect(new URL(inner.mock.calls[1][0]).searchParams.get('artist')).toBe('Cher');
  });

  test('a URL built with the refused key afterwards goes out with the built-in key', async () => {
    const keys = keysWith();
    keys.noteReply(keys.readPair(), 10);
    const inner = jest.fn().mockResolvedValue(jsonResponse(200, {}));
    await createLastfmFetch({ fetch: inner, keys })(url('own-key'));
    expect(sentKey(inner.mock.calls[0][0])).toBe('builtin-key');
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

  test('other hosts, POSTs and someone else’s key pass straight through', async () => {
    const keys = keysWith();
    const inner = jest.fn().mockResolvedValue(jsonResponse(403, { error: 10 }));
    const wrapped = createLastfmFetch({ fetch: inner, keys });
    await wrapped('https://musicbrainz.org/ws/2/artist?query=x');
    await wrapped(url('own-key'), { method: 'POST' });
    await wrapped(url('another-apps-key'));
    expect(inner).toHaveBeenCalledTimes(3);
    expect(keys.ownKeyRefused()).toBe(false);
    expect(lastfmApiGetUrl(url('another-apps-key'), undefined, keys)).toBeNull();
  });

  test('lastfmErrorCode reads the error number', () => {
    expect(lastfmErrorCode({ error: 10 })).toBe(10);
    expect(lastfmErrorCode({ error: '26' })).toBe(26);
    expect(lastfmErrorCode({ artist: {} })).toBeNull();
    expect(lastfmErrorCode(null)).toBeNull();
  });
});

describe('the scrobbler’s signed calls use the same pair rules', () => {
  const { LastFmScrobbler } = require('../../scrobbler-loader');
  let stored;
  let calls;
  let events;
  const install = (replies) => {
    calls = [];
    events = [];
    global.window = {
      electron: {
        store: { get: async () => stored, set: async (_k, v) => { stored = v; } },
        proxyFetch: async (u, init) => { calls.push({ url: u, body: init && init.body }); return replies.shift(); },
        crypto: { md5: async (s) => `md5(${s})` },
      },
      dispatchEvent: (ev) => events.push(ev),
    };
    global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
  };
  const reply = (status, body) => ({ success: status < 300, status, text: JSON.stringify(body) });
  const sent = (call) => new URLSearchParams(call.body);

  afterEach(() => { delete global.window; delete global.CustomEvent; });

  test('a refused own pair: the scrobble is re-signed with the built-in key AND secret', async () => {
    stored = { enabled: true, sessionKey: 'sk', sessionApiKey: 'builtin-key' };
    install([reply(403, { error: 10, message: 'Invalid API key' }), reply(200, { scrobbles: {} })]);
    const scrobbler = new LastFmScrobbler();
    const keys = keysWith();
    scrobbler.setKeySource(keys);
    await scrobbler.scrobble({ artist: 'A', title: 'T' }, 1);
    expect(calls).toHaveLength(2);
    expect(sent(calls[0]).get('api_key')).toBe('own-key');
    expect(sent(calls[0]).get('api_sig')).toMatch(/own-secret\)$/);
    expect(sent(calls[1]).get('api_key')).toBe('builtin-key');
    expect(sent(calls[1]).get('api_sig')).toMatch(/builtin-secret\)$/);
  });

  test('a refused built-in key throws "unavailable" and keeps the session', async () => {
    stored = { enabled: true, sessionKey: 'sk' };
    install([reply(403, { error: 26, message: 'Suspended API key' })]);
    const scrobbler = new LastFmScrobbler();
    scrobbler.setKeySource(keysWith({ own: null }));
    await expect(scrobbler.scrobble({ artist: 'A', title: 'T' }, 1)).rejects.toMatchObject({ lastfmUnavailable: true });
    expect(calls).toHaveLength(1);
    expect(stored.sessionKey).toBe('sk');
  });

  test('a session made with the refused key: one error 9, then "sign in again", no loop', async () => {
    stored = { enabled: true, sessionKey: 'sk', sessionApiKey: 'own-key' };
    install([reply(403, { error: 10 }), reply(403, { error: 9, message: 'Invalid session key' })]);
    const scrobbler = new LastFmScrobbler();
    scrobbler.setKeySource(keysWith());
    const err = await scrobbler.scrobble({ artist: 'A', title: 'T' }, 1).catch((e) => e);
    expect(err.authError).toBe(true);
    expect(calls).toHaveLength(2);
    expect(stored).toMatchObject({ sessionKey: null, enabled: false });
    expect(events.map((ev) => ev.type)).toEqual(['scrobbler-auth-error']);
    expect(events[0].detail.userMessage).toMatch(/Sign in to Last\.fm again/);
    // Signed out: nothing more is sent.
    expect(await scrobbler.isEnabled()).toBe(false);
  });

  test('a session from before sessionApiKey was recorded counts as made with the refused key', async () => {
    stored = { enabled: true, sessionKey: 'sk' };
    install([reply(403, { error: 10 }), reply(403, { error: 9, message: 'Invalid session key' })]);
    const scrobbler = new LastFmScrobbler();
    scrobbler.setKeySource(keysWith());
    await scrobbler.scrobble({ artist: 'A', title: 'T' }, 1).catch(() => {});
    expect(stored.sessionKey).toBeNull();
  });

  test('a plain error 9 with no key switch is still treated as transient first', async () => {
    stored = { enabled: true, sessionKey: 'sk' };
    install([reply(403, { error: 9, message: 'Invalid session key' })]);
    const scrobbler = new LastFmScrobbler();
    scrobbler.setKeySource(keysWith());
    const err = await scrobbler.scrobble({ artist: 'A', title: 'T' }, 1).catch((e) => e);
    expect(err.authErrorTransient).toBe(true);
    expect(stored.sessionKey).toBe('sk');
  });

  test('sign-in keeps the pair its token was asked with, and records the session’s key', async () => {
    stored = {};
    install([
      reply(403, { error: 10 }),
      reply(200, { token: 'tok' }),
      reply(200, { session: { key: 'new-sk', name: 'someone' } }),
    ]);
    const scrobbler = new LastFmScrobbler();
    scrobbler.setKeySource(keysWith());
    const token = await scrobbler.getAuthToken();
    expect(token).toBe('tok');
    expect(scrobbler.getAuthUrl(token)).toContain('api_key=builtin-key');
    const session = await scrobbler.getSession(token);
    expect(new URL(calls[2].url).searchParams.get('api_key')).toBe('builtin-key');
    expect(new URL(calls[2].url).searchParams.get('api_sig')).toMatch(/builtin-secret\)$/);
    expect(session.apiKey).toBe('builtin-key');
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

  test('charts-utils, spinoff-pool and the plug-in take the key they are given', () => {
    for (const p of ['src/charts-utils.js', 'src/renderer/lib/spinoff-pool.js', 'plugins-src/lastfm/implementation.js']) {
      const src = read(p);
      expect(src).not.toMatch(/process\.env|config\.get\(|metaServiceConfigs|LASTFM_API|electron\.store/);
      expect(src).not.toMatch(/['"`][0-9a-f]{32}['"`]/);
    }
    expect(read('plugins-src/lastfm/implementation.js')).toMatch(/const apiKey = config && config\.apiKey;/);
    expect(app).toMatch(/if \(resolverId === 'lastfm'\) \{\s*\n\s*const apiKey = getLastfmApiKey\(\);/);
  });

  test('no other source file talks to the Last.fm API', () => {
    const known = new Set([
      'src/renderer/app.js', 'src/charts-utils.js', 'src/renderer/lib/spinoff-pool.js',
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

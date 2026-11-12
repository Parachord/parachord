// Apple Music user-token health (2026-11). MusicKit JS restored its own stale
// copy of the user token at configure and startup wrote it over every fresh
// sign-in, so Apple refused every /v1/me call (403) while the app showed
// "connected". See src/renderer/lib/apple-music-user-token.js.

const fs = require('fs');
const path = require('path');
const L = require('../../src/renderer/lib/apple-music-user-token');

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

describe('MusicKit JS token slots', () => {
  test('finds MusicKit\'s own slot, not the harvested cookie or the app copy', () => {
    const s = memoryStorage({
      'music.yr3xete537.media-user-token': 'STALE',
      'music.ampwebplay.media-user-token': 'FRESH',
      musickit_user_token: 'STALE',
      'music.ampwebplay.itua': 'US',
    });
    expect(L.musicKitTokenSlots(s)).toEqual(['music.yr3xete537.media-user-token']);
  });

  test('sync writes the app token into a slot that differs, and leaves equal ones alone', () => {
    const s = memoryStorage({ 'music.yr3xete537.media-user-token': 'STALE', 'music.abc.media-user-token': 'FRESH' });
    expect(L.syncMusicKitTokenSlots(s, 'FRESH')).toBe(1);
    expect(s.getItem('music.yr3xete537.media-user-token')).toBe('FRESH');
    expect(L.syncMusicKitTokenSlots(s, 'FRESH')).toBe(0);
  });

  test('sync with no token, or no slot, changes nothing', () => {
    const s = memoryStorage({ 'music.yr3xete537.media-user-token': 'STALE' });
    expect(L.syncMusicKitTokenSlots(s, '')).toBe(0);
    expect(L.syncMusicKitTokenSlots(memoryStorage(), 'FRESH')).toBe(0);
    expect(s.getItem('music.yr3xete537.media-user-token')).toBe('STALE');
  });

  test('clear removes only MusicKit\'s slots', () => {
    const s = memoryStorage({ 'music.yr3xete537.media-user-token': 'STALE', 'music.ampwebplay.media-user-token': 'FRESH' });
    expect(L.clearMusicKitTokenSlots(s)).toBe(1);
    expect(s.dump()).toEqual({ 'music.ampwebplay.media-user-token': 'FRESH' });
  });
});

describe('userTokenCandidates', () => {
  test('app copy first, then the harvested cookie, then MusicKit\'s, then extras, without repeats', () => {
    const s = memoryStorage({
      musickit_user_token: 'A',
      'music.ampwebplay.media-user-token': 'H',
      'music.yr3xete537.media-user-token': 'A',
      'music.other.media-user-token': 'M',
    });
    expect(L.userTokenCandidates(s, ['N', 'H', null])).toEqual(['A', 'H', 'M', 'N']);
  });
  test('empty storage has none', () => {
    expect(L.userTokenCandidates(memoryStorage())).toEqual([]);
  });
});

describe('classifyStatus', () => {
  test.each([
    [200, 'ok'], [204, 'ok'], [401, 'rejected'], [403, 'rejected'],
    [404, 'unknown'], [429, 'unknown'], [500, 'unknown'], [null, 'unknown'],
  ])('%p → %s', (status, kind) => expect(L.classifyStatus(status)).toBe(kind));
});

describe('findWorkingUserToken', () => {
  const probeFrom = (table) => async (t) => table[t];

  test('the reported case: the app copy is refused, the harvested sign-in works', async () => {
    const r = await L.findWorkingUserToken(['STALE', 'FRESH'], probeFrom({ STALE: 403, FRESH: 200 }), async () => 200);
    expect(r).toEqual({ verdict: 'ok', token: 'FRESH', status: 200 });
  });

  test('stops at the first working token', async () => {
    const asked = [];
    const r = await L.findWorkingUserToken(['A', 'B'], async (t) => { asked.push(t); return 200; });
    expect(r.token).toBe('A');
    expect(asked).toEqual(['A']);
  });

  test('every token refused, developer token fine → rejected (sign in again)', async () => {
    const r = await L.findWorkingUserToken(['A', 'B'], probeFrom({ A: 403, B: 401 }), async () => 200);
    expect(r).toEqual({ verdict: 'rejected', token: null, status: 401 });
  });

  test('every token refused but the developer token is refused too → unknown, not the user\'s sign-in', async () => {
    const r = await L.findWorkingUserToken(['A'], probeFrom({ A: 401 }), async () => 401);
    expect(r.verdict).toBe('unknown');
  });

  test('no answer (offline) or a 5xx is no verdict', async () => {
    expect((await L.findWorkingUserToken(['A'], async () => null, async () => 200)).verdict).toBe('unknown');
    expect((await L.findWorkingUserToken(['A', 'B'], probeFrom({ A: 403, B: 503 }), async () => 200)).verdict).toBe('unknown');
  });

  test('a throwing probe counts as no answer', async () => {
    const r = await L.findWorkingUserToken(['A'], async () => { throw new Error('boom'); });
    expect(r.verdict).toBe('unknown');
  });

  test('no candidates → none, and nothing is asked', async () => {
    let asked = false;
    const r = await L.findWorkingUserToken([], async () => { asked = true; return 200; });
    expect(r.verdict).toBe('none');
    expect(asked).toBe(false);
  });
});

describe('makeAppleProbes', () => {
  test('storefront with both tokens; catalog with the developer token only; status only', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, headers: init.headers }); return { status: 403 }; };
    const p = L.makeAppleProbes(fetchImpl, 'DEV');
    await expect(p.probeUserToken('USER')).resolves.toBe(403);
    await expect(p.probeDeveloperToken()).resolves.toBe(403);
    expect(calls[0]).toEqual({ url: L.STOREFRONT_URL, headers: { Authorization: 'Bearer DEV', 'Music-User-Token': 'USER' } });
    expect(calls[1]).toEqual({ url: L.CATALOG_PROBE_URL, headers: { Authorization: 'Bearer DEV' } });
  });
  test('a network error is null', async () => {
    const p = L.makeAppleProbes(async () => { throw new Error('offline'); }, 'DEV');
    await expect(p.probeUserToken('U')).resolves.toBeNull();
  });
});

describe('wiring', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const web = fs.readFileSync(path.join(__dirname, '../../musickit-web.js'), 'utf8');

  test('startup checks the stored token with Apple before configuring MusicKit JS', () => {
    const start = app.indexOf('const checkMusicKitAvailable = async () => {');
    const check = app.indexOf('await checkAppleMusicUserToken(', start);
    const configure = app.indexOf('await musicKitWeb.configure(developerToken, \'Parachord\', \'1.0.0\', userToken);', start);
    expect(start).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(start);
    expect(configure).toBeGreaterThan(check);
  });

  test('MusicKit\'s own slot is brought in line with the app token before configure', () => {
    expect(app).toMatch(/syncMusicKitTokenSlots\(localStorage, userToken\)/);
  });

  test('startup keeps the app\'s token, never MusicKit\'s restored one, when it has one', () => {
    expect(app).not.toContain("const currentToken = musicKitWeb.getUserToken() || localStorage.getItem('musickit_user_token');");
  });

  test('configure injects the app token whenever MusicKit holds a different one, not only when signed out', () => {
    expect(web).not.toContain('if (userToken && !initialAuth) {');
    expect(web).toContain('if (userToken && this.musicKit.musicUserToken !== userToken) {');
  });
});

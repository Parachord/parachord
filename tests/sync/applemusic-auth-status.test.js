// Apple Music's sync auth check (#1288). It used to report only "ok or not",
// so every refusal re-authorized and then showed "Unknown error". It now keeps
// Apple's HTTP status, re-authorizes only on a 401, and names the problem.

const fs = require('fs');
const path = require('path');
const provider = require('../../sync-providers/applemusic');

const token = JSON.stringify({ developerToken: 'DEV', userToken: 'USER' });

describe('checkAuthStatus', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  test('asks for one library song with both tokens, and returns the status', async () => {
    const calls = [];
    global.fetch = async (url, init) => { calls.push({ url, init }); return { ok: false, status: 403 }; };
    await expect(provider.checkAuthStatus(token)).resolves.toEqual({ ok: false, status: 403 });
    expect(calls[0].url).toMatch(/\/me\/library\/songs\?limit=1$/);
    expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer DEV', 'Music-User-Token': 'USER' });
  });

  test('ok on a 2xx', async () => {
    global.fetch = async () => ({ ok: true, status: 200 });
    await expect(provider.checkAuthStatus(token)).resolves.toEqual({ ok: true, status: 200 });
    await expect(provider.checkAuth(token)).resolves.toBe(true);
  });

  test('a network failure has no status', async () => {
    global.fetch = async () => { throw new Error('offline'); };
    await expect(provider.checkAuthStatus(token)).resolves.toEqual({ ok: false, status: null });
  });

  test('a missing token makes no request', async () => {
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, status: 200 }; };
    await expect(provider.checkAuthStatus(JSON.stringify({ developerToken: 'DEV' }))).resolves.toEqual({ ok: false, status: null });
    await expect(provider.checkAuthStatus('not json')).resolves.toEqual({ ok: false, status: null });
    expect(called).toBe(false);
  });
});

describe('describeAuthFailure', () => {
  const d = (s) => provider.describeAuthFailure(s);
  test('every message names the status, and none is "Unknown error"', () => {
    for (const s of [401, 403, 404, 429, 500, 503, 418]) {
      expect(d(s)).toContain(`HTTP ${s}`);
      expect(d(s)).not.toMatch(/unknown error/i);
    }
  });
  test('says what to check', () => {
    expect(d(401)).toMatch(/Connect/);
    expect(d(403)).toMatch(/subscription/);
    expect(d(403)).toMatch(/Sync Library/);
    expect(d(404)).toMatch(/Sync Library/);
    expect(d(429)).toMatch(/minutes/);
    expect(d(503)).toMatch(/later/);
  });
  test('no status means Apple could not be reached', () => {
    expect(d(null)).toMatch(/reach Apple Music/);
  });
});

describe('the sync setup flow', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  test('re-authorizes only when signing in again can help', () => {
    expect(app).toContain('const reauthCanHelp = !authStatus.status || authStatus.status === 401;');
    expect(app).toContain('if (reauthCanHelp) {');
  });
});

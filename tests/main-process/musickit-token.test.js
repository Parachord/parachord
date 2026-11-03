/**
 * Which MusicKit developer token Apple Music gets (main-process/musickit-token.js),
 * and that the renderer asks the main process for it instead of reading its
 * own saved copy first.
 *
 * A token from .env and one saved in Settings expire (at most six months
 * out). The renderer read the saved copy before asking the main process, and
 * the main process took an .env token over generating one, so an expired
 * token stayed in use and MusicKit refused it ("Initialized with an expired
 * token"): search, previews and the web player stopped working.
 */

const fs = require('fs');
const path = require('path');
const { tokenExpiry, isTokenExpired, pickDeveloperToken } = require('../../main-process/musickit-token');

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'ES256', kid: 'KEY' })}.${b64url(payload)}.sig`;

const NOW = Date.UTC(2026, 10, 2); // 2026-11-02
const EXPIRED = jwt({ iss: 'TEAM', iat: Date.UTC(2026, 1, 1) / 1000, exp: Date.UTC(2026, 6, 31) / 1000 });
const FRESH = jwt({ iss: 'TEAM', iat: NOW / 1000, exp: NOW / 1000 + 180 * 86400 });

describe('tokenExpiry / isTokenExpired', () => {
  test('reads exp from a JWT', () => {
    expect(tokenExpiry(EXPIRED)).toBe(Date.UTC(2026, 6, 31) / 1000);
    expect(isTokenExpired(EXPIRED, NOW)).toBe(true);
    expect(isTokenExpired(FRESH, NOW)).toBe(false);
  });

  test('a token that is not a JWT with exp is not judged', () => {
    for (const t of ['opaque-token', 'a.b', 'a.!!!.c', jwt({ iss: 'TEAM' }), null, undefined]) {
      expect(tokenExpiry(t)).toBeNull();
      expect(isTokenExpired(t, NOW)).toBe(false);
    }
  });
});

describe('pickDeveloperToken', () => {
  test('takes the first one that is set and not expired', () => {
    const skipped = [];
    const token = pickDeveloperToken([
      { source: 'environment', token: EXPIRED },
      { source: 'generated', token: null },
      { source: 'Settings', token: FRESH },
    ], { now: NOW, onSkip: (source, at) => skipped.push([source, at.toISOString().slice(0, 10)]) });
    expect(token).toBe(FRESH);
    expect(skipped).toEqual([['environment', '2026-07-31']]);
  });

  test('a fresh generated token wins over an expired one saved in Settings', () => {
    expect(pickDeveloperToken([
      { source: 'environment', token: undefined },
      { source: 'generated', token: FRESH },
      { source: 'Settings', token: EXPIRED },
    ], { now: NOW })).toBe(FRESH);
  });

  test('nothing usable is null', () => {
    expect(pickDeveloperToken([{ source: 'Settings', token: EXPIRED }, { source: 'generated', token: '' }], { now: NOW })).toBeNull();
  });
});

describe('wiring', () => {
  const root = path.join(__dirname, '..', '..');
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');

  test('config-get picks among environment, generated and Settings, skipping expired ones', () => {
    const handler = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('config-get'"));
    expect(handler.slice(0, 1500)).toMatch(/pickMusicKitDeveloperToken\(\[\s*\{ source: 'environment'[\s\S]*?source: 'generated'[\s\S]*?source: 'Settings'/);
  });

  test('an expired environment token does not stop generation from the key', () => {
    const gen = mainSrc.slice(mainSrc.indexOf('async function generateMusicKitDeveloperToken'));
    expect(gen.slice(0, 1200)).toMatch(/if \(!isMusicKitTokenExpired\(process\.env\.MUSICKIT_DEVELOPER_TOKEN\)\)/);
  });

  // A saved token that is still valid keeps winning, as it did before the
  // expiry fix (the user's Apple Music sign-in was made with it); only an
  // expired one falls through to the main process.
  test('the renderer uses its saved copy first only while it has not expired, then asks the main process', () => {
    const reads = appSrc.match(/localStorage\.getItem\('musickit_developer_token'\)/g) || [];
    expect(reads).toHaveLength(1);
    const helper = appSrc.slice(appSrc.indexOf('async function getMusicKitDeveloperToken'));
    const body = helper.slice(0, helper.indexOf('\n}\n'));
    const savedAt = body.indexOf("localStorage.getItem('musickit_developer_token')");
    const guardAt = body.indexOf('if (saved && !isMusicKitTokenExpired(saved)) return saved;');
    const askAt = body.indexOf("config.get('MUSICKIT_DEVELOPER_TOKEN')");
    expect(savedAt).toBeGreaterThan(0);
    expect(guardAt).toBeGreaterThan(savedAt);
    expect(askAt).toBeGreaterThan(guardAt);
    expect(appSrc).toContain("const { isTokenExpired: isMusicKitTokenExpired } = require('../../main-process/musickit-token');");
  });
});

describe('in the renderer (no Buffer)', () => {
  const realBuffer = global.Buffer;
  afterEach(() => { global.Buffer = realBuffer; });

  test('reads exp with atob', () => {
    global.Buffer = undefined;
    expect(tokenExpiry(EXPIRED)).toBe(Date.UTC(2026, 6, 31) / 1000);
    expect(isTokenExpired(EXPIRED, NOW)).toBe(true);
    expect(isTokenExpired(FRESH, NOW)).toBe(false);
  });
});

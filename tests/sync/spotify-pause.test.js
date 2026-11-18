/**
 * One Spotify rate-limit pause per process (sync-providers/spotify-pause.js),
 * and the places that must honour it: the renderer's fetch gate, the main
 * process's playback poller and quit pause, and the sync provider.
 */
const fs = require('fs');
const path = require('path');
const { createSpotifyPause, isSpotifyApiUrl, retryAfterMs, pausedResponse, MAX_PAUSE_MS } = require('../../sync-providers/spotify-pause');

describe('createSpotifyPause', () => {
  test('a 429 starts a pause for Retry-After', () => {
    const p = createSpotifyPause();
    expect(p.noteStatus(429, '8940', 0)).toBe(true);
    expect(p.isPaused(8940 * 1000 - 1)).toBe(true);
    expect(p.isPaused(8940 * 1000)).toBe(false);
  });

  test('another 429 extends but never shortens, and reports no new start', () => {
    const p = createSpotifyPause();
    p.noteStatus(429, '100', 0);
    expect(p.noteStatus(429, '10', 1000)).toBe(false);
    expect(p.msRemaining(1000)).toBe(99000);
    p.noteStatus(429, '200', 1000);
    expect(p.msRemaining(1000)).toBe(200000);
  });

  test('other statuses change nothing', () => {
    const p = createSpotifyPause();
    expect(p.noteStatus(200, null, 0)).toBe(false);
    expect(p.noteStatus(503, '60', 0)).toBe(false);
    expect(p.isPaused(1)).toBe(false);
  });

  test('a missing or junk Retry-After is 5 s; a huge one is capped at a day', () => {
    expect(retryAfterMs(null)).toBe(5000);
    expect(retryAfterMs('soon')).toBe(5000);
    expect(retryAfterMs('0')).toBe(5000);
    expect(retryAfterMs(String(10 * 24 * 3600))).toBe(MAX_PAUSE_MS);
  });
});

test('isSpotifyApiUrl matches only the Web API host', () => {
  expect(isSpotifyApiUrl('https://api.spotify.com/v1/me/player')).toBe(true);
  expect(isSpotifyApiUrl({ url: 'https://api.spotify.com/v1/search?q=a' })).toBe(true);
  expect(isSpotifyApiUrl('https://accounts.spotify.com/api/token')).toBe(false);
  expect(isSpotifyApiUrl('https://open.spotify.com/track/x')).toBe(false);
  expect(isSpotifyApiUrl('not a url')).toBe(false);
});

test('pausedResponse is a 429 carrying the time left', async () => {
  const r = pausedResponse(61500);
  expect(r.status).toBe(429);
  expect(r.ok).toBe(false);
  expect(r.headers.get('Retry-After')).toBe('62');
});

describe('wiring', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

  test('the renderer gates every api.spotify.com fetch', () => {
    const app = read('src/renderer/app.js');
    expect(app).toMatch(/isSpotifyApiUrl\(input\)/);
    expect(app).toMatch(/spotifyPause\.isPaused\(\)\)\s*\{?[\s\S]{0,200}pausedResponse\(/);
    expect(app).toMatch(/spotifyPause\.noteStatus\(/);
  });

  test('main: the playback poller, its recovery and the quit pause skip while paused', () => {
    const main = read('main.js');
    expect((main.match(/sharedPause\.isPaused\(\)/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((main.match(/sharedPause\.noteStatus\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('the sync provider shares the main-process pause', () => {
    const sync = read('sync-providers/spotify.js');
    expect(sync).toMatch(/require\('\.\/spotify-pause'\)/);
    expect(sync).toMatch(/sharedPause\.isPaused\(/);
    expect(sync).toMatch(/sharedPause\.noteStatus\(/);
  });
});

describe('the sync sign-in check honours the pause', () => {
  const spotify = require('../../sync-providers/spotify');
  const { sharedPause } = require('../../sync-providers/spotify-pause');
  afterEach(() => { sharedPause.clear(); delete global.fetch; });

  test('while paused it answers 429 without a request', async () => {
    sharedPause.noteStatus(429, '600');
    global.fetch = jest.fn();
    expect(await spotify.checkAuthStatus('tok')).toEqual({ ok: false, status: 429 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a 429 from /me starts the pause, so the sync after it sends nothing', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? '600' : null) } });
    expect(await spotify.checkAuthStatus('tok')).toEqual({ ok: false, status: 429 });
    expect(sharedPause.isPaused()).toBe(true);
    await expect(spotify.getPlaylistSnapshot('p', 'tok')).rejects.toThrow(/cooldown/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// #909: the pause outlives a restart and is shared by both processes.
describe('a pause known elsewhere (extendTo, onChange)', () => {
  test('extendTo adopts a later end, never shortens, and ignores one already over or junk', () => {
    const p = createSpotifyPause();
    expect(p.extendTo(60000, 0)).toBe(true);
    expect(p.until()).toBe(60000);
    expect(p.extendTo(30000, 0)).toBe(false);
    expect(p.extendTo(60000, 0)).toBe(false);
    expect(p.until()).toBe(60000);
    expect(p.extendTo(500, 1000)).toBe(false);
    expect(p.extendTo('later', 0)).toBe(false);
    expect(p.extendTo(undefined, 0)).toBe(false);
  });

  test('a saved end time is capped at a day from now', () => {
    const p = createSpotifyPause();
    expect(p.extendTo(1e15, 1000)).toBe(true);
    expect(p.until()).toBe(1000 + MAX_PAUSE_MS);
  });

  test('onChange hears every lengthening, from a 429 or extendTo, and nothing else', () => {
    const p = createSpotifyPause();
    const seen = [];
    const off = p.onChange((until) => seen.push(until));
    p.noteStatus(200, null, 0);
    p.noteStatus(429, '10', 0);
    p.noteStatus(429, '5', 0); // shorter: no change
    p.extendTo(20000, 0);
    p.extendTo(15000, 0); // shorter: no change
    expect(seen).toEqual([10000, 20000]);
    off();
    p.extendTo(30000, 0);
    expect(seen).toEqual([10000, 20000]);
  });

  test("two processes' pauses settle on the later end without echoing forever", () => {
    // main and the renderer, wired as main.js and installSpotifyPause wire them
    const main = createSpotifyPause();
    const renderer = createSpotifyPause();
    let hops = 0;
    main.onChange((u) => { hops++; renderer.extendTo(u, 0); });
    renderer.onChange((u) => { hops++; main.extendTo(u, 0); });
    renderer.noteStatus(429, '100', 0);
    expect(main.until()).toBe(100000);
    expect(renderer.until()).toBe(100000);
    expect(hops).toBe(2);
    main.noteStatus(429, '200', 0);
    expect(renderer.until()).toBe(200000);
  });

  test('a listener that throws does not stop the pause or the other listeners', () => {
    const p = createSpotifyPause();
    const seen = [];
    p.onChange(() => { throw new Error('boom'); });
    p.onChange((u) => seen.push(u));
    expect(p.noteStatus(429, '1', 0)).toBe(true);
    expect(seen).toEqual([1000]);
  });
});

describe('#909 wiring: saved, restored and shown', () => {
  const root = path.join(__dirname, '../..');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const main = read('main.js');
  const app = read('src/renderer/app.js');
  const preload = read('preload.js');
  const coll = read('src/renderer/components/collection-page.js');

  test('main restores the saved pause right after loading the module, before anything calls Spotify', () => {
    const load = main.indexOf("require('./sync-providers/spotify-pause')");
    const restore = main.indexOf("sharedPause.extendTo(store.get('spotify_pause_until'));");
    expect(restore).toBeGreaterThan(load);
    expect(restore - load).toBeLessThan(600);
    expect(restore).toBeLessThan(main.indexOf('async poll()'));
  });

  test('main saves every lengthening and tells the renderer, and the breaker re-announces too', () => {
    expect(main).toMatch(/sharedPause\.onChange\(\(until\) => \{\s*try \{ store\.set\('spotify_pause_until', until\); \}[\s\S]{0,200}announceSpotifyCooldown\(\);/);
    expect(main).toContain("save: (s) => { store.set('spotify_breaker_state', s); announceSpotifyCooldown(); },");
    expect(main).toContain("safeSendToRenderer('spotify-cooldown-changed', spotifyCooldown());");
    expect(main).toContain("ipcMain.handle('spotify-cooldown-get', () => spotifyCooldown());");
    expect(main).toContain("ipcMain.on('spotify-pause-note', (_event, until) => { sharedPause.extendTo(until); });");
  });

  test('preload exposes the cooldown read, the note and the change event', () => {
    expect(preload).toContain("getCooldown: () => ipcRenderer.invoke('spotify-cooldown-get'),");
    expect(preload).toContain("notePause: (until) => ipcRenderer.send('spotify-pause-note', Number(until) || 0),");
    expect(preload).toContain("ipcRenderer.on('spotify-cooldown-changed', handler);");
  });

  test("the renderer adopts main's pause and hands main its own", () => {
    expect(app).toContain('spotifyPause.extendTo(cooldown.pauseUntil);');
    expect(app).toMatch(/spotifyPause\.onChange\(\(until\) => \{\s*if \(bridge && typeof bridge\.notePause === 'function'\) bridge\.notePause\(until\);/);
    expect(app).toContain('bridge.getCooldown().then(adopt)');
    expect(app).toContain('bridge.onCooldownChanged(adopt)');
  });

  test("the Sync menu shows when a service's cooldown ends, after Signed out", () => {
    expect(app).toContain("window.addEventListener('parachord:spotify-cooldown', onCooldown);");
    expect(coll).toContain("const { untilLabel } = require('../lib/until-label');");
    expect(coll).toContain('`Paused until ${untilLabel(syncPausedUntil[pid])}`');
    expect(coll).toMatch(/trailing: syncSignedOut\?\.\[pid\]\s*\? [\s\S]{0,120}'Signed out'\)\s*: \(syncPausedUntil\?\.\[pid\] > Date\.now\(\)/);
  });
});

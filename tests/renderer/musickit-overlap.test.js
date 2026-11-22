/**
 * Apple Music through MusicKit JS (the web player: Windows, Linux, and a Mac
 * whose native player isn't ready, error 6 after a macOS update) broke when
 * two plays overlapped. A second play cut into the first's setQueue ("The
 * play() request was interrupted by a call to pause()"), MusicKit showed that
 * in its own dialog, and the older play finishing late left it stopped.
 *
 *   1. MusicKit's own error dialog is off (suppressErrorDialog): Parachord
 *      handles a failed play itself.
 *   2. handlePlay waits for the MusicKit JS pause before the next play.
 *   3. Plays run one at a time, and only the newest still wanted runs: a play
 *      that a newer play or a pause overtook while it waited is skipped, and
 *      one already running when a pause comes is paused once it lands.
 *   4. The error-6 toast says what's happening (it plays through the web
 *      player) and what fixes it (open the Music app once).
 */
const fs = require('fs');
const path = require('path');
const { MusicKitWeb } = require('../../musickit-web');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// A MusicKit whose setQueue resolves when the test says, recording the order
// of everything asked of it.
function fakeMusicKit() {
  const calls = [];
  const pending = [];
  const musicKit = {
    setQueue: jest.fn((opts) => new Promise((resolve) => { calls.push(`setQueue:${opts.song}`); pending.push(resolve); })),
    pause: jest.fn(async () => { calls.push('pause'); }),
    stop: jest.fn(async () => { calls.push('stop'); }),
    play: jest.fn(async () => { calls.push('play'); }),
  };
  const mk = new MusicKitWeb();
  mk.musicKit = musicKit;
  mk.isConfigured = true;
  Object.defineProperty(mk, 'isAuthorized', { get: () => true });
  const releaseNext = async () => { const r = pending.shift(); if (r) r(); await new Promise((x) => setImmediate(x)); };
  return { mk, musicKit, calls, releaseNext, pending };
}
const tick = () => new Promise((x) => setImmediate(x));

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('MusicKit JS plays run one at a time, newest wins', () => {
  test('a second play waits for the first\'s setQueue instead of cutting into it', async () => {
    const { mk, calls, releaseNext } = fakeMusicKit();
    const first = mk.play('A');
    await tick();
    const second = mk.play('B');
    await tick();
    expect(calls).toEqual(['setQueue:A']); // B hasn't touched MusicKit yet
    await releaseNext();
    await tick();
    expect(calls).toEqual(['setQueue:A', 'setQueue:B']);
    await releaseNext();
    await expect(first).resolves.toMatchObject({ playing: true });
    await expect(second).resolves.toMatchObject({ playing: true });
  });

  test('a play a newer play overtook while it waited never runs', async () => {
    const { mk, calls, releaseNext } = fakeMusicKit();
    const a = mk.play('A');
    await tick();
    const b = mk.play('B');
    const c = mk.play('C');
    await releaseNext(); // A lands
    await tick();
    await releaseNext(); // C lands
    await expect(a).resolves.toMatchObject({ playing: true });
    await expect(b).resolves.toMatchObject({ playing: false, superseded: true });
    await expect(c).resolves.toMatchObject({ playing: true });
    expect(calls).toEqual(['setQueue:A', 'setQueue:C']);
  });

  test('a pause cancels a play still waiting its turn', async () => {
    const { mk, calls, releaseNext } = fakeMusicKit();
    const a = mk.play('A');
    await tick();
    const b = mk.play('B');
    await mk.pause();
    await releaseNext(); // A lands
    await expect(b).resolves.toMatchObject({ playing: false, superseded: true });
    expect(calls.filter((c) => c.startsWith('setQueue'))).toEqual(['setQueue:A']);
    await a;
  });

  test('a play already running when a pause comes is paused once it lands (another engine took over)', async () => {
    const { mk, calls, releaseNext } = fakeMusicKit();
    const a = mk.play('A');
    await tick();
    await mk.pause(); // handlePlay starting a Spotify track
    await releaseNext();
    await expect(a).resolves.toMatchObject({ playing: false, superseded: true });
    expect(calls).toEqual(['setQueue:A', 'pause', 'pause']);
  });

  test('a play after a pause is not paused by it', async () => {
    const { mk, calls, releaseNext } = fakeMusicKit();
    await mk.pause();
    const a = mk.play('A');
    await tick();
    await releaseNext();
    await expect(a).resolves.toMatchObject({ playing: true });
    expect(calls).toEqual(['pause', 'setQueue:A']);
  });

  test('a failed setQueue rejects that play and doesn\'t block the next', async () => {
    const { mk, musicKit, releaseNext } = fakeMusicKit();
    musicKit.setQueue.mockImplementationOnce(async () => { throw new Error('nope'); });
    await expect(mk.play('A')).rejects.toThrow('nope');
    const b = mk.play('B');
    await tick();
    await releaseNext();
    await expect(b).resolves.toMatchObject({ playing: true });
  });

  test('playQueue takes its turn the same way', async () => {
    const { mk, musicKit, releaseNext } = fakeMusicKit();
    musicKit.setQueue.mockImplementation((opts) => new Promise((resolve) => setImmediate(resolve)));
    const a = mk.play('A');
    const q = mk.playQueue(['X', 'Y']);
    await expect(a).resolves.toMatchObject({ playing: false, superseded: true });
    await expect(q).resolves.toMatchObject({ playing: true, queueLength: 2 });
    void releaseNext;
  });
});

describe('the wiring', () => {
  test('MusicKit\'s own error dialog is off', () => {
    expect(read('musickit-web.js')).toMatch(/const musicKitConfig = \{[\s\S]*?suppressErrorDialog: true,[\s\S]*?\};/);
  });

  test('handlePlay waits for the MusicKit JS pause with the other engines\' pauses', () => {
    const engine = read('src', 'renderer', 'hooks', 'use-playback-engine.js');
    const block = engine.slice(engine.indexOf('// Always pause Apple Music web playback (MusicKit JS)'), engine.indexOf('// Always stop Apple Music preview audio'));
    expect(block).toContain('pausePromises.push(Promise.resolve(musicKitWeb.pause()).catch(() => {}));');
    expect(block).not.toMatch(/^\s*musicKitWeb\.pause\(\);/m);
  });

  test('the error-6 toast says it plays through the web player and how to fix it, as info', () => {
    const app = read('src', 'renderer', 'app.js');
    const handler = app.slice(app.indexOf('const handleAppleMusicSessionError = () => {'), app.indexOf("window.addEventListener('musickit-track-ended'"));
    expect(handler).toContain("showToast('Apple Music is playing through its web player because this Mac’s player isn’t ready. Open the Music app once to fix it.', 'info'");
    expect(handler).not.toContain("can\\'t play right now");
  });
});

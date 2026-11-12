/**
 * A restored queue's track resumes where it was (#1319). Play started it at
 * 0:00 and an effect seeked 500 ms later, so the bar jumped to 0:00 and back
 * and the first half second played before the jump (seen on Apple Music).
 * handlePlay now hands the position to engines that can start there: local
 * files and html5 streams (the element's start time), Amazon (Shaka's load
 * start time), Apple Music (the native helper sets playbackTime before play)
 * and Spotify (position_ms). The effect still seeks for the rest.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { pendingStartAt, trackPositionKey } = require('../../src/renderer/lib/playback-helpers');

describe('pendingStartAt', () => {
  const track = { id: 'spoon-inside-out', artist: 'Spoon', title: 'Inside Out' };
  const pending = { trackKey: trackPositionKey(track), position: 141.4 };

  test('the pending position for this track', () => {
    expect(pendingStartAt(pending, track)).toBe(141.4);
    expect(pendingStartAt(pending, { ...track, sources: { applemusic: {} } })).toBe(141.4);
  });

  test('another track, nothing pending, or no position: start at 0', () => {
    expect(pendingStartAt(pending, { id: 'other', artist: 'B', title: 'T' })).toBe(0);
    expect(pendingStartAt(null, track)).toBe(0);
    expect(pendingStartAt({ ...pending, position: 0 }, track)).toBe(0);
  });
});

describe('the engine starts there when it can', () => {
  const engine = read('src/renderer/hooks/use-playback-engine.js');

  test('handlePlay reads the start and clears the pending seek only for an engine that started there', () => {
    expect(engine).toContain('const pendingStart = pendingStartPositionRef ? pendingStartPositionRef.current : null;');
    expect(engine).toContain('const startAt = pendingStartAt(pendingStart, trackOrSource);');
    expect(engine).toMatch(/const startedAtPosition = \(\) => \{\s*if \(startAt > 0 && pendingStartPositionRef\.current === pendingStart\) pendingStartPositionRef\.current = null;/);
  });

  test('local files and html5 streams set the element\'s start before play', () => {
    const sets = engine.match(/audioRef\.current\.load\(\);\s*\/\/ Before metadata, this sets where playback starts\.\s*if \(startAt > 0\) audioRef\.current\.currentTime = startAt;/g) || [];
    expect(sets).toHaveLength(2);
  });

  test('the bar shows the start, not 0:00, for engines that started there', () => {
    expect((engine.match(/setProgress\(startAt\);\s*startedAtPosition\(\);/g) || []).length).toBe(3); // local, Amazon, html5 stream
    expect(engine).toContain('setProgress(startedThere ? startAt : 0);');
  });

  test('a plugin gets _startAt and acknowledges with _startedAt', () => {
    expect(engine).toContain('const playSource = startAt > 0 ? { ...sourceToPlay, _startAt: startAt } : sourceToPlay;');
    expect(engine).toContain('const success = await resolver.play(playSource, config);');
    expect(engine).toContain('const startedThere = startAt > 0 && playSource._startedAt === startAt;');
  });

  test('Amazon passes the start to Shaka\'s load', () => {
    expect(engine).toMatch(/__parachordWidevine\.play\(audioRef\.current, \{\s*resolverId,\s*startTime: startAt,/);
    const wv = read('src/renderer/lib/widevine-player.js');
    expect(wv).toContain('async function play(audio, { resolverId, entity, trackContext, startTime } = {}) {');
    expect(wv).toContain('await player.load(uri, startTime > 0 ? startTime : undefined);');
  });

  test('the resume effect still seeks for an engine that didn\'t', () => {
    const app = read('src/renderer/app.js');
    expect(app).toMatch(/if \(pending\.position > 0\) setTimeout\(\(\) => handleSeekRef\.current\?\.\(pending\.position\), 500\);/);
  });
});

describe('Apple Music native start', () => {
  const swift = read('native/musickit-helper/Sources/MusicKitHelperApp.swift');
  const bridge = read('musickit-bridge.js');
  const preload = read('preload.js');

  test('the helper sets playbackTime after prepareToPlay and before play, on the retry too', () => {
    expect(swift).toContain('func play(songId: String, startTime: Double = 0) async throws -> [String: Any] {');
    const sets = swift.match(/try await player\.prepareToPlay\(\)\s*if startTime > 0 \{ player\.playbackTime = startTime \}/g) || [];
    expect(sets).toHaveLength(2);
    expect(swift).toContain('if startTime > 0 { answer["startTime"] = startTime }');
    expect(swift).toContain('result = try await bridge.play(songId: songId, startTime: startTime)');
  });

  test('the bridge and preload forward it, only when there is one', () => {
    expect(bridge).toContain("const params = Number.isFinite(startTime) && startTime > 0 ? { songId, startTime } : { songId };");
    expect(preload).toContain("play: (songId, startTime) => ipcRenderer.invoke('musickit:play', songId, startTime),");
  });
});

describe('plugins', () => {
  const instantiate = (id) => {
    const axe = JSON.parse(read(`plugins/${id}.axe`));
    return new Function('return ' + axe.implementation.play)();
  };

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.window;
  });

  const appleWindow = (playImpl) => ({
    electron: { musicKit: { checkAuth: async () => ({ success: true, authorized: true }), play: jest.fn(playImpl) } }
  });

  test('Apple Music asks the helper to start there and acknowledges when it did', async () => {
    global.window = appleWindow(async (id, startTime) => ({ success: true, playing: true, ...(startTime ? { startTime } : {}) }));
    const track = { appleMusicId: '123', _startAt: 141.4 };
    expect(await instantiate('applemusic')(track, {})).toBe(true);
    expect(global.window.electron.musicKit.play).toHaveBeenCalledWith('123', 141.4);
    expect(track._startedAt).toBe(141.4);
  });

  test('Apple Music with an older helper (no startTime in the answer) doesn\'t acknowledge, so the host seeks', async () => {
    global.window = appleWindow(async () => ({ success: true, playing: true }));
    const track = { appleMusicId: '123', _startAt: 141.4 };
    expect(await instantiate('applemusic')(track, {})).toBe(true);
    expect(track._startedAt).toBeUndefined();
  });

  test('Apple Music with no start plays as before', async () => {
    global.window = appleWindow(async () => ({ success: true }));
    await instantiate('applemusic')({ appleMusicId: '123' }, {});
    expect(global.window.electron.musicKit.play).toHaveBeenCalledWith('123');
  });
});

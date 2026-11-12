/**
 * A restored queue's track resumes where it was (#1319). The scrobbler's
 * threshold is on position (half the track or 4 minutes), and every play
 * reset it, so a track paused past its threshold, restored, and resumed was
 * scrobbled a second time within a second of Play. The saved position now
 * records whether that listen was scrobbled, and a resume of it isn't
 * submitted again.
 */
const fs = require('fs');
const path = require('path');
const { ScrobbleManager } = require('../../scrobbler-loader');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function managerWithPlugin() {
  const mgr = new ScrobbleManager();
  const plugin = { id: 'test', isEnabled: async () => true, updateNowPlaying: jest.fn(async () => {}), scrobble: jest.fn(async () => {}) };
  mgr.registerPlugin(plugin);
  return { mgr, plugin };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const track = { id: 'spoon-inside-out', title: 'Inside Out', artist: 'Spoon', duration: 301 };

describe('ScrobbleManager', () => {
  test('a resumed listen that was already scrobbled is not scrobbled again; Now Playing still goes out', async () => {
    const { mgr, plugin } = managerWithPlugin();
    await mgr.onTrackStart(track, { continuesScrobbled: true });
    expect(plugin.updateNowPlaying).toHaveBeenCalledTimes(1);
    await mgr.onProgressUpdate(200); // past the 150.5 s threshold
    expect(plugin.scrobble).not.toHaveBeenCalled();
  });

  test('a resumed listen that wasn\'t scrobbled yet scrobbles at the threshold', async () => {
    const { mgr, plugin } = managerWithPlugin();
    await mgr.onTrackStart(track, { continuesScrobbled: false });
    await mgr.onProgressUpdate(141);
    expect(plugin.scrobble).not.toHaveBeenCalled();
    await mgr.onProgressUpdate(151);
    expect(plugin.scrobble).toHaveBeenCalledTimes(1);
  });

  test('a plain start scrobbles as before', async () => {
    const { mgr, plugin } = managerWithPlugin();
    await mgr.onTrackStart(track);
    await mgr.onProgressUpdate(151);
    expect(plugin.scrobble).toHaveBeenCalledTimes(1);
  });

  test('hasScrobbled answers for the playing track only, once it scrobbled', async () => {
    const { mgr } = managerWithPlugin();
    const isIt = (t) => t.id === track.id;
    expect(mgr.hasScrobbled(isIt)).toBe(false);
    await mgr.onTrackStart(track);
    expect(mgr.hasScrobbled(isIt)).toBe(false);
    await mgr.onProgressUpdate(151);
    expect(mgr.hasScrobbled(isIt)).toBe(true);
    expect(mgr.hasScrobbled((t) => t.id === 'other')).toBe(false);
    mgr.onTrackEnd();
    expect(mgr.hasScrobbled(isIt)).toBe(false);
  });
});

describe('the app carries it across a restart', () => {
  const app = read('src/renderer/app.js');
  const engine = read('src/renderer/hooks/use-playback-engine.js');

  test('the saved position records whether the listen was scrobbled', () => {
    expect(app).toContain('const scrobbled = !!window.scrobbleManager?.hasScrobbled?.((t) => trackPositionKey(t) === trackKey)');
    // A restored track not played yet keeps what it was saved with (the save
    // on pause runs at launch too).
    expect(app).toContain('|| !!(pending && pending.trackKey === trackKey && pending.scrobbled);');
    expect(app).toContain("{ trackKey, position: progressRef.current, ...(scrobbled ? { scrobbled: true } : {}) }");
  });

  test('the restore and a seek before Play keep it on the pending position', () => {
    expect(app).toContain('pendingStartPositionRef.current = { trackKey: firstTrackKey, position: startAt, ...(savedQueuePosition.scrobbled ? { scrobbled: true } : {}) };');
    expect(app).toContain('pendingStartPositionRef.current = { trackKey, position: newPosition, ...(prior && prior.trackKey === trackKey && prior.scrobbled ? { scrobbled: true } : {}) };');
  });

  test('handlePlay tells the scrobbler at every start', () => {
    expect(engine).toContain('const scrobbleStart = { continuesScrobbled: startAt > 0 && !!pendingStart.scrobbled };');
    expect(engine).not.toContain('window.scrobbleManager.onTrackStart(trackToSet);');
    expect((engine.match(/window\.scrobbleManager\.onTrackStart\(trackToSet, scrobbleStart\);/g) || []).length).toBe(6);
  });
});

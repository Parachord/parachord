/**
 * Subsonic's "Report plays to your server" (#1546): while the switch is on,
 * a track that plays from Subsonic is reported with scrobble.view, as Now
 * Playing at its start (submission=false) and as a play at the scrobble
 * threshold (submission=true). It rides the scrobble manager's plugin
 * contract (window.scrobbleManager.registerPlugin), started by the host for a
 * playing plug-in with capabilities.playbackTelemetry
 * (lib/playback-telemetry.js), which hands the plug-in host.getConfig.
 *
 * Runs the real .axe through the real ResolverLoader and the real
 * ScrobbleManager, with fetch mocked: no server is asked.
 */

const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');
const { ScrobbleManager } = require('../../scrobbler-loader');
const { initPlaybackTelemetry } = require('../../src/renderer/lib/playback-telemetry');

const ROOT = path.join(__dirname, '../..');
const axe = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/subsonic.axe'), 'utf8'));

const CONFIG = { serverUrl: 'http://navidrome.local:4533', username: 'alice', password: 'sekret', reportPlays: true };

const ok = () => ({ ok: true, status: 200, json: async () => ({ 'subsonic-response': { status: 'ok', version: '1.16.1' } }) });
const failed = (code, message) => ({
  ok: true, status: 200,
  json: async () => ({ 'subsonic-response': { status: 'failed', version: '1.16.1', error: { code, message } } }),
});

// A track as the playback engine hands it to the scrobble manager: the
// playing source's fields spread on top, _activeResolver naming what played.
const subsonicPlay = (over = {}) => ({
  id: 'radiohead-pyramid-song',
  title: 'Pyramid Song',
  artist: 'Radiohead',
  album: 'Amnesiac',
  duration: 288,
  subsonicId: 'song-42',
  subsonicServer: 'http://navidrome.local:4533',
  sources: { subsonic: { subsonicId: 'song-42', confidence: 1 }, spotify: { spotifyId: 'sp1', confidence: 1 } },
  _activeResolver: 'subsonic',
  ...over,
});
const spotifyPlay = () => ({
  id: 'radiohead-pyramid-song', title: 'Pyramid Song', artist: 'Radiohead', album: 'Amnesiac', duration: 288,
  spotifyId: 'sp1',
  sources: { subsonic: { subsonicId: 'song-42', confidence: 1 }, spotify: { spotifyId: 'sp1', confidence: 1 } },
  _activeResolver: 'spotify',
});

let store;
let config;
let logs;

function setup({ manager = true, host = true } = {}) {
  store = {};
  config = { ...CONFIG };
  const mgr = manager ? new ScrobbleManager() : null;
  global.window = {
    scrobbleManager: mgr || undefined,
    electron: {
      store: {
        get: jest.fn(async (k) => store[k]),
        set: jest.fn(async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }),
      },
    },
  };
  global.fetch = jest.fn(async () => ok());
  const loader = new ResolverLoader();
  return { mgr, loader, host };
}

async function start(loader, host = true) {
  await loader.loadResolvers([axe]);
  if (host) return initPlaybackTelemetry(loader, loader.getAllResolvers(), async () => config);
  // A host that passes nothing (the mobile apps' telemetry init).
  await loader.initResolver('subsonic', {});
  return [];
}

const params = (call) => new URL(call[0]).searchParams;
const scrobbleCalls = () => global.fetch.mock.calls.filter((c) => /\/rest\/scrobble\.view\?/.test(c[0]));

beforeEach(() => {
  logs = [];
  for (const level of ['log', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { logs.push(args.map(String).join(' ')); });
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  delete global.window;
  delete global.fetch;
});

describe('the manifest', () => {
  test('declares the capability the host starts it by, and the switch outside configurable, off by default', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins-src/subsonic/manifest.json'), 'utf8'));
    expect(m.capabilities.playbackTelemetry).toBe(true);
    expect(m.settings.switches.reportPlays.label).toBe('Report plays to your server');
    expect(m.settings.switches.reportPlays.default).toBe(false);
    // The mobile apps and older desktops draw every configurable field as a
    // text box, so the switch must not be one.
    expect(m.settings.configurable.reportPlays).toBeUndefined();
    // Nothing it relies on is missing from an older app: it just does nothing there.
    expect(m.manifest.minAppVersion.desktop).toBeUndefined();
  });
});

describe('with the switch on', () => {
  test('a Subsonic play sends submission=false at its start and submission=true at the threshold, with its song id', async () => {
    const { mgr, loader } = setup();
    expect(await start(loader)).toEqual(['subsonic']);
    expect(mgr.plugins.has('subsonic')).toBe(true);

    await mgr.onTrackStart(subsonicPlay());
    expect(scrobbleCalls()).toHaveLength(1);
    const np = params(scrobbleCalls()[0]);
    expect(scrobbleCalls()[0][0]).toMatch(/^http:\/\/navidrome\.local:4533\/rest\/scrobble\.view\?/);
    expect(np.get('id')).toBe('song-42');
    expect(np.get('submission')).toBe('false');
    expect(np.get('time')).toBeNull();
    // The plug-in's own token auth, never the password.
    expect(np.get('u')).toBe('alice');
    expect(np.get('t')).toMatch(/^[0-9a-f]{32}$/);
    expect(np.get('s')).toBeTruthy();
    expect(np.get('c')).toBe('parachord');
    expect(scrobbleCalls()[0][0]).not.toContain('sekret');

    await mgr.onProgressUpdate(100);
    expect(scrobbleCalls()).toHaveLength(1);
    await mgr.onProgressUpdate(145); // half of 288
    expect(scrobbleCalls()).toHaveLength(2);
    const play = params(scrobbleCalls()[1]);
    expect(play.get('id')).toBe('song-42');
    expect(play.get('submission')).toBe('true');
    expect(Number(play.get('time'))).toBe(Math.floor(mgr.trackStartTime / 1000) * 1000);

    // Once per listen.
    await mgr.onProgressUpdate(200);
    expect(scrobbleCalls()).toHaveLength(2);
  });

  test('the song id comes from the Subsonic source when it is not on the track itself', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    const track = subsonicPlay();
    delete track.subsonicId;
    await mgr.onTrackStart(track);
    expect(params(scrobbleCalls()[0]).get('id')).toBe('song-42');
  });

  test('a play from another source sends nothing', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    await mgr.onTrackStart(spotifyPlay());
    await mgr.onProgressUpdate(200);
    expect(global.fetch).not.toHaveBeenCalled();
    // Nothing queued for it either.
    expect(store['scrobble-failed-queue']).toBeUndefined();
  });
});

describe('with the switch off', () => {
  test('nothing is sent, off being the default', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    delete config.reportPlays;
    await mgr.onTrackStart(subsonicPlay());
    await mgr.onProgressUpdate(200);
    config.reportPlays = false;
    await mgr.onTrackStart(subsonicPlay());
    await mgr.onProgressUpdate(200);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('turning it on applies to the next play, without a reload', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    config.reportPlays = false;
    await mgr.onTrackStart(subsonicPlay());
    expect(global.fetch).not.toHaveBeenCalled();
    config.reportPlays = true;
    await mgr.onTrackStart(subsonicPlay());
    expect(scrobbleCalls()).toHaveLength(1);
  });

  test('a server with no saved credentials is not asked', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    delete config.password;
    await mgr.onTrackStart(subsonicPlay());
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  test('a failed submission throws, so the manager queues it with the song id, and the retry sends it', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    await mgr.onTrackStart(subsonicPlay());
    global.fetch.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await mgr.onProgressUpdate(200);

    const queue = store['scrobble-failed-queue'];
    expect(queue).toHaveLength(1);
    expect(queue[0].pluginId).toBe('subsonic');
    expect(queue[0].track).toEqual({
      title: 'Pyramid Song', artist: 'Radiohead', album: 'Amnesiac', duration: 288,
      _activeResolver: 'subsonic', subsonicId: 'song-42',
    });
    expect(queue[0].error).toBe('Subsonic scrobble failed: HTTP 503');

    // The next launch: a new manager's startup pass runs before plug-ins
    // load, so it keeps the item; Subsonic's registration retries it.
    const timestamp = queue[0].timestamp;
    const next = new ScrobbleManager();
    window.scrobbleManager = next;
    global.fetch.mockClear();
    global.fetch.mockImplementation(async () => ok());
    await next.retryFailedScrobbles();
    expect(store['scrobble-failed-queue']).toHaveLength(1);
    expect(global.fetch).not.toHaveBeenCalled();

    const loader2 = new ResolverLoader();
    await start(loader2);
    await next._queueChain;
    expect(scrobbleCalls()).toHaveLength(1);
    const retried = params(scrobbleCalls()[0]);
    expect(retried.get('id')).toBe('song-42');
    expect(retried.get('submission')).toBe('true');
    expect(Number(retried.get('time'))).toBe(timestamp * 1000);
    expect(store['scrobble-failed-queue']).toEqual([]);
  });

  test('wrong credentials (error 40) are queued and wait; the retry pass stops at the first one instead of looping', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    global.fetch.mockImplementation(async (url) => (/submission=true/.test(url) ? failed(40, 'Wrong username or password') : ok()));
    await mgr.onTrackStart(subsonicPlay());
    await mgr.onProgressUpdate(200);
    await mgr.onTrackStart(subsonicPlay({ subsonicId: 'song-43' }));
    await mgr.onProgressUpdate(200);
    expect(store['scrobble-failed-queue']).toHaveLength(2);

    global.fetch.mockClear();
    await mgr.retryFailedScrobbles();
    // One request: the auth error pauses the rest of the pass.
    expect(scrobbleCalls()).toHaveLength(1);
    const queue = store['scrobble-failed-queue'];
    expect(queue).toHaveLength(2);
    expect(queue.map((i) => i.attempts)).toEqual([1, 1]);
  });

  test('a play the server will never take (error 70, song not found) is logged once and not queued', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    global.fetch.mockImplementation(async () => failed(70, 'Song not found'));
    await mgr.onTrackStart(subsonicPlay());
    await mgr.onProgressUpdate(200);
    await mgr.onTrackStart(subsonicPlay());
    await mgr.onProgressUpdate(200);
    expect(store['scrobble-failed-queue']).toBeUndefined();
    expect(logs.filter((l) => /not retrying/.test(l))).toHaveLength(1);
  });

  test('a Now Playing failure is ignored and logged once', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    global.fetch.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    await expect(mgr.onTrackStart(subsonicPlay())).resolves.toBeUndefined();
    await mgr.onTrackStart(subsonicPlay());
    expect(logs.filter((l) => /couldn’t send Now Playing/.test(l))).toHaveLength(1);
    // The manager didn't see an error from it.
    expect(logs.filter((l) => /Now Playing failed for subsonic/.test(l))).toHaveLength(0);
  });

  test('no log line carries the password, the token or the salt', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    global.fetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await mgr.onTrackStart(subsonicPlay());
    await mgr.onProgressUpdate(200);
    const sent = global.fetch.mock.calls.map((c) => new URL(c[0]).searchParams);
    const secrets = ['sekret', ...sent.map((p) => p.get('t')), ...sent.map((p) => p.get('s'))];
    for (const line of logs) for (const secret of secrets) expect(line).not.toContain(secret);
    expect(JSON.stringify(store)).not.toContain('sekret');
  });
});

describe('hosts without the feature', () => {
  test('without window.scrobbleManager the plug-in loads and does nothing', async () => {
    const { loader } = setup({ manager: false });
    await expect(start(loader)).resolves.toEqual(['subsonic']);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a host that passes no getConfig (the mobile apps) registers nothing', async () => {
    const { mgr, loader } = setup();
    await start(loader, false);
    expect(mgr.plugins.has('subsonic')).toBe(false);
  });

  test('cleanup unregisters it', async () => {
    const { mgr, loader } = setup();
    await start(loader);
    await loader.unloadResolver('subsonic');
    expect(mgr.plugins.has('subsonic')).toBe(false);
  });
});

describe('initPlaybackTelemetry', () => {
  test('starts only playing plug-ins that declare playbackTelemetry, and hands each its own config', async () => {
    const inits = [];
    const loader = {
      initResolver: jest.fn(async (id, cfg, host) => { inits.push([id, await host.getConfig()]); }),
    };
    const resolvers = [
      { id: 'reports', capabilities: { playbackTelemetry: true }, init: () => {} },
      { id: 'quiet', capabilities: { resolve: true }, init: () => {} },
      { id: 'noinit', capabilities: { playbackTelemetry: true } },
    ];
    const started = await initPlaybackTelemetry(loader, resolvers, async (id) => ({ who: id }));
    expect(started).toEqual(['reports']);
    expect(inits).toEqual([['reports', { who: 'reports' }]]);
  });

  test('a plug-in whose init throws does not stop the others', async () => {
    const loader = { initResolver: jest.fn(async (id) => { if (id === 'a') throw new Error('boom'); }) };
    const resolvers = ['a', 'b'].map((id) => ({ id, capabilities: { playbackTelemetry: true }, init: () => {} }));
    expect(await initPlaybackTelemetry(loader, resolvers, async () => ({}))).toEqual(['b']);
  });

  test('app.js starts them on the cold load and on both install paths', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
    expect(app).toContain("const { initPlaybackTelemetry } = require('./lib/playback-telemetry');");
    expect(app).toContain('await initPlaybackTelemetry(resolverLoader.current, resolvers, ');
    expect((app.match(/await initPlaybackTelemetry\(resolverLoader\.current, \[newResolverInstance\], /g) || []).length).toBe(2);
  });
});

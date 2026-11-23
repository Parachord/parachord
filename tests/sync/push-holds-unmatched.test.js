/**
 * A sync push never replaces a mirror with only the tracks it could look up
 * this time (#1637; mobile parachord-mobile#809, found on #807 where a synced
 * Spotify playlist went from 26 tracks to 1).
 *
 * Each provider's resolveTracks now answers three ways:
 *   resolved     found on the service
 *   unresolved   the service answered, and doesn't have it (left out, as before)
 *   unreachable  the lookup went unanswered: a rate limit or cooldown, an auth
 *                failure, a 5xx, the network, an MBID mapper that can't be
 *                reached, a lookup budget spent for this sync
 * and every push holds while any track is unreachable (sync-engine/push-hold.js),
 * leaving the playlist marked for the next sync.
 */

const fs = require('fs');
const path = require('path');

const AM_TOKEN = JSON.stringify({ developerToken: 'dev', userToken: 'usr' });
const res = (status, bodyObj = {}) => {
  const text = JSON.stringify(bodyObj);
  return { ok: status >= 200 && status < 300, status, statusText: String(status), headers: { get: () => null }, json: async () => bodyObj, text: async () => text };
};

afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

describe('pushHold: the one rule', () => {
  const { pushHold } = require('../../sync-engine/push-hold');
  test('holds when the lookup failed or any track went unanswered', () => {
    expect(pushHold(undefined)).toEqual({ reason: 'lookup-failed' });
    expect(pushHold({ success: false, error: 'x' })).toEqual({ reason: 'lookup-failed' });
    expect(pushHold({ success: true, resolved: [{}], unresolved: [], unreachable: [{ artist: 'A', title: 'T' }] }))
      .toEqual({ reason: 'unanswered', count: 1 });
  });
  test('pushes when every track was answered, found or not', () => {
    expect(pushHold({ success: true, resolved: [{}], unresolved: [{ artist: 'A', title: 'T' }], unreachable: [] })).toBeNull();
    // A provider from before the field: nothing unanswered to report.
    expect(pushHold({ resolved: [], unresolved: [] })).toBeNull();
  });
});

describe('Spotify resolveTracks', () => {
  const spotify = require('../../sync-providers/spotify');
  afterEach(() => spotify._setBreakerStore({ load: () => ({ openUntil: 0, level: 0 }) }));

  test('a network failure is unreachable, not a miss', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); });
    const out = await spotify.resolveTracks([{ title: 'X', artist: 'Y' }], 'tok');
    expect(out.resolved).toEqual([]);
    expect(out.unresolved).toEqual([]);
    expect(out.unreachable).toEqual([{ artist: 'Y', title: 'X' }]);
  });

  test('a 400 for the query is an answer: a miss', async () => {
    global.fetch = jest.fn(async () => res(400, { error: { message: 'bad query' } }));
    const out = await spotify.resolveTracks([{ title: 'X', artist: 'Y' }], 'tok');
    expect(out.unresolved).toEqual([{ artist: 'Y', title: 'X' }]);
    expect(out.unreachable).toEqual([]);
  });

  test('an answered empty search is a miss, and a track with a URI needs no lookup', async () => {
    global.fetch = jest.fn(async () => res(200, { tracks: { items: [] } }));
    const out = await spotify.resolveTracks([{ title: 'X', artist: 'Y' }, { title: 'Z', artist: 'Y', spotifyUri: 'spotify:track:z' }], 'tok');
    expect(out.unresolved).toEqual([{ artist: 'Y', title: 'X' }]);
    expect(out.resolved.map((t) => t.spotifyUri)).toEqual(['spotify:track:z']);
    expect(out.unreachable).toEqual([]);
  });
});

describe('Apple Music resolveTracks', () => {
  const applemusic = require('../../sync-providers/applemusic');
  const amFetch = (searchStatus) => jest.fn(async (url) => {
    if (String(url).includes('/me/storefront')) return res(200, { data: [{ id: 'us' }] });
    if (searchStatus === 'throw') throw new TypeError('fetch failed');
    return res(searchStatus, searchStatus === 200 ? { results: { songs: { data: [] } } } : {});
  });

  test.each([429, 500, 503, 401, 403, 'throw'])('a %s from the search is unreachable', async (status) => {
    global.fetch = amFetch(status);
    const out = await applemusic.resolveTracks([{ title: 'X', artist: 'Y' }], AM_TOKEN);
    expect(out.unreachable).toEqual([{ artist: 'Y', title: 'X' }]);
    expect(out.unresolved).toEqual([]);
  });

  test('a 400, or an answered empty search, is a miss', async () => {
    for (const status of [400, 200]) {
      global.fetch = amFetch(status);
      const out = await applemusic.resolveTracks([{ title: 'X', artist: 'Y' }], AM_TOKEN);
      expect(out.unresolved).toEqual([{ artist: 'Y', title: 'X' }]);
      expect(out.unreachable).toEqual([]);
    }
  });
});

describe('ListenBrainz resolveTracks', () => {
  const loadLb = (status) => {
    let lb;
    jest.isolateModules(() => {
      jest.doMock('../../mbid-lookup', () => ({
        resolveRecordingMbid: async () => (status === 'hit'
          ? { status: 'hit', result: { recording_mbid: '11111111-1111-1111-1111-111111111111', confidence: 0.9 } }
          : { status, result: null }),
      }));
      lb = require('../../sync-providers/listenbrainz');
    });
    return lb;
  };

  test('a mapper that can\'t be reached is unreachable, a mapper miss is a miss', async () => {
    let out = await loadLb('unreachable').resolveTracks([{ artist: 'A', title: 'T' }], 'tok');
    expect(out.unreachable).toEqual([{ artist: 'A', title: 'T', album: undefined }]);
    expect(out.unresolved).toEqual([]);
    out = await loadLb('miss').resolveTracks([{ artist: 'A', title: 'T' }], 'tok');
    expect(out.unresolved).toEqual([{ artist: 'A', title: 'T', album: undefined }]);
    expect(out.unreachable).toEqual([]);
  });

  test('a lookup the sync\'s budget couldn\'t fit is unreachable; a miss still cooling down is a miss', async () => {
    const lb = loadLb('hit');
    const pending = { resolve: () => ({ skip: true, mbid: null, pending: true }), record() {}, flush() {} };
    let out = await lb.resolveTracks([{ artist: 'A', title: 'T' }], 'tok', { hydration: pending });
    expect(out.unreachable).toHaveLength(1);
    const coolingMiss = { resolve: () => ({ skip: true, mbid: null }), record() {}, flush() {} };
    out = await lb.resolveTracks([{ artist: 'A', title: 'T' }], 'tok', { hydration: coolingMiss });
    expect(out.unresolved).toHaveLength(1);
    expect(out.unreachable).toEqual([]);
  });
});

describe('sync-create holds instead of writing a partial list', () => {
  const { registerSyncCreateIpc } = require('../../main-process/ipc/sync-create');
  const { createSyncLinks } = require('../../main-process/sync-links');
  const makeStore = () => { const data = {}; return { get: (k) => data[k], set: (k, v) => { data[k] = v; }, delete: (k) => { delete data[k]; } }; };
  const harness = ({ existing } = {}) => {
    const calls = { createPlaylist: 0, updatePlaylistTracks: 0 };
    const provider = {
      capabilities: { playlists: true },
      fetchPlaylists: async () => ({ playlists: existing ? [existing] : [] }),
      createPlaylist: async () => { calls.createPlaylist++; return { externalId: 'NEW', snapshotId: 's' }; },
      updatePlaylistTracks: async () => { calls.updatePlaylistTracks++; return { snapshotId: 's2' }; },
      resolveTracks: async (tracks) => ({ resolved: [tracks[0]], unresolved: [], unreachable: tracks.slice(1).map((t) => ({ artist: t.artist, title: t.title })) }),
    };
    const handlers = new Map();
    registerSyncCreateIpc({
      ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
      SyncEngine: { getProvider: () => provider },
      legacyPlaylistSyncEnabled: () => true,
      getChannelOverride: () => null,
      resolveProviderToken: async () => ({ token: 'TOKEN', refreshTokenCb: async () => 'TOKEN' }),
      lbHydrationOpts: () => undefined,
      achordion: { buildLocalPlaylistMirrorContext: (c) => c, pushPlaylistLinksToAchordion: () => {} },
      syncLinks: createSyncLinks({ store: makeStore() }),
    });
    return { handlers, calls };
  };
  const TRACKS = [{ artist: 'A', title: 'One' }, { artist: 'B', title: 'Two' }, { artist: 'C', title: 'Three' }];

  test('a new mirror isn\'t created while tracks went unanswered', async () => {
    const { handlers, calls } = harness();
    const out = await handlers.get('sync:create-playlist')(null, 'spotify', 'Mine', '', TRACKS, 'local-1');
    expect(out).toMatchObject({ success: false, held: true, error: 'held-unanswered' });
    expect(calls.createPlaylist).toBe(0);
  });

  test('an existing mirror found by name isn\'t replaced with a partial list', async () => {
    const { handlers, calls } = harness({ existing: { externalId: 'EX', name: 'Mine', isOwnedByUser: true, trackCount: 3, snapshotId: 'x' } });
    const out = await handlers.get('sync:create-playlist')(null, 'spotify', 'Mine', '', TRACKS, 'local-1');
    expect(out).toMatchObject({ success: false, held: true });
    expect(calls.updatePlaylistTracks).toBe(0);
  });

  test('the renderer\'s resolve IPC passes unreachable through', async () => {
    const { handlers } = harness();
    const out = await handlers.get('sync:resolve-tracks')(null, 'spotify', TRACKS);
    expect(out.unreachable).toHaveLength(2);
  });
});

describe('both renderer push loops hold', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  test('every pushPlaylist after a resolveTracks asks pushHold first', () => {
    const resolves = [...app.matchAll(/await window\.electron\.sync\.resolveTracks\(providerId, playlist\.tracks \|\| \[\]\)/g)];
    expect(resolves).toHaveLength(2);
    for (const m of resolves) {
      const after = app.slice(m.index, m.index + 2500);
      const holdAt = after.indexOf('pushHold(resolveResult)');
      const pushAt = after.indexOf('window.electron.sync.pushPlaylist(');
      expect(holdAt).toBeGreaterThan(-1);
      expect(holdAt).toBeLessThan(pushAt);
    }
    // The raw, unresolved list is never pushed when the lookup fails.
    expect(app).not.toMatch(/let tracksForPush = playlist\.tracks \|\| \[\];\s*try \{\s*const resolveResult/);
  });
});

describe('the playlist page\'s Send to <service> holds too', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/playlist-view-page.js'), 'utf8');
  test('it matches the tracks, holds on an unanswered lookup, and sends only what matched', () => {
    const start = page.indexOf('const handlePush = async () => {');
    const body = page.slice(start, start + 2500);
    const holdAt = body.indexOf('pushHold(resolveResult)');
    const pushAt = body.indexOf('window.electron.sync.pushPlaylist(');
    expect(holdAt).toBeGreaterThan(-1);
    expect(holdAt).toBeLessThan(pushAt);
    expect(body).toMatch(/pushPlaylist\(provider, externalId, resolveResult\.resolved, metadata\)/);
  });
});

/**
 * Subsonic's loves (parachord#1559 step 3, #1658): a heart stars the song on
 * the server (star.view) when "Push loves to Subsonic" is on, and Import
 * reads the starred songs (getStarred2), each with its source on the server.
 * The manifest says the song is identified by its server id (needs:
 * 'serviceId'), so the host finds it first (lib/love-providers.js
 * pluginLoveProvider): the track arrives with track.sources.subsonic. Never
 * unstar.
 *
 * Runs the real .axe through the real ResolverLoader and the real host
 * wrapper, with fetch mocked: no server is asked.
 */

const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');
const LP = require('../../src/renderer/lib/love-providers');

const ROOT = path.join(__dirname, '../..');
const axe = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/subsonic.axe'), 'utf8'));
const CONFIG = { serverUrl: 'http://navidrome.local:4533', username: 'alice', password: 'sekret' };

const json = (body) => ({ ok: true, status: 200, json: async () => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...body } }) });
const failed = (code, message) => ({ ok: true, status: 200, json: async () => ({ 'subsonic-response': { status: 'failed', error: { code, message } } }) });
const endpointOf = (url) => (String(url).match(/\/rest\/(\w+)\.view/) || [])[1];
const params = (url) => new URL(url).searchParams;

let subsonic;
beforeEach(async () => {
  delete global.window;
  global.window = {};
  global.fetch = jest.fn(async () => json({}));
  const loader = new ResolverLoader();
  await loader.loadResolvers([axe]);
  subsonic = loader.getResolver('subsonic');
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  delete global.window;
  delete global.fetch;
  jest.restoreAllMocks();
});

describe('the manifest', () => {
  test('declares loves: by its own id, and it can list them', () => {
    expect(axe.capabilities.lovedTracks).toBe(true);
    expect(LP.loveDescriptor(axe.loves)).toEqual({ contract: 1, verb: 'Love', needs: 'serviceId', canImport: true });
    expect(subsonic.loves).toEqual(axe.loves);
    expect(LP.lovesOf(subsonic)).toEqual({ contract: 1, verb: 'Love', needs: 'serviceId', canImport: true });
  });
});

describe('loveTrack: a star on the server', () => {
  const track = (source) => ({ artist: 'Radiohead', title: 'Pyramid Song', sources: source ? { subsonic: source } : {} });

  test('stars the song by its server id, with token auth, never the password', async () => {
    const result = await subsonic.loveTrack(track({ subsonicId: 'song-42', subsonicServer: 'http://navidrome.local:4533' }), CONFIG);
    expect(result).toEqual({ ok: true, ref: 'song-42' });
    const url = global.fetch.mock.calls[0][0];
    expect(endpointOf(url)).toBe('star');
    expect(params(url).get('id')).toBe('song-42');
    expect(params(url).get('u')).toBe('alice');
    expect(params(url).get('t')).toMatch(/^[a-f0-9]{32}$/);
    expect(url).not.toContain('sekret');
    expect(global.fetch.mock.calls.some(([u]) => endpointOf(u) === 'unstar')).toBe(false);
  });

  test('no source here, or one from another server, is no match: nothing is starred', async () => {
    await expect(subsonic.loveTrack(track(null), CONFIG)).resolves.toEqual({ ok: false, reason: 'no-match' });
    await expect(subsonic.loveTrack(track({ subsonicId: 'song-42', subsonicServer: 'http://old.local:4533' }), CONFIG))
      .resolves.toEqual({ ok: false, reason: 'no-match' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a refusal or an unreachable server throws, so the push retries', async () => {
    global.fetch = jest.fn(async () => failed(40, 'Wrong username or password'));
    await expect(subsonic.loveTrack(track({ subsonicId: 'song-42' }), CONFIG)).rejects.toThrow('Subsonic star failed: error 40 Wrong username or password');
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));
    await expect(subsonic.loveTrack(track({ subsonicId: 'song-42' }), CONFIG)).rejects.toThrow('HTTP 503');
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(subsonic.loveTrack(track({ subsonicId: 'song-42' }), CONFIG)).rejects.toThrow('could not be reached');
  });
});

describe('getLovedPage: the starred songs', () => {
  const starred = (songs) => json({ starred2: { song: songs } });

  test('every starred song, newest first, with its source on the server and no credential in it', async () => {
    global.fetch = jest.fn(async () => starred([
      { id: 's1', title: 'Older', artist: 'A', album: 'X', duration: 200, starred: '2024-01-02T03:04:05Z', track: 3, year: 2001 },
      { id: 's2', title: 'Newer', artist: 'B', album: 'Y', starred: '2025-06-01T00:00:00Z' },
      { id: 's3' }, // no title: skipped
    ]));
    const page = await subsonic.getLovedPage({ cursor: null, account: 'alice' }, CONFIG);
    expect(endpointOf(global.fetch.mock.calls[0][0])).toBe('getStarred2');
    expect(page.next).toBeNull();
    expect(page.items.map((i) => i.title)).toEqual(['Newer', 'Older']);
    expect(page.items[1]).toMatchObject({ artist: 'A', title: 'Older', album: 'X', lovedAt: Date.parse('2024-01-02T03:04:05Z') / 1000 });
    expect(page.items[1].source).toEqual({
      id: 'subsonic-s1', title: 'Older', artist: 'A', album: 'X', duration: 200,
      subsonicId: 's1', subsonicServer: 'http://navidrome.local:4533', genre: null, year: 2001, trackNumber: 3,
    });
    expect(JSON.stringify(page)).not.toMatch(/[?&](t|s|p)=|sekret/);
  });

  test('not set up is "Not connected" (the import\'s permanent failure); a refusal throws', async () => {
    await expect(subsonic.getLovedPage({}, {})).rejects.toThrow('Not connected');
    global.fetch = jest.fn(async () => failed(50, 'Not authorized'));
    await expect(subsonic.getLovedPage({}, CONFIG)).rejects.toThrow('Subsonic starred list failed: 50 Not authorized');
  });
});

describe('through the host\'s wrapper', () => {
  test('a track with no Subsonic source is searched, and the match is starred', async () => {
    global.fetch = jest.fn(async (url) => (endpointOf(url) === 'search3'
      ? json({ searchResult3: { song: [{ id: 'other', title: 'Pyramid Song (Live)', artist: 'Radiohead' }, { id: 'song-42', title: 'Pyramid Song', artist: 'Radiohead' }] } })
      : json({})));
    const provider = LP.loveProviderFor(subsonic, { getConfig: async () => CONFIG });
    await expect(provider.isSignedIn()).resolves.toBe(true);
    const result = await provider.loveTrack({ artist: 'Radiohead', title: 'Pyramid Song', sources: {} });
    expect(result).toEqual({ ok: true, ref: 'song-42' });
    const star = global.fetch.mock.calls.map(([u]) => u).find((u) => endpointOf(u) === 'star');
    expect(params(star).get('id')).toBe('song-42');
  });

  test('a search that finds nothing like it stars nothing', async () => {
    global.fetch = jest.fn(async (url) => (endpointOf(url) === 'search3'
      ? json({ searchResult3: { song: [{ id: 'x', title: 'Something Else', artist: 'Someone' }] } })
      : json({})));
    const provider = LP.loveProviderFor(subsonic, { getConfig: async () => CONFIG });
    await expect(provider.loveTrack({ artist: 'Radiohead', title: 'Pyramid Song', sources: {} })).resolves.toEqual({ ok: false, reason: 'no-match' });
    expect(global.fetch.mock.calls.some(([u]) => endpointOf(u) === 'star')).toBe(false);
  });

  test('not set up: not signed in, and no account to import from', async () => {
    const provider = LP.loveProviderFor(subsonic, { getConfig: async () => ({}) });
    await expect(provider.isSignedIn()).resolves.toBe(false);
    await expect(provider.importAccount()).resolves.toBeNull();
    expect(provider.importAccountHint('Subsonic')).toBe('Set up Subsonic first');
  });
});

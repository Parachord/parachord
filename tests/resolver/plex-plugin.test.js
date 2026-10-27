/**
 * plugins-src/plex/implementation.js — the parts of the Plex resolver that
 * carry invariants rather than network glue:
 *   - a track never carries the server token or connection list (they are
 *     persisted into the saved queue and playlists), and ISRC is normalised
 *     and validated at capture;
 *   - the stream URL is built from the SAVED config, not the track;
 *   - an album share link answered by lookupUrl comes back as the album;
 *   - the index is freed on cleanup.
 * Driven with a fake window.electron.plex.fetch.
 */

const plex = require('../../plugins-src/plex/implementation');

const SERVER = { serverId: 'srv1', serverName: 'Attic', accessToken: 'TOKEN-1', connections: ['http://192.168.1.5:32400'] };
const CONFIG = {
  authToken: 'ACCOUNT',
  clientId: 'parachord-x',
  libraries: [{ serverId: 'srv1', serverName: 'Attic', accessToken: 'TOKEN-1', connections: ['http://192.168.1.5:32400'], key: '3', title: 'Music' }],
};
const TRACK_META = {
  ratingKey: '42', title: 'Everything in Its Right Place', grandparentTitle: 'Radiohead', parentTitle: 'Kid A',
  duration: 251000, index: 1, thumb: '/library/metadata/41/thumb/1', guid: 'plex://track/abc',
  Guid: [{ id: 'mbid://2c6cf4f6-1a4f-4b8b-9b67-4c6c6a2f1c11' }, { id: 'isrc://  gbayk0000001 ' }],
  Media: [{ Part: [{ key: '/library/parts/99/file.flac' }] }],
};

function installFakeFetch(routes) {
  const calls = [];
  global.window = {
    electron: {
      plex: {
        fetch: async (url, options) => {
          calls.push({ url, options });
          for (const [pattern, body] of routes) {
            if (url.includes(pattern)) return { ok: true, status: 200, text: JSON.stringify(typeof body === 'function' ? body(url) : body) };
          }
          return { ok: false, status: 404, text: '' };
        },
      },
    },
  };
  return calls;
}

afterEach(() => { delete global.window; });

describe('_mapTrack', () => {
  test('keeps only the stable Plex ids, never the token or connections', () => {
    const t = plex._mapTrack(TRACK_META, SERVER, 'http://192.168.1.5:32400');
    expect(t).toMatchObject({
      id: 'plex-srv1-42', title: 'Everything in Its Right Place', artist: 'Radiohead', album: 'Kid A', duration: 251,
      plexRatingKey: '42', plexServerId: 'srv1', plexServerName: 'Attic', plexPartKey: '/library/parts/99/file.flac',
    });
    expect(t.plexToken).toBeUndefined();
    expect(t.plexConnections).toBeUndefined();
    expect(Object.keys(t).filter((k) => k !== 'albumArt').some((k) => String(t[k]).includes('TOKEN-1'))).toBe(false);
  });

  test('ISRC is upper-cased, trimmed and validated; MBID is carried under both names', () => {
    const t = plex._mapTrack(TRACK_META, SERVER, 'http://192.168.1.5:32400');
    expect(t.isrc).toBe('GBAYK0000001');
    expect(t.mbid).toBe('2c6cf4f6-1a4f-4b8b-9b67-4c6c6a2f1c11');
    expect(t.recordingMbid).toBe(t.mbid);
    const bad = plex._mapTrack({ ...TRACK_META, Guid: [{ id: 'isrc://not-an-isrc' }] }, SERVER, 'http://x');
    expect(bad.isrc).toBeUndefined();
  });
});

describe('getStreamUrl / play', () => {
  test('builds the stream URL from the saved config, not from the track', async () => {
    installFakeFetch([['/identity', { MediaContainer: {} }]]);
    const track = plex._mapTrack(TRACK_META, SERVER, 'http://192.168.1.5:32400');
    const url = await plex.getStreamUrl(track, CONFIG);
    expect(url).toBe('http://192.168.1.5:32400/library/parts/99/file.flac?X-Plex-Token=TOKEN-1');
    await expect(plex.play(track, CONFIG)).resolves.toEqual({ type: 'local', url });
  });

  test('a server missing from the saved selection cannot be streamed', async () => {
    installFakeFetch([['/identity', {}]]);
    const track = { ...plex._mapTrack(TRACK_META, SERVER, 'http://x'), plexServerId: 'srv-unknown' };
    await expect(plex.getStreamUrl(track, { libraries: CONFIG.libraries })).resolves.toBeNull();
    await expect(plex.play(track, { libraries: CONFIG.libraries })).resolves.toBe(false);
  });
});

describe('lookupUrl', () => {
  test('a track key returns the track; an album key returns the album with its tracks', async () => {
    installFakeFetch([
      ['/identity', {}],
      ['/library/metadata/41/children', { MediaContainer: { Metadata: [TRACK_META] } }],
      ['/library/metadata/41?', { MediaContainer: { Metadata: [{ type: 'album', ratingKey: '41', title: 'Kid A', parentTitle: 'Radiohead', thumb: '/t' }] } }],
      ['/library/metadata/42?', { MediaContainer: { Metadata: [{ ...TRACK_META, type: 'track' }] } }],
    ]);
    const base = 'https://app.plex.tv/desktop/#!/server/srv1/details?key=';
    const track = await plex.lookupUrl(base + encodeURIComponent('/library/metadata/42'), CONFIG);
    expect(track.id).toBe('plex-srv1-42');
    expect(track.tracks).toBeUndefined();
    const album = await plex.lookupUrl(base + encodeURIComponent('/library/metadata/41'), CONFIG);
    expect(album).toMatchObject({ id: 'plex-album-41', name: 'Kid A', artist: 'Radiohead', trackCount: 1 });
    expect(album.tracks[0].id).toBe('plex-srv1-42');
  });
});

describe('index lifecycle', () => {
  test('cleanup frees the index and the connection cache', async () => {
    installFakeFetch([]);
    global.window._plexIndex = { 'srv1::3': { status: 'ready' } };
    global.window._plexBaseCache = { srv1: { baseUrl: 'http://x', ts: Date.now() } };
    expect(plex._allIndexed(CONFIG)).toBe(true);
    await plex.cleanup();
    expect(global.window._plexIndex).toBeUndefined();
    expect(global.window._plexBaseCache).toBeUndefined();
    expect(plex._allIndexed(CONFIG)).toBe(false);
  });
});

describe('isConfigured', () => {
  test('needs a token and at least one selected library', () => {
    expect(plex.isConfigured(CONFIG)).toBe(true);
    expect(plex.isConfigured({ authToken: 'ACCOUNT', libraries: [] })).toBe(false);
    expect(plex.isConfigured({ libraries: CONFIG.libraries })).toBe(false);
    expect(plex.isConfigured(undefined)).toBe(false);
  });
});

// The settings panel is plugin-rendered (settings.authType 'custom'): the host
// hands over React and config read/write, the plugin owns the markup. Static
// render only — effects (library discovery, index polling) need a window.
describe('renderSettings', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const render = (config) => renderToStaticMarkup(React.createElement(() => plex.renderSettings({
    React, config, resolver: plex, isActive: false,
    saveConfig: async () => {}, clearConfig: async () => {}, setActive: () => {},
  })));

  test('signed out: offers the sign-in button and no library list', () => {
    const html = render({});
    expect(html).toContain('Sign in with Plex');
    expect(html).not.toContain('Disconnect');
    expect(html).not.toContain('Music libraries');
  });

  test('signed in: shows the account, the disconnect button and the library section', () => {
    const html = render({ ...CONFIG, username: 'jp' });
    expect(html).toContain('Signed in as jp');
    expect(html).toContain('Disconnect');
    expect(html).toContain('Music libraries');
    expect(html).not.toContain('Sign in with Plex');
  });
});

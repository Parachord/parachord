/**
 * Subsonic resolver tests.
 *
 * Covers the .axe resolver surface against a mocked Subsonic/Navidrome API:
 *   - structural validity (manifest/capabilities/implementation compile)
 *   - search3 result mapping (song -> resolver track shape, incl. ISRC
 *     validation; no credentialed stream/cover URLs, no claimed streamQuality)
 *   - resolve() containment matching (both axes, no fuzzy fallback)
 *   - getStreamUrl() builds a fresh URL and ignores any baked one
 *   - auth (token = md5(password + salt)) against the real algorithm
 *   - server URL normalization (user-pasted variants: trailing slash, /rest)
 *   - play() is host-owned (returns false — handlePlay owns playback)
 *   - byte-identical FALLBACK_RESOLVERS copy in app.js (drift guard)
 *   - app.js integration: canonical order, volume offsets, transport routing
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/subsonic.axe'), 'utf8'));

function instantiate(axeContent) {
  const { manifest, capabilities, implementation } = axeContent;
  const resolver = {
    id: manifest.id,
    name: manifest.name,
    capabilities,
    ...Object.fromEntries(
      Object.entries(implementation).map(([k, src]) => [k, new Function('return ' + src)()])
    )
  };
  // Bind `this` the way resolver-loader.js does so this.search works inside resolve
  for (const key of Object.keys(implementation)) {
    const original = resolver[key];
    resolver[key] = function (...args) { return original.call(resolver, ...args); };
  }
  return resolver;
}

const CONFIG = {
  serverUrl: 'http://navidrome.local:4533',
  username: 'alice',
  password: 'sekret'
};

const SONG = {
  id: 'zqo5IWGbAZyry49KUisFaA',
  title: 'Pyramid Song',
  artist: 'Radiohead',
  album: 'Amnesiac',
  track: 2,
  year: 2001,
  genre: 'Rock',
  coverArt: 'al-1eu9mTvmsW5qKrE1qrpYiF_0',
  duration: 288,
  bitRate: 192,
  suffix: 'mp3',
  contentType: 'audio/mpeg',
  samplingRate: 44100,
  bitDepth: 0,
  channelCount: 2,
  isrc: []
};

function okResponse(songs) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        type: 'navidrome',
        searchResult3: { song: songs }
      }
    })
  };
}

function mockFetch(handler) {
  const calls = [];
  global.fetch = jest.fn(async (url, ...rest) => {
    calls.push(url);
    return handler(url, ...rest);
  });
  return calls;
}

beforeEach(() => {
  global.window = { crypto: require('crypto').webcrypto, console };
});

describe('subsonic .axe structure', () => {
  test('manifest identifies the resolver', () => {
    expect(axe.manifest.id).toBe('subsonic');
    expect(axe.manifest.version).toBe('0.2.0');
  });

  test('declares streaming capabilities with userpass auth', () => {
    expect(axe.capabilities).toEqual(
      expect.objectContaining({ resolve: true, search: true, stream: true, browse: false, urlLookup: false })
    );
    expect(axe.settings.requiresAuth).toBe(true);
    // No API key. Username and password are a credential pair the settings
    // panel groups together — they must stay adjacent.
    expect(axe.capabilities.mobile).toBe(false);
    expect(axe.settings.authType).toBe('userpass');
    expect(axe.settings.configurable.username.type).toBe('text');
    expect(axe.settings.configurable.password.type).toBe('password');
    const keys = Object.keys(axe.settings.configurable);
    expect(Math.abs(keys.indexOf('username') - keys.indexOf('password'))).toBe(1);
  });

  test('implementation functions compile', () => {
    for (const [key, src] of Object.entries(axe.implementation)) {
      expect(() => new Function('return ' + src)()).not.toThrow();
      expect(typeof new Function('return ' + src)()).toBe('function');
    }
    expect(Object.keys(axe.implementation).sort()).toEqual(
      ['cleanup', 'getStreamUrl', 'init', 'lookupAlbum', 'play', 'resolve', 'search', 'searchAlbums'].sort()
    );
  });
});

describe('subsonic search', () => {
  test('maps search3 songs to resolver track shape', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => okResponse([SONG]));
    const results = await resolver.search('pyramid song', CONFIG);

    expect(results).toHaveLength(1);
    const t = results[0];
    expect(t.id).toBe('subsonic-' + SONG.id);
    expect(t.title).toBe('Pyramid Song');
    expect(t.artist).toBe('Radiohead');
    expect(t.album).toBe('Amnesiac');
    expect(t.duration).toBe(288);
    expect(t.sources).toEqual(['subsonic']);
    expect(t.subsonicId).toBe(SONG.id);
    expect(t.subsonicServer).toBe('http://navidrome.local:4533');
    // Token+salt URLs are replayable credentials. Search must not return them.
    expect(t.subsonicStreamUrl).toBeUndefined();
    expect(t.albumArt).toBeUndefined();
    expect(t.streamQuality).toBeUndefined();
    const blob = JSON.stringify(t);
    expect(blob).not.toContain('stream.view');
    expect(blob).not.toContain('getCoverArt');
    expect(blob).not.toMatch(/[?&]t=/);
    expect(blob).not.toContain('sekret');

    // search3 endpoint + params
    expect(calls[0]).toContain('/rest/search3.view');
    expect(calls[0]).toContain('f=json');
    expect(calls[0]).toContain('query=pyramid%20song');
  });

  test('token auth: t = md5(password + salt), never the plaintext password', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => okResponse([SONG]));
    await resolver.search('pyramid song', CONFIG);
    const url = new URL(calls[0]);
    const params = url.searchParams;

    expect(params.get('u')).toBe('alice');
    expect(params.get('v')).toBe('1.16.1');
    expect(params.get('c')).toBe('parachord');
    const salt = params.get('s');
    expect(salt).toBeTruthy();
    expect(params.get('t')).toBe(crypto.createHash('md5').update('sekret' + salt).digest('hex'));
    // plaintext password must not appear anywhere in the URL
    expect(calls[0]).not.toContain('sekret');
  });

  test('isrc: validated and upper-cased; empty arrays dropped', async () => {
    const resolver = instantiate(axe);
    const withIsrc = { ...SONG, isrc: ['gbrfp0200302'] };
    mockFetch(() => okResponse([withIsrc]));
    const [withHit] = await resolver.search('first', CONFIG);
    expect(withHit.isrc).toBe('GBRFP0200302');

    const badIsrc = { ...SONG, isrc: 'not-an-isrc' };
    mockFetch(() => okResponse([badIsrc]));
    const [noHit] = await resolver.search('second', CONFIG);
    expect(noHit.isrc).toBeUndefined();
  });

  test('does not attach claimed streamQuality (server may transcode)', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => okResponse([SONG]));
    const [t] = await resolver.search('pyramid song', CONFIG);
    expect(t.streamQuality).toBeUndefined();
  });

  test('API error (status != ok) returns []', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } })
    }));
    const results = await resolver.search('pyramid song', CONFIG);
    expect(results).toEqual([]);
  });

  test('HTTP error returns []', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => ({ ok: false, status: 502 }));
    const results = await resolver.search('pyramid song', CONFIG);
    expect(results).toEqual([]);
  });

  test('missing config returns [] without fetching', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => okResponse([SONG]));
    const results = await resolver.search('pyramid song', {});
    expect(results).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('short queries return [] without fetching', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => okResponse([SONG]));
    expect(await resolver.search('', CONFIG)).toEqual([]);
    expect(await resolver.search('a', CONFIG)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('malformed song entries are skipped, not fatal', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => okResponse([{ title: 'no id' }, { id: 'x' }, SONG]));
    const results = await resolver.search('pyramid song', CONFIG);
    expect(results).toHaveLength(1);
  });
});

describe('subsonic server URL normalization', () => {
  test.each([
    ['http://192.168.0.13:4533', 'http://192.168.0.13:4533'],
    ['http://192.168.0.13:4533/', 'http://192.168.0.13:4533'],
    ['http://192.168.0.13:4533/rest', 'http://192.168.0.13:4533'],
    ['http://192.168.0.13:4533/rest/', 'http://192.168.0.13:4533'],
    ['https://nav.example.com/music/rest', 'https://nav.example.com/music'],
    ['192.168.0.13:4533', 'http://192.168.0.13:4533'],
    ['  http://192.168.0.13:4533  ', 'http://192.168.0.13:4533'],
    ['', null],
    [null, null]
  ])('%s -> %s', async (input, expected) => {
    const resolver = instantiate(axe);
    mockFetch(() => okResponse([SONG]));
    const results = await resolver.search('pyramid song', { ...CONFIG, serverUrl: input });
    if (expected === null) {
      expect(results).toEqual([]);
    } else {
      expect(results[0].subsonicServer).toBe(expected);
    }
  });
});

describe('subsonic resolve', () => {
  test('returns the containment match on both axes', async () => {
    const resolver = instantiate(axe);
    const other = { ...SONG, id: 'other', title: 'Packt Like Sardines in a Crushd Tin Box' };
    mockFetch(() => okResponse([other, SONG]));
    const hit = await resolver.resolve('Radiohead', 'Pyramid Song', 'Amnesiac', CONFIG);
    expect(hit.subsonicId).toBe(SONG.id);
  });

  test('single-axis match returns null (the 0.6 floor would drop it anyway)', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => okResponse([SONG]));
    const miss = await resolver.resolve('Nirvana', 'Pyramid Song', null, CONFIG);
    expect(miss).toBeNull();
  });

  test('no results returns null', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => okResponse([]));
    const miss = await resolver.resolve('Radiohead', 'Nothing', null, CONFIG);
    expect(miss).toBeNull();
  });
});

describe('subsonic getStreamUrl', () => {
  test('fresh config wins (fresh salt + token per call)', async () => {
    const resolver = instantiate(axe);
    const track = { subsonicId: SONG.id, subsonicStreamUrl: 'http://old.example/baked' };
    const url1 = await resolver.getStreamUrl(track, CONFIG);
    const url2 = await resolver.getStreamUrl(track, CONFIG);
    expect(url1).toContain('/rest/stream.view');
    expect(url1).toContain('id=' + encodeURIComponent(SONG.id));
    expect(url1).not.toBe('http://old.example/baked');
    // fresh salt per call
    const s1 = new URL(url1).searchParams.get('s');
    const s2 = new URL(url2).searchParams.get('s');
    expect(s1).not.toBe(s2);
  });

  test('incomplete config returns null and ignores a baked URL', async () => {
    const resolver = instantiate(axe);
    const track = { subsonicId: SONG.id, subsonicStreamUrl: 'http://old.example/baked?u=alice&t=deadbeef&s=salt' };
    expect(await resolver.getStreamUrl(track, {})).toBeNull();
    expect(await resolver.getStreamUrl(track, null)).toBeNull();
    expect(await resolver.getStreamUrl(track, { serverUrl: CONFIG.serverUrl, username: CONFIG.username })).toBeNull();
  });

  test('reads subsonicId from the sources record (spread-source shape)', async () => {
    const resolver = instantiate(axe);
    const track = { sources: { subsonic: { subsonicId: SONG.id } } };
    const url = await resolver.getStreamUrl(track, CONFIG);
    expect(url).toContain('id=' + encodeURIComponent(SONG.id));
  });

  test('no subsonicId anywhere returns null', async () => {
    const resolver = instantiate(axe);
    expect(await resolver.getStreamUrl({ title: 'x' }, CONFIG)).toBeNull();
    expect(await resolver.getStreamUrl(null, CONFIG)).toBeNull();
  });
});

describe('subsonic play is host-owned', () => {
  test('play() returns false — handlePlay\'s subsonic branch owns playback', async () => {
    const resolver = instantiate(axe);
    expect(await resolver.play({ subsonicId: 'x' }, CONFIG)).toBe(false);
  });
});

describe('app.js integration', () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('FALLBACK_RESOLVERS copy is byte-identical to the .axe', () => {
    const lines = appSrc.split('\n');
    const start = lines.findIndex((l) => l.startsWith('const FALLBACK_RESOLVERS = ['));
    const entry = lines.find((l, i) => i > start && l.includes('"id":"subsonic"'));
    expect(entry).toBeTruthy();
    expect(JSON.parse(entry.trim().replace(/,$/, ''))).toEqual(axe);
  });

  test('subsonic is in CANONICAL_RESOLVER_ORDER', () => {
    const m = appSrc.match(/const CANONICAL_RESOLVER_ORDER = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).toContain("'subsonic'");
  });

  test('handlePlay has a subsonic branch that plays through the shared audioRef', () => {
    expect(appSrc).toContain("if (resolverId === 'subsonic') {");
    // the branch must come before the generic resolver.play() path
    const branchIdx = appSrc.indexOf("if (resolverId === 'subsonic') {");
    const genericIdx = appSrc.indexOf('const success = await resolver.play(sourceToPlay, config);');
    expect(branchIdx).toBeGreaterThan(0);
    expect(branchIdx).toBeLessThan(genericIdx);
  });

  test('transport routing treats subsonic as an HTML5 audio resolver', () => {
    // play/pause toggle
    expect(appSrc).toContain("_activeResolver === 'localfiles' || currentTrack?._activeResolver === 'soundcloud' || currentTrack?._activeResolver === 'subsonic'");
    // seek keys off the resolver actually playing, not "has a subsonic source"
    expect(appSrc).toContain("activeResolver === 'localfiles' || activeResolver === 'soundcloud' || activeResolver === 'subsonic') && audioRef.current");
    expect(appSrc).not.toContain('currentTrack?.sources?.subsonic');
    // volume slider support
    expect(appSrc).toContain("currentResolverId === 'soundcloud' || currentResolverId === 'subsonic'");
  });

  test('the fallback wall-clock progress tracker skips subsonic (HTML5 audio owns progress)', () => {
    // The generic audioContext-based progress interval must not run for HTML5
    // audio resolvers — otherwise it fights with the element's timeupdate
    // (progress bar jumps back and forth) and its elapsed>=duration check can
    // fire a premature handleNext after a pause/resume. localfiles/soundcloud
    // are skipped the same way.
    const m = appSrc.match(/const isSoundCloud = activeResolver === 'soundcloud';\n    const isSubsonic = activeResolver === 'subsonic';/);
    expect(m).toBeTruthy();
    expect(appSrc).toContain('!isLocalFile && !isSoundCloud && !isSubsonic && !isBrowserTrack');
  });

  test('resolver volume offsets include subsonic (neutral)', () => {
    const m = appSrc.match(/const \[resolverVolumeOffsets, setResolverVolumeOffsets\] = useState\(\{([\s\S]*?)\}\)/);
    expect(m).toBeTruthy();
    expect(m[1]).toContain('subsonic');
  });

  test('shared HTML5 element is created once and every path uses it', () => {
    expect(appSrc.match(/ensureSharedAudioElement\(trackOrSource\)/g)).toHaveLength(3);
    expect(appSrc).toContain('const audio = new Audio()');
    expect(appSrc).not.toContain('audioRef.current = new Audio()');
    expect(appSrc).not.toContain('sourceToPlay.subsonicStreamUrl');
  });

  // The per-plugin drift guard (was: a spawn of scripts/sync-subsonic-axe.js
  // --check, absorbed into scripts/build-axes.js) now lives in
  // .github/workflows/test.yml — the committed-state drift gate
  // (git diff --exit-code on the tracked writer outputs) — plus build-axes
  // itself in pretest, and covers every bundled plugin.

  test('_fetchResolverConfig reads subsonic credentials from meta_service_configs', () => {
    const idx = appSrc.indexOf("if (resolverId === 'subsonic') {");
    const cfgIdx = appSrc.indexOf("metaConfigs?.subsonic");
    expect(idx).toBeGreaterThan(0);
    expect(cfgIdx).toBeGreaterThan(idx);
  });
});

describe('subsonic album search (capabilities.albumSearch)', () => {
  const subsonicOk = (body) => ({
    ok: true,
    status: 200,
    json: async () => ({ 'subsonic-response': { status: 'ok', ...body } })
  });

  test('declares albumSearch', () => {
    expect(axe.capabilities.albumSearch).toBe(true);
  });

  test('searchAlbums asks search3 for albums only and returns plugin-private urls', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => subsonicOk({
      searchResult3: { album: [{ id: 'al-1', name: 'Amnesiac', artist: 'Radiohead', year: 2001, songCount: 11, coverArt: 'al-1' }] }
    }));
    const albums = await resolver.searchAlbums({ artist: 'Radiohead', title: 'Amnesiac' }, CONFIG);
    expect(calls[0]).toContain('/rest/search3.view?');
    expect(calls[0]).toContain('songCount=0');
    expect(calls[0]).toContain('albumCount=20');
    expect(albums).toEqual([{
      id: 'subsonic-album-al-1',
      name: 'Amnesiac',
      artist: 'Radiohead',
      albumArt: null,
      releaseDate: '2001',
      trackCount: 11,
      url: 'subsonic:album:al-1'
    }]);
    // no credentialed URL in what is returned
    expect(JSON.stringify(albums)).not.toMatch(/[?&]t=|[?&]s=|password/);
  });

  test('lookupAlbum loads getAlbum songs in disc and track order', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => subsonicOk({
      album: {
        id: 'al-1', name: 'Amnesiac', artist: 'Radiohead', year: 2001,
        song: [
          { id: 's2', title: 'Pyramid Song', artist: 'Radiohead', track: 2, discNumber: 1, duration: 288 },
          { id: 's1', title: 'Packt Like Sardines in a Crushd Tin Box', artist: 'Radiohead', track: 1, discNumber: 1, duration: 240 }
        ]
      }
    }));
    const album = await resolver.lookupAlbum('subsonic:album:al-1', CONFIG);
    expect(calls[0]).toContain('/rest/getAlbum.view?');
    expect(calls[0]).toContain('id=al-1');
    expect(album.name).toBe('Amnesiac');
    expect(album.tracks.map(t => t.title)).toEqual(['Packt Like Sardines in a Crushd Tin Box', 'Pyramid Song']);
    expect(album.tracks[0]).toMatchObject({ subsonicId: 's1', sources: ['subsonic'], trackNumber: 1, discNumber: 1, duration: 240 });
    expect(album.tracks[0].streamUrl).toBeUndefined();
  });

  test('lookupAlbum ignores urls that are not its own', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => { throw new Error('should not fetch'); });
    expect(await resolver.lookupAlbum('https://open.spotify.com/album/x', CONFIG)).toBe(null);
  });

  test('no server configured: no albums, no request', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => subsonicOk({}));
    expect(await resolver.searchAlbums({ artist: 'Radiohead', title: 'Amnesiac' }, {})).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

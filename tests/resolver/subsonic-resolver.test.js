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
 *   - byte-identical FALLBACK_RESOLVERS copy in the generated module (drift guard)
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
    expect(axe.manifest.version).toBe('0.3.3');
  });

  test('declares streaming capabilities with userpass auth', () => {
    expect(axe.capabilities).toEqual(
      expect.objectContaining({ resolve: true, search: true, stream: true, browse: false, urlLookup: false })
    );
    expect(axe.settings.requiresAuth).toBe(true);
    // No API key. Username and password are a credential pair the settings
    // panel groups together — they must stay adjacent.
    // Mobile hosts the html5Stream engine (Parachord/parachord-mobile#401);
    // older mobile apps than the floors stay hidden from it.
    expect(axe.capabilities.mobile).toBe(true);
    expect(axe.capabilities.html5Stream).toBe(true);
    expect(axe.manifest.minAppVersion).toEqual({ android: '0.9.10', ios: '0.3.0' });
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
      ['cleanup', 'getStreamUrl', 'init', 'isConfigured', 'lookupAlbum', 'play', 'resolve', 'search', 'searchAlbums', 'searchArtistImage'].sort()
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

  test('API error (status != ok) throws with the Subsonic error code', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } })
    }));
    await expect(resolver.search('pyramid song', CONFIG)).rejects.toThrow(
      'Subsonic search failed: 40 Wrong username or password'
    );
  });

  test('HTTP error throws with the status', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => ({ ok: false, status: 502 }));
    await expect(resolver.search('pyramid song', CONFIG)).rejects.toThrow('Subsonic search failed: HTTP 502');
  });

  test('a body that is not a Subsonic response throws', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) }));
    await expect(resolver.search('pyramid song', CONFIG)).rejects.toThrow('not a Subsonic response');
  });

  test('a network failure throws instead of answering no match', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
    await expect(resolver.search('pyramid song', CONFIG)).rejects.toThrow('Failed to fetch');
  });

  test('resolve passes a failed search on instead of answering no match', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => ({ ok: false, status: 503 }));
    await expect(resolver.resolve('Radiohead', 'Pyramid Song', '', CONFIG)).rejects.toThrow('503');
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

// Navidrome's backend for a query containing CJK (persistence/sql_search.go in
// its repo): every whitespace-separated word of the query must literally be a
// substring of the title/album/artist/album-artist text — punctuation included,
// no width folding ('!!' is not '！！'). Its non-CJK (FTS) path strips
// punctuation on both sides, so only a CJK query needs the letter/number
// re-ask.
function navidromeCjk(rows) {
  const fields = (row) => [row.title, row.album, row.artist, row.albumArtist || row.artist];
  return jest.fn(async (url) => {
    const query = new URL(url).searchParams.get('query');
    const words = query.split(/\s+/).filter(Boolean);
    const found = rows.filter((row) =>
      words.every((w) => fields(row).some((f) => String(f || '').toLowerCase().includes(w.toLowerCase())))
    );
    return okResponse(found);
  });
}

// The reported case (live 2026-11): MusicBrainz titles the track 'ぶっ生き返す!!'
// (half-width) while the Navidrome library is tagged 'ぶっ生き返す！！' (full-
// width) — one title, two punctuation spellings. The query is asked as written
// first; only a zero-result answer re-asks with the query's letter/number runs,
// so the punctuation spelling stops deciding the match and nothing the server
// found before changes.
describe('subsonic search re-asks a CJK query as its letter runs after a miss', () => {
  const askedQueries = () =>
    global.fetch.mock.calls.map((url) => new URL(url).searchParams.get('query'));

  test("half-width '!!' in the query finds a full-width '！！' in the library", async () => {
    const resolver = instantiate(axe);
    const song = { ...SONG, id: 'jp-1', title: 'ぶっ生き返す！！', artist: 'マキシマムザホルモン', album: 'ぶっ生き返す！！' };
    global.fetch = navidromeCjk([song]);
    const results = await resolver.search('マキシマムザホルモン ぶっ生き返す!!', CONFIG);
    expect(askedQueries()).toEqual([
      'マキシマムザホルモン ぶっ生き返す!!',
      'マキシマムザホルモン ぶっ生き返す',
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('ぶっ生き返す！！');
  });

  test("a wave dash and a full-width tilde (〜 U+301C vs ～ U+FF5E) are the same class", async () => {
    // Live-reported (2026-11): the same title spelled with the Shift-JIS wave
    // dash on one side and the full-width tilde on the other (the CP932
    // mapping split). Any punctuation pair works the same way: the re-ask
    // drops punctuation entirely, and the gate strips it.
    const resolver = instantiate(axe);
    const row = { id: 'jp-2', title: '恐喝～kyokatsu～', artist: 'マキシマムザホルモン', album: '恐喝～kyokatsu～', duration: 200 };
    global.fetch = navidromeCjk([row]);
    const hit = await resolver.resolve('マキシマムザホルモン', '恐喝〜kyokatsu〜', '恐喝〜kyokatsu〜', CONFIG);
    expect(hit && hit.title).toBe('恐喝～kyokatsu～');
    expect(askedQueries()).toEqual(['マキシマムザホルモン 恐喝〜kyokatsu〜', 'マキシマムザホルモン 恐喝 kyokatsu']);
  });

  test("full-width '！！' in the query finds a half-width '!!' in the library", async () => {
    const resolver = instantiate(axe);
    const row = { id: 'jp-1', title: 'ぶっ生き返す!!', artist: 'マキシマムザホルモン', album: 'ぶっ生き返す!!', duration: 200 };
    global.fetch = navidromeCjk([row]);
    const hit = await resolver.resolve('マキシマムザホルモン', 'ぶっ生き返す！！', 'ぶっ生き返す！！', CONFIG);
    expect(hit && hit.title).toBe('ぶっ生き返す!!');
  });

  test('a library tagged exactly like the request is found on the first ask (no re-ask)', async () => {
    const resolver = instantiate(axe);
    const row = { id: 'jp-1', title: 'ぶっ生き返す!!', artist: 'マキシマムザホルモン', album: 'ぶっ生き返す!!', duration: 200 };
    global.fetch = navidromeCjk([row]);
    const hit = await resolver.resolve('マキシマムザホルモン', 'ぶっ生き返す!!', 'ぶっ生き返す!!', CONFIG);
    expect(hit && hit.title).toBe('ぶっ生き返す!!');
    expect(askedQueries()).toEqual(['マキシマムザホルモン ぶっ生き返す!!']);
  });

  test('a CJK miss on a failed ask throws without a re-ask', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => ({ ok: false, status: 502, json: async () => ({}) }));
    await expect(resolver.search('マキシマムザホルモン ぶっ生き返す!!', CONFIG)).rejects.toThrow('HTTP 502');
    expect(calls).toHaveLength(1);
  });

  test('a CJK miss on an API error throws without a re-ask either', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ 'subsonic-response': { status: 'error', error: { code: 40, message: 'Wrong username or password' } } }),
    }));
    await expect(resolver.search('マキシマムザホルモン ぶっ生き返す!!', CONFIG)).rejects.toThrow('Wrong username or password');
    expect(calls).toHaveLength(1);
  });

  test('a CJK query already made of runs is asked once (the re-ask would repeat it)', async () => {
    const resolver = instantiate(axe);
    global.fetch = navidromeCjk([]);
    const results = await resolver.search('マキシマムザホルモン ぶっ生き返す', CONFIG);
    expect(results).toEqual([]);
    expect(askedQueries()).toEqual(['マキシマムザホルモン ぶっ生き返す']);
  });

  test('a query with no CJK is never re-asked (Navidrome strips punctuation server-side on its FTS path)', async () => {
    const resolver = instantiate(axe);
    // a hit: one ask, as written — AC/DC keeps its slash and Jay-Z its hyphen,
    // the forms Navidrome turns into ("Jay Z" OR JayZ*)
    const calls = mockFetch(() => okResponse([SONG]));
    await resolver.search('AC/DC Back in Black', CONFIG);
    expect(calls[0]).toContain('query=' + encodeURIComponent('AC/DC Back in Black'));
    await resolver.search('Jay-Z', CONFIG);
    expect(calls[1]).toContain('query=' + encodeURIComponent('Jay-Z'));
    // a miss: still one ask — the re-ask is CJK-only
    await resolver.search('Jay-Zzzz', CONFIG);
    expect(calls).toHaveLength(3);
  });

  test("a Latin word inside a CJK query is re-asked as its runs", async () => {
    const resolver = instantiate(axe);
    const row = { id: 'jp-1', title: "Let's 五線譜！！", artist: 'バンド', album: "Let's 五線譜！！", duration: 200 };
    global.fetch = navidromeCjk([row]);
    const hit = await resolver.resolve('バンド', "Let's 五線譜!!", null, CONFIG);
    expect(hit && hit.title).toBe("Let's 五線譜！！");
    expect(askedQueries()).toEqual(["バンド Let's 五線譜!!", 'バンド Let s 五線譜']);
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
  const appSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8') +
    fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');

  test('FALLBACK_RESOLVERS copy is byte-identical to the .axe', () => {
    // The block moved to the gitignored generated module (bucket C); the
    // generated-require hook only ▸ requires it. App-src assertion kept
    // elsewhere; here the parity surface is the generated module.
    const entries = require(path.join(__dirname, '../../src/renderer/lib/fallback-resolvers.generated.js'));
    const entry = entries.find((e) => e.manifest && e.manifest.id === 'subsonic');
    expect(entry).toBeTruthy();
    expect(entry).toEqual(axe);
    expect(appSrc).toContain("require('./lib/fallback-resolvers.generated.js')");
  });

  test('subsonic is in CANONICAL_RESOLVER_ORDER', () => {
    const m = appSrc.match(/const CANONICAL_RESOLVER_ORDER = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    expect(m[1]).toContain("'subsonic'");
  });

  test('handlePlay has an html5Stream branch that plays through the shared audioRef', () => {
    // Subsonic reaches it by declaring capabilities.html5Stream, not by name.
    expect(appSrc).toContain('if (isHtml5StreamResolver(resolverId)) {');
    // the branch must come before the generic resolver.play() path
    const branchIdx = appSrc.indexOf('if (isHtml5StreamResolver(resolverId)) {');
    const genericIdx = appSrc.indexOf('const success = await resolver.play(playSource, config);');
    expect(branchIdx).toBeGreaterThan(0);
    expect(branchIdx).toBeLessThan(genericIdx);
  });

  test('transport routing treats subsonic as an HTML5 audio resolver', () => {
    // play/pause toggle
    // The host never names Subsonic in the transport lists: a
    // resolver declaring capabilities.html5Stream is routed by capability
    // through usesSharedAudio / isHtml5StreamResolver.
    expect(axe.capabilities.html5Stream).toBe(true);
    expect(appSrc).toContain("const isHtml5StreamResolver = (id) => !!findLoadedResolver(id)?.capabilities?.html5Stream;");
    expect(appSrc).toContain("const usesSharedAudio = (id) => id === 'localfiles' || isHtml5StreamResolver(id) || isWidevineResolver(id);");
    // play/pause toggle
    expect(appSrc).toContain('audioRef.current && usesSharedAudio(currentTrack?._activeResolver)');
    // seek keys off the resolver actually playing, not "has a subsonic source":
    // mediaElementFor hands back the shared element for every usesSharedAudio
    // resolver (an embedded player's facade aside)
    expect(appSrc).toContain('return usesSharedAudio(id) ? audioRef.current : null;');
    expect(appSrc).toContain('const seekEl = mediaElementFor(activeResolver);');
    expect(appSrc).not.toContain('currentTrack?.sources?.subsonic');
    // volume slider support — widevine resolvers (Amazon) share the element,
    // so they need no special case here anymore
    expect(appSrc).toContain('playsInApp(currentResolverId) || (isSpotify && spotifyVolumeSupported)');
    expect(appSrc).toContain('const playsInApp = (id) => usesSharedAudio(id) || !!embedPlayerKind(id);');
    // and no id list is left behind
    expect(appSrc).not.toMatch(/activeResolver(?:Id)? === 'subsonic'|resolverId === 'subsonic'/);
  });

  test('the fallback wall-clock progress tracker skips subsonic (HTML5 audio owns progress)', () => {
    // The generic audioContext-based progress interval must not run for HTML5
    // audio resolvers — otherwise it fights with the element's timeupdate
    // (progress bar jumps back and forth) and its elapsed>=duration check can
    // fire a premature handleNext after a pause/resume. localfiles and the
    // embedded players (SoundCloud's widget) are skipped the same way.
    const m = appSrc.match(/const isEmbedPlayer = !!embedPlayerKind\(activeResolver\);.*\n    const isHtml5Stream = isHtml5StreamResolver\(activeResolver\);/);
    expect(m).toBeTruthy();
    expect(appSrc).toContain('!isLocalFile && !isEmbedPlayer && !isHtml5Stream && !isBrowserTrack');
  });

  test('resolver volume offsets include subsonic (neutral)', () => {
    // The offsets map moved to the volume hook (Track 2b slice 1):
    // src/renderer/hooks/use-volume.js owns the defaults now; app.js keeps
    // only the hook destructure.
    const hookSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-volume.js'), 'utf8');
    const m = hookSrc.match(/function defaultResolverVolumeOffsets\(\) \{[\s\S]*?return \{([\s\S]*?)\};/);
    expect(m).toBeTruthy();
    expect(m[1]).toContain('subsonic');
    expect(m[1]).toContain('subsonic: 0');
    expect(appSrc).toContain('useVolume({');
  });

  test('shared HTML5 element is created once and every path uses it', () => {
    // localfiles hands the track over as-is (SoundCloud plays in its widget
    // now, not the shared element); the shared html5Stream branch tags it
    // with the owning resolver because every such resolver plays http(s) URLs
    // and the element's src can't tell them apart.
    expect(appSrc.match(/ensureSharedAudioElement\(trackOrSource\)/g)).toHaveLength(1);
    expect(appSrc).toContain('ensureSharedAudioElement({ ...trackOrSource, _streamOwner: resolverId })');
    expect(appSrc).toContain('const audio = new Audio()');
    expect(appSrc).not.toContain('audioRef.current = new Audio()');
    expect(appSrc).not.toContain('sourceToPlay.subsonicStreamUrl');
  });

  // The per-plugin drift guard (was: a spawn of scripts/sync-subsonic-axe.js
  // --check, absorbed into scripts/build-axes.js) now lives in
  // .github/workflows/test.yml — the committed-state drift gate
  // (git diff --exit-code on the tracked writer outputs) — plus build-axes
  // itself in pretest, and covers every bundled plugin.

  test('the resolver config is the meta_service_configs entry the settings panel saved, with no subsonic branch', () => {
    // The userpass panel saves serverUrl/username/password under
    // meta_service_configs.subsonic; getResolverConfig's generic fallback hands
    // that entry to search/getStreamUrl, same as for any other plugin.
    expect(appSrc).not.toContain("if (resolverId === 'subsonic') {");
    expect(appSrc).toContain('metaServiceConfigsRef.current?.[resolverId] || metaServiceConfigs[resolverId],');
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

  test('re-asks a CJK album query as its letter runs after a miss', async () => {
    const resolver = instantiate(axe);
    const album = { id: 'al-jp', name: 'ぶっ生き返す！！', artist: 'マキシマムザホルモン', year: 2007, songCount: 3 };
    const calls = mockFetch((url) => {
      const query = new URL(url).searchParams.get('query');
      return subsonicOk(
        query === 'マキシマムザホルモン ぶっ生き返す'
          ? { searchResult3: { album: [album] } }
          : { searchResult3: {} },
      );
    });
    const albums = await resolver.searchAlbums({ artist: 'マキシマムザホルモン', title: 'ぶっ生き返す!!' }, CONFIG);
    expect(calls.map((url) => new URL(url).searchParams.get('query'))).toEqual([
      'マキシマムザホルモン ぶっ生き返す!!',
      'マキシマムザホルモン ぶっ生き返す',
    ]);
    expect(albums[0].name).toBe('ぶっ生き返す！！');
    expect(albums[0].url).toBe('subsonic:album:al-jp');
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

  test('a failed album search throws instead of answering no albums', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => ({ ok: false, status: 500 }));
    await expect(
      resolver.searchAlbums({ artist: 'Radiohead', title: 'Amnesiac' }, CONFIG)
    ).rejects.toThrow('Subsonic album search failed: HTTP 500');
  });
});

describe('subsonic artist images (capabilities.artistImage)', () => {
  const subsonicOk = (body) => ({
    ok: true,
    status: 200,
    json: async () => ({ 'subsonic-response': { status: 'ok', ...body } })
  });

  test('declares artistImage', () => {
    expect(axe.capabilities.artistImage).toBe(true);
  });

  test('returns the OpenSubsonic artistImageUrl of the exact-name artist', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => subsonicOk({
      searchResult3: { artist: [
        { id: 'ar-2', name: 'Radiohead Tribute Band', artistImageUrl: 'http://navidrome.local:4533/share/img/other' },
        { id: 'ar-1', name: 'Radiohead', artistImageUrl: 'http://navidrome.local:4533/share/img/eyJhbGc?size=600' }
      ] }
    }));
    expect(await resolver.searchArtistImage('radiohead', CONFIG)).toBe('http://navidrome.local:4533/share/img/eyJhbGc?size=600');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/rest/search3.view?');
    expect(calls[0]).toContain('artistCount=5');
  });

  test('falls back to getArtistInfo2, and never returns a credentialed URL', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch((url) => url.includes('/search3.view')
      ? subsonicOk({ searchResult3: { artist: [{ id: 'ar-1', name: 'Radiohead', artistImageUrl: 'http://navidrome.local:4533/rest/getCoverArt.view?id=ar-1&u=alice&t=abc&s=def' }] } })
      : subsonicOk({ artistInfo2: { largeImageUrl: 'https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg' } }));
    expect(await resolver.searchArtistImage('Radiohead', CONFIG)).toBe('https://lastfm.freetls.fastly.net/i/u/300x300/abc.jpg');
    expect(calls[1]).toContain('/rest/getArtistInfo2.view?');
    expect(calls[1]).toContain('id=ar-1');
  });

  test("Last.fm's placeholder star is a miss", async () => {
    const resolver = instantiate(axe);
    mockFetch((url) => url.includes('/search3.view')
      ? subsonicOk({ searchResult3: { artist: [{ id: 'ar-1', name: 'Radiohead' }] } })
      : subsonicOk({ artistInfo2: { largeImageUrl: 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png' } }));
    expect(await resolver.searchArtistImage('Radiohead', CONFIG)).toBe(null);
  });

  test('an artist not in the library is a miss', async () => {
    const resolver = instantiate(axe);
    mockFetch(() => subsonicOk({ searchResult3: { artist: [{ id: 'ar-9', name: 'Radiohead Tribute Band' }] } }));
    expect(await resolver.searchArtistImage('Radiohead', CONFIG)).toBe(null);
  });

  test('no server configured: no request', async () => {
    const resolver = instantiate(axe);
    const calls = mockFetch(() => subsonicOk({}));
    expect(await resolver.searchArtistImage('Radiohead', {})).toBe(null);
    expect(calls).toHaveLength(0);
  });
});

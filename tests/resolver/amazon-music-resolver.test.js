/**
 * Amazon Music resolver tests (parachord#988).
 *
 * Covers the .axe resolver surface:
 *   - structural validity (manifest/capabilities/implementation compile)
 *   - search result mapping (bridge -> resolver track shape)
 *   - resolve() containment matching (best match, not just first result)
 *   - play() not-signed-in flow (sign-in prompt + retry)
 *   - searchAlbums()/lookupAlbum() (the albumSearch capability: bridge mapping,
 *     sign-in prompt, and miss vs notReady)
 *   - lookupPlaylist() (the playlist import: resolver-shape mapping, sign-in
 *     prompt, and the miss vs notReady vs truncated policy)
 *   - searchArtistImage() (the artistImage capability: bridge mapping, the
 *     no-bridge no-op, and miss vs error — never a sign-in prompt)
 *   - getRecommendations()/expandRecommendationSection() (the recommendations
 *     capability, a real flow over the webSession bridge since #1356 M8: the
 *     mapping, miss vs notReady, never a sign-in prompt)
 *   - byte-identical FALLBACK_RESOLVERS copy in the generated module (drift guard)
 *   - resolver-limiter does NOT skip amazonmusic (CDP fan-out + web search)
 */

const fs = require('fs');
const path = require('path');

// instantiateAmazonPlugin materializes the .axe the way resolver-loader.js
// does, #1402's plugin library included (implementation._lib called once,
// frozen, injected as this.lib) — the search's runner rides it.
const {
  loadAmazonAxe,
  instantiateAmazonPlugin,
  amazonWebSessionMock,
  amazonPlaylistDetailCapture,
  amazonPlaylistPage
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();

function instantiate(axeContent) {
  return instantiateAmazonPlugin(axeContent || axe);
}

describe('amazonmusic .axe structure', () => {
  test('manifest identifies the resolver', () => {
    expect(axe.manifest.id).toBe('amazonmusic');
    expect(axe.manifest.version).toBe('1.21.3');
  });

  test('declares streaming capabilities without auth', () => {
    expect(axe.capabilities).toEqual(
      expect.objectContaining({ resolve: true, search: true, stream: true, urlLookup: true, albumSearch: true, artistImage: true, recommendations: true, widevine: true, mobile: false })
    );
    expect(axe.requires).toEqual({ hostBridges: ['webSession'] });
    expect(axe.manifest.minAppVersion).toEqual({ desktop: '0.9.13' });
    expect(axe.settings.requiresAuth).toBe(false);
    expect(axe.urlPatterns).toEqual([
      'music.amazon.com/playlists/*',
      'music.amazon.com/my/playlists/*',
      'music.amazon.com/user-playlists/*',
      'music.amazon.com/albums/*'
    ]);
    // The typed patterns (#1356 M11): what getUrlType classifies a matched
    // URL as, manifest data since the per-service arms died. "track" first —
    // the ?trackAsin= song share link must beat the bare album pattern, in
    // BOTH query positions (leading, and after other params like ref=dm_sh&).
    // No /tracks/* pattern: the URL never routes (no urlPatterns entry), so
    // under the routed-resolver scoping (#1441 review, note 2) it could only
    // ever answer 'unknown' — the plugin resolves tracks by search, never by
    // ASIN path.
    expect(axe.urlTypes).toEqual({
      track: [
        'music.amazon.com/albums/*?trackAsin=*',
        'music.amazon.com/albums/*?*trackAsin=*'
      ],
      album: ['music.amazon.com/albums/*'],
      playlist: [
        'music.amazon.com/playlists/*',
        'music.amazon.com/my/playlists/*',
        'music.amazon.com/user-playlists/*'
      ]
    });
  });

  test('implementation functions compile', () => {
    for (const [key, src] of Object.entries(axe.implementation)) {
      expect(() => new Function('return ' + src)()).not.toThrow();
      expect(typeof new Function('return ' + src)()).toBe('function');
    }
    expect(Object.keys(axe.implementation).sort()).toEqual(
      ['_lib', 'appVersion', 'assertPlanPlays', 'cacheSeeMorePage', 'cdmAvailable', 'cleanup', 'debugCaptureGql', 'debugCapturePageFlow', 'dmls', 'dropSessionState', 'drmAsinFromTrack', 'enqueuePageFlow', 'ensureSessionContext', 'expandRecommendationSection', 'expandRecommendationSectionParsed', 'fetchConfigJson', 'getPlan', 'getPlaybackManifest', 'getRecommendations', 'getStatus', 'handlePlayerEvent', 'homePageFlow', 'init', 'isSignedIn', 'kickCertWarm', 'lookupAlbum', 'lookupAlbumFlow', 'lookupAlbumPageFlow', 'lookupPlaylist', 'lookupPlaylistFlow', 'lookupPlaylistPageFlow', 'mintCsrfHeaders', 'mintCsrfPageFlow', 'mintSessionContext', 'musicAgent', 'musicHomePageFlow', 'notePlanReading', 'pageSections', 'play', 'playlistImportPages', 'postTelemetryEvent', 'relayLicense', 'replayGql', 'requireLib', 'resolve', 'search', 'searchAlbums', 'searchArtistImage', 'seeMorePageFlow', 'sessionState', 'signIn', 'signInPromptDecision', 'signOut', 'specSearch', 'specSearchPageFlow', 'specStructuralError', 'telemetry', 'tryMusicHomeWalk', 'trySeeMoreReplay', 'trySpecReplay', 'walkMusicHomePages', 'warmCertSession', 'withPlaylistsSection'].sort()
    );
  });
});

describe('amazonmusic search', () => {
  // #1356 M5: the search runs in the plugin, driving the host web session
  // through the window.electron.webSession bridge (the machinery pins live
  // in amazon-music-plugin-spec-search.test.js); these pins are the resolver
  // surface — the track mapping and the miss-vs-notReady semantics.
  const runnerTracks = [
    { asin: 'B000SNWG5Q', title: 'Around the World', artist: 'Daft Punk', album: 'Homework', albumAsin: 'B000031W1M', duration: 430, explicit: false, albumArt: 'https://m.media-amazon.com/images/I/B000SNWG5Q.jpg' },
    { asin: 'B07XLSKGGK', title: 'Master of Puppets (Remastered)', artist: 'Metallica', album: 'Master of Puppets', duration: 515, explicit: false }
  ];

  afterEach(() => {
    delete global.window;
  });

  test('maps the runner rows to the resolver track shape', async () => {
    amazonWebSessionMock({ tracks: runnerTracks });
    const resolver = instantiate(axe);
    const results = await resolver.search('daft punk around the world', {});
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({
      id: 'amazonmusic-B000SNWG5Q',
      title: 'Around the World',
      artist: 'Daft Punk',
      album: 'Homework',
      duration: 430,
      sources: ['amazonmusic'],
      amazonAsin: 'B000SNWG5Q',
      explicit: false,
      // The gql search response carries the track's own cover art — the resolver passes
      // it through so getAlbumArtFromResolvers can hit it.
      albumArt: 'https://m.media-amazon.com/images/I/B000SNWG5Q.jpg'
    }));
    expect(results[1].albumArt).toBeNull();
  });

  test('throws notReady when the player is not signed in so resolve does not cache noMatch', async () => {
    amazonWebSessionMock({ tracks: runnerTracks, signedIn: false });
    const resolver = instantiate(axe);
    await expect(resolver.search('anything', {})).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
  });

  test('throws notReady when the in-app player is not signed in', async () => {
    amazonWebSessionMock({ tracks: runnerTracks, signedIn: false });
    const resolver = instantiate(axe);
    await expect(resolver.resolve('Daft Punk', 'Around the World', null, {})).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
  });

  test('throws notReady when the page never loaded, so a stalled network is not cached as noMatch', async () => {
    amazonWebSessionMock({
      tracks: runnerTracks,
      loadResult: { success: false, reason: 'load-failed', error: 'Amazon Music page did not finish loading within 30000ms' }
    });
    const resolver = instantiate(axe);
    await expect(resolver.search('daft punk', {})).rejects.toMatchObject({
      notReady: true,
      code: 'load-failed'
    });
  });

  // #1220: off Music Unlimited the search gate answers plan-ineligible.
  // Not-ready, not a miss: a 30-day noMatch would outlive an upgrade.
  test('throws notReady when the plan is not Music Unlimited, so it is not cached as noMatch', async () => {
    amazonWebSessionMock({ tracks: runnerTracks, tier: 'PRIME' });
    const resolver = instantiate(axe);
    await expect(resolver.resolve('Daft Punk', 'Around the World', null, {})).rejects.toMatchObject({
      notReady: true,
      code: 'plan-ineligible'
    });
  });

  test('returns [] on short queries', async () => {
    const ws = amazonWebSessionMock({ tracks: runnerTracks });
    const resolver = instantiate(axe);
    expect(await resolver.search('d', {})).toEqual([]);
    expect(ws.load).not.toHaveBeenCalled();
  });
});

describe('amazonmusic resolve', () => {
  // resolve rides the plugin's own search (the webSession runner), so these
  // mocks serve the spec-search envelope through the bridge.
  const serveTracks = (tracks) => amazonWebSessionMock({ tracks });

  beforeEach(() => {
    serveTracks([
      // Deliberately not the target first — resolve must pick by containment
      { asin: 'B1', title: 'The Game of Love', artist: 'Daft Punk', album: 'RAM', duration: 322 },
      { asin: 'B2', title: 'Around the World', artist: 'Daft Punk', album: 'Homework', duration: 430 },
      { asin: 'B3', title: 'Around the World (Live)', artist: 'Some Cover Band', album: 'Covers', duration: 400 }
    ]);
  });

  afterEach(() => {
    delete global.window;
  });

  test('picks the first containment match (artist AND title), not just the top hit', async () => {
    const resolver = instantiate(axe);
    const match = await resolver.resolve('Daft Punk', 'Around the World', null, {});
    expect(match).toBeTruthy();
    expect(match.amazonAsin).toBe('B2');
    // The search ran for the quoted title + artist pair (the OR-union query).
    const ws = global.window.electron.webSession;
    expect(ws.load).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(ws.load.mock.calls[0][1])).toContain('"Around the World" by "Daft Punk"');
  });

  test('matches Cyrillic titles instead of stripping them to empty', async () => {
    serveTracks([
      { asin: 'B9', title: 'На рахунок три', artist: 'Tember Blanche', album: 'На рахунок три', duration: 180 }
    ]);
    const resolver = instantiate(axe);
    const match = await resolver.resolve('Tember Blanche', 'На рахунок три', null, {});
    expect(match).toBeTruthy();
    expect(match.amazonAsin).toBe('B9');
  });

  test('falls back to null when nothing matches', async () => {
    serveTracks([]);
    const resolver = instantiate(axe);
    expect(await resolver.resolve('Nobody', 'Nothing', null, {})).toBeNull();
  });

  const resolveAmong = async (tracks, artist, title) => {
    serveTracks(tracks.map(([asin, a, t]) => ({ asin, title: t, artist: a, album: 'X', duration: 200 })));
    return (await instantiate(axe).resolve(artist, title, null, {}))?.amazonAsin || null;
  };

  test('prefers the exact track over a live or remixed version ranked above it', async () => {
    expect(await resolveAmong([
      ['L', 'Daft Punk', 'Around the World (Live 2007)'],
      ['R', 'Daft Punk', 'Around the World (Remix)'],
      ['E', 'Daft Punk', 'Around the World'],
    ], 'Daft Punk', 'Around the World')).toBe('E');
  });

  test('without an exact match, a non-variant containment match beats a variant', async () => {
    expect(await resolveAmong([
      ['K', 'Daft Punk', 'Around the World (Karaoke Version)'],
      ['M', 'Daft Punk', 'Around the World - Remastered'],
    ], 'Daft Punk', 'Around the World')).toBe('M');
  });

  test('a variant is still used when it is the only containment match', async () => {
    expect(await resolveAmong([['L', 'Daft Punk', 'Around the World (Live)']], 'Daft Punk', 'Around the World')).toBe('L');
  });

  test('a version word the request names is not held against a result', async () => {
    expect(await resolveAmong([
      ['S', 'Oasis', 'Live Forever'],
    ], 'Oasis', 'Live Forever')).toBe('S');
    expect(await resolveAmong([
      ['P', 'Daft Punk', 'Around the World'],
      ['L', 'Daft Punk', 'Around the World (Live)'],
    ], 'Daft Punk', 'Around the World (Live)')).toBe('L');
  });

  test('matches across feat. credits', async () => {
    expect(await resolveAmong([
      ['R', 'Shakey Graves', 'Ready or Not (Live)'],
      ['E', 'Shakey Graves', 'Ready or Not (feat. Sierra Ferrell)'],
    ], 'Shakey Graves feat. Sierra Ferrell', 'Ready or Not')).toBe('E');
  });

  test('the version word list matches the renderer\'s', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../plugins-src/amazonmusic/implementation.js'), 'utf8');
    const m = src.match(/var VARIANT =\s*\/(.*)\/gi;/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(require('../../src/renderer/lib/track-variants').VARIANT_WORDS.source);
  });
});

describe('amazonmusic play (host-owned through capabilities.widevine)', () => {
  // With capabilities.widevine the .axe never touches audio: the host's
  // handlePlay widevine branch drives the shared player, and the old
  // play-IPC prompt/retry contract moved with it (source-pinned below).
  // play() here only fails honestly on hosts without that branch.
  test('play() is host-owned: returns false with a console note', async () => {
    const resolver = instantiate(axe);
    const ok = await resolver.play({ amazonAsin: 'B1', title: 'T', artist: 'A' }, {});
    expect(ok).toBe(false);
  });

  test('cleanup() stops the shared widevine engine when it exists', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    global.window = { __parachordWidevine: { stop } };
    const resolver = instantiate(axe);
    await resolver.cleanup();
    expect(stop).toHaveBeenCalledTimes(1);
    delete global.window;
  });

  test('cleanup() tolerates a host with no widevine engine', async () => {
    const resolver = instantiate(axe);
    await expect(resolver.cleanup()).resolves.toBeUndefined();
  });

  test('the host widevine branch keeps the not-signed-in prompt-then-retry contract', () => {
    // Transport is hook-extracted: markers live in the engine hook.
    const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');
    expect(appSrc).toContain('if (isWidevineResolver(resolverId)) {');
    expect(appSrc).toMatch(/window\.__parachordWidevine\.play\(audioRef\.current, \{\s*resolverId,\s*startTime: startAt,\s*entity: \{ asin \}/);
    // Routed by capability since #1523 (the plug-in on the status surface
    // with a signIn; app.js runs Amazon's own prompt flow for it).
    expect(appSrc).toMatch(/error\.reason === 'not-signed-in' && typeof window\.__parachordPromptPluginSignIn === 'function'\s*&& window\.__parachordPromptPluginSignIn\.canPrompt\(resolverId\)/);
    expect(appSrc).toContain('await startWidevine();');
  });

  test('the resolver declares capabilities.widevine and no longer plays via the amazon IPC', () => {
    expect(axe.capabilities.widevine).toBe(true);
    const impl = axe.implementation.play;
    expect(impl).not.toContain('amazonMusic.playTrack');
  });
});

describe('amazonmusic lookupPlaylist', () => {
  // The flow runs in the plugin (#1356 M7) over the webSession bridge; the
  // flow mechanics (the capture window, the verbatim replay, the token-driven
  // pagination with its delisted/duplicate/no-advance rules, the busy backoff)
  // are pinned in tests/resolver/amazon-music-plugin-playlist.test.js. Here:
  // the resolver contract — the mapping to the playlist shape, the sign-in
  // prompt, and the miss vs notReady policy.
  const playlistUrl = 'https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A';

  const PLAYLIST = {
    id: 'PP6417A00A9C99470BBC8834FF3BF6009A',
    name: 'Alexa Chill',
    owner: 'Amazon',
    albumArt: 'https://m.media-amazon.com/images/I/71Yr0gqZPpL._SX500_SY500_.jpg'
  };
  const TRACKS = [
    { asin: 'B000SNWG5Q', title: 'Around the World', artist: 'Daft Punk', album: 'Homework', duration: 430, albumAsin: 'B000031W1M' },
    { asin: 'B07XLSKGGK', title: 'Master of Puppets (Remastered)', artist: 'Metallica', album: 'Master of Puppets', duration: 515, albumAsin: null }
  ];

  // A webSession mock whose playlist page answers the page's own
  // playlistDetail capture and one response page. `pages(afterCursor)` (when
  // given) replaces the response script: it answers the afterCursor the
  // plugin sent, or null for a not-found shape.
  const playlistMock = (pages = null) => {
    const first = amazonPlaylistPage(PLAYLIST, TRACKS, null);
    const ws = amazonWebSessionMock({
      capturesFor: (url) => (/\/playlists\//.test(String(url))
        ? [amazonPlaylistDetailCapture(PLAYLIST.id)]
        : []),
      envelope: {}
    });
    ws.pageFetch.mockImplementation(async (id, request) => {
      const body = JSON.parse(request.body);
      const afterCursor = body.variables && body.variables.afterCursor;
      const page = pages ? pages(afterCursor) : (!afterCursor ? first : null);
      if (!page) return { success: true, status: 200, text: JSON.stringify({ data: { playlist: null } }) };
      return { success: true, status: 200, text: JSON.stringify(page) };
    });
    return ws;
  };

  afterEach(() => {
    if (global.window) delete global.window.__parachordManageAmazonMusic;
    delete global.window;
  });

  test('maps the flow playlist to the resolver playlist shape', async () => {
    const ws = playlistMock();
    const resolver = instantiate(axe);
    const playlist = await resolver.lookupPlaylist(playlistUrl, {});
    expect(playlist).toEqual(expect.objectContaining({
      id: 'amazonmusic-playlist-PP6417A00A9C99470BBC8834FF3BF6009A',
      name: 'Alexa Chill',
      owner: 'Amazon',
      trackCount: 2,
      url: playlistUrl,
      albumArt: 'https://m.media-amazon.com/images/I/71Yr0gqZPpL._SX500_SY500_.jpg'
    }));
    expect(playlist.tracks[0]).toEqual(expect.objectContaining({
      id: 'amazonmusic-B000SNWG5Q',
      title: 'Around the World',
      artist: 'Daft Punk',
      album: 'Homework',
      duration: 430,
      sources: ['amazonmusic'],
      amazonAsin: 'B000SNWG5Q',
      albumAsin: 'B000031W1M'
    }));
    // The playlist page loaded on the plugin's session with the gql capture
    // window inside the load, and the page's own request was replayed
    // verbatim (its own firstLimit, no cursor variables patched).
    expect(ws.load).toHaveBeenCalledTimes(1);
    expect(ws.load.mock.calls[0][0]).toBe('amazon-music');
    expect(ws.load.mock.calls[0][1]).toBe(playlistUrl);
    expect(ws.load.mock.calls[0][2].capture.urlPrefixes).toEqual(['https://gql.music.amazon.com/*']);
    expect(ws.pageFetch).toHaveBeenCalledTimes(1);
    const replayed = JSON.parse(ws.pageFetch.mock.calls[0][1].body);
    expect(replayed.operationName).toBe('playlistDetail');
    expect(replayed.variables.firstLimit).toBe(100);
    expect('afterCursor' in replayed.variables).toBe(false);
  });

  describe('not signed in', () => {
    test('prompts for sign-in and retries once, like play()', async () => {
      const ws = playlistMock();
      let signedOut = true;
      ws.state.mockImplementation(async () => ({
        success: true,
        url: 'https://music.amazon.com/search/x/songs',
        signInUrl: null,
        cookieNames: signedOut ? ['session-id', 'ubid-main'] : ['at-main', 'sess-at-main'],
        generation: 0
      }));
      const resolver = instantiate(axe);
      const managePrompt = jest.fn(async () => { signedOut = false; return true; });
      global.window.__parachordManageAmazonMusic = managePrompt;
      const playlist = await resolver.lookupPlaylist(playlistUrl, {});
      expect(playlist.trackCount).toBe(2);
      expect(managePrompt).toHaveBeenCalledTimes(1);
      // The refused run never loaded a page; only the retry did.
      expect(ws.load).toHaveBeenCalledTimes(1);
    });

    test('declined sign-in throws notReady so the import is not reported as a missing playlist', async () => {
      const ws = playlistMock();
      ws.state.mockImplementation(async () => ({
        success: true,
        url: 'https://music.amazon.com/search/x/songs',
        signInUrl: null,
        cookieNames: ['session-id', 'ubid-main'],
        generation: 0
      }));
      const resolver = instantiate(axe);
      global.window.__parachordManageAmazonMusic = jest.fn(async () => false);
      await expect(resolver.lookupPlaylist(playlistUrl, {})).rejects.toMatchObject({
        notReady: true,
        code: 'not-signed-in'
      });
      expect(ws.load).not.toHaveBeenCalled();
    });
  });

  test('a playlist the page never asked for (deleted/private/renamed) is the not-found error', async () => {
    // The page loaded but never fired playlistDetail for our id — the old
    // "success with playlist: null" IPC result.
    const ws = amazonWebSessionMock({ capturesFor: () => [], envelope: {} });
    const resolver = instantiate(axe);
    await expect(resolver.lookupPlaylist(playlistUrl, {})).rejects.toThrow(/not found on Amazon Music/);
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('an errored replay surfaces its message', async () => {
    playlistMock().pageFetch.mockImplementation(async () => ({ success: true, error: 'Amazon playlist query failed (403)' }));
    const resolver = instantiate(axe);
    await expect(resolver.lookupPlaylist(playlistUrl, {})).rejects.toThrow(/403/);
  });

  test("a server-truncated import keeps the playlist's own trackCount instead of looking complete", async () => {
    // A one-page response whose trackCount exceeds its rows, with no
    // continuation pageInfo: the server is simply out of pages.
    playlistMock((afterCursor) => (afterCursor == null
      ? amazonPlaylistPage({ ...PLAYLIST, trackCount: 7 }, TRACKS, null)
      : null));
    const resolver = instantiate(axe);
    const playlist = await resolver.lookupPlaylist(playlistUrl, {});
    expect(playlist.trackCount).toBe(7);
    expect(playlist.tracks).toHaveLength(2);
  });

  test('a page that never loaded is not reported as a missing playlist', async () => {
    // load-failed means the import never got to ask Amazon (offline, captive
    // portal, stalled load) — 'Playlist not found' would be a lie. The manage
    // function is installed to prove it is also NOT offered a sign-in prompt
    // (each mock replaces global.window, so it is installed after each one).
    const managePrompt = jest.fn().mockResolvedValue(true);
    for (const reason of ['load-failed', 'superseded', 'not-ready']) {
      amazonWebSessionMock({
        loadResult: { success: false, reason, error: reason + ' happened' },
        capturesFor: () => [],
        envelope: {}
      });
      global.window.__parachordManageAmazonMusic = managePrompt;
      await expect(instantiate(axe).lookupPlaylist(playlistUrl, {})).rejects.toMatchObject({
        notReady: true,
        code: reason
      });
    }
    expect(managePrompt).not.toHaveBeenCalled();
  });

  test('a reasonless flow rejection keeps the old IPC handler shape, never a silent null', async () => {
    // The #1437 review note: the deleted IPC handler caught EVERY error and
    // the renderer surfaced "Amazon Music playlist import failed: <message>".
    // A raw bridge rejection (a broken invoke — no reason class) reaches the
    // outer catch, which must throw that shape, not return null (a null would
    // report a real failure as a missing playlist).
    const ws = playlistMock();
    ws.load.mockRejectedValue(new Error('ipc broke'));
    const resolver = instantiate(axe);
    await expect(resolver.lookupPlaylist(playlistUrl, {})).rejects.toThrow('Amazon Music playlist import failed: ipc broke');
  });

  test('no webSession bridge returns null', async () => {
    global.window = {};
    const resolver = instantiate(axe);
    await expect(resolver.lookupPlaylist(playlistUrl, {})).resolves.toBeNull();
  });
});

describe('amazonmusic searchAlbums', () => {
  // The flow runs in the plugin (#1356 M6) over the webSession bridge; the
  // flow mechanics (the albums-tab URL, the album spec, the staleness check,
  // the breaker) are pinned in amazon-music-plugin-catalog.test.js. Here: the
  // resolver contract — the mapping to the albumSearch shape and the miss vs
  // notReady policy.
  const albums = [
    { asin: 'B0FMW6FYGN', name: 'Dulling The Horns (Deluxe Edition)', artist: 'Wild Pink', albumArt: 'https://m.media-amazon.com/images/I/91OrDh0ADYL.jpg', explicit: true },
    { asin: 'B07CMLR17Z', name: 'Yolk in the Fur', artist: 'Wild Pink', albumArt: 'https://m.media-amazon.com/images/I/61t5hojNMAL.jpg', explicit: false }
  ];

  beforeEach(() => {
    amazonWebSessionMock({ albums });
  });

  afterEach(() => {
    delete global.window;
  });

  test('maps the flow rows to the albumSearch contract shape', async () => {
    const resolver = instantiate(axe);
    const found = await resolver.searchAlbums({ artist: 'Wild Pink', title: 'Dulling the Horns' }, {});
    expect(found).toEqual([
      {
        id: 'amazonmusic-album-B0FMW6FYGN',
        name: 'Dulling The Horns (Deluxe Edition)',
        artist: 'Wild Pink',
        albumArt: 'https://m.media-amazon.com/images/I/91OrDh0ADYL.jpg',
        // The album search spec carries no releaseDate or trackCount; the
        // plugin contract allows both to be null.
        releaseDate: null,
        trackCount: null,
        url: 'https://music.amazon.com/albums/B0FMW6FYGN',
        explicit: true
      },
      {
        id: 'amazonmusic-album-B07CMLR17Z',
        name: 'Yolk in the Fur',
        artist: 'Wild Pink',
        albumArt: 'https://m.media-amazon.com/images/I/61t5hojNMAL.jpg',
        releaseDate: null,
        trackCount: null,
        url: 'https://music.amazon.com/albums/B07CMLR17Z',
        explicit: false
      }
    ]);
  });

  test('too short or empty queries never reach the bridge', async () => {
    const resolver = instantiate(axe);
    expect(await resolver.searchAlbums('d', {})).toEqual([]);
    expect(await resolver.searchAlbums('', {})).toEqual([]);
    expect(await resolver.searchAlbums({}, {})).toEqual([]);
    expect(global.window.electron.webSession.load).not.toHaveBeenCalled();
  });

  test('a plain miss returns [] and readiness failures throw, like search()', async () => {
    amazonWebSessionMock({ envelope: { data: { specificationSearch: { result: [{ edges: [] }] } } } });
    const resolver = instantiate(axe);
    expect(await resolver.searchAlbums('nothing anywhere', {})).toEqual([]);
    // superseded too: a sign-out mid-load is a readiness failure (search's
    // list) — never a miss the album catalog caches.
    for (const reason of ['not-ready', 'not-signed-in', 'load-failed', 'superseded']) {
      // A fresh resolver per case: one that already minted a spec-search
      // template answers the next search on the fast path, past the load.
      amazonWebSessionMock({
        albums,
        loadResult: { success: false, reason, error: reason + ' happened' },
      });
      await expect(instantiate(axe).searchAlbums('wild pink', {})).rejects.toMatchObject({ notReady: true, code: reason });
    }
  });

  test('no webSession bridge returns []', async () => {
    global.window = {};
    const resolver = instantiate(axe);
    expect(await resolver.searchAlbums('wild pink', {})).toEqual([]);
  });
});

describe('amazonmusic searchArtistImage', () => {
  // The flow runs in the plugin (#1356 M6) over the webSession bridge; the
  // flow mechanics are pinned in amazon-music-plugin-catalog.test.js. Here:
  // the resolver contract — a photo URL or null, never a throw.
  const photo = 'https://m.media-amazon.com/images/I/71KKtoQJVeL.jpg';
  const artists = [{ asin: 'B00V07PBMY', name: 'The Warning', images: [{ url: photo, width: 1366, height: 1366, imageType: 'PROFILE' }] }];

  beforeEach(() => {
    amazonWebSessionMock({ artists });
  });

  afterEach(() => {
    delete global.window;
  });

  test('returns the flow photo URL for a hit', async () => {
    const resolver = instantiate(axe);
    expect(await resolver.searchArtistImage('The Warning', {})).toBe(photo);
  });

  test('too short or empty names never reach the bridge', async () => {
    const resolver = instantiate(axe);
    expect(await resolver.searchArtistImage('x', {})).toBeNull();
    expect(await resolver.searchArtistImage('', {})).toBeNull();
    expect(await resolver.searchArtistImage('   ', {})).toBeNull();
    expect(await resolver.searchArtistImage(null, {})).toBeNull();
    expect(global.window.electron.webSession.state).not.toHaveBeenCalled();
  });

  test('a miss (no exact name, not-signed-in included) is null, never a throw', async () => {
    const resolver = instantiate(axe);
    amazonWebSessionMock({ artists });
    expect(await resolver.searchArtistImage('Warrant', {})).toBeNull();
    amazonWebSessionMock({ artists, signedIn: false });
    expect(await resolver.searchArtistImage('The Warning', {})).toBeNull();
  });

  test('no webSession bridge is a quiet null', async () => {
    global.window = {};
    const resolver = instantiate(axe);
    expect(await resolver.searchArtistImage('The Warning', {})).toBeNull();
  });
});

describe('amazonmusic lookupAlbum', () => {
  // The flow runs in the plugin (#1356 M6) over the webSession bridge; the
  // flow mechanics (the candidate ranking, the AlbumSeo skip, the miss vs
  // lookup-failed semantics, the disc numbering) are pinned in
  // amazon-music-plugin-catalog.test.js. Here: the resolver contract — the
  // mapping to the albumSearch shape, the sign-in prompt, and the miss vs
  // notReady policy.
  const albumUrl = 'https://music.amazon.com/albums/B07558DQJL';

  const detailAlbum = {
    asin: 'B07558DQJL',
    name: 'Master of Puppets (Remastered)',
    artist: 'Metallica',
    albumArt: 'https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg',
    releaseDate: '1986-02-21T00:00:00.000Z',
    trackCount: 8,
    url: albumUrl,
    explicit: false,
    tracks: [
      { asin: 'B07554FHF5', title: 'Battery (Remastered)', artist: 'Metallica', duration: 312, trackNumber: 1, discNumber: 1, explicit: false },
      { asin: 'B0755C8JX3', title: 'Master Of Puppets (Remastered)', artist: 'Metallica', duration: 515, trackNumber: 2, discNumber: 1, explicit: false }
    ]
  };

  // A webSession mock whose album lookup answers the given album-detail
  // response (or { reason } for the failure paths).
  const lookupMock = (album) => {
    const response = album
      ? { data: { album: {
          id: album.asin, title: album.name, shortTitle: album.name,
          trackCount: album.trackCount, releaseDate: album.releaseDate,
          images: [{ url: album.albumArt, width: 1200, height: 1200, imageType: 'PRIMARY' }],
          contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: album.artist } }] },
          tracksConnection: { edges: album.tracks.map((t) => ({ node: {
            __typename: 'Track', id: t.asin, title: t.title, trackNumber: t.trackNumber, duration: t.duration,
            contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: t.artist } }] }
          } })) }
        } } }
      : null;
    const ws = amazonWebSessionMock({
      capturesFor: (url) => (/\/albums\//.test(String(url))
        ? [{
            url: 'https://gql.music.amazon.com/',
            method: 'POST',
            body: JSON.stringify({
              operationName: 'AlbumDetailPage',
              variables: { id: 'B07558DQJL', isAuthenticated: true },
              extensions: { clientLibrary: { name: '@apollo/client' }, persistedQuery: { version: 1, sha256Hash: 'hash' } }
            }),
            headers: { 'x-api-key': 'k', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': '1' }
          }]
        : []),
      envelope: {}
    });
    ws.pageFetch.mockImplementation(async () => ({
      success: true, status: 200, text: JSON.stringify(response || { data: { album: null } })
    }));
    return ws;
  };

  afterEach(() => {
    delete global.window.__parachordManageAmazonMusic;
    delete global.window;
  });

  test('maps the flow album to the albumSearch contract shape', async () => {
    lookupMock(detailAlbum);
    const resolver = instantiate(axe);
    const album = await resolver.lookupAlbum(albumUrl, {});
    expect(album).toEqual(expect.objectContaining({
      id: 'amazonmusic-album-B07558DQJL',
      name: 'Master of Puppets (Remastered)',
      artist: 'Metallica',
      albumArt: 'https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg',
      releaseDate: '1986-02-21T00:00:00.000Z',
      trackCount: 8,
      url: albumUrl
    }));
    expect(album.tracks[0]).toEqual(expect.objectContaining({
      id: 'amazonmusic-B07554FHF5',
      title: 'Battery (Remastered)',
      artist: 'Metallica',
      album: 'Master of Puppets (Remastered)',
      duration: 312,
      sources: ['amazonmusic'],
      amazonAsin: 'B07554FHF5',
      albumAsin: 'B07558DQJL',
      trackNumber: 1,
      discNumber: 1,
      explicit: false,
      albumArt: 'https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg'
    }));
    // trackCount stays the server's 8 even though only 2 rows mapped — a
    // truncated load is visible the way the playlist import's is.
    expect(album.tracks).toHaveLength(2);
  });

  describe('not signed in', () => {
    test('prompts for sign-in and retries once, like lookupPlaylist', async () => {
      const ws = lookupMock(detailAlbum);
      let signedOut = true;
      ws.state.mockImplementation(async () => ({
        success: true,
        url: 'https://music.amazon.com/search/x/songs',
        signInUrl: null,
        cookieNames: signedOut ? ['session-id', 'ubid-main'] : ['at-main', 'sess-at-main'],
        generation: 0
      }));
      const resolver = instantiate(axe);
      const managePrompt = jest.fn(async () => { signedOut = false; return true; });
      global.window.__parachordManageAmazonMusic = managePrompt;
      const album = await resolver.lookupAlbum(albumUrl, {});
      expect(album.name).toBe('Master of Puppets (Remastered)');
      expect(managePrompt).toHaveBeenCalledTimes(1);
      // The refused run never loaded a page; only the retry did.
      expect(ws.load).toHaveBeenCalledTimes(1);
    });

    test('declined sign-in throws notReady', async () => {
      const ws = lookupMock(detailAlbum);
      ws.state.mockImplementation(async () => ({
        success: true,
        url: 'https://music.amazon.com/search/x/songs',
        signInUrl: null,
        cookieNames: ['session-id', 'ubid-main'],
        generation: 0
      }));
      const resolver = instantiate(axe);
      global.window.__parachordManageAmazonMusic = jest.fn(async () => false);
      await expect(resolver.lookupAlbum(albumUrl, {})).rejects.toMatchObject({
        notReady: true,
        code: 'not-signed-in'
      });
      expect(ws.load).not.toHaveBeenCalled();
    });
  });

  test('a legitimate miss (no connection ever, deleted / other region) is null, not a throw', async () => {
    lookupMock(null); // every replay answers data.album: null — no winner
    const resolver = instantiate(axe);
    await expect(resolver.lookupAlbum(albumUrl, {})).resolves.toBeNull();
  });

  test('transient and structural failures throw notReady — never a bogus miss', async () => {
    // superseded too: a sign-out mid-lookup is a readiness failure — its
    // captures belong to the old account, and the catalog fallback must not
    // cache it as a missing album.
    for (const reason of ['load-failed', 'not-ready', 'lookup-failed', 'superseded']) {
      amazonWebSessionMock({
        loadResult: { success: false, reason, error: reason + ' happened' },
        capturesFor: () => [],
        envelope: {}
      });
      await expect(instantiate(axe).lookupAlbum(albumUrl, {})).rejects.toMatchObject({ notReady: true, code: reason });
    }
    // An errored replay is lookup-failed.
    lookupMock(detailAlbum).pageFetch.mockImplementation(async () => ({ success: true, error: 'Amazon gql query failed (500)' }));
    await expect(instantiate(axe).lookupAlbum(albumUrl, {})).rejects.toMatchObject({ notReady: true, code: 'lookup-failed' });
  });

  test('a flow rejection surfaces as null, not a throw', async () => {
    const ws = lookupMock(detailAlbum);
    ws.load.mockRejectedValue(new Error('ipc broke'));
    const resolver = instantiate(axe);
    await expect(resolver.lookupAlbum(albumUrl, {})).resolves.toBeNull();
  });
});

describe('FALLBACK_RESOLVERS parity (generated module)', () => {
  test('the generated amazonmusic fallback is byte-identical to plugins/amazonmusic.axe', () => {
    // The inline block moved to the gitignored generated module (bucket C),
    // required by app.js.
    const entries = require(path.join(__dirname, '../../src/renderer/lib/fallback-resolvers.generated.js'));
    const fallback = entries.find((e) => e.manifest && e.manifest.id === 'amazonmusic');
    expect(fallback).toBeTruthy();
    expect(fallback).toEqual(axe);
    const appSrc = require('../helpers/renderer-source').appWithPages();
    expect(appSrc).toContain("require('./lib/fallback-resolvers.generated.js')");
  });

  test('amazonmusic is in the canonical resolver order', () => {
    const appSrc = require('../helpers/renderer-source').appWithPages();
    const m = appSrc.match(/const CANONICAL_RESOLVER_ORDER = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const order = m[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
    expect(order).toContain('amazonmusic');
    // Positioned with the streaming services, before localfiles
    expect(order.indexOf('amazonmusic')).toBeGreaterThan(order.indexOf('applemusic'));
    expect(order.indexOf('amazonmusic')).toBeLessThan(order.indexOf('localfiles'));
  });
});

describe('resolver limiter skip set', () => {
  test('amazonmusic searches stay under the global resolver limiter', () => {
    const { RESOLVER_LIMITER_SKIP_IDS } = require('../../resolver-limiter');
    expect(RESOLVER_LIMITER_SKIP_IDS.has('amazonmusic')).toBe(false);
  });
});

describe('playlist URL routing', () => {
  const ResolverLoader = require('../../resolver-loader');
  const loader = () => {
    const l = new ResolverLoader();
    l.urlPatterns = axe.urlPatterns.map(pattern => ({ pattern, resolverId: 'amazonmusic' }));
    // The typed patterns, in the manifest's own key order — what
    // loadResolver registers for getUrlType.
    for (const [type, patterns] of Object.entries(axe.urlTypes)) {
      for (const pattern of patterns) l.urlTypedPatterns.push({ pattern, type, resolverId: 'amazonmusic' });
    }
    return l;
  };

  test('shared/brand and my-music playlist pages route to amazonmusic as playlists', () => {
    const l = loader();
    expect(l.findResolverForUrl('https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A'))
      .toBe('amazonmusic');
    expect(l.getUrlType('https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A'))
      .toBe('playlist');
    expect(l.findResolverForUrl('https://music.amazon.com/my/playlists/PP6417A00A9C99470BBC8834FF3BF6009A?ref=dm_sh'))
      .toBe('amazonmusic');
    expect(l.getUrlType('https://music.amazon.com/my/playlists/PP6417A00A9C99470BBC8834FF3BF6009A?ref=dm_sh'))
      .toBe('playlist');
    // /user-playlists/<hex-uuid> — the share-link shape for user-created
    // playlists. It does NOT contain the literal '/playlists/' substring, so
    // it has its own typed pattern in the manifest (and its own urlPattern
    // for findResolverForUrl).
    expect(l.findResolverForUrl('https://music.amazon.com/user-playlists/e518f7064d964396a9dc211c4a705a80'))
      .toBe('amazonmusic');
    expect(l.getUrlType('https://music.amazon.com/user-playlists/e518f7064d964396a9dc211c4a705a80'))
      .toBe('playlist');
  });

  test('album pages route to amazonmusic as albums (dropping an album URL works)', () => {
    const l = loader();
    expect(l.findResolverForUrl('https://music.amazon.com/albums/B000031W1M')).toBe('amazonmusic');
    expect(l.getUrlType('https://music.amazon.com/albums/B000031W1M')).toBe('album');
    expect(l.findResolverForUrl('https://music.amazon.com/albums/B07558DQJL?ref=dm_sh')).toBe('amazonmusic');
  });

  test('a song share link (/albums/...?trackAsin=) types as track, not the album', () => {
    const l = loader();
    // Amazon's "copy link to song" shape. Typed album, a drop queued every
    // track on the album; typed track it fails cleanly (the resolver has no
    // lookupUrl for songs yet), like an unmatched /tracks/ URL.
    expect(l.getUrlType('https://music.amazon.com/albums/B0H7NR1GWR?trackAsin=B0H7NZ97KH')).toBe('track');
    expect(l.getUrlType('https://music.amazon.com/albums/B0H7NR1GWR')).toBe('album');
    expect(l.findResolverForUrl('https://music.amazon.com/albums/B0H7NR1GWR?trackAsin=B0H7NZ97KH')).toBe('amazonmusic');
  });

  test('track pages do not match the playlist or album patterns (the resolver has no lookupUrl)', () => {
    const l = loader();
    // A /tracks/<ASIN> URL never routes (no urlPatterns entry), so under the
    // routed-resolver scoping (#1441 review, note 2) it answers 'unknown' —
    // the old arm's '/tracks/' substring answer was a guess no caller could
    // reach (they all check for a resolver first).
    expect(l.findResolverForUrl('https://music.amazon.com/tracks/B000SNWG5Q')).toBeNull();
    expect(l.getUrlType('https://music.amazon.com/tracks/B000SNWG5Q')).toBe('unknown');
  });
});

describe('marketplace manifest entry', () => {
  test('marketplace-manifest.json lists amazonmusic at the matching version', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../marketplace-manifest.json'), 'utf8'));
    const entry = (manifest.plugins || []).find(p => p.id === 'amazonmusic');
    expect(entry).toBeTruthy();
    expect(entry.version).toBe(axe.manifest.version);
    expect(entry.builtin).toBe(true);
  });
});

describe('amazonmusic recommendations (the recommendations capability)', () => {
  // #1356 M8: the recommendations run in the plugin, driving the host web
  // session through the window.electron.webSession bridge (the flow pins live
  // in tests/resolver/amazon-music-plugin-recommendations.test.js; this
  // describe holds the resolver contract: the mapping, miss vs notReady,
  // never a sign-in prompt).
  const { amazonRecommendationsMock, amazonMusicHomeData, amazonSeeMoreData } = require('../helpers/amazon-plugin-bridge');

  afterEach(() => { delete global.window; });

  const SECTION_ID = 'uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy';
  const albumItem = (id, title, artist) => ({
    __typename: 'Album', id, title, shortTitle: title,
    images: [{ url: `https://m.media-amazon.com/images/I/${id}.jpg`, width: 2560, height: 2560, imageType: 'PRIMARY' }],
    url: `https://music.amazon.com/albums/${id}?ref=dm_wtyd`,
    contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: artist } }] }
  });

  const homeMock = ({ homePage, seeMorePage, ...rest } = {}) => amazonRecommendationsMock({
    homePage: homePage || (async () => amazonMusicHomeData([
      { id: SECTION_ID, name: 'Albums for You', recommendedContent: { edges: [{ node: albumItem('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast') }] } },
      { id: 'uri:///recommendations/browse-home/audiobooksForYouLapsedT2', name: 'Audiobooks for You', recommendedContent: { edges: [] } }
    ])),
    seeMorePage: seeMorePage || (async () => amazonSeeMoreData([], { hasNextPage: false, token: null })),
    ...rest
  });

  test('maps the walked home sections through and drops empty sections', async () => {
    homeMock();
    const resolver = instantiate(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0]).toMatchObject({ id: SECTION_ID, title: 'Albums for You' });
    expect(out.sections[0].items[0]).toMatchObject({ type: 'album', id: 'B0G2TSTWXD', name: 'Tempelschlaf', artist: 'The Ruins Of Beverast' });
  });

  test('a miss (empty sections) passes through as a miss, never a notReady', async () => {
    homeMock({ homePage: async () => amazonMusicHomeData([]) });
    const resolver = instantiate(axe);
    await expect(resolver.getRecommendations({})).resolves.toEqual({ sections: [] });
  });

  test('readiness failures throw notReady (never cached as a miss, never a sign-in prompt)', async () => {
    for (const opts of [
      { signedIn: false },
      { loadResult: { success: false, reason: 'load-failed', error: 'stalled' } },
      { capturesFor: () => [] }
    ]) {
      homeMock(opts);
      const resolver = instantiate(axe);
      await expect(resolver.getRecommendations({})).rejects.toMatchObject({ notReady: true });
    }
  });

  test('a host whose webSession bridge is missing is a quiet empty provider', async () => {
    global.window = { electron: {} };
    const resolver = instantiate(axe);
    await expect(resolver.getRecommendations({})).resolves.toEqual({ sections: [] });
    await expect(resolver.expandRecommendationSection(SECTION_ID, null, {})).resolves.toEqual({ items: [], nextCursor: null });
  });

  test('expandRecommendationSection maps the page and the offset cursor', async () => {
    homeMock({ seeMorePage: async () => amazonSeeMoreData([albumItem('B07QYGJGVC', 'Sons of Northern Darkness', 'Immortal')], { hasNextPage: true, token: 'browse-home_mp3PrimeAlbumsStrategy.20' }) });
    const resolver = instantiate(axe);
    const page = await resolver.expandRecommendationSection(SECTION_ID, null, {});
    expect(page).toEqual({ items: [expect.objectContaining({ type: 'album', name: 'Sons of Northern Darkness' })], nextCursor: 'browse-home_mp3PrimeAlbumsStrategy.20' });
  });

  test('expandRecommendationSection: an exhausted section is empty, not an error', async () => {
    homeMock({ seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null }) });
    const resolver = instantiate(axe);
    await expect(resolver.expandRecommendationSection('uri:///x/aStrategy', 'aStrategy.20', {})).resolves.toEqual({ items: [], nextCursor: null });
  });

  test('expandRecommendationSection: an editorial shelf (no strategy, no see-more page) is at its end without loading anything', async () => {
    global.window = { electron: { amazonMusic: { expandRecommendationSection: jest.fn() } } };
    const resolver = instantiate(axe);
    for (const id of ['uri:///recommendations/browse-home/6a0d8250-d85c-42c0-868a-01dc91991473', 'uri:///recommendations/browse-home/GET_STARTED']) {
      await expect(resolver.expandRecommendationSection(id, null, {})).resolves.toEqual({ items: [], nextCursor: null });
    }
    expect(global.window.electron.amazonMusic.expandRecommendationSection).not.toHaveBeenCalled();
  });

  test('expandRecommendationSection: notReady on readiness failures, and unknown failure reasons are notReady too (never a cached miss)', async () => {
    homeMock({ signedIn: false });
    let resolver = instantiate(axe);
    await expect(resolver.expandRecommendationSection('uri:///x/aStrategy', null, {})).rejects.toMatchObject({ notReady: true, code: 'not-signed-in' });
    homeMock({ loadResult: { success: false, reason: 'weird-new-reason', error: 'x' } });
    resolver = instantiate(axe);
    // Any unmapped failure reason is notReady — a future reason string must not
    // silently become a miss the page caches.
    await expect(resolver.expandRecommendationSection('uri:///x/aStrategy', null, {})).rejects.toMatchObject({ notReady: true, code: 'weird-new-reason' });
  });
});

/**
 * Amazon Music resolver tests (parachord#988).
 *
 * Covers the .axe resolver surface:
 *   - structural validity (manifest/capabilities/implementation compile)
 *   - search result mapping (bridge -> resolver track shape)
 *   - resolve() containment matching (best match, not just first result)
 *   - play() not-signed-in flow (sign-in prompt + retry)
 *   - byte-identical FALLBACK_RESOLVERS copy in app.js (drift guard)
 *   - resolver-limiter does NOT skip amazonmusic (CDP fan-out + web search)
 */

const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/amazonmusic.axe'), 'utf8'));

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
  // Bind `this` the way resolver-loader.js does so this.search works inside resolve/play
  for (const key of Object.keys(implementation)) {
    const original = resolver[key];
    resolver[key] = function (...args) { return original.call(resolver, ...args); };
  }
  return resolver;
}

describe('amazonmusic .axe structure', () => {
  test('manifest identifies the resolver', () => {
    expect(axe.manifest.id).toBe('amazonmusic');
    expect(axe.manifest.version).toBe('1.4.2');
  });

  test('declares streaming capabilities without auth', () => {
    expect(axe.capabilities).toEqual(
      expect.objectContaining({ resolve: true, search: true, stream: true, urlLookup: true, mobile: false })
    );
    expect(axe.settings.requiresAuth).toBe(false);
    expect(axe.urlPatterns).toEqual(['music.amazon.com/playlists/*', 'music.amazon.com/my/playlists/*']);
  });

  test('implementation functions compile', () => {
    for (const [key, src] of Object.entries(axe.implementation)) {
      expect(() => new Function('return ' + src)()).not.toThrow();
      expect(typeof new Function('return ' + src)()).toBe('function');
    }
    expect(Object.keys(axe.implementation).sort()).toEqual(
      ['cleanup', 'init', 'lookupPlaylist', 'play', 'resolve', 'search'].sort()
    );
  });
});

describe('amazonmusic search', () => {
  let bridgeResults;

  beforeEach(() => {
    bridgeResults = {
      success: true,
      tracks: [
        { asin: 'B000SNWG5Q', uniqueId: 'ML-abc', title: 'Around the World', artist: 'Daft Punk', album: 'Homework', duration: 430, genre: 'Electronic', explicit: false },
        { asin: 'B07XLSKGGK', uniqueId: 'ML-def', title: 'Master of Puppets (Remastered)', artist: 'Metallica', album: 'Master of Puppets', duration: 515, genre: 'Metal', explicit: false }
      ]
    };
    global.window = {
      electron: {
        amazonMusic: {
          searchTracks: jest.fn().mockResolvedValue(bridgeResults),
          playTrack: jest.fn().mockResolvedValue({ success: true })
        }
      }
    };
  });

  afterEach(() => {
    delete global.window;
  });

  test('maps bridge tracks to the resolver track shape', async () => {
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
      amazonUniqueId: 'ML-abc',
      explicit: false
    }));
  });

  test('throws notReady when the player is not signed in so resolve does not cache noMatch', async () => {
    global.window.electron.amazonMusic.searchTracks.mockResolvedValue({
      success: false, reason: 'not-signed-in'
    });
    const resolver = instantiate(axe);
    await expect(resolver.search('anything', {})).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
  });

  test('throws notReady when the in-app player is not signed in', async () => {
    global.window.electron.amazonMusic.searchTracks.mockResolvedValue({
      success: false, reason: 'not-signed-in'
    });
    const resolver = instantiate(axe);
    await expect(resolver.resolve('Daft Punk', 'Around the World', null, {})).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
  });

  test('throws notReady when the page never loaded, so a stalled network is not cached as noMatch', async () => {
    global.window.electron.amazonMusic.searchTracks.mockResolvedValue({
      success: false, reason: 'load-failed', error: 'Amazon Music page did not finish loading within 30000ms'
    });
    const resolver = instantiate(axe);
    await expect(resolver.search('daft punk', {})).rejects.toMatchObject({
      notReady: true,
      code: 'load-failed'
    });
  });

  test('returns [] on short queries', async () => {
    const resolver = instantiate(axe);
    expect(await resolver.search('d', {})).toEqual([]);
    expect(global.window.electron.amazonMusic.searchTracks).not.toHaveBeenCalled();
  });
});

describe('amazonmusic resolve', () => {
  beforeEach(() => {
    global.window = {
      electron: {
        amazonMusic: {
          searchTracks: jest.fn().mockResolvedValue({
            success: true,
            tracks: [
              // Deliberately not the target first — resolve must pick by containment
              { asin: 'B1', uniqueId: 'ML-1', title: 'The Game of Love', artist: 'Daft Punk', album: 'RAM', duration: 322 },
              { asin: 'B2', uniqueId: 'ML-2', title: 'Around the World', artist: 'Daft Punk', album: 'Homework', duration: 430 },
              { asin: 'B3', uniqueId: 'ML-3', title: 'Around the World (Live)', artist: 'Some Cover Band', album: 'Covers', duration: 400 }
            ]
          })
        }
      }
    };
  });

  afterEach(() => {
    delete global.window;
  });

  test('picks the first containment match (artist AND title), not just the top hit', async () => {
    const resolver = instantiate(axe);
    const match = await resolver.resolve('Daft Punk', 'Around the World', null, {});
    expect(match).toBeTruthy();
    expect(match.amazonAsin).toBe('B2');
    expect(global.window.electron.amazonMusic.searchTracks).toHaveBeenCalledWith({
      title: 'Around the World',
      artist: 'Daft Punk'
    });
  });

  test('matches Cyrillic titles instead of stripping them to empty', async () => {
    global.window.electron.amazonMusic.searchTracks.mockResolvedValue({
      success: true,
      tracks: [
        { asin: 'B9', uniqueId: 'ML-9', title: 'На рахунок три', artist: 'Tember Blanche', album: 'На рахунок три', duration: 180 }
      ]
    });
    const resolver = instantiate(axe);
    const match = await resolver.resolve('Tember Blanche', 'На рахунок три', null, {});
    expect(match).toBeTruthy();
    expect(match.amazonAsin).toBe('B9');
  });

  test('falls back to null when nothing matches', async () => {
    global.window.electron.amazonMusic.searchTracks.mockResolvedValue({ success: true, tracks: [] });
    const resolver = instantiate(axe);
    expect(await resolver.resolve('Nobody', 'Nothing', null, {})).toBeNull();
  });
});

describe('amazonmusic play', () => {
  let managePrompt;

  beforeEach(() => {
    managePrompt = jest.fn().mockResolvedValue(true);
    global.window = {
      electron: {
        amazonMusic: {
          playTrack: jest.fn().mockResolvedValue({ success: true })
        }
      },
      __parachordManageAmazonMusic: managePrompt
    };
  });

  afterEach(() => {
    delete global.window;
  });

  test('plays by ASIN', async () => {
    const resolver = instantiate(axe);
    const ok = await resolver.play({ amazonAsin: 'B000SNWG5Q', title: 'Around the World', artist: 'Daft Punk' }, {});
    expect(ok).toBe(true);
    expect(global.window.electron.amazonMusic.playTrack).toHaveBeenCalledWith({
      asin: 'B000SNWG5Q', title: 'Around the World', artist: 'Daft Punk'
    });
  });

  test('not-signed-in triggers the sign-in prompt and retries once', async () => {
    global.window.electron.amazonMusic.playTrack
      .mockResolvedValueOnce({ success: false, reason: 'not-signed-in' })
      .mockResolvedValueOnce({ success: true });
    const resolver = instantiate(axe);
    const ok = await resolver.play({ amazonAsin: 'B1', title: 'T', artist: 'A' }, {});
    expect(ok).toBe(true);
    expect(managePrompt).toHaveBeenCalledTimes(1);
    expect(global.window.electron.amazonMusic.playTrack).toHaveBeenCalledTimes(2);
  });

  test('declined sign-in returns false without retrying', async () => {
    managePrompt.mockResolvedValue(false);
    global.window.electron.amazonMusic.playTrack.mockResolvedValue({ success: false, reason: 'not-signed-in' });
    const resolver = instantiate(axe);
    const ok = await resolver.play({ amazonAsin: 'B1', title: 'T', artist: 'A' }, {});
    expect(ok).toBe(false);
    expect(global.window.electron.amazonMusic.playTrack).toHaveBeenCalledTimes(1);
  });

  test('no ASIN on the track returns false', async () => {
    const resolver = instantiate(axe);
    expect(await resolver.play({ title: 'T', artist: 'A' }, {})).toBe(false);
    expect(global.window.electron.amazonMusic.playTrack).not.toHaveBeenCalled();
  });

  test('a page that never loaded fails the play without offering a sign-in prompt', async () => {
    // load-failed is a network condition (bounded loadURL): the account is not
    // the problem, so no manage prompt and no retry — the resolver falls
    // through to the next one in priority order.
    global.window.electron.amazonMusic.playTrack.mockResolvedValue({
      success: false, reason: 'load-failed', error: 'Amazon Music page did not finish loading within 30000ms'
    });
    const resolver = instantiate(axe);
    const ok = await resolver.play({ amazonAsin: 'B1', title: 'T', artist: 'A' }, {});
    expect(ok).toBe(false);
    expect(managePrompt).not.toHaveBeenCalled();
    expect(global.window.electron.amazonMusic.playTrack).toHaveBeenCalledTimes(1);
  });
});

describe('amazonmusic lookupPlaylist', () => {
  const playlistUrl = 'https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A';

  const bridgePlaylist = {
    success: true,
    engine: 'web',
    playlist: {
      id: 'PP6417A00A9C99470BBC8834FF3BF6009A',
      name: 'Alexa Chill',
      owner: null,
      albumArt: 'https://m.media-amazon.com/images/I/71Yr0gqZPpL._SX500_SY500_.jpg',
      tracks: [
        { asin: 'B000SNWG5Q', title: 'Around the World', artist: 'Daft Punk', album: 'Homework', duration: 430, albumAsin: 'B000031W1M' },
        { asin: 'B07XLSKGGK', title: 'Master of Puppets (Remastered)', artist: 'Metallica', album: 'Master of Puppets', duration: 515, albumAsin: null }
      ]
    }
  };

  beforeEach(() => {
    global.window = {
      electron: {
        amazonMusic: {
          lookupPlaylist: jest.fn().mockResolvedValue(bridgePlaylist)
        }
      }
    };
  });

  afterEach(() => {
    delete global.window;
  });

  test('maps bridge tracks to the resolver playlist shape', async () => {
    const resolver = instantiate(axe);
    const playlist = await resolver.lookupPlaylist(playlistUrl, {});
    expect(playlist).toEqual(expect.objectContaining({
      id: 'amazonmusic-playlist-PP6417A00A9C99470BBC8834FF3BF6009A',
      name: 'Alexa Chill',
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
    expect(global.window.electron.amazonMusic.lookupPlaylist).toHaveBeenCalledWith(playlistUrl);
  });

  describe('not signed in', () => {
    let managePrompt;

    const makeResolver = () => {
      managePrompt = jest.fn().mockResolvedValue(true);
      global.window.__parachordManageAmazonMusic = managePrompt;
      return instantiate(axe);
    };

    test('prompts for sign-in and retries once, like play()', async () => {
      const resolver = makeResolver();
      global.window.electron.amazonMusic.lookupPlaylist
        .mockResolvedValueOnce({ success: false, reason: 'not-signed-in' })
        .mockResolvedValueOnce(bridgePlaylist);
      const playlist = await resolver.lookupPlaylist(playlistUrl, {});
      expect(playlist.trackCount).toBe(2);
      expect(managePrompt).toHaveBeenCalledTimes(1);
      expect(global.window.electron.amazonMusic.lookupPlaylist).toHaveBeenCalledTimes(2);
    });

    test('declined sign-in throws notReady so the import is not reported as a missing playlist', async () => {
      const resolver = makeResolver();
      managePrompt.mockResolvedValue(false);
      global.window.electron.amazonMusic.lookupPlaylist.mockResolvedValue({
        success: false, reason: 'not-signed-in'
      });
      await expect(resolver.lookupPlaylist(playlistUrl, {})).rejects.toMatchObject({
        notReady: true,
        code: 'not-signed-in'
      });
      expect(global.window.electron.amazonMusic.lookupPlaylist).toHaveBeenCalledTimes(1);
    });
  });

  test('a playlist that never loaded is a not-found, not an empty import', async () => {
    // The gql replay never fires for a deleted/private playlist -> main returns
    // success with playlist: null.
    global.window.electron.amazonMusic.lookupPlaylist.mockResolvedValue({
      success: true, playlist: null
    });
    const resolver = instantiate(axe);
    await expect(resolver.lookupPlaylist(playlistUrl, {})).rejects.toThrow(/not found on Amazon Music/);
  });

  test('a bridge error surfaces its message', async () => {
    global.window.electron.amazonMusic.lookupPlaylist.mockResolvedValue({
      success: false, reason: 'lookup-failed', error: 'Amazon playlist query failed (403)'
    });
    const resolver = instantiate(axe);
    await expect(resolver.lookupPlaylist(playlistUrl, {})).rejects.toThrow(/403/);
  });

  test('a server-truncated import keeps the playlist\'s own trackCount instead of looking complete', async () => {
    global.window.electron.amazonMusic.lookupPlaylist.mockResolvedValue({
      success: true,
      engine: 'web',
      playlist: {
        id: 'PP6417A00A9C99470BBC8834FF3BF6009A',
        name: 'Alexa Chill',
        owner: null,
        albumArt: null,
        trackCount: 7,
        tracks: bridgePlaylist.playlist.tracks
      }
    });
    const resolver = instantiate(axe);
    const playlist = await resolver.lookupPlaylist(playlistUrl, {});
    expect(playlist.trackCount).toBe(7);
    expect(playlist.tracks).toHaveLength(2);
  });

  test('a page that never loaded is not reported as a missing playlist', async () => {
    // load-failed means the import never got to ask Amazon (offline, captive
    // portal, stalled load) — 'Playlist not found' would be a lie. The manage
    // function is installed to prove it is also NOT offered a sign-in prompt.
    const managePrompt = jest.fn().mockResolvedValue(true);
    global.window.__parachordManageAmazonMusic = managePrompt;
    global.window.electron.amazonMusic.lookupPlaylist.mockResolvedValue({
      success: false, reason: 'load-failed', error: 'Amazon Music page did not finish loading within 30000ms'
    });
    const resolver = instantiate(axe);
    await expect(resolver.lookupPlaylist(playlistUrl, {})).rejects.toMatchObject({
      notReady: true,
      code: 'load-failed'
    });
    expect(managePrompt).not.toHaveBeenCalled();
    expect(global.window.electron.amazonMusic.lookupPlaylist).toHaveBeenCalledTimes(1);
  });

  test('a missing CDM never offers the sign-in prompt — importing needs no CDM', async () => {
    const managePrompt = jest.fn().mockResolvedValue(true);
    global.window.__parachordManageAmazonMusic = managePrompt;
    global.window.electron.amazonMusic.lookupPlaylist.mockResolvedValue({
      success: false, reason: 'no-cdm', error: 'This Parachord build has no Widevine CDM'
    });
    const resolver = instantiate(axe);
    await expect(resolver.lookupPlaylist(playlistUrl, {})).rejects.toMatchObject({
      notReady: true,
      code: 'no-cdm'
    });
    expect(managePrompt).not.toHaveBeenCalled();
    expect(global.window.electron.amazonMusic.lookupPlaylist).toHaveBeenCalledTimes(1);
  });

  test('a bridge rejection surfaces as null, not a throw', async () => {
    global.window.electron.amazonMusic.lookupPlaylist.mockRejectedValue(new Error('ipc broke'));
    const resolver = instantiate(axe);
    await expect(resolver.lookupPlaylist(playlistUrl, {})).resolves.toBeNull();
  });
});

describe('app.js FALLBACK_RESOLVERS parity', () => {
  test('the inline amazonmusic fallback is byte-identical to plugins/amazonmusic.axe', () => {
    const appSrc = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
    const m = appSrc.match(/\{"manifest":\{"id":"amazonmusic"[\s\S]*?\}\},\n/);
    expect(m).toBeTruthy();
    const fallback = JSON.parse(m[0].replace(/,\n$/, ''));
    expect(fallback).toEqual(axe);
  });

  test('amazonmusic is in the canonical resolver order', () => {
    const appSrc = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
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
  });

  test('track pages do not match the playlist patterns (the resolver has no lookupUrl)', () => {
    const l = loader();
    expect(l.findResolverForUrl('https://music.amazon.com/tracks/B000SNWG5Q')).toBeNull();
    expect(l.getUrlType('https://music.amazon.com/tracks/B000SNWG5Q')).toBe('track');
    expect(l.getUrlType('https://music.amazon.com/albums/B000031W1M')).toBe('album');
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

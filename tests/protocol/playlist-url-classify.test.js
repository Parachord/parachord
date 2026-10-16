/**
 * parachord://play/playlist?url=<provider-url> routing classification
 * (parachord#930). Covers the five test URLs from the issue plus edge cases.
 * The orchestrator (resolveProviderPlaylistUrl in app.js) does the actual
 * fetching/resolver-sniffing; this verifies the pure routing DECISION only.
 */

const { classifyPlaylistUrl, isProviderPlaylistUrl, isProviderImportedPlaylist } = require('../helpers/playlist-url-classify');

describe('classifyPlaylistUrl', () => {
  describe('Achordion → public XSPF endpoint', () => {
    test('playlist page maps to /api/playlist/<mbid>/xspf', () => {
      expect(classifyPlaylistUrl(
        'https://achordion.xyz/playlist/c2accebd-ccd1-42c6-8ce7-ec0e8cf6cd13'
      )).toEqual({
        kind: 'achordion',
        xspfUrl: 'https://achordion.xyz/api/playlist/c2accebd-ccd1-42c6-8ce7-ec0e8cf6cd13/xspf',
      });
    });

    test('www. host is accepted', () => {
      expect(classifyPlaylistUrl(
        'https://www.achordion.xyz/playlist/c2accebd-ccd1-42c6-8ce7-ec0e8cf6cd13'
      ).kind).toBe('achordion');
    });

    test('uppercase MBID is lowercased in the API URL', () => {
      expect(classifyPlaylistUrl(
        'https://achordion.xyz/playlist/C2ACCEBD-CCD1-42C6-8CE7-EC0E8CF6CD13'
      ).xspfUrl).toBe('https://achordion.xyz/api/playlist/c2accebd-ccd1-42c6-8ce7-ec0e8cf6cd13/xspf');
    });

    test('trailing slash is tolerated', () => {
      expect(classifyPlaylistUrl(
        'https://achordion.xyz/playlist/c2accebd-ccd1-42c6-8ce7-ec0e8cf6cd13/'
      ).kind).toBe('achordion');
    });

    test('non-UUID achordion path falls back to standard (not a playlist mbid)', () => {
      expect(classifyPlaylistUrl('https://achordion.xyz/playlist/not-a-uuid')).toEqual({ kind: 'standard' });
      expect(classifyPlaylistUrl('https://achordion.xyz/about')).toEqual({ kind: 'standard' });
    });

    test('an extra path segment after the mbid is not treated as a playlist page', () => {
      expect(classifyPlaylistUrl(
        'https://achordion.xyz/playlist/c2accebd-ccd1-42c6-8ce7-ec0e8cf6cd13/extra'
      )).toEqual({ kind: 'standard' });
    });
  });

  describe('SoundCloud short link → redirect-follow', () => {
    test('on.soundcloud.com is flagged for redirect resolution', () => {
      expect(classifyPlaylistUrl('https://on.soundcloud.com/Drk2sCLhCHVNugYtAP'))
        .toEqual({ kind: 'soundcloud-short' });
    });
  });

  describe('standard (resolver lookupPlaylist, else tracklist document)', () => {
    test('Spotify playlist page', () => {
      expect(classifyPlaylistUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'))
        .toEqual({ kind: 'standard' });
    });
    test('Apple Music playlist page', () => {
      expect(classifyPlaylistUrl(
        'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb'
      )).toEqual({ kind: 'standard' });
    });
    test('SoundCloud canonical set URL', () => {
      expect(classifyPlaylistUrl('https://soundcloud.com/jherskowitz/sets/frozen-in-time-2026'))
        .toEqual({ kind: 'standard' });
    });
    test('hosted XSPF document URL', () => {
      expect(classifyPlaylistUrl('https://example.com/my-playlist.xspf'))
        .toEqual({ kind: 'standard' });
    });
    test('a non-short soundcloud subdomain is NOT treated as a short link', () => {
      // Only on.soundcloud.com is the short-link host; api/m/etc. are not.
      expect(classifyPlaylistUrl('https://m.soundcloud.com/jherskowitz/sets/x'))
        .toEqual({ kind: 'standard' });
    });
    test('malformed URL is safe (falls back to standard, no throw)', () => {
      expect(classifyPlaylistUrl('not a url')).toEqual({ kind: 'standard' });
      expect(classifyPlaylistUrl('')).toEqual({ kind: 'standard' });
      expect(classifyPlaylistUrl(undefined)).toEqual({ kind: 'standard' });
    });
  });
});

describe('isProviderPlaylistUrl', () => {
  // The loader stub answers dispatch for a fixed URL set — resolver-loader's
  // own tests cover pattern matching; these pin the reload/poller decision.
  const providerPlaylistUrls = [
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    'https://music.apple.com/us/playlist/discovery-mix/pl.u-abc123',
    'https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A',
    'https://music.amazon.com/my/playlists/PP6417A00A9C99470BBC8834FF3BF6009A',
    'https://soundcloud.com/jherskowitz/sets/frozen-in-time-2026'
  ];
  const loader = {
    findResolverForUrl: (url) => (providerPlaylistUrls.includes(url) ? 'someResolver' : null),
    getUrlType: (url) => (providerPlaylistUrls.includes(url) ? 'playlist' : 'unknown')
  };

  test('provider playlist pages are provider URLs, not hosted documents', () => {
    for (const url of providerPlaylistUrls) {
      expect(isProviderPlaylistUrl(url, loader)).toBe(true);
    }
  });

  test('hosted tracklist documents are not provider URLs (stay reloadable/pollable)', () => {
    expect(isProviderPlaylistUrl('https://achordion.xyz/api/playlist/c2accebd-ccd1-42c6-8ce7-ec0e8cf6cd13/xspf', loader)).toBe(false);
    expect(isProviderPlaylistUrl('https://example.com/my-playlist.xspf', loader)).toBe(false);
    expect(isProviderPlaylistUrl('https://cdn.example.com/weekly.json', loader)).toBe(false);
  });

  test('a resolver URL that is not a playlist page is not a provider playlist', () => {
    const trackLoader = {
      findResolverForUrl: () => 'spotify',
      getUrlType: () => 'track'
    };
    expect(isProviderPlaylistUrl('https://open.spotify.com/track/xyz', trackLoader)).toBe(false);
  });

  test('no loader (resolvers still loading) or no url is not a provider URL', () => {
    expect(isProviderPlaylistUrl('https://music.amazon.com/playlists/PP1', null)).toBe(false);
    expect(isProviderPlaylistUrl(null, loader)).toBe(false);
    expect(isProviderPlaylistUrl('', loader)).toBe(false);
  });

  test('a throwing loader reads as not-a-provider-URL, never a crash', () => {
    const hostile = {
      findResolverForUrl: () => { throw new Error('boom'); },
      getUrlType: () => 'playlist'
    };
    expect(isProviderPlaylistUrl('https://x.example/p', hostile)).toBe(false);
    const hostileType = {
      findResolverForUrl: () => 'spotify',
      getUrlType: () => { throw new Error('boom'); }
    };
    expect(isProviderPlaylistUrl('https://open.spotify.com/playlist/x', hostileType)).toBe(false);
  });
});

describe('isProviderImportedPlaylist', () => {
  const loader = {
    findResolverForUrl: () => 'amazonmusic',
    getUrlType: () => 'playlist'
  };

  test('the source suffix marks a provider import even when resolvers are not loaded', () => {
    expect(isProviderImportedPlaylist({
      sourceUrl: 'https://music.amazon.com/playlists/PP1',
      source: 'amazonmusic-import'
    }, null)).toBe(true);
  });

  test('a hosted XSPF is not a provider import', () => {
    const hostedLoader = {
      findResolverForUrl: () => null,
      getUrlType: () => 'unknown'
    };
    expect(isProviderImportedPlaylist({
      sourceUrl: 'https://example.com/weekly.xspf',
      source: 'hosted-xspf'
    }, hostedLoader)).toBe(false);
  });

  test('loader classification covers a provider URL whose source suffix was lost', () => {
    expect(isProviderImportedPlaylist({
      sourceUrl: 'https://music.amazon.com/playlists/PP1',
      source: ''
    }, loader)).toBe(true);
  });

  test('no url is not a provider import', () => {
    expect(isProviderImportedPlaylist({ source: 'amazonmusic-import' }, loader)).toBe(false);
    expect(isProviderImportedPlaylist(null, loader)).toBe(false);
  });
});

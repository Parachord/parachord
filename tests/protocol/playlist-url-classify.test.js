/**
 * parachord://play/playlist?url=<provider-url> routing classification
 * (parachord#930). Covers the five test URLs from the issue plus edge cases.
 * The orchestrator (resolveProviderPlaylistUrl in app.js) does the actual
 * fetching/resolver-sniffing; this verifies the pure routing DECISION only.
 */

const { classifyPlaylistUrl } = require('../helpers/playlist-url-classify');

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

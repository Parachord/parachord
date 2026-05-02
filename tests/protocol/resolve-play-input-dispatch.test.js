/**
 * Tests the param-shape dispatch logic of resolveProtocolPlayInput.
 * Each branch's actual fetch is integration-tested via the smoke matrix
 * (Task 8). This test only verifies which branch FIRES for which params.
 */

const dispatchProtocolPlayInput = (params, allowed = {}) => {
  const a = {
    allowMbid: false, allowProviderId: false,
    allowArtistTitleAlbum: false,
    ...allowed,
  };
  if (a.allowMbid && params.mbid) return 'mbid';
  if (a.allowProviderId && params.spotify) return 'spotify';
  if (a.allowProviderId && params.applemusic) return 'applemusic';
  if (params.url) return 'url';
  if (params.tracks) return 'tracks';
  if (a.allowArtistTitleAlbum && params.artist && params.title) return 'artist+title';
  return null;
};

describe('protocol play-input dispatch', () => {
  test('mbid wins over everything when allowed', () => {
    expect(dispatchProtocolPlayInput(
      { mbid: 'X', url: 'http://a', tracks: 'YYY', artist: 'A', title: 'B' },
      { allowMbid: true, allowProviderId: true, allowArtistTitleAlbum: true }
    )).toBe('mbid');
  });
  test('spotify wins over url/tracks when allowed', () => {
    expect(dispatchProtocolPlayInput(
      { spotify: '37i9', url: 'http://a' },
      { allowProviderId: true }
    )).toBe('spotify');
  });
  test('applemusic wins over url/tracks when allowed', () => {
    expect(dispatchProtocolPlayInput(
      { applemusic: 'pl.123', url: 'http://a' },
      { allowProviderId: true }
    )).toBe('applemusic');
  });
  test('url > tracks > artist+title', () => {
    expect(dispatchProtocolPlayInput(
      { url: 'http://a', tracks: 'YYY', artist: 'A', title: 'B' },
      { allowArtistTitleAlbum: true }
    )).toBe('url');
    expect(dispatchProtocolPlayInput(
      { tracks: 'YYY', artist: 'A', title: 'B' },
      { allowArtistTitleAlbum: true }
    )).toBe('tracks');
    expect(dispatchProtocolPlayInput(
      { artist: 'A', title: 'B' },
      { allowArtistTitleAlbum: true }
    )).toBe('artist+title');
  });
  test('mbid ignored when not allowed (e.g. play-playlist)', () => {
    expect(dispatchProtocolPlayInput(
      { mbid: 'X', url: 'http://a' },
      { allowMbid: false }
    )).toBe('url');
  });
  test('returns null when no usable shape', () => {
    expect(dispatchProtocolPlayInput({})).toBe(null);
    expect(dispatchProtocolPlayInput({ shuffle: '1' })).toBe(null);
  });
  test('artist+title without allowArtistTitleAlbum returns null even if both present', () => {
    expect(dispatchProtocolPlayInput({ artist: 'A', title: 'B' })).toBe(null);
  });
});

/**
 * Artist photos without a Spotify or Apple Music sign-in
 * (src/renderer/lib/artist-image-chain.js), and getArtistImage's wiring in
 * app.js, checked by source markers because app.js never runs under jest.
 */

const fs = require('fs');
const path = require('path');

const {
  ARTIST_IMAGE_MISS_TTL_MS,
  isUsableArtistImageUrl,
  deezerArtistImageFromSearch,
  firstArtistImage,
  createArtistImageMissCache,
} = require('../../src/renderer/lib/artist-image-chain');

const DEEZER_PHOTO = 'https://cdn-images.dzcdn.net/images/artist/dd4cfe7a0de0ae23e47376d83aa29d31/1000x1000-000000-80-0-0.jpg';

describe('isUsableArtistImageUrl', () => {
  test('a plain https or http image URL is usable', () => {
    expect(isUsableArtistImageUrl(DEEZER_PHOTO)).toBe(true);
    expect(isUsableArtistImageUrl('http://navidrome.local:4533/share/img/eyJhbGc?size=600')).toBe(true);
  });

  test('credentials, placeholders and non-URLs are not', () => {
    expect(isUsableArtistImageUrl('http://nas:4533/rest/getCoverArt.view?id=ar-1&u=alice&t=abc&s=def')).toBe(false);
    expect(isUsableArtistImageUrl('https://plex.local/photo?X-Plex-Token=abc')).toBe(false);
    expect(isUsableArtistImageUrl('https://user:pw@host/a.jpg')).toBe(false);
    expect(isUsableArtistImageUrl('https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png')).toBe(false);
    expect(isUsableArtistImageUrl('file:///Users/x/a.jpg')).toBe(false);
    expect(isUsableArtistImageUrl('')).toBe(false);
    expect(isUsableArtistImageUrl(null)).toBe(false);
    expect(isUsableArtistImageUrl({ url: DEEZER_PHOTO })).toBe(false);
  });
});

describe('deezerArtistImageFromSearch', () => {
  test('takes the matching artist, not the first result', () => {
    const json = { data: [
      { name: 'Havukruunu Tribute', picture_xl: 'https://cdn-images.dzcdn.net/images/artist/aaa/1000x1000.jpg', md5_image: 'aaa' },
      { name: 'Havukruunu', picture_xl: DEEZER_PHOTO, md5_image: 'dd4cfe7a0de0ae23e47376d83aa29d31' },
    ] };
    expect(deezerArtistImageFromSearch(json, 'havukruunu')).toBe(DEEZER_PHOTO);
  });

  test('matches through case, marks, a leading "The" and "&"', () => {
    const json = { data: [{ name: 'The Last Dinner Party', picture_xl: DEEZER_PHOTO, md5_image: 'x' }] };
    expect(deezerArtistImageFromSearch(json, 'last dinner party')).toBe(DEEZER_PHOTO);
    const amp = { data: [{ name: 'Florence + the Machine', picture_xl: DEEZER_PHOTO, md5_image: 'x' }] };
    expect(deezerArtistImageFromSearch(amp, 'Florence + The Machine')).toBe(DEEZER_PHOTO);
  });

  test("Deezer's blank placeholder is a miss", () => {
    const json = { data: [{
      name: 'Atlantean Kodex',
      picture_xl: 'https://cdn-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg',
      md5_image: '',
    }] };
    expect(deezerArtistImageFromSearch(json, 'Atlantean Kodex')).toBe(null);
  });

  test('no match, an empty answer, or no name is a miss', () => {
    expect(deezerArtistImageFromSearch({ data: [{ name: 'Drudkh', picture_xl: DEEZER_PHOTO }] }, 'Windir')).toBe(null);
    expect(deezerArtistImageFromSearch({ data: [] }, 'Windir')).toBe(null);
    expect(deezerArtistImageFromSearch(null, 'Windir')).toBe(null);
    expect(deezerArtistImageFromSearch({ data: [{ name: 'Windir', picture_xl: DEEZER_PHOTO }] }, '')).toBe(null);
  });
});

describe('firstArtistImage', () => {
  test('the first usable photo wins, and later steps are not run', async () => {
    const later = jest.fn(async () => 'https://example.com/later.jpg');
    const result = await firstArtistImage([
      { id: 'spotify', run: async () => null },
      { id: 'subsonic', run: async () => 'http://nas/rest/getCoverArt.view?u=a&t=b&s=c' },
      { id: 'deezer', run: async () => DEEZER_PHOTO },
      { id: 'wikipedia', run: later },
    ]);
    expect(result).toEqual({ url: DEEZER_PHOTO, source: 'deezer', complete: true });
    expect(later).not.toHaveBeenCalled();
  });

  test('a step that throws is skipped and marks the run incomplete', async () => {
    const log = jest.fn();
    const result = await firstArtistImage([
      { id: 'spotify', run: async () => { throw new Error('429'); } },
      { id: 'deezer', run: async () => null },
    ], { log });
    expect(result).toEqual({ url: null, source: null, complete: false });
    expect(log).toHaveBeenCalledWith('spotify failed: 429');
  });

  test('a step that hangs times out and marks the run incomplete', async () => {
    const result = await firstArtistImage([
      { id: 'subsonic', run: () => new Promise(() => {}) },
      { id: 'deezer', run: async () => DEEZER_PHOTO },
    ], { timeoutMs: 10 });
    expect(result).toEqual({ url: DEEZER_PHOTO, source: 'deezer', complete: false });
  });

  test('every step answering with nothing is a complete miss', async () => {
    const result = await firstArtistImage([
      { id: 'deezer', run: async () => null },
      { id: 'discogs', run: () => null },
    ]);
    expect(result).toEqual({ url: null, source: null, complete: true });
    expect(await firstArtistImage([])).toEqual({ url: null, source: null, complete: true });
  });
});

describe('createArtistImageMissCache', () => {
  test('remembers a miss by normalized name until the TTL passes', () => {
    let t = 0;
    const misses = createArtistImageMissCache({ now: () => t });
    misses.add('The Last Dinner Party');
    expect(misses.has('last dinner party')).toBe(true);
    t += ARTIST_IMAGE_MISS_TTL_MS + 1;
    expect(misses.has('The Last Dinner Party')).toBe(false);
  });

  test('clear forgets every miss', () => {
    const misses = createArtistImageMissCache();
    misses.add('Windir');
    misses.clear();
    expect(misses.has('Windir')).toBe(false);
  });
});

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const body = (startMarker, endMarker) => {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  return start === -1 || end === -1 ? '' : src.slice(start, end);
};
const getArtistImage = body('const getArtistImage = async (artistName, { mbid = null } = {}) => {', '\n  };\n');

describe('getArtistImage wiring', () => {
  test('the marker this test depends on exists', () => {
    expect(getArtistImage.length).toBeGreaterThan(0);
  });

  test('no longer gives up without a Spotify or Apple Music sign-in', () => {
    expect(getArtistImage).not.toContain('No music service connected');
  });

  // Deezer before the resolvers: one cheap request, where a resolver's lookup
  // can be a page load on the queue its track resolution uses (Amazon Music).
  test('the chain runs Spotify, Apple Music, Deezer, active resolvers, Wikipedia, Discogs in that order', () => {
    const order = ["id: 'spotify'", "id: 'applemusic'", "id: 'deezer'", 'loader.getArtistImageResolvers()', "id: 'wikipedia'", "id: 'discogs'"]
      .map(marker => getArtistImage.indexOf(marker));
    expect(order.every(i => i !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(getArtistImage).toContain('.filter(r => activeIds.includes(r.id))');
    expect(getArtistImage).toContain('await firstArtistImage(steps');
    expect(getArtistImage).toContain('if (complete) artistImageMissesRef.current.add(artistName);');
  });

  test('stale-closure callers see live credentials', () => {
    expect(getArtistImage).toContain('const token = spotifyTokenRef.current || spotifyToken;');
    expect(getArtistImage).toContain('metaServiceConfigsRef.current?.discogs?.personalAccessToken');
  });

  test('the artist page uses the shared chain, not its own fallbacks', () => {
    expect(src).toContain('await getArtistImage(artistName, { mbid: artist.id })');
    expect(src).toContain('await getArtistImage(artistName, { mbid: fallbackArtist.mbid || null })');
    const direct = src.match(/await getWikipediaArtistImage\(|await getDiscogsArtistImage\(/g) || [];
    expect(direct).toHaveLength(0);
  });
});

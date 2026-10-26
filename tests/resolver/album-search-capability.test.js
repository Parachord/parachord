/**
 * The album-search plugin contract (capabilities.albumSearch; see
 * docs/architecture/plugins.md, "searchAlbums"): a plugin that declares it
 * implements searchAlbums and lookupAlbum, and every url searchAlbums returns
 * is one its own lookupAlbum accepts. The album pages use it when MusicBrainz
 * can't supply a track list (src/renderer/lib/album-catalog.js).
 *
 * Subsonic's pair is tested in subsonic-resolver.test.js.
 */

const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');

const PLUGINS_SRC = path.join(__dirname, '../../plugins-src');
const loadAxe = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins', `${id}.axe`), 'utf8'));

function instantiate(axe) {
  const { manifest, capabilities, implementation } = axe;
  const resolver = {
    id: manifest.id,
    name: manifest.name,
    capabilities,
    ...Object.fromEntries(Object.entries(implementation).map(([k, src]) => [k, new Function('return ' + src)()])),
  };
  for (const key of Object.keys(implementation)) {
    const original = resolver[key];
    resolver[key] = function (...args) { return original.call(resolver, ...args); };
  }
  return resolver;
}

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body) });

afterEach(() => {
  delete global.window;
  delete global.fetch;
});

describe('contract', () => {
  const ids = fs.readdirSync(PLUGINS_SRC).filter(id => fs.existsSync(path.join(PLUGINS_SRC, id, 'manifest.json')));
  const declaring = ids.filter(id => require(path.join(PLUGINS_SRC, id, 'manifest.json')).capabilities?.albumSearch);

  test('the album-search plugins are the ones this change covers', () => {
    expect(declaring.sort()).toEqual(['amazonmusic', 'applemusic', 'bandcamp', 'localfiles', 'spotify', 'subsonic']);
  });

  test.each(declaring)('%s implements both searchAlbums and lookupAlbum', (id) => {
    const impl = require(path.join(PLUGINS_SRC, id, 'implementation.js'));
    expect(typeof impl.searchAlbums).toBe('function');
    expect(typeof impl.lookupAlbum).toBe('function');
  });
});

describe('Apple Music', () => {
  const axe = loadAxe('applemusic');
  const ITUNES_ALBUM = {
    collectionId: 1755555555,
    collectionName: 'Dulling the Horns',
    artistName: 'Wild Pink',
    collectionViewUrl: 'https://music.apple.com/us/album/dulling-the-horns/1755555555?uo=4',
    artworkUrl100: 'https://is1.mzstatic.com/x/100x100bb.jpg',
    releaseDate: '2024-10-04T07:00:00Z',
    trackCount: 10,
  };

  test('searchAlbums uses the public iTunes album search, no sign-in', async () => {
    const urls = [];
    global.window = { iTunesRateLimiter: { fetch: async (u) => { urls.push(u); return json({ results: [ITUNES_ALBUM] }); } } };
    const albums = await instantiate(axe).searchAlbums({ artist: 'Wild Pink', title: 'Dulling the Horns' }, {});
    expect(urls[0]).toContain('entity=album');
    expect(urls[0]).toContain('term=Wild%20Pink%20Dulling%20the%20Horns');
    expect(albums).toEqual([{
      id: 'applemusic-album-1755555555',
      name: 'Dulling the Horns',
      artist: 'Wild Pink',
      albumArt: 'https://is1.mzstatic.com/x/500x500bb.jpg',
      releaseDate: '2024-10-04T07:00:00Z',
      trackCount: 10,
      url: ITUNES_ALBUM.collectionViewUrl,
    }]);
    // the url is one lookupAlbum accepts
    expect(/\/album\/[^/]+\/(\d+)/.test(albums[0].url)).toBe(true);
  });

  test('a miss on artist + title retries with the artist alone', async () => {
    const urls = [];
    global.window = { iTunesRateLimiter: { fetch: async (u) => { urls.push(u); return json({ results: urls.length === 1 ? [] : [ITUNES_ALBUM] }); } } };
    const albums = await instantiate(axe).searchAlbums({ artist: 'Wild Pink', title: 'Dulling the Horns' }, {});
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('term=Wild%20Pink&');
    expect(albums).toHaveLength(1);
  });

  test('a failed request is a miss, not an error', async () => {
    global.window = { iTunesRateLimiter: { fetch: async () => json({}, false) } };
    expect(await instantiate(axe).searchAlbums('anything here', {})).toEqual([]);
  });
});

describe('Spotify', () => {
  const axe = loadAxe('spotify');

  test('no token: no albums, no request', async () => {
    global.fetch = jest.fn();
    expect(await instantiate(axe).searchAlbums({ artist: 'A', title: 'B' }, {})).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('searchAlbums uses an album:/artist: query and returns open.spotify.com urls', async () => {
    global.fetch = jest.fn(async () => json({
      albums: { items: [{ id: 'abc123', name: 'Dulling the Horns', artists: [{ name: 'Wild Pink' }], images: [{ url: 'https://i.scdn.co/a' }], release_date: '2024-10-04', total_tracks: 10, external_urls: { spotify: 'https://open.spotify.com/album/abc123' } }] },
    }));
    const albums = await instantiate(axe).searchAlbums({ artist: 'Wild Pink', title: 'Dulling the Horns' }, { token: 't' });
    const url = global.fetch.mock.calls[0][0];
    expect(decodeURIComponent(url)).toContain('album:"Dulling the Horns" artist:"Wild Pink"');
    expect(url).toContain('type=album');
    expect(albums[0]).toMatchObject({ id: 'spotify-album-abc123', name: 'Dulling the Horns', artist: 'Wild Pink', url: 'https://open.spotify.com/album/abc123' });
  });

  test('an expired token is refreshed once', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => (++n === 1 ? { ok: false, status: 401 } : json({ albums: { items: [] } })));
    const refreshToken = jest.fn(async () => 'fresh');
    await instantiate(axe).searchAlbums('wild pink', { token: 'stale', refreshToken });
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh');
  });
});

describe('Bandcamp', () => {
  const axe = loadAxe('bandcamp');

  test('searchAlbums asks the search API for albums and keeps album pages only', async () => {
    global.fetch = jest.fn(async () => json({
      auto: { results: [
        { type: 'a', id: 2223875750, name: 'Still Coming Down', band_name: 'Wild Pink', item_url_path: 'https://wildpink.bandcamp.com/album/still-coming-down', img: 'https://f4.bcbits.com/img/0153084467_3.jpg' },
        { type: 't', id: 1, name: 'A track', band_name: 'Wild Pink', item_url_path: 'https://wildpink.bandcamp.com/track/a-track' },
      ] },
    }));
    const albums = await instantiate(axe).searchAlbums({ artist: 'Wild Pink', title: 'Still Coming Down' }, {});
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).search_filter).toBe('a');
    expect(albums).toEqual([{
      id: 'bandcamp-album-2223875750',
      name: 'Still Coming Down',
      artist: 'Wild Pink',
      albumArt: 'https://f4.bcbits.com/img/0153084467_10.jpg',
      releaseDate: null,
      trackCount: null,
      url: 'https://wildpink.bandcamp.com/album/still-coming-down',
    }]);
  });

  test('falls back to the autocomplete endpoint, albums only', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => (++n === 1
      ? json({}, false)
      : json({ results: [
        { type: 'a', name: 'Still Coming Down', band_name: 'Wild Pink', url: 'https://wildpink.bandcamp.comhttps://wildpink.bandcamp.com/album/still-coming-down' },
        { type: 'b', name: 'Wild Pink', url: 'https://wildpink.bandcamp.com' },
      ] })));
    const albums = await instantiate(axe).searchAlbums('wild pink still coming down', {});
    expect(albums.map(a => a.url)).toEqual(['https://wildpink.bandcamp.com/album/still-coming-down']);
  });
});

describe('Local Files', () => {
  const axe = loadAxe('localfiles');

  test('searchAlbums matches on the album name and returns localfiles: urls', async () => {
    const searchAlbums = jest.fn(async () => [{ album: 'Amnesiac', albumArtist: 'Radiohead', year: 2001, trackCount: 11 }]);
    global.window = { electron: { localFiles: { searchAlbums } } };
    const albums = await instantiate(axe).searchAlbums({ artist: 'Radiohead', title: 'Amnesiac' }, {});
    expect(searchAlbums).toHaveBeenCalledWith('Amnesiac');
    expect(albums[0]).toMatchObject({ name: 'Amnesiac', artist: 'Radiohead', trackCount: 11, url: 'localfiles:album:Radiohead/Amnesiac' });
  });

  test('lookupAlbum round-trips the url, including slashes in names', async () => {
    const getAlbumTracks = jest.fn(async () => [
      { id: 'local-1', title: 'One', artist: 'AC/DC', album: 'High Voltage / Live', duration: 200, filePath: '/m/1.mp3', trackNumber: 1, discNumber: 1, year: 1976, albumArt: 'file:///art.jpg', sources: { localfiles: { fileUrl: 'file:///m/1.mp3' } } },
    ]);
    const searchAlbums = jest.fn(async () => [{ album: 'High Voltage / Live', albumArtist: 'AC/DC', year: 1976, trackCount: 1 }]);
    global.window = { electron: { localFiles: { searchAlbums, getAlbumTracks } } };
    const r = instantiate(axe);
    const [found] = await r.searchAlbums({ artist: 'AC/DC', title: 'High Voltage' }, {});
    const album = await r.lookupAlbum(found.url, {});
    expect(getAlbumTracks).toHaveBeenCalledWith({ album: 'High Voltage / Live', albumArtist: 'AC/DC' });
    expect(album).toMatchObject({ name: 'High Voltage / Live', artist: 'AC/DC', albumArt: 'file:///art.jpg', releaseDate: '1976', trackCount: 1 });
    expect(album.tracks[0]).toMatchObject({ title: 'One', fileUrl: 'file:///m/1.mp3', trackNumber: 1 });
  });

  test('no bridge: no albums', async () => {
    global.window = {};
    expect(await instantiate(axe).searchAlbums('x y', {})).toEqual([]);
    expect(await instantiate(axe).lookupAlbum('localfiles:album:a/b', {})).toBe(null);
  });
});

describe('ResolverLoader album search', () => {
  const loaderWith = async (ids) => {
    const loader = new ResolverLoader();
    await loader.loadResolvers(ids.map(loadAxe));
    return loader;
  };

  test('getAlbumSearchResolvers lists only plugins that declare and implement it', async () => {
    const loader = await loaderWith(['applemusic', 'youtube', 'localfiles']);
    expect(loader.getAlbumSearchResolvers().map(r => r.id).sort()).toEqual(['applemusic', 'localfiles']);
  });

  test('searchAlbums drops results without a name or url, and a throw is a miss', async () => {
    const loader = await loaderWith(['localfiles']);
    const r = loader.getResolver('localfiles');
    r.searchAlbums = async () => [{ name: 'A', url: 'localfiles:album:x/A' }, { name: 'No url' }, null];
    expect(await loader.searchAlbums('localfiles', 'a b')).toEqual([{ name: 'A', url: 'localfiles:album:x/A' }]);
    r.searchAlbums = async () => { throw new Error('boom'); };
    expect(await loader.searchAlbums('localfiles', 'a b')).toEqual([]);
    expect(await loader.searchAlbums('youtube', 'a b')).toEqual([]);
  });

  test('lookupAlbumFrom calls the resolver that found the album, not URL routing', async () => {
    const loader = await loaderWith(['localfiles']);
    const r = loader.getResolver('localfiles');
    r.lookupAlbum = jest.fn(async () => ({ name: 'A', tracks: [{ title: 't' }] }));
    const found = await loader.lookupAlbumFrom('localfiles', 'localfiles:album:x/A', { k: 1 });
    expect(found).toEqual({ album: { name: 'A', tracks: [{ title: 't' }] }, resolverId: 'localfiles' });
    expect(r.lookupAlbum).toHaveBeenCalledWith('localfiles:album:x/A', { k: 1 });
    // an album with no tracks is no album
    r.lookupAlbum = async () => ({ name: 'A', tracks: [] });
    expect(await loader.lookupAlbumFrom('localfiles', 'localfiles:album:x/A')).toBe(null);
  });
});

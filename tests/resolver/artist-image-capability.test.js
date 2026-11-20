/**
 * The artist-image plugin contract (capabilities.artistImage; see
 * docs/architecture/plugins.md, "searchArtistImage"): ResolverLoader lists
 * the plugins that declare and implement it, and searchArtistImage turns a
 * non-string into a miss and passes a throw on (a failure is not a miss). getArtistImage asks the user's active
 * ones (src/renderer/lib/artist-image-chain.js).
 *
 * Subsonic's implementation is tested in subsonic-resolver.test.js,
 * Amazon Music's in amazon-music-resolver.test.js.
 */

const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');

const loadAxe = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins', `${id}.axe`), 'utf8'));

describe('ResolverLoader artist images', () => {
  const loaderWith = async (ids) => {
    const loader = new ResolverLoader();
    await loader.loadResolvers(ids.map(loadAxe));
    return loader;
  };

  test('getArtistImageResolvers lists only plugins that declare and implement it', async () => {
    const loader = await loaderWith(['subsonic', 'amazonmusic', 'bandcamp', 'youtube']);
    expect(loader.getArtistImageResolvers().map(r => r.id).sort()).toEqual(['amazonmusic', 'subsonic']);
  });

  test('searchArtistImage passes the config through; a non-string is a miss, a throw is passed on', async () => {
    const loader = await loaderWith(['subsonic', 'youtube']);
    const r = loader.getResolver('subsonic');
    r.searchArtistImage = jest.fn(async () => 'https://example.com/a.jpg');
    expect(await loader.searchArtistImage('subsonic', 'Radiohead', { k: 1 })).toBe('https://example.com/a.jpg');
    expect(r.searchArtistImage).toHaveBeenCalledWith('Radiohead', { k: 1 });
    r.searchArtistImage = async () => ({ url: 'https://example.com/a.jpg' });
    expect(await loader.searchArtistImage('subsonic', 'Radiohead')).toBe(null);
    // A failure is not a miss: the photo chain must see it, or it remembers
    // "no photo" for 6 hours after one outage (#1358).
    r.searchArtistImage = async () => { throw new Error('boom'); };
    await expect(loader.searchArtistImage('subsonic', 'Radiohead')).rejects.toThrow('boom');
    expect(await loader.searchArtistImage('subsonic', '')).toBe(null);
    expect(await loader.searchArtistImage('youtube', 'Radiohead')).toBe(null);
  });
});

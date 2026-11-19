// Similar artists and tracks from every plug-in that names them (#1539):
// which plug-ins are asked, in what order, what counts as a failure, and how
// the answers merge.

const fs = require('fs');
const path = require('path');
const {
  similarProviders,
  askEach,
  firstAnswer,
  mergeSimilarArtists,
  mergeSimilarTracks,
  sourcesIn,
} = require('../../src/renderer/lib/similar-music');
const ResolverLoader = require('../../resolver-loader');

const fakeLoader = (resolvers) => ({
  getSimilarArtistsResolvers: () => resolvers.filter((r) => r.capabilities.similarArtists),
  getSimilarTracksResolvers: () => resolvers.filter((r) => r.capabilities.similarTracks),
  getArtistTopTracksResolvers: () => resolvers.filter((r) => r.capabilities.artistTopTracks),
});

describe('similarProviders', () => {
  const loader = fakeLoader([
    { id: 'lastfm', capabilities: { similarArtists: true, similarTracks: true, artistTopTracks: true } },
    { id: 'listenbrainz', capabilities: { similarArtists: true, artistTopTracks: true } },
    { id: 'spotify', capabilities: { similarArtists: true } },
    { id: 'stray', capabilities: { similarArtists: true } },
  ]);
  const base = { activeIds: ['spotify'], order: ['spotify', 'listenbrainz', 'lastfm'], metaIds: ['lastfm', 'listenbrainz'] };

  test('active plug-ins and meta-services, in the user’s order', () => {
    const ids = similarProviders(loader, 'similarArtists', base).map((r) => r.id);
    // The inactive content plug-in is left out; active ones lead.
    expect(ids).toEqual(['spotify', 'listenbrainz', 'lastfm']);
  });

  test('a plug-in switched off is left out', () => {
    const ids = similarProviders(loader, 'similarArtists', { ...base, isOff: (id) => id === 'lastfm' }).map((r) => r.id);
    expect(ids).toEqual(['spotify', 'listenbrainz']);
  });

  test('by capability', () => {
    expect(similarProviders(loader, 'similarTracks', base).map((r) => r.id)).toEqual(['lastfm']);
    expect(similarProviders(loader, 'artistTopTracks', base).map((r) => r.id)).toEqual(['listenbrainz', 'lastfm']);
    expect(similarProviders(loader, 'nope', base)).toEqual([]);
    expect(similarProviders(null, 'similarArtists', base)).toEqual([]);
  });
});

describe('askEach', () => {
  const providers = [{ id: 'a' }, { id: 'b' }];

  test('one failing plug-in leaves the others’ answers', async () => {
    const out = await askEach(providers, async (p) => {
      if (p.id === 'a') throw new Error('refused');
      return [{ name: 'X' }];
    });
    expect(out).toEqual({ answers: [{ id: 'b', items: [{ name: 'X' }] }], failed: false });
  });

  test('an empty answer is an answer, not a failure', async () => {
    const out = await askEach(providers, async () => []);
    expect(out.failed).toBe(false);
    expect(out.answers).toHaveLength(2);
  });

  test('failed when none answered, or there was nobody to ask', async () => {
    expect((await askEach(providers, async () => { throw new Error('down'); })).failed).toBe(true);
    expect(await askEach([], async () => [])).toEqual({ answers: [], failed: true });
  });

  test('a synchronous throw is a failure too', async () => {
    const out = await askEach([{ id: 'a' }], () => { throw new Error('boom'); });
    expect(out.failed).toBe(true);
  });
});

describe('firstAnswer', () => {
  test('the first plug-in with any items wins; lists are never merged', () => {
    const lists = [
      { id: 'listenbrainz', items: [] },
      { id: 'lastfm', items: [{ title: 'Creep' }] },
      { id: 'other', items: [{ title: 'Nude' }] },
    ];
    expect(firstAnswer(lists)).toEqual({ id: 'lastfm', items: [{ title: 'Creep' }] });
    expect(firstAnswer([{ id: 'a', items: [] }])).toBeNull();
    expect(firstAnswer(undefined)).toBeNull();
  });
});

describe('mergeSimilarArtists', () => {
  test('one entry per name: the higher match, the first mbid, every source', () => {
    const merged = mergeSimilarArtists([
      { id: 'lastfm', items: [{ name: 'Muse', match: 80, url: 'u' }, { name: 'Thom Yorke', match: 60 }] },
      { id: 'listenbrainz', items: [{ name: 'muse ', match: 95, mbid: 'm-1' }, { name: 'Nirvana', match: 100, mbid: 'n' }] },
    ]);
    expect(merged).toEqual([
      { name: 'Muse', mbid: 'm-1', url: 'u', match: 95, sources: ['lastfm', 'listenbrainz'] },
      { name: 'Thom Yorke', mbid: undefined, url: undefined, match: 60, sources: ['lastfm'] },
      { name: 'Nirvana', mbid: 'n', url: undefined, match: 100, sources: ['listenbrainz'] },
    ]);
    expect(sourcesIn(merged)).toEqual(['lastfm', 'listenbrainz']);
  });

  test('skips rows without a name', () => {
    expect(mergeSimilarArtists([{ id: 'a', items: [null, { name: '' }, { match: 3 }] }])).toEqual([]);
  });
});

describe('mergeSimilarTracks', () => {
  test('one entry per artist and title, matched loosely', () => {
    const merged = mergeSimilarTracks([
      { id: 'a', items: [{ artist: 'Radiohead', title: 'Karma Police', match: 40 }] },
      { id: 'b', items: [{ artist: 'radiohead', title: 'Karma Police ', match: 70, mbid: 'r' }, { artist: 'Muse', title: 'Uprising', match: 10 }] },
    ]);
    expect(merged).toEqual([
      { artist: 'Radiohead', title: 'Karma Police', mbid: 'r', match: 70, sources: ['a', 'b'] },
      { artist: 'Muse', title: 'Uprising', mbid: undefined, match: 10, sources: ['b'] },
    ]);
  });
});

describe('resolver-loader', () => {
  const loader = new ResolverLoader();
  const register = (id, capabilities, impl) => loader.resolvers.set(id, { id, capabilities, config: { saved: true }, ...impl });

  beforeEach(() => loader.resolvers.clear());

  test('lists plug-ins by capability and method', () => {
    register('a', { similarArtists: true }, { getSimilarArtists: async () => [] });
    register('b', { similarArtists: true }, {}); // an older install without the method
    register('c', { similarTracks: true }, { getSimilarTracks: async () => [] });
    expect(loader.getSimilarArtistsResolvers().map((r) => r.id)).toEqual(['a']);
    expect(loader.getSimilarTracksResolvers().map((r) => r.id)).toEqual(['c']);
  });

  test('passes the query and config, drops nameless rows', async () => {
    const seen = [];
    register('a', { similarArtists: true }, {
      getSimilarArtists: async (q, config) => { seen.push([q, config]); return [{ name: 'Muse' }, { name: ' ' }, null]; },
    });
    await expect(loader.getSimilarArtists('a', { name: 'Radiohead', limit: 3 }, { apiKey: 'k' })).resolves.toEqual([{ name: 'Muse' }]);
    expect(seen).toEqual([[{ name: 'Radiohead', limit: 3 }, { apiKey: 'k' }]]);
  });

  test('a plug-in that throws rejects, never answers []', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    register('a', { similarTracks: true }, { getSimilarTracks: async () => { throw new Error('refused'); } });
    await expect(loader.getSimilarTracks('a', { artist: 'A', title: 'B' })).rejects.toThrow('refused');
    spy.mockRestore();
  });

  test('artist top tracks: by capability and method, dropping untitled rows, rejecting on a throw', async () => {
    register('a', { artistTopTracks: true }, { getArtistTopTracks: async (q) => [{ title: 'Creep', artist: q.name }, { title: ' ' }, null] });
    register('b', { artistTopTracks: true }, {});
    register('c', { artistTopTracks: true }, { getArtistTopTracks: async () => { throw new Error('refused'); } });
    expect(loader.getArtistTopTracksResolvers().map((r) => r.id)).toEqual(['a', 'c']);
    await expect(loader.getArtistTopTracks('a', { name: 'Radiohead' })).resolves.toEqual([{ title: 'Creep', artist: 'Radiohead' }]);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loader.getArtistTopTracks('c', { name: 'Radiohead' })).rejects.toThrow('refused');
    spy.mockRestore();
    await expect(loader.getArtistTopTracks('b', { name: 'Radiohead' })).resolves.toEqual([]);
  });

  test('a missing plug-in or capability answers []', async () => {
    register('a', {}, { getSimilarTracks: async () => [{ artist: 'A', title: 'B' }] });
    await expect(loader.getSimilarTracks('a', {})).resolves.toEqual([]);
    await expect(loader.getSimilarArtists('nope', {})).resolves.toEqual([]);
  });
});

describe('no similar-music call by service name in the renderer', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '../../src/renderer', ...p), 'utf8');

  test('app.js and spinoff-pool.js ask the plug-ins', () => {
    for (const src of [read('app.js'), read('lib', 'spinoff-pool.js'), read('hooks', 'use-playback-engine.js')]) {
      expect(src).not.toMatch(/method=(artist|track)\.getsimilar|['"](artist|track)\.getsimilar['"]|labs\.api\.listenbrainz\.org\/similar-artists/);
      expect(src).not.toMatch(/method=artist\.gettoptracks|top-recordings-for-artist/);
    }
    const app = read('app.js');
    expect(app).not.toMatch(/getLastfmSimilarArtists|getListenBrainzSimilarArtists/);
    expect(app).toMatch(/similarProviders\(resolverLoaderRef\.current, capability/);
    expect(app).toMatch(/askEach\(similarProvidersFor\('artistTopTracks'\)/);
  });

  test('the meta-service load gate includes both capabilities', () => {
    const app = read('app.js');
    expect(app.match(/axe\.capabilities\?\.similarArtists && axe\.implementation\?\.getSimilarArtists/g)).toHaveLength(2);
    expect(app.match(/axe\.capabilities\?\.similarTracks && axe\.implementation\?\.getSimilarTracks/g)).toHaveLength(2);
    expect(app.match(/axe\.capabilities\?\.artistTopTracks && axe\.implementation\?\.getArtistTopTracks/g)).toHaveLength(2);
  });
});

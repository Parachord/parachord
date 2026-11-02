/**
 * Search's request budget, counted against a fake fetch (the same approach as
 * page-load-budget.test.js for album and artist pages): what one query costs
 * MusicBrainz and ListenBrainz. MusicBrainz starts one request every 1.1s, so
 * an extra MusicBrainz request is another second before its rows show.
 *
 *   MusicBrainz ............ 3 per query: artists, albums (release groups), songs (recordings)
 *   ListenBrainz ........... at most 1 per category (albums, songs), capped at 800ms,
 *                            0 for ids answered in the last day
 *   your services .......... asked at the same moment as MusicBrainz, not after it
 *   a superseded query ..... its requests carry the query's abort signal, so the
 *                            MusicBrainz queue drops them unsent (limiter-abort.test.js)
 */

const {
  preprocessQuery, searchMusicBrainzArtists, searchMusicBrainzAlbums, searchMusicBrainzTracks, createPopularityLookup,
} = require('../../src/renderer/lib/search-requests');
const { ARTIST_POPULARITY_REFERENCE_LISTENS } = require('../../src/renderer/lib/search-catalog');

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const MBID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function recordingFetch(route) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return route(url, init); };
  return { fetch, calls };
}

describe('MusicBrainz: 3 requests per query', () => {
  const route = (url) => {
    if (url.includes('/artist?')) return response(200, { artists: [{ id: 'a1', name: 'Portishead' }, { id: 'a2', name: 'portishead' }] });
    if (url.includes('/release-group?')) return response(200, { 'release-groups': [
      { id: 'r1', title: 'Dummy', 'artist-credit': [{ name: 'Portishead' }] },
      { id: 'r2', title: 'dummy', 'artist-credit': [{ name: 'portishead' }] },
    ] });
    if (url.includes('/recording?')) return response(200, { recordings: [
      { id: 'rec1', title: 'Roads', score: 100, length: 305000, 'artist-credit': [{ name: 'Portishead', artist: { id: 'a1' } }], releases: [{ id: 'rel1', title: 'Dummy', 'release-group': { id: 'r1' } }] },
    ] });
    return response(500, {});
  };

  test('one request each, all carrying the query\'s abort signal', async () => {
    const { fetch, calls } = recordingFetch(route);
    const signal = new AbortController().signal;
    const fetchOptions = { headers: {}, signal };
    await Promise.all([
      searchMusicBrainzArtists('portishead roads', { fetch, fetchOptions }),
      searchMusicBrainzAlbums('portishead roads', { fetch, fetchOptions }),
      searchMusicBrainzTracks('portishead roads', { fetch, fetchOptions }),
    ]);
    expect(calls).toHaveLength(3);
    expect(calls.map(c => c.url.match(/ws\/2\/([a-z-]+)\?/)[1]).sort()).toEqual(['artist', 'recording', 'release-group']);
    expect(calls.every(c => c.init.signal === signal)).toBe(true);
  });

  test('rows: artists and albums deduped, songs mapped with their MBIDs', async () => {
    const { fetch } = recordingFetch(route);
    const opts = { fetch, fetchOptions: {} };
    expect((await searchMusicBrainzArtists('portishead', opts)).rows.map(a => a.id)).toEqual(['a1']);
    expect((await searchMusicBrainzAlbums('dummy', opts)).rows.map(a => a.id)).toEqual(['r1']);
    const [track] = (await searchMusicBrainzTracks('roads', opts)).rows;
    expect(track).toMatchObject({ id: 'rec1', mbid: 'rec1', artist: 'Portishead', artistMbids: ['a1'], album: 'Dummy', releaseGroupId: 'r1', duration: 305, score: 100, _needsResolution: true });
  });

  test('field syntax maps to each endpoint\'s', () => {
    expect(preprocessQuery('album:dummy roads', 'release-group')).toBe('releasegroup:dummy roads');
    expect(preprocessQuery('album:dummy track:roads', 'recording')).toBe('release:dummy recording:roads');
    expect(preprocessQuery('portishead album:"dummy" song:roads', 'artist')).toBe('portishead');
  });

  test('an album search outage leaves the catalogs to answer; a superseded query stops', async () => {
    const down = await searchMusicBrainzAlbums('x', { fetch: async () => { throw new TypeError('Failed to fetch'); }, fetchOptions: {} });
    expect(down).toMatchObject({ ok: false, failed: true, rows: [] });
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(searchMusicBrainzAlbums('x', { fetch: async () => { throw abort; }, fetchOptions: {} })).rejects.toBe(abort);
  });
});

describe('ListenBrainz popularity: at most 1 request per category, capped', () => {
  const lb = (url, init) => {
    const body = JSON.parse(init.body);
    const ids = body.release_group_mbids || body.artist_mbids || [];
    const field = body.release_group_mbids ? 'release_group_mbid' : 'artist_mbid';
    return response(200, ids.map((id, i) => ({ [field]: id, total_listen_count: i === 0 ? null : 1000 * i })));
  };

  test('one POST for every row of a category, and none for rows answered today', async () => {
    const { fetch, calls } = recordingFetch(lb);
    const { fetchPopularity } = createPopularityLookup({ fetch });
    const ids = [MBID(1), MBID(2), MBID(3), MBID(2)];
    const first = await fetchPopularity('release-group', ids);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.listenbrainz.org/1/popularity/release-group');
    expect(JSON.parse(calls[0].init.body).release_group_mbids).toEqual([MBID(1), MBID(2), MBID(3)]); // deduped
    expect(first.has(MBID(1))).toBe(false); // null listens: no popularity
    expect(first.get(MBID(2))).toBeGreaterThan(0);
    await fetchPopularity('release-group', ids);
    expect(calls).toHaveLength(1); // the null was cached too
  });

  test('ids that aren\'t MBIDs cost nothing', async () => {
    const { fetch, calls } = recordingFetch(lb);
    const out = await createPopularityLookup({ fetch }).fetchPopularity('release-group', ['spotify-123', '', null]);
    expect(calls).toHaveLength(0);
    expect(out.size).toBe(0);
  });

  test('a slow ListenBrainz is cut off at the cap and leaves the rows without popularity', async () => {
    let aborted = false;
    const fetch = (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
    const started = Date.now();
    const out = await createPopularityLookup({ fetch }).fetchPopularity('artist', [MBID(1)], { timeoutMs: 50 });
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out.size).toBe(0);
  });

  test('a failed call isn\'t cached: the next search asks again', async () => {
    let n = 0;
    const fetch = async () => { n += 1; return response(503, {}); };
    const lookup = createPopularityLookup({ fetch });
    await lookup.fetchPopularity('artist', [MBID(1)]);
    await lookup.fetchPopularity('artist', [MBID(1)]);
    expect(n).toBe(2);
  });

  test('songs take their artist\'s popularity; the token rides along when there is one', async () => {
    const { fetch, calls } = recordingFetch(lb);
    const { withPopularity } = createPopularityLookup({ fetch, headersFor: () => ({ Authorization: 'Token t' }) });
    const rows = [{ id: 'rec1', artistMbids: [MBID(5)] }, { id: 'rec2', artistMbids: [MBID(6)] }, { id: 'rec3', artistMbids: [MBID(6)] }];
    const out = await withPopularity('artist', rows, { idOf: t => t.artistMbids[0], reference: ARTIST_POPULARITY_REFERENCE_LISTENS });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.Authorization).toBe('Token t');
    expect(JSON.parse(calls[0].init.body).artist_mbids).toEqual([MBID(5), MBID(6)]);
    expect(out[0]._popularity).toBeUndefined(); // MBID(5) answered null
    expect(out[1]._popularity).toBe(out[2]._popularity); // same artist
  });
});

describe('performSearch uses these, so the budget is the real one', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  const search = app.slice(app.indexOf('const performSearch = async (query) => {'), app.indexOf('\n  // Covers for search results'));

  test('the three MusicBrainz searches go through search-requests.js, and only once each', () => {
    for (const fn of ['searchMusicBrainzArtists', 'searchMusicBrainzAlbums', 'searchMusicBrainzTracks']) {
      expect(search.match(new RegExp(`await ${fn}\\(query, \\{ fetch, fetchOptions \\}\\)`, 'g'))).toHaveLength(1);
    }
    expect(search).not.toMatch(/musicbrainz\.org\/ws\/2/); // no second copy of the requests
  });

  test('your services are asked at the same moment as MusicBrainz, not after it', () => {
    // all four start before the one await that waits for them
    const waitAll = search.indexOf('await Promise.all([artistPromise, albumPromise, trackPromise, catalogPromise]);');
    expect(waitAll).toBeGreaterThan(-1);
    for (const start of ['const artistPromise = (async () => {', 'const albumPromise = (async () => {', 'const trackPromise = (async () => {', 'const catalogPromise = Promise.all([']) {
      const at = search.indexOf(start);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(waitAll);
    }
  });

  test('popularity is fetched once per category, before its rows show', () => {
    expect(search.match(/await withListenBrainzPopularity\(/g)).toHaveLength(2);
    expect(search.indexOf("await withListenBrainzPopularity('release-group'")).toBeLessThan(search.indexOf('publishAlbums();', search.indexOf('const albumPromise')));
    expect(search.indexOf("await withListenBrainzPopularity('artist'")).toBeLessThan(search.indexOf('publishTracks();', search.indexOf('const trackPromise')));
  });
});

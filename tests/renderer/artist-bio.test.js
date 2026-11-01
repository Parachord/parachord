/**
 * Artist bios: the Wikidata id comes from Wikidata itself first, so a
 * MusicBrainz outage no longer takes the Wikipedia bio down (parachord:
 * Wild Pink's Biography tab spun, then showed nothing, while MusicBrainz was
 * unreachable), and bios are remembered for the session.
 */

const {
  isMbid,
  wikidataSearchUrl,
  wikidataIdFromSearch,
  wikidataIdFromMbRelations,
  createWikidataIdLookup,
  createArtistBioCache,
} = require('../../src/renderer/lib/artist-bio');

const WILD_PINK = '94fdf751-0644-4b78-9e72-dbdce539b5b7';
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const notOk = (status) => ({ ok: false, status, json: async () => ({}) });
const searchHit = (id) => ({ query: { search: [{ title: id }] } });
const noHit = { query: { search: [] } };
const mbRels = (id) => ({ relations: [{ type: 'wikidata', url: { resource: `https://www.wikidata.org/wiki/${id}` } }] });

describe('Wikidata id parsing', () => {
  test('isMbid accepts only a UUID', () => {
    expect(isMbid(WILD_PINK)).toBe(true);
    expect(isMbid(WILD_PINK.toUpperCase())).toBe(true);
    expect(isMbid('Wild Pink')).toBe(false);
    expect(isMbid(`${WILD_PINK} OR haswbstatement:P31`)).toBe(false);
    expect(isMbid(null)).toBe(false);
  });

  test('the search url filters on P434 and nothing else', () => {
    const url = new URL(wikidataSearchUrl(WILD_PINK));
    expect(url.hostname).toBe('www.wikidata.org');
    expect(url.searchParams.get('srsearch')).toBe(`haswbstatement:P434=${WILD_PINK}`);
    expect(url.searchParams.get('origin')).toBe('*');
    expect(wikidataSearchUrl('not an mbid')).toBeNull();
  });

  test('reads the Q-id from a search hit, and only a Q-id', () => {
    expect(wikidataIdFromSearch(searchHit('Q25056425'))).toBe('Q25056425');
    expect(wikidataIdFromSearch(noHit)).toBeNull();
    expect(wikidataIdFromSearch(searchHit('Wild Pink'))).toBeNull();
    expect(wikidataIdFromSearch(null)).toBeNull();
  });

  test('reads the Q-id from MusicBrainz url-rels', () => {
    expect(wikidataIdFromMbRelations(mbRels('Q25056425'))).toBe('Q25056425');
    expect(wikidataIdFromMbRelations({ relations: [{ type: 'official homepage', url: { resource: 'https://x' } }] })).toBeNull();
    expect(wikidataIdFromMbRelations({})).toBeNull();
  });
});

describe('createWikidataIdLookup', () => {
  const makeFetch = (routes) => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, init });
      const host = new URL(url).hostname;
      const route = routes[host];
      if (!route) throw new TypeError('Failed to fetch');
      return route(url);
    };
    return { fetch, calls };
  };

  test('asks Wikidata first and never touches MusicBrainz on a hit', async () => {
    const { fetch, calls } = makeFetch({ 'www.wikidata.org': () => ok(searchHit('Q25056425')) });
    const lookup = createWikidataIdLookup({ fetch, userAgent: 'UA' });
    await expect(lookup(WILD_PINK)).resolves.toBe('Q25056425');
    expect(calls.map(c => new URL(c.url).hostname)).toEqual(['www.wikidata.org']);
  });

  test('works while MusicBrainz is unreachable', async () => {
    const { fetch } = makeFetch({
      'www.wikidata.org': () => ok(searchHit('Q25056425')),
      // musicbrainz.org has no route: every request throws, as in the outage
    });
    const lookup = createWikidataIdLookup({ fetch, userAgent: 'UA' });
    await expect(lookup(WILD_PINK)).resolves.toBe('Q25056425');
  });

  test('falls back to MusicBrainz url-rels when Wikidata has no P434 for the artist', async () => {
    const { fetch, calls } = makeFetch({
      'www.wikidata.org': () => ok(noHit),
      'musicbrainz.org': () => ok(mbRels('Q42')),
    });
    const lookup = createWikidataIdLookup({ fetch, userAgent: 'UA' });
    await expect(lookup(WILD_PINK)).resolves.toBe('Q42');
    expect(calls[1].url).toBe(`https://musicbrainz.org/ws/2/artist/${WILD_PINK}?inc=url-rels&fmt=json`);
    expect(calls[1].init.headers['User-Agent']).toBe('UA');
    // bios and photos are never what the user clicked for
    expect(calls[1].init.mbBackground).toBe(true);
  });

  test('falls back to MusicBrainz when Wikidata errors or is unreachable', async () => {
    for (const wikidata of [() => notOk(503), null]) {
      const routes = { 'musicbrainz.org': () => ok(mbRels('Q42')) };
      if (wikidata) routes['www.wikidata.org'] = wikidata;
      const { fetch } = makeFetch(routes);
      const lookup = createWikidataIdLookup({ fetch, userAgent: 'UA' });
      await expect(lookup(WILD_PINK)).resolves.toBe('Q42');
    }
  });

  test('null when neither source has it; a MusicBrainz network failure propagates', async () => {
    const both404 = makeFetch({ 'www.wikidata.org': () => ok(noHit), 'musicbrainz.org': () => notOk(404) });
    await expect(createWikidataIdLookup({ fetch: both404.fetch, userAgent: 'UA' })(WILD_PINK)).resolves.toBeNull();
    const mbDown = makeFetch({ 'www.wikidata.org': () => ok(noHit) });
    await expect(createWikidataIdLookup({ fetch: mbDown.fetch, userAgent: 'UA' })(WILD_PINK)).rejects.toThrow('Failed to fetch');
  });

  test('no request at all without a valid mbid', async () => {
    const { fetch, calls } = makeFetch({});
    const lookup = createWikidataIdLookup({ fetch, userAgent: 'UA' });
    await expect(lookup(null)).resolves.toBeNull();
    await expect(lookup('Wild Pink')).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('a found id is kept; concurrent lookups share one request; a miss is retried', async () => {
    let answer = noHit;
    const { fetch, calls } = makeFetch({ 'www.wikidata.org': () => ok(answer), 'musicbrainz.org': () => notOk(404) });
    const lookup = createWikidataIdLookup({ fetch, userAgent: 'UA' });
    await expect(lookup(WILD_PINK)).resolves.toBeNull();
    expect(calls).toHaveLength(2);

    answer = searchHit('Q25056425');
    const [a, b] = await Promise.all([lookup(WILD_PINK), lookup(WILD_PINK.toUpperCase())]);
    expect([a, b]).toEqual(['Q25056425', 'Q25056425']);
    expect(calls).toHaveLength(3);

    await lookup(WILD_PINK);
    expect(calls).toHaveLength(3);
  });
});

describe('createArtistBioCache', () => {
  const bio = { bio: 'Wild Pink is an American rock band.', source: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Wild_Pink' };

  test('a found bio is reused by the next caller (playbar, then artist page)', async () => {
    const cache = createArtistBioCache();
    const fetchBio = jest.fn(async () => bio);
    await expect(cache.load('Wild Pink', WILD_PINK, fetchBio)).resolves.toBe(bio);
    await expect(cache.load('wild pink ', WILD_PINK.toUpperCase(), fetchBio)).resolves.toBe(bio);
    expect(fetchBio).toHaveBeenCalledTimes(1);
  });

  test('concurrent callers share one fetch', async () => {
    const cache = createArtistBioCache();
    let release;
    const fetchBio = jest.fn(() => new Promise((r) => { release = () => r(bio); }));
    const a = cache.load('Wild Pink', WILD_PINK, fetchBio);
    const b = cache.load('Wild Pink', WILD_PINK, fetchBio);
    await Promise.resolve();
    release();
    await expect(Promise.all([a, b])).resolves.toEqual([bio, bio]);
    expect(fetchBio).toHaveBeenCalledTimes(1);
  });

  test('"no bio" is not kept, so a later try can succeed', async () => {
    const cache = createArtistBioCache();
    const fetchBio = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(bio);
    await expect(cache.load('Wild Pink', WILD_PINK, fetchBio)).resolves.toBeNull();
    await expect(cache.load('Wild Pink', WILD_PINK, fetchBio)).resolves.toBe(bio);
    expect(fetchBio).toHaveBeenCalledTimes(2);
  });

  test('a bio fetched without an mbid does not answer a request with one', async () => {
    const cache = createArtistBioCache();
    const lastfm = { bio: 'x'.repeat(60), source: 'lastfm' };
    const fetchBio = jest.fn(async (name, mbid) => (mbid ? bio : lastfm));
    await expect(cache.load('Wild Pink', null, fetchBio)).resolves.toBe(lastfm);
    await expect(cache.load('Wild Pink', WILD_PINK, fetchBio)).resolves.toBe(bio);
  });

  test('entries expire after the TTL, and the cache is bounded', async () => {
    let t = 0;
    const cache = createArtistBioCache({ now: () => t, ttlMs: 1000, maxEntries: 2 });
    const fetchBio = jest.fn(async (name) => ({ bio: name, source: 'lastfm' }));
    await cache.load('A', null, fetchBio);
    t = 1500;
    await cache.load('A', null, fetchBio);
    expect(fetchBio).toHaveBeenCalledTimes(2);
    await cache.load('B', null, fetchBio);
    await cache.load('C', null, fetchBio);
    expect(cache.size).toBe(2);
  });

  test('a fetch that throws rejects every waiter and is not kept', async () => {
    const cache = createArtistBioCache();
    const fetchBio = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(bio);
    await expect(cache.load('Wild Pink', WILD_PINK, fetchBio)).rejects.toThrow('boom');
    await expect(cache.load('Wild Pink', WILD_PINK, fetchBio)).resolves.toBe(bio);
  });

  test('no name, no fetch', async () => {
    const cache = createArtistBioCache();
    const fetchBio = jest.fn();
    await expect(cache.load('', WILD_PINK, fetchBio)).resolves.toBeNull();
    expect(fetchBio).not.toHaveBeenCalled();
  });
});

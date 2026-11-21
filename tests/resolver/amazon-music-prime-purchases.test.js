/**
 * Amazon Prime plays the tracks the account bought (#1494;
 * plugins-src/amazonmusic/implementation.js, "The bought tracks").
 *
 * On Prime, Amazon's search never says what the account owns; the library's
 * Purchased page (LibraryPurchasedPageQuery) does, so the plugin reads its
 * bought tracks from there and answers Prime searches from that list. The stream request's
 * gate is in amazon-music-plugin-drm.test.js ("the plan gate"); the host's
 * side, a Prime limit that keeps Amazon in playback, is in
 * tests/renderer/playback-limits.test.js.
 *
 * Pinned here:
 *   - the library parser keeps bought tracks only, by their catalog ASIN,
 *     and reads the continuation cursor; a response with no song connection
 *     is structural (envelope false), never "owns nothing"
 *   - the page walk follows pageInfo.token as afterCursor, dedupes, and
 *     stops when the same page comes back
 *   - matching: a resolve's artist and title either way round, a Search
 *     string by its words
 *   - search and resolve on Prime answer from the list (no catalog search);
 *     no bought match is not-ready, never a cached miss
 *   - the list is read once and reused, dropped on sign-out, and a read
 *     that a sign-out overtook never lands
 *   - getStatus on Prime: Amazon stays in playback (ownedOnly), with the
 *     purchases wording, and the read starts
 *   - on Music Unlimited nothing changes: the library is never read
 */

const {
  loadAmazonAxe,
  instantiateAmazonPlugin,
  amazonWebSessionMock,
  amazonLibraryPage,
  serveAmazonLibrary
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();
const lib = instantiateAmazonPlugin(axe).requireLib();

const PRIME_MESSAGE = "Amazon Prime: Parachord plays the songs you've bought from Amazon. Playing anything else from Amazon needs Music Unlimited.";

const BOUGHT_A = { asin: 'B000000001', title: 'Soulless', artist: 'Some Band', album: 'First Album' };
const BOUGHT_B = { asin: 'B000000002', title: 'Around the World', artist: 'Daft Punk', album: 'Homework' };
const LIKED_C = { asin: 'B000000003', title: 'One More Time', artist: 'Daft Punk', bought: false };

afterEach(() => {
  delete global.window;
});

describe('ownedTracksFromLibraryGql', () => {
  test('keeps bought tracks only, by catalog ASIN, with the next cursor', () => {
    const page = lib.ownedTracksFromLibraryGql(amazonLibraryPage([BOUGHT_A, LIKED_C, BOUGHT_B], { token: 'tok-2' }).data);
    expect(page.envelope).toBe(true);
    expect(page.tracks.map((t) => t.asin)).toEqual(['B000000001', 'B000000002']);
    expect(page.tracks[1]).toMatchObject({ title: 'Around the World', artist: 'Daft Punk', album: 'Homework', albumAsin: 'BALBUM0001', duration: 200 });
    expect(page.nextCursor).toBe('tok-2');
    expect(page.rawCount).toBe(3);
  });

  test('a node without a purchaseContext is not bought', () => {
    const data = amazonLibraryPage([BOUGHT_A]).data;
    delete data.user.purchased.edges[0].node.purchaseContext;
    expect(lib.ownedTracksFromLibraryGql(data).tracks).toEqual([]);
  });

  test('the ASIN comes from the url when the id is not one', () => {
    const data = amazonLibraryPage([BOUGHT_A]).data;
    data.user.purchased.edges[0].node.id = 'mrn:1.0:library:track:objectid:x';
    expect(lib.ownedTracksFromLibraryGql(data).tracks.map((t) => t.asin)).toEqual(['B000000001']);
  });

  test('hasNextPage false ends the walk even with a token', () => {
    const page = amazonLibraryPage([BOUGHT_A], { token: 'tok', hasNextPage: false });
    expect(lib.ownedTracksFromLibraryGql(page.data).nextCursor).toBeNull();
  });

  test('an empty library is an envelope with no tracks; an unrelated answer is not an envelope', () => {
    expect(lib.ownedTracksFromLibraryGql(amazonLibraryPage([]).data)).toMatchObject({ envelope: true, tracks: [] });
    expect(lib.ownedTracksFromLibraryGql({ somethingElse: { title: 'x' } }).envelope).toBe(false);
    expect(lib.ownedTracksFromLibraryGql(null).envelope).toBe(false);
  });
});

describe('paginateOwnedTracks', () => {
  test('follows the token as the cursor to the end, deduped by ASIN', async () => {
    const pages = {
      'tok-2': amazonLibraryPage([BOUGHT_B, { ...BOUGHT_A, cursor: 'c-again' }], { token: 'tok-3' }),
      'tok-3': amazonLibraryPage([{ asin: 'B000000004', title: 'Last', artist: 'Someone' }])
    };
    const asked = [];
    const out = await lib.paginateOwnedTracks({
      firstPageData: amazonLibraryPage([BOUGHT_A, LIKED_C], { token: 'tok-2' }).data,
      fetchPage: async (cursor) => { asked.push(cursor); return { data: pages[cursor].data }; }
    });
    expect(asked).toEqual(['tok-2', 'tok-3']);
    expect(out.tracks.map((t) => t.asin)).toEqual(['B000000001', 'B000000002', 'B000000004']);
    expect(out).toMatchObject({ pages: 3, stop: 'exhausted' });
  });

  test('the same page served again stops the walk', async () => {
    const first = amazonLibraryPage([BOUGHT_A], { token: 'tok-2' });
    const out = await lib.paginateOwnedTracks({
      firstPageData: first.data,
      fetchPage: async () => ({ data: first.data })
    });
    expect(out.stop).toBe('no-advance');
    expect(out.tracks.map((t) => t.asin)).toEqual(['B000000001']);
  });

  test('a failed page keeps what was read', async () => {
    const out = await lib.paginateOwnedTracks({
      firstPageData: amazonLibraryPage([BOUGHT_A], { token: 'tok-2' }).data,
      fetchPage: async () => ({ error: 'HTTP 500' })
    });
    expect(out).toMatchObject({ stop: 'page-error' });
    expect(out.tracks).toHaveLength(1);
  });

  test('the page cap holds whatever the cursor says', async () => {
    let n = 0;
    const out = await lib.paginateOwnedTracks({
      firstPageData: amazonLibraryPage([BOUGHT_A], { token: 'tok-0' }).data,
      fetchPage: async () => {
        n += 1;
        return { data: amazonLibraryPage([{ asin: `B10000000${n}`, title: `T${n}`, artist: 'A' }], { token: `tok-${n}` }).data };
      },
      maxPages: 3
    });
    expect(out).toMatchObject({ pages: 3, stop: 'page-limit' });
  });
});

describe('ownedTracksMatching', () => {
  const tracks = [
    { asin: '1', title: 'Soulless', artist: 'Some Band', album: 'First Album' },
    { asin: '2', title: 'Around the World', artist: 'Daft Punk', album: 'Homework' },
    { asin: '3', title: 'Café Song', artist: 'Beyoncé & Jay-Z', album: 'X' }
  ];

  test('a resolve matches artist and title, either way round, folded', () => {
    expect(lib.ownedTracksMatching(tracks, { artist: 'Daft Punk', title: 'Around the World (Radio Edit)' }).map((t) => t.asin)).toEqual(['2']);
    expect(lib.ownedTracksMatching(tracks, { artist: 'beyonce', title: 'cafe song' }).map((t) => t.asin)).toEqual(['3']);
    expect(lib.ownedTracksMatching(tracks, { artist: 'Daft Punk', title: 'Soulless' })).toEqual([]);
    expect(lib.ownedTracksMatching(tracks, {})).toEqual([]);
  });

  test('a Search string matches every word in the title, artist or album', () => {
    expect(lib.ownedTracksMatching(tracks, 'daft world').map((t) => t.asin)).toEqual(['2']);
    expect(lib.ownedTracksMatching(tracks, 'homework').map((t) => t.asin)).toEqual(['2']);
    expect(lib.ownedTracksMatching(tracks, 'daft soulless')).toEqual([]);
  });
});

// A Prime account with a library, through the plugin's own bridge calls.
function primeSession({ pages, tier = 'PRIME' } = {}) {
  const ws = amazonWebSessionMock({ tracks: [], tier });
  const replays = serveAmazonLibrary(ws, pages || {
    first: amazonLibraryPage([BOUGHT_A, LIKED_C], { token: 'tok-2' }),
    'tok-2': amazonLibraryPage([BOUGHT_B])
  });
  const libraryLoads = () => ws.load.mock.calls.filter(([, url]) => String(url).endsWith('/my/purchases'));
  const searchLoads = () => ws.load.mock.calls.filter(([, url]) => String(url).includes('/search/'));
  return { ws, replays, libraryLoads, searchLoads };
}

describe('search and resolve on Prime', () => {
  test('a resolve finds a bought track in the list, with no catalog search', async () => {
    const { replays, searchLoads } = primeSession();
    const resolver = instantiateAmazonPlugin(axe);
    const found = await resolver.resolve('Daft Punk', 'Around the World', null, {});
    expect(found).toMatchObject({ amazonAsin: 'B000000002', title: 'Around the World', artist: 'Daft Punk' });
    expect(searchLoads()).toHaveLength(0);
    // The walk asked for page 2 with the first page's token.
    expect(replays.map((b) => b.variables.afterCursor)).toEqual([undefined, 'tok-2']);
    expect(replays[1].variables).toMatchObject({ firstLimit: 50, isAuthenticated: true });
  });

  test('a track the account only liked, or never bought, is not-ready: never a cached miss', async () => {
    primeSession();
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.search({ artist: 'Daft Punk', title: 'One More Time' }, {})).rejects.toMatchObject({
      notReady: true, code: 'plan-ineligible'
    });
  });

  test('a Search-page string with no bought match is no rows', async () => {
    primeSession();
    const resolver = instantiateAmazonPlugin(axe);
    expect(await resolver.search('nothing like it', {})).toEqual([]);
    expect((await resolver.search('soulless', {})).map((r) => r.amazonAsin)).toEqual(['B000000001']);
  });

  test('the list is read once for many searches', async () => {
    const { libraryLoads } = primeSession();
    const resolver = instantiateAmazonPlugin(axe);
    await Promise.all([
      resolver.search('soulless', {}),
      resolver.search('daft', {}),
      resolver.search({ artist: 'Some Band', title: 'Soulless' }, {})
    ]);
    await resolver.search('homework', {});
    expect(libraryLoads()).toHaveLength(1);
  });

  test('a library page that never asks for its songs is not-ready, not "owns nothing"', async () => {
    const ws = amazonWebSessionMock({ tracks: [], tier: 'PRIME' });
    serveAmazonLibrary(ws, {}, { capture: null });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.search({ artist: 'Daft Punk', title: 'Around the World' }, {})).rejects.toMatchObject({
      notReady: true, code: 'not-ready'
    });
  });

  test('on Music Unlimited the library is never read', async () => {
    const { libraryLoads } = primeSession({ tier: 'UNLIMITED_HD' });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.search('daft punk', {});
    expect(libraryLoads()).toHaveLength(0);
  });
});

describe('the list and the session', () => {
  test('sign-out drops the list: the next account reads its own', async () => {
    const { libraryLoads } = primeSession();
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getOwnedTracks();
    resolver.dropSessionState();
    expect(resolver._ownedTracks).toBeNull();
    await resolver.getOwnedTracks();
    expect(libraryLoads()).toHaveLength(2);
  });

  test('a read a sign-out overtook never lands', async () => {
    primeSession();
    const resolver = instantiateAmazonPlugin(axe);
    const reading = resolver.getOwnedTracks();
    resolver.dropSessionState();
    await expect(reading).rejects.toMatchObject({ reason: 'superseded' });
    expect(resolver._ownedTracks).toBeNull();
  });

  test('a stale list is read again', async () => {
    const { libraryLoads } = primeSession();
    const resolver = instantiateAmazonPlugin(axe);
    const first = await resolver.getOwnedTracks();
    first.at -= lib.OWNED_TTL_MS + 1;
    await resolver.getOwnedTracks();
    expect(libraryLoads()).toHaveLength(2);
  });
});

describe('getStatus on Prime', () => {
  test('Amazon stays in playback for the bought tracks, and the read starts', async () => {
    const { libraryLoads } = primeSession();
    const resolver = instantiateAmazonPlugin(axe);
    const reply = await resolver.getStatus();
    expect(reply.playbackLimit).toEqual({
      blocked: false, ownedOnly: true, planKey: 'prime', label: 'Prime: purchases only', message: PRIME_MESSAGE, searchesHeldBack: true
    });
    expect(reply.statusMessage).toBe(PRIME_MESSAGE);
    await resolver._ownedPromise;
    expect(libraryLoads()).toHaveLength(1);
  });
});

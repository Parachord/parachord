/**
 * amazon-web-player.searchArtistImage wiring (the artistImage capability's
 * host half; docs/architecture/amazon-music.md, "Artist images"). The
 * parsers are pinned in amazon-music-logic.test.js and the .axe bridge
 * mapping in amazon-music-resolver.test.js — this file pins the arguments
 * the method hands to the shared spec-search runner: the artists tab URL,
 * the 'artist' spec (a flip to the default 'track' spec would only surface
 * as a structural-failure storm tripping the shared breaker), the staleness
 * check from #1135, and never-throw / null-without-a-request when not
 * signed in.
 *
 * The module is loaded with plain require: electron is pulled lazily behind
 * electron() inside the stubbed methods, so no electron mock is needed for
 * these calls. specSearch and isSignedIn are stubbed on the exported
 * singleton — both are looked up through `this` at call time.
 */

const amazonWebPlayer = require('../../amazon-web-player');

describe('amazonWebPlayer.searchArtistImage', () => {
  let specSearch;
  let isSignedIn;

  beforeEach(() => {
    specSearch = jest.spyOn(amazonWebPlayer, 'specSearch').mockResolvedValue([]);
    isSignedIn = jest.spyOn(amazonWebPlayer, 'isSignedIn').mockResolvedValue(true);
  });

  afterEach(() => {
    specSearch.mockRestore();
    isSignedIn.mockRestore();
  });

  test('rides the spec-search runner with the artists tab URL and the artist spec', async () => {
    await amazonWebPlayer.searchArtistImage('The Warning');
    expect(specSearch).toHaveBeenCalledTimes(1);
    const opts = specSearch.mock.calls[0][0];
    expect(opts.url).toBe('https://music.amazon.com/search/' + encodeURIComponent('"The Warning"') + '/artists');
    expect(opts.searchText).toBe('"The Warning"');
    expect(opts.specType).toBe('artist');
    expect(typeof opts.staleCheck).toBe('function');
    expect(typeof opts.parse).toBe('function');
  });

  test('the stale check carries the album-jobs budget (#1135): fresh at enqueue, stale past 8s', async () => {
    const now = 1_700_000_000_000;
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    await amazonWebPlayer.searchArtistImage('The Warning');
    const { staleCheck } = specSearch.mock.calls[0][0];
    expect(staleCheck()).toBe(false);
    dateSpy.mockReturnValue(now + 8001);
    expect(staleCheck()).toBe(true);
    dateSpy.mockRestore();
  });

  test('the parse callback maps a hit to a single url row and a miss to none', async () => {
    await amazonWebPlayer.searchArtistImage('The Warning');
    const { parse } = specSearch.mock.calls[0][0];
    const artist = {
      __typename: 'Artist',
      id: 'B00V07PBMY',
      name: 'The Warning',
      images: [
        { url: 'https://m.media-amazon.com/images/I/41mVLfnDeyL.jpg', width: 500, height: 500, imageType: 'PROFILE' },
        { url: 'https://m.media-amazon.com/images/I/71KKtoQJVeL.jpg', width: 1366, height: 1366, imageType: 'PROFILE' }
      ]
    };
    const hit = parse({ specificationSearch: { result: [{ edges: [{ node: artist }] }] } });
    expect(hit.envelope).toBe(true);
    expect(hit.rows).toEqual(['https://m.media-amazon.com/images/I/71KKtoQJVeL.jpg']);
    const miss = parse({ specificationSearch: { result: [{ edges: [] }] } });
    expect(miss).toEqual({ rows: [], envelope: true });
    // An absent envelope is structural (runner throws notReady, caught below).
    expect(parse({ somethingElse: {} }).envelope).toBe(false);
  });

  test('returns the first url row, or null on an empty result', async () => {
    specSearch.mockResolvedValue(['https://m.media-amazon.com/images/I/x.jpg']);
    expect(await amazonWebPlayer.searchArtistImage('The Warning')).toBe('https://m.media-amazon.com/images/I/x.jpg');
    specSearch.mockResolvedValue([]);
    expect(await amazonWebPlayer.searchArtistImage('The Warning')).toBeNull();
  });

  test('the runner throwing (structural, breaker) degrades to null, never rethrows', async () => {
    const err = new Error('Amazon search page never issued its artist search');
    err.reason = 'not-ready';
    specSearch.mockRejectedValue(err);
    await expect(amazonWebPlayer.searchArtistImage('The Warning')).resolves.toBeNull();
  });

  test('not signed in is null without any request', async () => {
    isSignedIn.mockResolvedValue(false);
    expect(await amazonWebPlayer.searchArtistImage('The Warning')).toBeNull();
    expect(specSearch).not.toHaveBeenCalled();
  });

  test('an empty name is null before even the sign-in check', async () => {
    expect(await amazonWebPlayer.searchArtistImage('')).toBeNull();
    expect(await amazonWebPlayer.searchArtistImage('   ')).toBeNull();
    expect(await amazonWebPlayer.searchArtistImage(null)).toBeNull();
    expect(isSignedIn).not.toHaveBeenCalled();
    expect(specSearch).not.toHaveBeenCalled();
  });

  test('a malformed (lone-surrogate) name is null without a request, not an exception', async () => {
    await expect(amazonWebPlayer.searchArtistImage('AC\uD83DDC')).resolves.toBeNull();
    expect(specSearch).not.toHaveBeenCalled();
  });
});

/**
 * Identity-parity fixtures for the legacy resolveTracks ID-minting paths
 * (parachord#911, mobile#289 audit).
 *
 *  P1 / D-Legacy-1 — the ungated `|| items[0]` no longer mints a wrong-song id:
 *    a wrong-artist same-title top hit must be DROPPED, not minted, on both
 *    Spotify and Apple Music. A real match still mints.
 *  P2 / D-Legacy-2 — Apple Music hydration tries an ISRC-exact catalog lookup
 *    first and is storefront-aware: a non-US-storefront ISRC lookup mints the
 *    storefront catalog id (matching what mobile mints) and uses the user's
 *    storefront, never a hardcoded 'us'.
 */

const spotify = require('../../sync-providers/spotify');
const applemusic = require('../../sync-providers/applemusic');
const { pickConfidentMatch } = require('../../sync-providers/confidence-scoring');

const AM_TOKEN = JSON.stringify({ developerToken: 'dev', userToken: 'usr' });

// Minimal Response stub honoring the bits the providers read.
function ok(bodyObj) {
  const text = JSON.stringify(bodyObj);
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => bodyObj, text: async () => text };
}

afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

describe('P1 — Spotify resolveTracks confidence gate (D-Legacy-1)', () => {
  test('wrong-artist same-title top hit is DROPPED, not minted', async () => {
    global.fetch = jest.fn(async () => ok({
      tracks: { items: [
        { name: 'Intro', artists: [{ name: 'Alt-J' }], uri: 'spotify:track:altj' },
      ] },
    }));
    const { resolved, unresolved } = await spotify.resolveTracks(
      [{ title: 'Intro', artist: 'The xx' }], 'tok'
    );
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual([{ artist: 'The xx', title: 'Intro' }]);
  });

  test('a correct match still mints (the right URI, not items[0])', async () => {
    global.fetch = jest.fn(async () => ok({
      tracks: { items: [
        { name: 'Intro', artists: [{ name: 'Alt-J' }], uri: 'spotify:track:altj' },
        { name: 'Intro', artists: [{ name: 'The xx' }], uri: 'spotify:track:thexx' },
      ] },
    }));
    const { resolved } = await spotify.resolveTracks(
      [{ title: 'Intro', artist: 'The xx' }], 'tok'
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].spotifyUri).toBe('spotify:track:thexx');
  });
});

describe('P1 — Apple Music resolveTracks confidence gate (D-Legacy-1)', () => {
  test('wrong-artist same-title top hit is DROPPED, not minted', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes('/me/storefront')) return ok({ data: [{ id: 'us' }] });
      if (url.includes('/search')) return ok({ results: { songs: { data: [
        { id: 'altj-id', attributes: { name: 'Intro', artistName: 'Alt-J' } },
      ] } } });
      return ok({ data: [] });
    });
    const { resolved, unresolved } = await applemusic.resolveTracks(
      [{ title: 'Intro', artist: 'The xx' }], AM_TOKEN
    );
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual([{ artist: 'The xx', title: 'Intro' }]);
  });
});

describe('P2 — Apple Music ISRC tier + storefront-awareness (D-Legacy-2)', () => {
  test('non-US-storefront ISRC lookup mints the storefront catalog id (matches mobile)', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      if (url.includes('/me/storefront')) return ok({ data: [{ id: 'gb' }] });
      if (url.includes('/catalog/gb/songs') && url.includes('filter[isrc]=GBAYE1234567')) {
        return ok({ data: [{ id: 'gb-catalog-id' }] });
      }
      return ok({ results: { songs: { data: [] } } });
    });
    const { resolved } = await applemusic.resolveTracks(
      [{ title: 'Intro', artist: 'The xx', isrc: 'GBAYE1234567' }], AM_TOKEN
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].appleMusicId).toBe('gb-catalog-id');
    expect(resolved[0].appleMusicCatalogId).toBe('gb-catalog-id');
    // The ISRC lookup hit the USER's storefront, never a hardcoded 'us'.
    expect(calls.some((u) => u.includes('/catalog/gb/songs') && u.includes('filter[isrc]=GBAYE1234567'))).toBe(true);
    expect(calls.some((u) => u.includes('/catalog/us/'))).toBe(false);
  });

  test('ISRC pulled from track.sources[*].isrc when no top-level ISRC', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      if (url.includes('/me/storefront')) return ok({ data: [{ id: 'jp' }] });
      if (url.includes('filter[isrc]=USRC11200001')) return ok({ data: [{ id: 'jp-id' }] });
      return ok({ results: { songs: { data: [] } } });
    });
    const { resolved } = await applemusic.resolveTracks(
      [{ title: 'X', artist: 'Y', sources: { spotify: { isrc: 'USRC11200001' } } }], AM_TOKEN
    );
    expect(resolved[0].appleMusicId).toBe('jp-id');
    expect(calls.some((u) => u.includes('/catalog/jp/songs'))).toBe(true);
  });

  test('ISRC miss falls through to the gated storefront text search', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes('/me/storefront')) return ok({ data: [{ id: 'gb' }] });
      if (url.includes('/songs?filter[isrc]')) return ok({ data: [] }); // no ISRC hit
      if (url.includes('/catalog/gb/search')) return ok({ results: { songs: { data: [
        { id: 'right-id', attributes: { name: 'Intro', artistName: 'The xx' } },
      ] } } });
      return ok({ results: { songs: { data: [] } } });
    });
    const { resolved } = await applemusic.resolveTracks(
      [{ title: 'Intro', artist: 'The xx', isrc: 'GBAYE9999999' }], AM_TOKEN
    );
    expect(resolved[0].appleMusicId).toBe('right-id');
  });
});

describe('pickConfidentMatch unit', () => {
  const t = { title: 'Intro', artist: 'The xx' };
  test('drops when only a wrong-artist same-title candidate exists', () => {
    expect(pickConfidentMatch(t, [{ title: 'Intro', artist: 'Alt-J' }])).toBeNull();
  });
  test('picks the correct candidate over a wrong-artist one', () => {
    const got = pickConfidentMatch(t, [
      { title: 'Intro', artist: 'Alt-J' },
      { title: 'Intro', artist: 'The xx' },
    ]);
    expect(got).toEqual({ index: 1, score: 0.95 });
  });
  test('empty candidates → null', () => {
    expect(pickConfidentMatch(t, [])).toBeNull();
    expect(pickConfidentMatch(t, null)).toBeNull();
  });
});

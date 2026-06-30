/**
 * AM N-way ADD primitive (parachord#956 §2c). AM is trackRemoveMode 'Unsupported'
 * but CAN append via POST. Without an addPlaylistTracks primitive, the materialize
 * executor's Unsupported branch hit the throwing default and armed AM mirrors
 * silently never received additions. This pins the primitive + that it's wired to
 * the real POST path.
 */

const am = require('../../sync-providers/applemusic');
const { withIncrementalDefaults } = require('../../sync-providers/incremental-primitives');

const TOKEN = JSON.stringify({ developerToken: 'dev', userToken: 'usr' });

describe('AM addPlaylistTracks primitive — armed additions land', () => {
  afterEach(() => { delete global.fetch; });

  test('AM implements addPlaylistTracks (no longer backfilled by the throwing stub)', () => {
    expect(typeof am.addPlaylistTracks).toBe('function');
    const ready = withIncrementalDefaults(am);
    expect(ready.addPlaylistTracks).toBe(am.addPlaylistTracks); // the real fn, not the stub
  });

  test('POSTs catalog ids to the playlist tracks endpoint with the bound token', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({}) }; });
    await am.addPlaylistTracks('p.123', ['1452906710', '999'], TOKEN);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/me/library/playlists/p.123/tracks');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body).data).toEqual([
      { id: '1452906710', type: 'songs' },
      { id: '999', type: 'songs' },
    ]);
    expect(calls[0].init.headers['Music-User-Token']).toBe('usr');
  });

  test('empty add is a no-op (never POSTs an empty batch)', async () => {
    global.fetch = jest.fn();
    expect(await am.addPlaylistTracks('p.1', [], TOKEN)).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

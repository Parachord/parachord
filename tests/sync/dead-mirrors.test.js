/**
 * A playlist deleted on a provider only got flagged when a push hit it, and an
 * unedited playlist never pushes, so a mirror could sit dead for months (#1269).
 * Each sync now compares against the full remote list, then confirms each
 * suspect with its own request. Only a definite "gone" flags a mirror: a partial
 * fetch alone must never flag anything.
 */

const { suspectedDeadMirrors, flagDeadMirrors, DEAD_MIRROR_MASS_FLOOR } = require('../../sync-engine/dead-mirrors');

const mirror = (id, externalId, extra = {}) => ({ id, title: id, syncedTo: { listenbrainz: { externalId, ...extra } } });
const remote = (...ids) => ids.map((externalId) => ({ externalId }));
const statusFrom = (table) => jest.fn(async (id) => table[id] || { exists: true, isPublic: true });
const options = (over) => ({ providerId: 'listenbrainz', token: 'tok', sleep: async () => {}, log: { warn() {}, log() {} }, ...over });

describe('suspectedDeadMirrors', () => {
  test('a mirror missing from the full list is a suspect, one that is listed is not', () => {
    const playlists = [mirror('a', 'gone'), mirror('b', 'there')];
    expect(suspectedDeadMirrors(playlists, 'listenbrainz', remote('there')).map((s) => s.externalId)).toEqual(['gone']);
  });

  test('ignores other providers, playlists with no mirror, and ones already flagged', () => {
    const playlists = [
      { id: 'none', title: 'none' },
      { id: 'other', syncedTo: { spotify: { externalId: 'sp' } } },
      mirror('flagged', 'x', { pendingAction: 'remote-deleted' }),
    ];
    expect(suspectedDeadMirrors(playlists, 'listenbrainz', remote())).toEqual([]);
  });
});

describe('flagDeadMirrors', () => {
  test('flags a mirror only when the provider confirms it is gone', async () => {
    const provider = { playlistStatus: statusFrom({ gone: { exists: false, isPublic: null } }) };
    const playlists = [mirror('a', 'gone'), mirror('b', 'there')];
    const result = await flagDeadMirrors(playlists, remote('there'), provider, options());
    expect(result.flagged).toBe(1);
    expect(result.playlists[0].syncedTo.listenbrainz).toEqual({ externalId: 'gone', pendingAction: 'remote-deleted' });
    expect(result.playlists[1]).toBe(playlists[1]);
    expect(provider.playlistStatus).toHaveBeenCalledTimes(1);
    expect(provider.playlistStatus).toHaveBeenCalledWith('gone', 'tok');
  });

  test('a suspect that still exists is left alone: the fetch was just partial', async () => {
    const provider = { playlistStatus: statusFrom({}) };
    const playlists = [mirror('a', 'missing-from-list')];
    const result = await flagDeadMirrors(playlists, remote(), provider, options());
    expect(result.flagged).toBe(0);
    expect(result.playlists).toBe(playlists);
  });

  test('an unclear answer or a thrown error flags nothing', async () => {
    const playlists = [mirror('a', 'x'), mirror('b', 'y')];
    const provider = {
      playlistStatus: jest.fn(async (id) => {
        if (id === 'x') return { exists: null, isPublic: null };
        throw new Error('429');
      }),
    };
    const result = await flagDeadMirrors(playlists, remote(), provider, options());
    expect(result.flagged).toBe(0);
    expect(result.playlists).toBe(playlists);
  });

  test('keeps the rest of the mirror and the other providers', async () => {
    const provider = { playlistStatus: statusFrom({ gone: { exists: false, isPublic: null } }) };
    const playlists = [{
      id: 'a',
      title: 'a',
      tracks: [1],
      syncedTo: { listenbrainz: { externalId: 'gone', snapshotId: 's', syncedAt: 5 }, spotify: { externalId: 'sp' } },
    }];
    const { playlists: out } = await flagDeadMirrors(playlists, remote(), provider, options());
    expect(out[0]).toEqual({
      id: 'a',
      title: 'a',
      tracks: [1],
      syncedTo: {
        listenbrainz: { externalId: 'gone', snapshotId: 's', syncedAt: 5, pendingAction: 'remote-deleted' },
        spotify: { externalId: 'sp' },
      },
    });
    expect(playlists[0].syncedTo.listenbrainz.pendingAction).toBeUndefined();
  });

  test('a provider with no status check does nothing', async () => {
    const playlists = [mirror('a', 'x')];
    const result = await flagDeadMirrors(playlists, remote(), {}, options());
    expect(result).toEqual({ playlists, flagged: 0, suspects: 0 });
  });

  test('too many suspects at once means a bad fetch: no requests and no flags', async () => {
    const provider = { playlistStatus: statusFrom({}) };
    const playlists = Array.from({ length: DEAD_MIRROR_MASS_FLOOR + 1 }, (_, i) => mirror(`p${i}`, `x${i}`));
    const result = await flagDeadMirrors(playlists, remote(), provider, options());
    expect(result.flagged).toBe(0);
    expect(provider.playlistStatus).not.toHaveBeenCalled();
  });

  test('exactly the floor is still checked', async () => {
    const provider = { playlistStatus: jest.fn(async () => ({ exists: false, isPublic: null })) };
    const playlists = Array.from({ length: DEAD_MIRROR_MASS_FLOOR }, (_, i) => mirror(`p${i}`, `x${i}`));
    const result = await flagDeadMirrors(playlists, remote(), provider, options());
    expect(result.flagged).toBe(DEAD_MIRROR_MASS_FLOOR);
  });
});

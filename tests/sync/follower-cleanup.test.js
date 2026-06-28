/**
 * Follower-dupe cleanup identification (parachord#937). The destructive apply
 * lives in main.js; this is the pure "what's wrong" logic.
 */

const { findFollowerSyncCleanup } = require('../../sync-engine/follower-cleanup');

const follower = (id, name, syncedTo) => ({ id, title: name, source: `${id.split('-')[0]}-import`, syncedTo });
const owned = (id, name, extra = {}) => ({ id, title: name, source: `${id.split('-')[0]}-sync`, ...extra });

describe('findFollowerSyncCleanup', () => {
  test('tier1: a followed playlist with mirror entries it should never have had', () => {
    const r = findFollowerSyncCleanup([
      follower('spotify-37i9', 'Today’s Hits', {
        listenbrainz: { externalId: 'lb-1' },
        applemusic: { externalId: 'am-1' },
      }),
    ]);
    expect(r.tier1).toHaveLength(1);
    expect(r.tier1[0].localId).toBe('spotify-37i9');
    expect(r.tier1[0].mirrors).toEqual([
      { providerId: 'listenbrainz', externalId: 'lb-1' },
      { providerId: 'applemusic', externalId: 'am-1' },
    ]);
    expect(r.mirrorCount).toBe(2);
  });

  test('tier1 excludes a mirror the user EXPLICITLY opted into via channel override', () => {
    const r = findFollowerSyncCleanup(
      [follower('spotify-x', 'Mix', { listenbrainz: { externalId: 'lb-2' }, applemusic: { externalId: 'am-2' } })],
      { 'spotify-x': ['applemusic'] }, // user chose to mirror to AM on purpose
    );
    expect(r.tier1[0].mirrors).toEqual([{ providerId: 'listenbrainz', externalId: 'lb-2' }]);
  });

  test('a followed playlist with NO stray mirrors is left alone', () => {
    const r = findFollowerSyncCleanup([follower('spotify-clean', 'Clean', {})]);
    expect(r.tier1).toHaveLength(0);
    expect(r.mirrorCount).toBe(0);
  });

  test('an OWNED playlist is never tier1 (it can legitimately have mirrors)', () => {
    const r = findFollowerSyncCleanup([owned('spotify-o', 'Owned', { syncedTo: { listenbrainz: { externalId: 'lb-3' } } })]);
    expect(r.tier1).toHaveLength(0);
  });

  test('tier2 flags an owned playlist that name-matches a follower (report-only)', () => {
    const r = findFollowerSyncCleanup([
      follower('spotify-dup', 'Road Trip', {}),
      owned('spotify-reexport', 'road trip'), // case-insensitive name match → possible re-export dupe
      owned('local-unrelated', 'Something Else'),
    ]);
    expect(r.tier2).toHaveLength(1);
    expect(r.tier2[0].localId).toBe('spotify-reexport');
  });

  test('a localOnly playlist is never tier2', () => {
    const r = findFollowerSyncCleanup([
      follower('spotify-dup', 'Road Trip', {}),
      owned('local-x', 'Road Trip', { localOnly: true }),
    ]);
    expect(r.tier2).toHaveLength(0);
  });

  test('collaborators are not followers — never touched', () => {
    const collab = { id: 'listenbrainz-c', title: 'Shared', source: 'listenbrainz-import', syncedFrom: { isCollaborator: true }, syncedTo: { spotify: { externalId: 'sp-1' } } };
    const r = findFollowerSyncCleanup([collab]);
    expect(r.tier1).toHaveLength(0);
  });

  test('empty / malformed input is safe', () => {
    expect(findFollowerSyncCleanup(null)).toEqual({ tier1: [], tier2: [], mirrorCount: 0 });
    expect(findFollowerSyncCleanup([null, {}, { id: 'x' }])).toEqual({ tier1: [], tier2: [], mirrorCount: 0 });
  });
});

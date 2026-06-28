/**
 * Corrected #937 cleanup identification (per #911). Finds the redundant
 * listenbrainz-* re-imports of a follower's legitimate LB mirror — never the
 * mirror itself. The destructive apply lives in main.js.
 */

const { findReimportDuplicates, isReadOnlyFollower } = require('../../sync-engine/follower-cleanup');

// A followed Spotify playlist that legitimately mirrors out to LB copy E.
const follower = (lbExt) => ({
  id: 'spotify-37i9', title: 'Today’s Hits', source: 'spotify-import',
  syncedFrom: { resolver: 'spotify', externalId: '37i9' },
  syncedTo: { listenbrainz: { externalId: lbExt } },
});
// The redundant re-import of LB copy E, with owned streaming re-exports.
const reimport = (lbExt, syncedTo = {}) => ({
  id: `listenbrainz-${lbExt}`, title: 'Today’s Hits', source: 'listenbrainz-sync',
  syncedFrom: { resolver: 'listenbrainz', externalId: lbExt },
  syncedTo,
});

describe('findReimportDuplicates', () => {
  test('flags the separate LB re-import of a follower mirror + its re-exports; keeps the LB mirror', () => {
    const r = findReimportDuplicates([
      follower('E'),
      reimport('E', { spotify: { externalId: 'sp-dup' }, applemusic: { externalId: 'am-dup' } }),
    ]);
    expect(r.dupes).toHaveLength(1);
    expect(r.dupes[0].localId).toBe('listenbrainz-E');
    expect(r.dupes[0].followerId).toBe('spotify-37i9');
    // The re-export targets to delete — NOT the LB mirror itself.
    expect(r.dupes[0].reexports).toEqual([
      { providerId: 'spotify', externalId: 'sp-dup' },
      { providerId: 'applemusic', externalId: 'am-dup' },
    ]);
    expect(r.reexportCount).toBe(2);
  });

  test('the follower itself is NEVER a duplicate', () => {
    const r = findReimportDuplicates([follower('E')]);
    expect(r.dupes).toHaveLength(0);
  });

  test('a legitimate LB playlist (not re-importing a follower mirror) is left alone', () => {
    const r = findReimportDuplicates([
      follower('E'),
      reimport('OTHER', { spotify: { externalId: 'sp-x' } }), // different LB id → not a dupe
    ]);
    expect(r.dupes).toHaveLength(0);
  });

  test('matches a re-import by listenbrainz- id even without syncedFrom', () => {
    const r = findReimportDuplicates([
      follower('E'),
      { id: 'listenbrainz-E', title: 'Today’s Hits', source: 'listenbrainz-sync', syncedTo: {} },
    ]);
    expect(r.dupes).toHaveLength(1);
    expect(r.dupes[0].reexports).toEqual([]);
  });

  test('a collaborator follower is not a read-only follower → its mirror is not a basis for dupes', () => {
    const collab = {
      id: 'spotify-c', title: 'Shared', source: 'spotify-import',
      syncedFrom: { resolver: 'spotify', externalId: 'c', isCollaborator: true },
      syncedTo: { listenbrainz: { externalId: 'E' } },
    };
    const r = findReimportDuplicates([collab, reimport('E', { spotify: { externalId: 'x' } })]);
    expect(r.dupes).toHaveLength(0);
  });

  test('isReadOnlyFollower basics', () => {
    expect(isReadOnlyFollower({ source: 'spotify-import' })).toBe(true);
    expect(isReadOnlyFollower({ source: 'spotify-sync' })).toBe(false);
    expect(isReadOnlyFollower({ source: 'listenbrainz-import', syncedFrom: { isCollaborator: true } })).toBe(false);
    expect(isReadOnlyFollower(null)).toBe(false);
  });

  test('empty / malformed input is safe', () => {
    expect(findReimportDuplicates(null)).toEqual({ dupes: [], reexportCount: 0 });
  });
});

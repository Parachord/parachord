/**
 * parachord#950 — the create gateway must never create an OWNED copy of a
 * playlist the user doesn't own (followed / collaborative, owner ≠ current
 * user). findNonOwnedSourceConflict is the pure gate; main.js's
 * sync:create-playlist returns { error: 'non-owned-source' } on a non-null
 * result. Because the non-owned original is permanent, this also stops the
 * "reappears after deletion" re-creation.
 */

const { findNonOwnedSourceConflict } = require('../../sync-engine/playlist-push-candidate');

const followed = { name: "Huff'n Duster", isOwnedByUser: false, ownerId: 'nicholas', externalId: 'rmt-follow' };
const collab = { name: 'galaxy brain family', isOwnedByUser: false, ownerId: 'mia', externalId: 'rmt-collab' };
const owned = { name: 'my mix', isOwnedByUser: true, ownerId: 'me', externalId: 'rmt-own' };

describe('findNonOwnedSourceConflict', () => {
  test('blocks a listenbrainz- mirror re-exporting onto a FOLLOWED Spotify playlist of the same name', () => {
    const hit = findNonOwnedSourceConflict('listenbrainz-abc', "Huff'n Duster", [followed, owned]);
    expect(hit).toBe(followed);
  });

  test('blocks the COLLABORATIVE case too (owner ≠ user, still not an owned copy)', () => {
    expect(findNonOwnedSourceConflict('listenbrainz-xyz', 'galaxy brain family', [collab])).toBe(collab);
  });

  test('case/whitespace-insensitive name match', () => {
    expect(findNonOwnedSourceConflict('applemusic-1', "  HUFF'N DUSTER ", [followed])).toBe(followed);
  });

  test('does NOT block when an OWNED remote of the name exists (caller links to it; no non-owned twin)', () => {
    expect(findNonOwnedSourceConflict('listenbrainz-abc', 'my mix', [owned])).toBeNull();
  });

  test('does NOT block a user-origin row (local-/playlist-/hosted-/ai-chat-) sharing a followed name', () => {
    for (const id of ['local-1', 'playlist-1700000000000', 'hosted-deadbeef', 'ai-chat-1700000000000']) {
      expect(findNonOwnedSourceConflict(id, "Huff'n Duster", [followed])).toBeNull();
    }
  });

  test('does NOT block when no same-name remote exists', () => {
    expect(findNonOwnedSourceConflict('listenbrainz-abc', 'Something Else', [followed, collab])).toBeNull();
  });

  test('safe on missing / malformed inputs', () => {
    expect(findNonOwnedSourceConflict(null, 'x', [followed])).toBeNull();
    expect(findNonOwnedSourceConflict('listenbrainz-a', '', [followed])).toBeNull();
    expect(findNonOwnedSourceConflict('listenbrainz-a', 'x', null)).toBeNull();
    // isOwnedByUser undefined (provider didn't report ownership) → never blocks.
    expect(findNonOwnedSourceConflict('listenbrainz-a', 'x', [{ name: 'x' }])).toBeNull();
  });
});

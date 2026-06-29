/**
 * Per-copy writability (parachord#911 contract). The N-way reconcile gates the
 * imported SOURCE copy on playlist.writable (A3) → only writable copies are push
 * targets (A9), so this is what decides whether a collaborative playlist's edits
 * ROUND-TRIP to the original vs. the source being mirror-only.
 *
 * The legacy `-import → false` rule wrongly made collaborators read-only, so their
 * edits never round-tripped (they fell to the create path → owned dupe, #950).
 */

const { isPlaylistWritable } = require('../../sync-engine/playlist-push-candidate');

describe('isPlaylistWritable', () => {
  test('owned playlist (non -import source) is writable', () => {
    expect(isPlaylistWritable({ source: 'spotify-sync' })).toBe(true);
    expect(isPlaylistWritable({ source: 'local' })).toBe(true);
    expect(isPlaylistWritable({})).toBe(true);
    expect(isPlaylistWritable({ id: 'playlist-1' })).toBe(true);
  });

  test('COLLABORATIVE import is writable — edits round-trip to the original', () => {
    expect(isPlaylistWritable({
      source: 'spotify-import',
      syncedFrom: { resolver: 'spotify', externalId: 'galaxy', isCollaborator: true },
    })).toBe(true);
  });

  test('FOLLOWED import (not a collaborator) is NOT writable — mirror-only', () => {
    expect(isPlaylistWritable({
      source: 'spotify-import',
      syncedFrom: { resolver: 'spotify', externalId: 'huff', isCollaborator: false },
    })).toBe(false);
    // isCollaborator absent → still read-only (the default followed case).
    expect(isPlaylistWritable({
      source: 'spotify-import',
      syncedFrom: { resolver: 'spotify', externalId: 'huff' },
    })).toBe(false);
  });

  test('malformed input is safe (defaults to writable for owned-shaped, false for import)', () => {
    expect(isPlaylistWritable(null)).toBe(true);
    expect(isPlaylistWritable({ source: 'applemusic-import' })).toBe(false);
  });
});

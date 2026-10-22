/**
 * savePlaylistToStore's payload must carry every playlist field. The
 * main-process `playlists-save` handler replaces the stored record outright,
 * so a field left out of the payload is deleted on disk. The old hand-written
 * field list omitted `localOnly` and `description`: adding or removing a track
 * on a "Local only" playlist cleared the flag, and the next sync pushed the
 * playlist to the user's services.
 *
 * The payload builder is a module-scope helper in app.js; this test extracts
 * and runs the real source.
 */

const fs = require('fs');
const path = require('path');

const { buildPlaylistSavePayload: build } = require('../../protocol-url');

// docs/architecture/android-parity.md "Playlist data-model fields to preserve on every save".
const REQUIRED = [
  'id', 'title', 'description', 'tracks',
  'syncedFrom', 'syncedTo', 'syncSources',
  'hasUpdates', 'locallyModified', 'lastModified',
  'localOnly', 'sourceUrl', 'source', 'creator',
  'createdAt', 'addedAt',
];

const full = {
  id: 'playlist-1',
  title: 'Road trip',
  description: 'For the drive',
  tracks: [{ artist: 'A', title: 'B' }],
  syncedFrom: { resolver: 'spotify', externalId: 'x', snapshotId: 's' },
  syncedTo: { applemusic: { externalId: 'p.1', syncedAt: 1 } },
  syncSources: { spotify: { addedAt: 1, syncedAt: 2 } },
  hasUpdates: false,
  locallyModified: true,
  lastModified: 5,
  localOnly: true,
  sourceUrl: 'https://example.com/p.xspf',
  source: 'hosted-xspf',
  creator: 'Me',
  createdAt: 10,
  addedAt: 11,
};

describe('buildPlaylistSavePayload', () => {
  test.each(REQUIRED)('keeps %s', (field) => {
    const out = build(full, '<xspf/>', 1000);
    expect(out).toHaveProperty(field);
  });

  test('localOnly survives a track edit (the reported bug)', () => {
    const edited = { ...full, tracks: [...full.tracks, { artist: 'C', title: 'D' }], locallyModified: true };
    const out = build(edited, '<xspf/>', 1000);
    expect(out.localOnly).toBe(true);
    expect(out.description).toBe('For the drive');
  });

  test('sets the computed fields', () => {
    const out = build({ id: 'p', title: 'T', tracks: [] }, '<xspf/>', 1000);
    expect(out.filename).toBe('p.xspf');
    expect(out.xspf).toBe('<xspf/>');
    expect(out.createdAt).toBe(1000);
    expect(out.addedAt).toBe(1000);
    expect(out.lastModified).toBe(1000);
    expect(out.isAiPlaylist).toBe(false);
  });

  test('keeps existing filename and timestamps, always bumps lastModified', () => {
    const out = build(full, '<xspf/>', 1000);
    expect(out.filename).toBe('playlist-1.xspf');
    expect(out.createdAt).toBe(10);
    expect(out.addedAt).toBe(11);
    expect(out.lastModified).toBe(1000);
  });

  test('preserves fields it has never heard of (main-process sync metadata, future fields)', () => {
    const out = build({ ...full, collaborators: ['bob'], futureField: 42 }, '<xspf/>', 1000);
    expect(out.collaborators).toEqual(['bob']);
    expect(out.futureField).toBe(42);
  });

  test('strips UI-only flags that ride on selectedPlaylist', () => {
    const out = build({ ...full, isEphemeral: false, isExternal: true, tracksLoaded: true }, '<xspf/>', 1000);
    expect(out).not.toHaveProperty('isEphemeral');
    expect(out).not.toHaveProperty('isExternal');
    expect(out).not.toHaveProperty('tracksLoaded');
  });

  test('does not mutate the playlist it was given', () => {
    const input = { ...full, isEphemeral: false };
    build(input, '<xspf/>', 1000);
    expect(input.isEphemeral).toBe(false);
    expect(input.xspf).toBeUndefined();
  });
});

describe('savePlaylistToStore uses the builder', () => {
  test('no hand-written field list remains', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
    const s = app.indexOf('const savePlaylistToStore = async (playlist) => {');
    expect(s).toBeGreaterThan(-1);
    const body = app.slice(s, app.indexOf('\n  };\n', s));
    expect(body).toMatch(/window\.buildPlaylistSavePayload\(playlist, xspfContent, Date\.now\(\)\)/);
    expect(body).not.toMatch(/syncedFrom: playlist\.syncedFrom/);
  });
});

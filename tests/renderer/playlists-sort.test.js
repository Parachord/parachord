// One sort for the Playlists page and the Add to playlist panel
// (src/renderer/lib/playlists-sort.js). "Recently modified" follows when a
// playlist's tracks last changed (tracksChangedAt): `lastModified` also moves
// when a background save adds resolved sources to its tracks, which put
// playlists nobody had touched in months at the top (2026-11-22).
const fs = require('fs');
const path = require('path');
const { sortPlaylists, playlistsSortOptions } = require('../../src/renderer/lib/playlists-sort');

const ids = (list) => list.map((p) => p.id);

describe('sortPlaylists', () => {
  test('modified: by tracksChangedAt, not a lastModified a source save moved', () => {
    const list = [
      { id: 'untouched-but-resolved', tracksChangedAt: 100, lastModified: 9_000 },
      { id: 'edited', tracksChangedAt: 5_000, lastModified: 5_000 },
    ];
    expect(ids(sortPlaylists(list, 'modified'))).toEqual(['edited', 'untouched-but-resolved']);
  });

  test('modified: a playlist never stamped falls back to lastModified, then addedAt', () => {
    const list = [
      { id: 'added-only', addedAt: 300 },
      { id: 'modified-only', lastModified: 400 },
      { id: 'stamped', tracksChangedAt: 200 },
    ];
    expect(ids(sortPlaylists(list, 'modified'))).toEqual(['modified-only', 'added-only', 'stamped']);
  });

  test('added, created (title breaks a tie), A–Z and Z–A', () => {
    const list = [
      { id: 'b', title: 'B', addedAt: 1, createdAt: 5 },
      { id: 'a', title: 'A', addedAt: 2, createdAt: 5 },
      { id: 'c', title: 'C', createdAt: 9 },
    ];
    expect(ids(sortPlaylists(list, 'added'))).toEqual(['c', 'a', 'b']);
    expect(ids(sortPlaylists(list, 'created'))).toEqual(['c', 'a', 'b']);
    expect(ids(sortPlaylists(list, 'alpha-asc'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortPlaylists(list, 'alpha-desc'))).toEqual(['c', 'b', 'a']);
  });

  test('never mutates its input, and an unknown sort keeps the order', () => {
    const list = [{ id: 'x', addedAt: 1 }, { id: 'y', addedAt: 2 }];
    const out = sortPlaylists(list, 'added');
    expect(ids(list)).toEqual(['x', 'y']);
    expect(out).not.toBe(list);
    expect(ids(sortPlaylists(list, 'nope'))).toEqual(['x', 'y']);
  });

  test('every menu choice is a sort it knows', () => {
    for (const { value } of playlistsSortOptions) {
      expect(() => sortPlaylists([{ id: 'a' }, { id: 'b' }], value)).not.toThrow();
    }
  });
});

describe('both lists use it', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  test('the Playlists page and the Add to playlist panel sort through sortPlaylists, with no copy of their own', () => {
    const app = read('src/renderer/app.js');
    expect(app).toMatch(/const sortPlaylists = useCallback\(\(items\) => sortPlaylistsBy\(items, playlistsSort\)/);
    const panel = read('src/renderer/components/add-to-playlist-panel.js');
    expect(panel).toMatch(/const sortedPlaylists = sortPlaylists\(filteredPlaylists, addToPlaylistSort\);/);
    for (const src of [app, panel]) expect(src).not.toMatch(/case 'modified':/);
  });
});

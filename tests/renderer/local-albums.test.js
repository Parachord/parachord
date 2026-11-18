/**
 * The Collection's albums from local files (#1532). Albums of the Local Files
 * library are derived from `library` (src/renderer/lib/local-albums.js) and
 * merged with the saved albums on the Albums tab; removing one only hides it.
 */

const fs = require('fs');
const path = require('path');

const {
  deriveLocalAlbums,
  mergeCollectionAlbums,
  hideLocalAlbum,
  unhideLocalAlbum,
  planAlbumRemoval,
  isJunkAlbumTitle,
  localAlbumIdOf,
} = require('../../src/renderer/lib/local-albums');
const { generateAlbumId } = require('../../sync-engine/collection-id');

const local = (over) => ({
  id: `local-${over.title}`,
  artist: 'Artist',
  sources: { localfiles: { filePath: `/m/${over.title}.mp3` } },
  filePath: `/m/${over.title}.mp3`,
  ...over,
});

describe('deriveLocalAlbums', () => {
  test('groups by album artist, else artist, and album title', () => {
    const library = [
      local({ title: 'b', album: 'Kid A', artist: 'Radiohead', trackNumber: 2, year: 2000, indexedAt: 500 }),
      local({ title: 'a', album: 'Kid A', artist: 'Radiohead', trackNumber: 1, albumArt: 'file:///c.jpg', indexedAt: 300 }),
      // A compilation: the album artist holds the tracks together.
      local({ title: 'x', album: 'Hits', artist: 'One', albumArtist: 'Various Artists' }),
      local({ title: 'y', album: 'Hits', artist: 'Two', albumArtist: 'Various Artists' }),
      // Same title, different artist: another album.
      local({ title: 'z', album: 'Kid A', artist: 'Someone Else' }),
    ];
    const albums = deriveLocalAlbums(library);
    expect(albums).toHaveLength(3);

    const kidA = albums.find(a => a.artist === 'Radiohead');
    expect(kidA).toMatchObject({
      title: 'Kid A', year: 2000, art: 'file:///c.jpg', trackCount: 2, addedAt: 300, isLocal: true,
    });
    // Disc and track order, and the library rows themselves (they play the file).
    expect(kidA.localTracks.map(t => t.title)).toEqual(['a', 'b']);
    expect(kidA.localTracks[0]).toBe(library[1]);

    const hits = albums.find(a => a.title === 'Hits');
    expect(hits.artist).toBe('Various Artists');
    expect(hits.trackCount).toBe(2);
  });

  test('ids are generateAlbumId of the album artist and title, as saved albums', () => {
    const [album] = deriveLocalAlbums([local({ title: 't', album: ' Björk Album ', artist: 'Björk' })]);
    expect(album.id).toBe(generateAlbumId('Björk', 'Björk Album'));
    const [cjk] = deriveLocalAlbums([local({ title: 't', album: '初恋', artist: '宇多田ヒカル' })]);
    expect(cjk.id).toBe(generateAlbumId('宇多田ヒカル', '初恋'));
    expect(localAlbumIdOf(local({ title: 't', album: 'X', albumArtist: 'AA', artist: 'B' }))).toBe(generateAlbumId('AA', 'X'));
  });

  test('albums without a title, or with a placeholder one, stay off the tab', () => {
    const albums = deriveLocalAlbums([
      local({ title: '1', album: null }),
      local({ title: '2', album: '' }),
      local({ title: '3', album: '   ' }),
      local({ title: '4', album: 'Unknown Album' }),
      local({ title: '5', album: '[Unknown Album]' }),
      local({ title: '6', album: 'unknown' }),
      local({ title: '7', album: 'Single' }),
      local({ title: '8', album: 'Local Files' }), // its own source's name
      local({ title: '9', album: 'Real Album' }),
    ]);
    expect(albums.map(a => a.title)).toEqual(['Real Album']);
    // Real titles that look like placeholders stay.
    expect(isJunkAlbumTitle('Untitled')).toBe(false);
    expect(isJunkAlbumTitle('None')).toBe(false);
  });

  test('an empty or missing library gives no albums', () => {
    expect(deriveLocalAlbums([])).toEqual([]);
    expect(deriveLocalAlbums(null)).toEqual([]);
  });
});

describe('mergeCollectionAlbums', () => {
  const localAlbums = deriveLocalAlbums([
    local({ title: 'a', album: 'In Rainbows', artist: 'Radiohead', albumArt: 'file:///ir.jpg' }),
    local({ title: 'b', album: 'Amnesiac', artist: 'Radiohead' }),
  ]);

  test('a local album that is also saved shows once, as the saved record with the local tracks', () => {
    const saved = [{ id: generateAlbumId('Radiohead', 'In Rainbows'), title: 'In Rainbows', artist: 'Radiohead', year: 2007, art: null, trackCount: 10, addedAt: 42 }];
    const merged = mergeCollectionAlbums(saved, localAlbums, []);
    expect(merged).toHaveLength(2);
    const ir = merged.filter(a => a.title === 'In Rainbows');
    expect(ir).toHaveLength(1);
    expect(ir[0]).toMatchObject({ year: 2007, trackCount: 10, addedAt: 42, art: 'file:///ir.jpg' });
    expect(ir[0].isLocal).toBeUndefined();
    expect(ir[0].localTracks.map(t => t.title)).toEqual(['a']);
    // Ids are unique, so the card keys are.
    expect(new Set(merged.map(a => a.id)).size).toBe(merged.length);
  });

  test("the saved album's own cover wins", () => {
    const saved = [{ id: generateAlbumId('Radiohead', 'In Rainbows'), title: 'In Rainbows', artist: 'Radiohead', art: 'https://x/ir.jpg' }];
    expect(mergeCollectionAlbums(saved, localAlbums, [])[0].art).toBe('https://x/ir.jpg');
  });

  test('hidden local albums are left out; saved albums always show', () => {
    const amnesiac = generateAlbumId('Radiohead', 'Amnesiac');
    const ir = generateAlbumId('Radiohead', 'In Rainbows');
    expect(mergeCollectionAlbums([], localAlbums, [amnesiac]).map(a => a.title)).toEqual(['In Rainbows']);
    const saved = [{ id: ir, title: 'In Rainbows', artist: 'Radiohead' }];
    expect(mergeCollectionAlbums(saved, localAlbums, [ir, amnesiac]).map(a => a.title)).toEqual(['In Rainbows']);
  });

  test('with no local albums the saved list is returned as is', () => {
    const saved = [{ id: 'x', title: 'X', artist: 'Y' }];
    expect(mergeCollectionAlbums(saved, [], [])).toBe(saved);
  });
});

describe('hiding', () => {
  test('hide and unhide', () => {
    let hidden = [];
    hidden = hideLocalAlbum(hidden, 'a');
    expect(hidden).toEqual(['a']);
    expect(hideLocalAlbum(hidden, 'a')).toBe(hidden);
    hidden = hideLocalAlbum(hidden, 'b');
    expect(unhideLocalAlbum(hidden, 'a')).toEqual(['b']);
    expect(unhideLocalAlbum(hidden, 'zzz')).toBe(hidden);
  });
});

describe('planAlbumRemoval', () => {
  const id = generateAlbumId('Radiohead', 'Amnesiac');
  const album = { id, title: 'Amnesiac', artist: 'Radiohead' };

  test('a local-only album is hidden and nothing is unsaved', () => {
    expect(planAlbumRemoval(album, new Set([id]), [])).toEqual({ hideId: id, unsave: false });
    // Matched by artist and title when the menu sent no id.
    expect(planAlbumRemoval({ title: 'Amnesiac', artist: 'Radiohead' }, new Set([id]), [])).toEqual({ hideId: id, unsave: false });
  });

  test('a saved album that is also local is unsaved and hidden', () => {
    expect(planAlbumRemoval(album, new Set([id]), [album])).toEqual({ hideId: id, unsave: true });
  });

  test('a saved album with no local files is only unsaved', () => {
    expect(planAlbumRemoval(album, new Set(), [album])).toEqual({ hideId: null, unsave: true });
  });
});

describe('app.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  const fnBody = (name) => {
    const start = src.indexOf(`const ${name} = useCallback(`);
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('}, [', start));
  };

  test('removing a local-only album returns before any collection write, tombstone or service call', () => {
    const body = fnBody('removeAlbumFromCollection');
    const early = body.indexOf('if (!removal.unsave)');
    expect(early).toBeGreaterThan(-1);
    const ret = body.indexOf('return;', early);
    expect(ret).toBeGreaterThan(early);
    const earlyBranch = body.slice(early, ret);
    for (const marker of ['setCollectionData', 'saveCollection', 'removeAlbums', 'tombstones']) {
      expect(earlyBranch).not.toContain(marker);
      const at = body.indexOf(marker);
      if (at !== -1) expect(at).toBeGreaterThan(early);
    }
  });

  test('adding an album clears its hide', () => {
    expect(fnBody('addAlbumToCollection')).toMatch(/setHiddenLocalAlbumIds\(prev => unhideLocalAlbum\(prev, albumId\)\)/);
  });

  test('the Albums tab reads the merged list, never collectionData.albums', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'collection-page.js'), 'utf8');
    const code = page.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/collectionData\.albums/);
    expect(page).toMatch(/filterCollectionItems\(collectionAlbums, 'albums'\)/);
  });

  test('the hidden list is persisted under an allowlisted key', () => {
    const store = fs.readFileSync(path.join(__dirname, '..', '..', 'main-process', 'ipc', 'store.js'), 'utf8');
    expect(store).toContain("'collection_hidden_local_albums'");
    expect(src).toContain("window.electron.store.set('collection_hidden_local_albums', hiddenLocalAlbumIds)");
  });
});

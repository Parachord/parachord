/**
 * The Collection with local files merged in (#1532). Local and saved albums,
 * artists and songs are each one list, every merged entry carries every
 * source (src/renderer/lib/local-albums.js), and showing is not saving: an
 * entry that is there only because of local files is never followed,
 * hearted or loved, and no push sends it.
 */

const fs = require('fs');
const path = require('path');

const {
  albumIdentity,
  trackAlbumKeyOf,
  trackArtistNameOf,
  isJunkAlbumTitle,
  mergeCollectionSongs,
  deriveLocalAlbums,
  mergeCollectionAlbums,
  deriveLocalArtists,
  mergeCollectionArtists,
  hideLocalAlbum,
  unhideLocalAlbum,
  planAlbumRemoval,
  savedAlbumIdsFor,
} = require('../../src/renderer/lib/local-albums');
const { generateAlbumId, generateArtistId, generateTrackId } = require('../../sync-engine/collection-id');
const { artistInCollection, albumInCollection, withCollectionState } = require('../../src/renderer/lib/menu-collection-state');

let nextId = 1;
const local = (over) => {
  const filePath = `/m/${nextId}-${over.title}.mp3`;
  return {
    id: `local-${nextId++}`,
    artist: 'Artist',
    filePath,
    sources: { localfiles: { filePath, fileUrl: `file://${filePath}`, confidence: 1 } },
    ...over,
  };
};
const saved = (over) => ({
  id: generateTrackId(over.artist, over.title, over.album),
  addedAt: 1,
  sources: { spotify: { spotifyId: `sp-${over.title}`, confidence: 1 } },
  ...over,
});
const deepFreeze = (o) => { Object.values(o).forEach(v => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };

describe('deriveLocalAlbums', () => {
  test('groups by album artist, else artist, and album title', () => {
    const library = [
      local({ title: 'b', album: 'Kid A', artist: 'Radiohead', trackNumber: 2, year: 2000, indexedAt: 500 }),
      local({ title: 'a', album: 'Kid A', artist: 'Radiohead', trackNumber: 1, albumArt: 'file:///c.jpg', indexedAt: 300 }),
      local({ title: 'x', album: 'Hits', artist: 'One', albumArtist: 'Various Artists' }),
      local({ title: 'y', album: 'Hits', artist: 'Two', albumArtist: 'Various Artists' }),
      local({ title: 'z', album: 'Kid A', artist: 'Someone Else' }),
    ];
    const albums = deriveLocalAlbums(library);
    expect(albums).toHaveLength(3);
    const kidA = albums.find(a => a.artist === 'Radiohead');
    expect(kidA).toMatchObject({ title: 'Kid A', year: 2000, art: 'file:///c.jpg', trackCount: 2, addedAt: 300, isLocal: true });
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
    expect(cjk.key).toBe(albumIdentity('宇多田ヒカル', '初恋'));
  });

  test('"X" and "X - EP" by one artist, in any case, are one album; an edition is another', () => {
    const albums = deriveLocalAlbums([
      local({ title: '1', album: 'Fences - EP', artist: 'Band' }),
      local({ title: '2', album: 'fences', artist: 'BAND' }),
      local({ title: '3', album: 'Fences (Deluxe Edition)', artist: 'Band' }),
    ]);
    expect(albums.map(a => a.trackCount).sort()).toEqual([1, 2]);
    expect(albumIdentity('Band', 'Fences - Single')).toBe(albumIdentity('band', 'Fences'));
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
    expect(isJunkAlbumTitle('Untitled')).toBe(false);
    expect(isJunkAlbumTitle('None')).toBe(false);
    expect(trackAlbumKeyOf(local({ title: 'x', album: 'Unknown Album' }))).toBeNull();
  });

  test('an empty or missing library gives no albums', () => {
    expect(deriveLocalAlbums([])).toEqual([]);
    expect(deriveLocalAlbums(null)).toEqual([]);
  });
});

describe('mergeCollectionSongs', () => {
  test('a song that is both local and saved shows once, with both sources, the saved id and its love', () => {
    const file = local({ title: 'Reckoner', artist: 'Radiohead', album: 'In Rainbows', albumArt: 'file:///ir.jpg', duration: 290 });
    const song = saved({ title: 'Reckoner', artist: 'Radiohead', album: 'In Rainbows', syncSources: { manual: { addedAt: 1 } } });
    const rows = mergeCollectionSongs([file], [song]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(song.id);
    expect(rows[0].syncSources).toEqual(song.syncSources);
    expect(Object.keys(rows[0].sources).sort()).toEqual(['localfiles', 'spotify']);
    expect(rows[0].sources.localfiles.filePath).toBe(file.filePath);
    expect(rows[0].albumArt).toBe('file:///ir.jpg');
    // Its heart reads the saved rows: loved.
    expect(withCollectionState({ type: 'track', track: rows[0] }, { tracks: [song] }).isInCollection).toBe(true);
  });

  test('names compare folded, and a store suffix or a placeholder album still matches', () => {
    const rows = mergeCollectionSongs(
      [
        local({ title: 'Twin Size Mattress', artist: 'The Front Bottoms', album: 'Back on Top' }),
        local({ title: 'Jóga', artist: 'Björk', album: null }),
      ],
      [
        saved({ title: 'twin size mattress', artist: 'the front bottoms', album: 'Back On Top - Single' }),
        saved({ title: 'Joga', artist: 'Bjork', album: 'Homogenic' }),
      ]
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.sources.localfiles).toBeTruthy();
  });

  test('two real, different albums stay two rows', () => {
    const rows = mergeCollectionSongs(
      [local({ title: 'Song', artist: 'A', album: 'Live at Leeds' })],
      [saved({ title: 'Song', artist: 'A', album: 'Studio Album' })]
    );
    expect(rows).toHaveLength(2);
  });

  test('a file matches one saved row at most; unmatched rows are the same objects', () => {
    const file = local({ title: 'Song', artist: 'A', album: 'X' });
    const other = local({ title: 'Other', artist: 'A', album: 'X' });
    const s1 = saved({ title: 'Song', artist: 'A', album: 'X' });
    const s2 = saved({ title: 'Song', artist: 'A', album: '' });
    const rows = mergeCollectionSongs([file, other], [s1, s2]);
    expect(rows).toHaveLength(3);
    expect(rows).toContain(other);
    expect(rows).toContain(s2);
    expect(rows.filter(r => r.sources.localfiles && r.sources.spotify)).toHaveLength(1);
  });

  test('a local-only song is not loved', () => {
    const file = local({ title: 'Home Demo', artist: 'Me', album: 'Tapes' });
    const [row] = mergeCollectionSongs([file], []);
    expect(row).toBe(file);
    expect(withCollectionState({ type: 'track', track: row }, { tracks: [] }).isInCollection).toBe(false);
  });
});

describe('mergeCollectionAlbums', () => {
  const library = [
    local({ title: 'Reckoner', artist: 'Radiohead', album: 'In Rainbows', trackNumber: 7, albumArt: 'file:///ir.jpg' }),
    local({ title: 'Nude', artist: 'Radiohead', album: 'In Rainbows', trackNumber: 3 }),
    local({ title: 'Pyramid Song', artist: 'Radiohead', album: 'Amnesiac', trackNumber: 2 }),
  ];
  const localAlbums = deriveLocalAlbums(library);
  const savedAlbum = { id: generateAlbumId('Radiohead', 'In Rainbows'), title: 'In Rainbows', artist: 'Radiohead', year: 2007, art: null, trackCount: 10, addedAt: 42 };
  const savedTracks = [
    saved({ title: 'Reckoner', artist: 'Radiohead', album: 'In Rainbows', trackNumber: 7 }),
    saved({ title: '15 Step', artist: 'Radiohead', album: 'In Rainbows', trackNumber: 1 }),
  ];
  const songs = mergeCollectionSongs(library, savedTracks);

  test('a local and a saved copy of one album give one entry with the union of tracks and sources', () => {
    const merged = mergeCollectionAlbums([savedAlbum], localAlbums, [], songs);
    expect(merged.map(a => a.title).sort()).toEqual(['Amnesiac', 'In Rainbows']);
    const ir = merged.find(a => a.title === 'In Rainbows');
    expect(ir).toMatchObject({ id: savedAlbum.id, year: 2007, trackCount: 10, addedAt: 42, art: 'file:///ir.jpg' });
    expect(ir.isLocal).toBeUndefined();
    expect(ir.tracks.map(t => t.title)).toEqual(['15 Step', 'Nude', 'Reckoner']);
    const sourcesOf = (title) => Object.keys(ir.tracks.find(t => t.title === title).sources).sort();
    expect(sourcesOf('15 Step')).toEqual(['spotify']);
    expect(sourcesOf('Nude')).toEqual(['localfiles']);
    expect(sourcesOf('Reckoner')).toEqual(['localfiles', 'spotify']);
    expect(new Set(merged.map(a => a.id)).size).toBe(merged.length);
  });

  test('a saved "X - EP" and local "X" are one entry', () => {
    const ep = { id: generateAlbumId('Radiohead', 'Amnesiac - EP'), title: 'Amnesiac - EP', artist: 'Radiohead' };
    const merged = mergeCollectionAlbums([ep], localAlbums, [], songs);
    expect(merged.filter(a => /Amnesiac/.test(a.title))).toEqual([expect.objectContaining({ id: ep.id })]);
  });

  test("the saved album's own cover wins", () => {
    const withArt = { ...savedAlbum, art: 'https://x/ir.jpg' };
    expect(mergeCollectionAlbums([withArt], localAlbums, [], songs)[0].art).toBe('https://x/ir.jpg');
  });

  test('a local-only album is listed but not saved', () => {
    const merged = mergeCollectionAlbums([], localAlbums, [], songs);
    const amnesiac = merged.find(a => a.title === 'Amnesiac');
    expect(amnesiac.isLocal).toBe(true);
    expect(albumInCollection([], amnesiac)).toBe(false);
  });

  test('hidden local albums are left out; saved albums always show', () => {
    const amnesiac = albumIdentity('Radiohead', 'Amnesiac');
    const ir = albumIdentity('Radiohead', 'In Rainbows');
    expect(mergeCollectionAlbums([], localAlbums, [amnesiac], songs).map(a => a.title)).toEqual(['In Rainbows']);
    expect(mergeCollectionAlbums([savedAlbum], localAlbums, [ir, amnesiac], songs).map(a => a.title)).toEqual(['In Rainbows']);
  });

  test('with no local albums the saved list is returned as is', () => {
    const list = [{ id: 'x', title: 'X', artist: 'Y' }];
    expect(mergeCollectionAlbums(list, [], [], [])).toBe(list);
  });
});

describe('artists', () => {
  const library = [
    local({ title: '1', artist: 'Mitski', album: 'Puberty 2', indexedAt: 9 }),
    local({ title: '2', artist: 'Mitski', album: 'Puberty 2', indexedAt: 4 }),
    local({ title: '3', artist: 'Guest', albumArtist: 'Sufjan Stevens', album: 'Carrie & Lowell' }),
    local({ title: '4', artist: 'Real One', albumArtist: 'Various Artists', album: 'Comp' }),
    local({ title: '5', artist: 'Unknown Artist', album: 'Mystery' }),
  ];

  test('derived from album artist, else artist; placeholders skipped', () => {
    const artists = deriveLocalArtists(library);
    expect(artists.map(a => a.name).sort()).toEqual(['Mitski', 'Real One', 'Sufjan Stevens']);
    const mitski = artists.find(a => a.name === 'Mitski');
    expect(mitski).toMatchObject({ id: generateArtistId('Mitski'), trackCount: 2, addedAt: 4, isLocal: true });
    expect(trackArtistNameOf({ albumArtist: 'Various', artist: 'X' })).toBe('X');
  });

  test('a local-only artist appears unstarred; following stars them once; unfollowing leaves them listed, unstarred', () => {
    const localArtists = deriveLocalArtists(library);
    // Not followed: listed, not in collectionData.artists, the star is off.
    let savedArtists = [];
    let merged = mergeCollectionArtists(savedArtists, localArtists);
    expect(merged.filter(a => a.name === 'Mitski')).toHaveLength(1);
    expect(artistInCollection(savedArtists, 'Mitski')).toBe(false);
    // Followed: the user's add puts one row in the saved list; one card.
    savedArtists = [{ id: generateArtistId('mitski'), name: 'mitski', addedAt: 99 }];
    merged = mergeCollectionArtists(savedArtists, localArtists);
    const cards = merged.filter(a => a.name.toLowerCase() === 'mitski');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ addedAt: 99, trackCount: 2 });
    expect(cards[0].isLocal).toBeUndefined();
    expect(artistInCollection(savedArtists, 'Mitski')).toBe(true);
    // Unfollowed: off the saved list, still on the tab, unstarred.
    savedArtists = [];
    merged = mergeCollectionArtists(savedArtists, localArtists);
    expect(merged.filter(a => a.name === 'Mitski')).toHaveLength(1);
    expect(artistInCollection(savedArtists, 'Mitski')).toBe(false);
  });

  test('merging never changes the saved lists', () => {
    const savedArtists = deepFreeze([{ id: generateArtistId('Mitski'), name: 'Mitski' }]);
    const savedAlbums = deepFreeze([{ id: generateAlbumId('Mitski', 'Puberty 2'), title: 'Puberty 2', artist: 'Mitski' }]);
    const savedTracks = deepFreeze([saved({ title: '1', artist: 'Mitski', album: 'Puberty 2' })]);
    expect(() => {
      mergeCollectionArtists(savedArtists, deriveLocalArtists(library));
      const songs = mergeCollectionSongs(library, savedTracks);
      mergeCollectionAlbums(savedAlbums, deriveLocalAlbums(library), [], songs);
    }).not.toThrow();
    expect(savedArtists).toHaveLength(1);
    expect(savedAlbums).toHaveLength(1);
    expect(savedTracks).toHaveLength(1);
  });
});

describe('a merged song carries its file', () => {
  test('the file path rides on the saved row, so its menu offers Show in Finder', () => {
    const file = local({ title: 'Reckoner', artist: 'Radiohead', album: 'In Rainbows' });
    const song = saved({ title: 'Reckoner', artist: 'Radiohead', album: 'In Rainbows' });
    const [row] = mergeCollectionSongs([file], [song]);
    expect(row.id).toBe(song.id);
    expect(row.filePath).toBe(file.filePath);
    // From the local source when the library row has no top-level path.
    const bare = { ...file, filePath: undefined };
    expect(mergeCollectionSongs([bare], [song])[0].filePath).toBe(file.sources.localfiles.filePath);
    // Remove from Collection still means the saved record.
    expect(withCollectionState({ type: 'track', track: row }, { tracks: [song] }).isInCollection).toBe(true);
  });
});

describe('saved copies of one album', () => {
  const x = { id: generateAlbumId('Band', 'Fences'), title: 'Fences', artist: 'Band', addedAt: 50, art: null, year: 2019 };
  const xEp = { id: generateAlbumId('Band', 'Fences - EP'), title: 'Fences - EP', artist: 'Band', addedAt: 10, art: 'https://x/ep.jpg' };
  const other = { id: generateAlbumId('Band', 'Other'), title: 'Other', artist: 'Band', addedAt: 5 };
  const savedTracks = [
    saved({ title: 'One', artist: 'Band', album: 'Fences', trackNumber: 1 }),
    saved({ title: 'Two', artist: 'Band', album: 'Fences - EP', trackNumber: 2 }),
  ];

  test('two saved copies give one entry: the copy without the store suffix, the first cover, both ids, the union of tracks', () => {
    const songs = mergeCollectionSongs([], savedTracks);
    const merged = mergeCollectionAlbums([xEp, other, x], [], [], songs);
    expect(merged.map(a => a.title)).toEqual(['Fences', 'Other']);
    const card = merged[0];
    expect(card).toMatchObject({ id: x.id, title: 'Fences', year: 2019, art: 'https://x/ep.jpg' });
    expect(card.savedIds.sort()).toEqual([x.id, xEp.id].sort());
    expect(card.tracks.map(t => t.title)).toEqual(['One', 'Two']);
    // Shows as saved.
    expect(card.isLocal).toBeUndefined();
    expect(albumInCollection([xEp], { title: 'Fences', artist: 'Band' })).toBe(true);
  });

  test('with no copy free of a store suffix, the earliest saved wins', () => {
    const single = { id: 'band-fences-single', title: 'Fences - Single', artist: 'Band', addedAt: 30 };
    const merged = mergeCollectionAlbums([single, xEp], [], [], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(xEp.id);
  });

  test('display only: the saved records are not changed', () => {
    const list = deepFreeze([{ ...x }, { ...xEp }]);
    expect(() => mergeCollectionAlbums(list, [], [], [])).not.toThrow();
    expect(list.map(a => a.id)).toEqual([x.id, xEp.id]);
  });

  test('removing the merged card removes every saved copy it stands for, and nothing else', () => {
    const merged = mergeCollectionAlbums([x, xEp, other], [], [], []);
    const card = merged.find(a => a.title === 'Fences');
    // What the menu sends back (the card without its tracks).
    const { tracks: _t, ...menuAlbum } = card;
    expect(savedAlbumIdsFor(menuAlbum, [x, xEp, other]).sort()).toEqual([x.id, xEp.id].sort());
    // Named by either title (an album page's menu), the same.
    expect(savedAlbumIdsFor({ title: 'Fences - EP', artist: 'Band' }, [x, xEp, other]).sort()).toEqual([x.id, xEp.id].sort());
    expect(planAlbumRemoval(menuAlbum, new Set(), [x, xEp, other])).toEqual({ hideKey: null, unsave: true });
  });

  test('a saved copy, a local copy and a second saved copy all merge into one', () => {
    const library = [
      local({ title: 'Three', artist: 'Band', album: 'Fences', trackNumber: 3 }),
      local({ title: 'One', artist: 'Band', album: 'Fences', trackNumber: 1 }),
    ];
    const songs = mergeCollectionSongs(library, savedTracks);
    const merged = mergeCollectionAlbums([xEp, x], deriveLocalAlbums(library), [], songs);
    expect(merged).toHaveLength(1);
    const card = merged[0];
    expect(card.id).toBe(x.id);
    expect(card.savedIds.sort()).toEqual([x.id, xEp.id].sort());
    expect(card.tracks.map(t => t.title)).toEqual(['One', 'Two', 'Three']);
    const one = card.tracks.find(t => t.title === 'One');
    expect(Object.keys(one.sources).sort()).toEqual(['localfiles', 'spotify']);
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
  const key = albumIdentity('Radiohead', 'Amnesiac');
  const album = { id: generateAlbumId('Radiohead', 'Amnesiac'), title: 'Amnesiac', artist: 'Radiohead' };

  test('a local-only album is hidden and nothing is unsaved', () => {
    expect(planAlbumRemoval(album, new Set([key]), [])).toEqual({ hideKey: key, unsave: false });
    expect(planAlbumRemoval({ title: 'Amnesiac', artist: 'Radiohead' }, new Set([key]), [])).toEqual({ hideKey: key, unsave: false });
  });

  test('a saved album that is also local is unsaved and hidden', () => {
    expect(planAlbumRemoval(album, new Set([key]), [album])).toEqual({ hideKey: key, unsave: true });
  });

  test('a saved album with no local files is only unsaved', () => {
    expect(planAlbumRemoval(album, new Set(), [album])).toEqual({ hideKey: null, unsave: true });
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

  test('removing an album removes every saved copy savedAlbumIdsFor names, each the old way', () => {
    const body = fnBody('removeAlbumFromCollection');
    expect(body).toMatch(/const matchIds = new Set\(savedAlbumIdsFor\(album, prev\.albums\)\);/);
    expect(body).toMatch(/for \(const existingAlbum of prev\.albums\.filter\(a => matchIds\.has\(a\.id\)\)\)/);
    expect(body).toMatch(/const newAlbums = prev\.albums\.filter\(a => !matchIds\.has\(a\.id\)\);/);
  });

  test('adding an album clears its hide', () => {
    expect(fnBody('addAlbumToCollection')).toMatch(/setHiddenLocalAlbumKeys\(prev => unhideLocalAlbum\(prev, albumIdentity\(album\.artist, album\.title\)\)\)/);
  });

  test('showing is not saving: no derived list reaches a collection write, a sync push or the love push', () => {
    const derived = ['collectionSongs', 'collectionAlbums', 'collectionArtists', 'collectionLocalAlbums', 'collectionLocalArtists', 'collectionTracksRef'];
    const writes = /setCollectionData|saveCollection|collection\.save|electron\.sync\.|runLoveBackfill|lovePush|tombstones/;
    // Line by line (the render expression is one long statement): a line
    // that writes the collection, pushes to a service or pushes loves never
    // names a derived list.
    for (const line of src.split('\n')) {
      if (!writes.test(line)) continue;
      for (const name of derived) expect({ name, line: line.includes(name) ? line.trim() : null }).toEqual({ name, line: null });
    }
    // And no derived list is ever handed to a setter of collectionData.
    expect(src).not.toMatch(/setCollectionData\(\s*(collectionSongs|collectionAlbums|collectionArtists)/);
    // The pushes read what was saved: the persisted collection or collectionDataRef.
    expect(src).toMatch(/const tracks = \(collectionDataRef\.current\?\.tracks \|\| \[\]\);\s*\n\s*const todo = tracks\.filter\(t => !lovePushedKeysRef/);
  });

  test('every Collection consumer reads the merged song list', () => {
    expect(src).toMatch(/const collectionSongs = useMemo\(\s*\(\) => mergeCollectionSongs\(library, collectionData\.tracks\)/);
    expect(src).toContain('for (const track of collectionSongs)');
    expect(src).toContain('collectionTracksRef.current = collectionSongs;');
    expect(src).not.toContain('[...library, ...collectionData.tracks]');
  });

  test('the tabs read the merged lists, never collectionData.albums / .artists', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'collection-page.js'), 'utf8');
    const code = page.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/collectionData\.albums/);
    expect(code).not.toMatch(/collectionData\.artists/);
    expect(code).toMatch(/filterCollectionItems\(collectionAlbums, 'albums'\)/);
    expect(code).toMatch(/filterCollectionItems\(collectionArtists, 'artists'\)/);
    expect(code).not.toMatch(/library\.length/);
  });

  test('the hidden list is persisted under an allowlisted key', () => {
    const store = fs.readFileSync(path.join(__dirname, '..', '..', 'main-process', 'ipc', 'store.js'), 'utf8');
    expect(store).toContain("'collection_hidden_local_albums'");
    expect(src).toContain("window.electron.store.set('collection_hidden_local_albums', hiddenLocalAlbumKeys)");
  });
});

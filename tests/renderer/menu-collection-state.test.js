/**
 * Context menus know what's in the collection (design audit bugs 17-19).
 */
const fs = require('fs');
const path = require('path');
const { withCollectionState } = require('../../src/renderer/lib/menu-collection-state');
const { generateAlbumId, generateArtistId, generateTrackId } = require('../../src/renderer/lib/collection-ids');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const collection = {
  tracks: [{ id: generateTrackId('Spoon', 'Inside Out', 'They Want My Soul'), artist: 'Spoon', title: 'Inside Out', album: 'They Want My Soul' }],
  albums: [{ id: generateAlbumId('Spoon', 'Gimme Fiction'), artist: 'Spoon', title: 'Gimme Fiction' }],
  artists: [{ id: generateArtistId('Spoon'), name: 'Spoon' }],
};

describe('withCollectionState', () => {
  test('a saved track, album or artist is in the collection', () => {
    expect(withCollectionState({ type: 'track', track: { artist: 'Spoon', title: 'Inside Out', album: 'They Want My Soul' } }, collection).isInCollection).toBe(true);
    expect(withCollectionState({ type: 'release', album: { artist: 'Spoon', title: 'Gimme Fiction' } }, collection).isInCollection).toBe(true);
    expect(withCollectionState({ type: 'release', name: 'Gimme Fiction', artist: 'Spoon' }, collection).isInCollection).toBe(true);
    expect(withCollectionState({ type: 'artist', artist: { name: 'Spoon' } }, collection).isInCollection).toBe(true);
  });

  test('anything else is not', () => {
    expect(withCollectionState({ type: 'track', track: { artist: 'Spoon', title: 'The Way We Get By' } }, collection).isInCollection).toBe(false);
    expect(withCollectionState({ type: 'release', album: { artist: 'Spoon', title: 'Kill the Moonlight' } }, collection).isInCollection).toBe(false);
    expect(withCollectionState({ type: 'artist', artist: { name: 'Wussy' } }, collection).isInCollection).toBe(false);
  });

  test('a caller that already decided is left alone, and other types pass through', () => {
    const decided = { type: 'track', track: { artist: 'Spoon', title: 'Inside Out' }, isInCollection: false };
    expect(withCollectionState(decided, collection)).toBe(decided);
    const playlist = { type: 'playlist', playlistId: 'p' };
    expect(withCollectionState(playlist, collection)).toBe(playlist);
  });
});

describe('menu wiring', () => {
  const main = read('main.js');
  const app = read('src/renderer/app.js');

  test('every renderer menu request goes through window.showItemMenu', () => {
    for (const dir of ['src/renderer', 'src/renderer/components', 'src/renderer/hooks']) {
      for (const f of fs.readdirSync(path.join(__dirname, '../..', dir)).filter((n) => n.endsWith('.js'))) {
        const src = read(`${dir}/${f}`);
        // Only showItemMenu itself calls the IPC.
        const calls = src.match(/window\.electron\.contextMenu\.showTrackMenu\(/g) || [];
        expect([f, calls.length]).toEqual([f, f === 'app.js' && dir === 'src/renderer' ? 1 : 0]);
      }
    }
    expect(app).toContain('window.electron.contextMenu.showTrackMenu(withCollectionState(data, collectionDataRef.current))');
  });

  test('albums and artists toggle between Add and Remove', () => {
    expect(main).toContain("label: data.isInCollection ? 'Remove Album from Collection' : 'Add Album to Collection',");
    expect(main).toContain("label: data.isInCollection ? 'Remove Artist from Collection' : 'Add Artist to Collection',");
  });

  test('ephemeral playlists get no Export or Delete', () => {
    expect(main).toMatch(/if \(!data\.isEphemeral\) \{\s*menuItems\.push\(\{ type: 'separator' \}\);\s*menuItems\.push\(\{\s*label: 'Export as XSPF…',/);
  });

  test('a queue row offers Remove from Queue for that row, and keeps Add to Queue', () => {
    expect(read('src/renderer/components/track-lists.js')).toContain("window.showItemMenu({ type: 'track', track, inQueue: true, queueIndex: index });");
    expect(main).not.toContain("if (!(data.type === 'track' && data.inQueue))");
    expect(app).toContain('removeFromQueueRef.current(data.trackId, data.queueIndex);');
    expect(main).toMatch(/if \(data\.type === 'track' && data\.inQueue\) \{\s*menuItems\.push\(\{\s*label: 'Remove from Queue',/);
    expect(app).toContain("if (data.action === 'remove-from-queue' && data.trackId) {");
  });

  test('a Recommendations album menu has tracks to queue', () => {
    const i = app.indexOf("onMouseEnter: () => scheduleTopAlbumHoverPrefetch(item.artist, item.name, art),");
    expect(i).toBeGreaterThan(-1);
    expect(app.slice(i, i + 1400)).toContain('{ tracks: cached, loading: !cached }');
  });
});

describe('removing one queued copy', () => {
  test('removeFromQueue with a row index removes only that row', () => {
    const hook = read('src/renderer/hooks/use-playback-queue.js');
    expect(hook).toMatch(/if \(oneRow && prev\[index\] && prev\[index\]\.id === trackId\) \{\s*const next = \[\.\.\.prev\];\s*next\.splice\(index, 1\);/);
    expect(read('src/renderer/components/track-lists.js')).toContain('removeFromQueue(track.id, index);');
  });
});

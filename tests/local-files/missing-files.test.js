/**
 * "Remove Missing Files" (parachord#1002, part 3). Automatic scans refuse to
 * delete rows when a folder comes back empty, because an unmounted drive looks
 * the same; that guard stays. This is the explicit, user-requested path, and
 * it must keep the same promise: a folder whose root can't be read is never
 * treated as "everything missing", and only a definite ENOENT counts.
 */

const fs = require('fs');
const path = require('path');
const { folderFor, mapLimit, findMissingFiles, removeMissingFiles } = require('../../local-files/missing-files');

const FOLDERS = ['/music', '/music/classical', '/Volumes/External'];

function fakeFs({ unreadable = [], missing = [], unknown = [] } = {}) {
  return {
    folderReadable: async (folder) => !unreadable.includes(folder),
    fileStatus: async (p) => (missing.includes(p) ? 'missing' : unknown.includes(p) ? 'unknown' : 'present'),
  };
}

describe('folderFor', () => {
  test('picks the deepest watch folder containing the file', () => {
    expect(folderFor('/music/a.flac', FOLDERS)).toBe('/music');
    expect(folderFor('/music/classical/b.flac', FOLDERS)).toBe('/music/classical');
  });

  test('a sibling with a shared prefix is not inside the folder', () => {
    expect(folderFor('/musicals/c.flac', FOLDERS)).toBeNull();
    expect(folderFor('/elsewhere/d.flac', FOLDERS)).toBeNull();
  });
});

describe('mapLimit', () => {
  test('keeps order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('findMissingFiles', () => {
  const filePaths = ['/music/a.flac', '/music/gone.flac', '/music/classical/gone2.flac', '/Volumes/External/x.flac', '/outside/y.flac'];

  test('reports only definitely-missing files inside readable folders', async () => {
    const result = await findMissingFiles({
      folders: FOLDERS,
      filePaths,
      ...fakeFs({ missing: ['/music/gone.flac', '/music/classical/gone2.flac'], unknown: ['/music/a.flac'] }),
    });
    expect(result.missing).toEqual(['/music/gone.flac', '/music/classical/gone2.flac']);
    expect(result.unreachableFolders).toEqual([]);
    expect(result.checked).toBe(4); // the row outside every watch folder is not checked
  });

  test('an unreadable folder (unmounted drive) is skipped and named, never counted as missing', async () => {
    const result = await findMissingFiles({
      folders: FOLDERS,
      filePaths,
      ...fakeFs({ unreadable: ['/Volumes/External'], missing: ['/Volumes/External/x.flac'] }),
    });
    expect(result.missing).toEqual([]);
    expect(result.unreachableFolders).toEqual(['/Volumes/External']);
  });

  test('a failing check is "unknown", not missing', async () => {
    const result = await findMissingFiles({
      folders: ['/music'],
      filePaths: ['/music/a.flac'],
      folderReadable: async () => true,
      fileStatus: async () => { throw new Error('EIO'); },
    });
    expect(result.missing).toEqual([]);
  });
});

describe('removeMissingFiles', () => {
  const known = new Set(['/music/gone.flac', '/music/back.flac', '/Volumes/External/x.flac']);

  test('deletes only rows that are known, in a readable folder, and still missing', async () => {
    const removed = [];
    const result = await removeMissingFiles({
      filePaths: ['/music/gone.flac', '/music/back.flac', '/Volumes/External/x.flac', '/music/never-in-library.flac', 42],
      folders: FOLDERS,
      isKnown: (p) => known.has(p),
      ...fakeFs({ unreadable: ['/Volumes/External'], missing: ['/music/gone.flac', '/Volumes/External/x.flac', '/music/never-in-library.flac'] }),
      removeTrack: (p) => removed.push(p),
    });
    expect(removed).toEqual(['/music/gone.flac']);
    expect(result.removed).toEqual(['/music/gone.flac']);
    // back.flac came back, External is unreadable, the rest are not library rows.
    expect(result.kept).toHaveLength(4);
  });
});

describe('wiring', () => {
  const root = path.join(__dirname, '..', '..');
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  // The Collection songs tab moved into its own module (Track 2b split).
  const collectionPage = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'collection-page.js'), 'utf8');

  test('the Collection songs tab tells the menu whether a track is really in the collection', () => {
    // It used to send isInCollection: true for every row, library-only ones
    // included, so "Remove from Collection" failed with "not in your collection".
    expect(collectionPage).not.toMatch(/isInCollection: true\s+\/\/ Collection tracks are always in collection/);
    expect(collectionPage).toMatch(/isLibraryTrack: !inCollection && !!\(track\.filePath \|\| track\.sources\?\.localfiles\?\.filePath\)/);
  });

  test('library-only tracks get Show in Folder, or Remove Missing File when the file is gone', () => {
    expect(main).toMatch(/if \(data\.isLibraryTrack\) \{/);
    expect(main).toMatch(/label: 'Remove Missing File from Library'/);
    expect(app).toMatch(/data\.action === 'remove-missing-local-file'/);
  });

  test('Settings asks before deleting anything', () => {
    const start = app.indexOf('const handleRemoveMissingFiles = async () => {');
    const body = app.slice(start, app.indexOf('\n  };', start));
    expect(body.indexOf('window.confirm(')).toBeGreaterThan(-1);
    expect(body.indexOf('window.confirm(')).toBeLessThan(body.indexOf('bridge.removeMissing('));
  });
});

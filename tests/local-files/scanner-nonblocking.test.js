/**
 * The local-files scan runs in the main process. It used blocking fs calls
 * and never gave the event loop back, so on a spinning disk a 2,000-file
 * library froze the window on Windows (parachord#1117); and every window blur
 * tore down the watchers that the next focus rebuilt, re-walking the library.
 * The three guards against reading an unreadable folder as "everything
 * deleted" (docs/architecture/local-files.md) must survive the async rewrite.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../local-files/metadata-reader', () => ({
  isSupported: (p) => /\.(mp3|flac)$/i.test(p),
  readFile: async (p) => ({ filePath: p, title: require('path').basename(p), artist: 'A' }),
}));

const FileScanner = require('../../local-files/scanner');

const fakeDb = (existingPaths = []) => {
  const rows = new Map(existingPaths.map(p => [p, { file_path: p, modified_at: 0 }]));
  return {
    rows,
    db: {
      prepare: (sql) => ({
        all: (like) => [...rows.keys()].filter(p => p.startsWith(like.replace(/%$/, ''))).map(file_path => ({ file_path })),
        get: (like) => ({ count: [...rows.keys()].filter(p => p.startsWith(like.replace(/%$/, ''))).length }),
      }),
    },
    getTrackByPath: (p) => rows.get(p) || null,
    insertTrack: (m) => rows.set(m.filePath, { file_path: m.filePath, modified_at: 1 }),
    removeTrack: (p) => rows.delete(p),
    updateWatchFolderStats: () => {},
  };
};

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-scan-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); jest.restoreAllMocks(); });

const touch = (rel) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '');
  return p;
};

describe('scanFolder guards', () => {
  test('an unreadable root is skipped and nothing is deleted', async () => {
    const missing = path.join(root, 'gone');
    const db = fakeDb([path.join(missing, 'a.mp3')]);
    const result = await new FileScanner(db).scanFolder(missing);
    expect(result.skipped).toBe('unreadable');
    expect(db.rows.size).toBe(1);
  });

  test('a root that is a file is skipped', async () => {
    const file = touch('not-a-dir.mp3');
    expect((await new FileScanner(fakeDb()).scanFolder(file)).skipped).toBe('not-a-directory');
  });

  test('a root readdir failure aborts the scan before the diff-and-delete', async () => {
    const db = fakeDb([path.join(root, 'a.mp3')]);
    const realReaddir = fs.promises.readdir;
    jest.spyOn(fs.promises, 'readdir').mockImplementation((dir, opts) =>
      dir === root ? Promise.reject(Object.assign(new Error('EIO'), { code: 'EIO' })) : realReaddir(dir, opts));
    const result = await new FileScanner(db).scanFolder(root);
    expect(result.skipped).toBe('walk-failed');
    expect(db.rows.size).toBe(1);
  });

  test('an empty folder with indexed tracks is not wiped', async () => {
    const db = fakeDb([path.join(root, 'a.mp3'), path.join(root, 'b.mp3')]);
    const result = await new FileScanner(db).scanFolder(root);
    expect(result.skipped).toBe('empty-but-db-populated');
    expect(db.rows.size).toBe(2);
  });
});

describe('scanFolder behaviour', () => {
  test('indexes new files, removes vanished ones, skips hidden entries and unsupported files', async () => {
    const kept = touch('Artist/Album/01.mp3');
    touch('Artist/Album/cover.jpg');
    touch('.hidden/x.mp3');
    touch('notes.txt');
    const gone = path.join(root, 'old.flac');
    const db = fakeDb([gone]);
    const result = await new FileScanner(db).scanFolder(root);
    expect(result).toMatchObject({ added: 1, removed: 1, total: 1 });
    expect([...db.rows.keys()]).toEqual([kept]);
  });

  test('finds folder art without regard to case', async () => {
    const song = touch('Album/01.mp3');
    touch('Album/COVER.JPG');
    expect(await new FileScanner(fakeDb()).findFolderArt(song)).toBe(path.join(root, 'Album', 'COVER.JPG'));
    expect(await new FileScanner(fakeDb()).findFolderArt(path.join(root, 'nowhere', 'x.mp3'))).toBeNull();
  });

  test('gives the event loop back while scanning a large folder', async () => {
    for (let i = 0; i < 300; i++) touch(`d${i % 10}/t${i}.mp3`);
    const order = [];
    setImmediate(() => order.push('other work'));
    await new FileScanner(fakeDb()).scanFolder(root).then(() => order.push('scan done'));
    expect(order).toEqual(['other work', 'scan done']);
  });

  test('uses no blocking fs calls', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../local-files/scanner.js'), 'utf8');
    expect(src).not.toMatch(/fs\.(statSync|lstatSync|readdirSync|existsSync)\(/);
  });
});

describe('FileWatcher background grace', () => {
  jest.mock('chokidar', () => ({
    watch: jest.fn(() => ({ on() { return this; }, close: jest.fn(async () => {}) })),
  }));

  const load = () => {
    const chokidar = require('chokidar');
    const FileWatcher = require('../../local-files/watcher');
    const db = { getWatchFolders: () => [{ path: '/music', enabled: true }] };
    const scanner = { scanFolder: jest.fn(async () => ({})) };
    const w = new FileWatcher(db, scanner);
    w.startWatching();
    return { w, chokidar, scanner, FileWatcher };
  };

  beforeEach(() => { jest.useFakeTimers(); jest.resetModules(); });
  afterEach(() => { jest.useRealTimers(); });

  test('a short blur keeps the watchers; nothing is rebuilt', () => {
    const { w, chokidar, FileWatcher } = load();
    expect(chokidar.watch).toHaveBeenCalledTimes(1);
    w.onAppBackground();
    jest.advanceTimersByTime(FileWatcher.BACKGROUND_GRACE_MS - 1);
    w.onAppForeground();
    jest.advanceTimersByTime(FileWatcher.BACKGROUND_GRACE_MS);
    expect(w.isForeground).toBe(true);
    expect(w.watchers.size).toBe(1);
    expect(chokidar.watch).toHaveBeenCalledTimes(1);
  });

  test('a long background switches to polling, and focus rebuilds the watchers once', () => {
    const { w, chokidar, FileWatcher } = load();
    w.onAppBackground();
    w.onAppBackground(); // repeated blur does not stack timers
    jest.advanceTimersByTime(FileWatcher.BACKGROUND_GRACE_MS);
    expect(w.isForeground).toBe(false);
    expect(w.watchers.size).toBe(0);
    expect(w.pollInterval).not.toBeNull();
    w.onAppForeground();
    expect(w.isForeground).toBe(true);
    expect(chokidar.watch).toHaveBeenCalledTimes(2);
    w.stopAll();
  });

  test('stopAll cancels a pending switch', async () => {
    const { w, FileWatcher } = load();
    w.onAppBackground();
    await w.stopAll();
    jest.advanceTimersByTime(FileWatcher.BACKGROUND_GRACE_MS);
    expect(w.isForeground).toBe(true);
    expect(w.pollInterval).toBeNull();
  });
});

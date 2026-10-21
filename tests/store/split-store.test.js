/**
 * The split store keeps big keys (local_playlists, sync_playlist_state, every
 * cache_*) out of config.json. electron-store rewrites and re-parses its whole
 * file on every set(), so a 40 MB config.json made each small setting cost
 * ~0.5 s of main-thread time and the 5-minute cache save froze the window.
 *
 * Driven with real `conf` stores (what electron-store is built on) in a temp
 * dir, so the copy-on-get / file layout behaviour is the library's own.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Conf = require('conf').default;
const { createSplitStore, isSplitStoreKey } = require('../../main-process/split-store');

let root;
let splitDir;
const openMain = () => new Conf({ cwd: root, configName: 'config', projectName: 'parachord-test' });
const deps = (main) => ({
  main,
  openKeyStore: (key) => new Conf({ cwd: splitDir, configName: key, projectName: 'parachord-test' }),
  listKeyStores: () => (fs.existsSync(splitDir) ? fs.readdirSync(splitDir) : [])
    .filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)),
  log: () => {},
});
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'split-store-'));
  splitDir = path.join(root, 'store');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('isSplitStoreKey', () => {
  test.each(['local_playlists', 'sync_playlist_state', 'cache_track_sources', 'cache_anything_new'])('%s is split', (k) => {
    expect(isSplitStoreKey(k)).toBe(true);
  });
  test.each(['saved_volume', 'friends', 'sync_playlist_links', 'cache.x', 'cache_../x', '', null])('%s stays in config.json', (k) => {
    expect(isSplitStoreKey(k)).toBe(false);
  });
});

describe('migration out of config.json', () => {
  test('moves split keys to their own files and leaves the rest', () => {
    const main = openMain();
    main.set({ saved_volume: 70, local_playlists: [{ id: 'p1' }], cache_album_art: { a: 1 } });

    const store = createSplitStore(deps(main));

    const config = readJson(path.join(root, 'config.json'));
    expect(config).toHaveProperty('saved_volume', 70);
    expect(config).not.toHaveProperty('local_playlists');
    expect(config).not.toHaveProperty('cache_album_art');
    expect(readJson(path.join(splitDir, 'local_playlists.json'))).toEqual({ local_playlists: [{ id: 'p1' }] });
    expect(store.get('local_playlists')).toEqual([{ id: 'p1' }]);
    expect(store.get('cache_album_art')).toEqual({ a: 1 });
    expect(store.get('saved_volume')).toBe(70);
  });

  test('a key in both places keeps the split file (an older build wrote config.json)', () => {
    const main = openMain();
    createSplitStore(deps(main)).set('local_playlists', [{ id: 'new' }]);
    main.set('local_playlists', [{ id: 'stale' }]);

    const store = createSplitStore(deps(main));

    expect(store.get('local_playlists')).toEqual([{ id: 'new' }]);
    expect(readJson(path.join(root, 'config.json'))).not.toHaveProperty('local_playlists');
  });

  test('nothing to move leaves config.json untouched', () => {
    const main = openMain();
    main.set('saved_volume', 1);
    const before = fs.statSync(path.join(root, 'config.json')).mtimeMs;
    createSplitStore(deps(main));
    expect(fs.statSync(path.join(root, 'config.json')).mtimeMs).toBe(before);
  });
});

describe('the electron-store surface', () => {
  test('a small setting never rewrites a split file, and a cache never rewrites config.json', () => {
    const store = createSplitStore(deps(openMain()));
    store.set('cache_track_sources', { t: 1 });
    store.set('saved_volume', 5);
    const cacheFile = path.join(splitDir, 'cache_track_sources.json');
    const cacheBefore = fs.readFileSync(cacheFile, 'utf8');
    const configBefore = fs.readFileSync(path.join(root, 'config.json'), 'utf8');

    store.set('saved_volume', 6);
    expect(fs.readFileSync(cacheFile, 'utf8')).toBe(cacheBefore);
    store.set('cache_track_sources', { t: 2 });
    expect(readJson(path.join(root, 'config.json'))).toEqual(JSON.parse(configBefore.replace('5', '6')));
  });

  test('get returns a private copy, as electron-store does', () => {
    const store = createSplitStore(deps(openMain()));
    store.set('local_playlists', [{ id: 'a' }]);
    const got = store.get('local_playlists');
    got.push({ id: 'b' });
    expect(store.get('local_playlists')).toEqual([{ id: 'a' }]);
  });

  test('defaults, has, delete', () => {
    const store = createSplitStore(deps(openMain()));
    expect(store.get('cache_charts', 'dflt')).toBe('dflt');
    expect(store.has('cache_charts')).toBe(false);
    store.set('cache_charts', [1]);
    expect(store.has('cache_charts')).toBe(true);
    store.delete('cache_charts');
    expect(store.get('cache_charts')).toBeUndefined();
  });

  test('object-form set routes each key', () => {
    const store = createSplitStore(deps(openMain()));
    store.set({ saved_volume: 3, cache_concerts: { c: 1 } });
    expect(readJson(path.join(root, 'config.json'))).toEqual({ saved_volume: 3 });
    expect(store.get('cache_concerts')).toEqual({ c: 1 });
  });

  test('`store` merges every key, including split files from an earlier run', () => {
    const main = openMain();
    createSplitStore(deps(main)).set('cache_mbid_mapper', { m: 1 });
    const store = createSplitStore(deps(main));
    store.set('friends', []);
    expect(store.store).toEqual({ friends: [], cache_mbid_mapper: { m: 1 } });
  });

  test('clear empties config.json and every split file', () => {
    const main = openMain();
    createSplitStore(deps(main)).set('local_playlists', [{ id: 'x' }]);
    const store = createSplitStore(deps(main));
    store.set('saved_volume', 9);
    store.clear();
    expect(store.store).toEqual({});
    expect(store.get('local_playlists')).toBeUndefined();
  });
});

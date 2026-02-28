const fs = require('fs');
const path = require('path');
const os = require('os');
const { migrate, MIGRATABLE_KEYS, SENSITIVE_KEYS } = require('../lib/migration');

function createMockStore(filePath) {
  const data = {};
  return {
    get: jest.fn((key, def) => data[key] !== undefined ? data[key] : def),
    set: jest.fn((key, val) => { data[key] = val; }),
    has: jest.fn((key) => key in data),
    delete: jest.fn((key) => { delete data[key]; }),
    flushSync: jest.fn(),
    _data: data,
    filePath: filePath || '/tmp/test-store.json'
  };
}

describe('Migration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parachord-migration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('migrates known keys from Electron store', () => {
    const electronPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(electronPath, JSON.stringify({
      search_history: [{ query: 'test', timestamp: 123 }],
      playlists: [{ id: 'p1', name: 'My Playlist' }],
      unknown_key: 'should be ignored'
    }));

    const store = createMockStore(path.join(tmpDir, 'store.json'));
    const result = migrate(electronPath, store);

    expect(result.migrated).toContain('search_history');
    expect(result.migrated).toContain('playlists');
    expect(result.migrated).not.toContain('unknown_key');
    expect(result.errors).toHaveLength(0);
  });

  test('skips existing keys when overwrite is false', () => {
    const electronPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(electronPath, JSON.stringify({
      search_history: [{ query: 'new' }]
    }));

    const store = createMockStore();
    store._data.search_history = [{ query: 'existing' }];
    store.has.mockImplementation((key) => key in store._data);

    const result = migrate(electronPath, store);
    expect(result.skipped).toContain('search_history');
    expect(result.migrated).not.toContain('search_history');
  });

  test('overwrites existing keys when overwrite is true', () => {
    const electronPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(electronPath, JSON.stringify({
      search_history: [{ query: 'new' }]
    }));

    const store = createMockStore();
    store._data.search_history = [{ query: 'existing' }];
    store.has.mockImplementation((key) => key in store._data);

    const result = migrate(electronPath, store, { overwrite: true });
    expect(result.migrated).toContain('search_history');
  });

  test('excludes sensitive keys by default', () => {
    const electronPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(electronPath, JSON.stringify({
      search_history: [{ query: 'test' }],
      spotify_token: 'secret-token',
      spotify_refresh_token: 'refresh'
    }));

    const store = createMockStore();
    const result = migrate(electronPath, store);

    expect(result.migrated).toContain('search_history');
    expect(result.migrated).not.toContain('spotify_token');
    expect(result.migrated).not.toContain('spotify_refresh_token');
  });

  test('includes sensitive keys when includeTokens is true', () => {
    const electronPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(electronPath, JSON.stringify({
      spotify_token: 'secret-token',
      spotify_refresh_token: 'refresh'
    }));

    const store = createMockStore();
    const result = migrate(electronPath, store, { includeTokens: true });

    expect(result.migrated).toContain('spotify_token');
    expect(result.migrated).toContain('spotify_refresh_token');
  });

  test('handles missing Electron store file', () => {
    const store = createMockStore();
    const result = migrate('/nonexistent/config.json', store);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Failed to read Electron store');
  });

  test('handles invalid JSON in Electron store', () => {
    const electronPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(electronPath, 'not json');

    const store = createMockStore();
    const result = migrate(electronPath, store);
    expect(result.errors).toHaveLength(1);
  });

  test('migrates collection.json if present', () => {
    const electronDir = path.join(tmpDir, 'electron');
    const serverDir = path.join(tmpDir, 'server');
    fs.mkdirSync(electronDir);
    fs.mkdirSync(serverDir);

    const electronPath = path.join(electronDir, 'config.json');
    fs.writeFileSync(electronPath, JSON.stringify({}));
    fs.writeFileSync(path.join(electronDir, 'collection.json'), JSON.stringify({
      tracks: [{ title: 'Song', artist: 'Artist' }]
    }));

    const store = createMockStore(path.join(serverDir, 'store.json'));
    const result = migrate(electronPath, store);
    expect(result.migrated).toContain('collection.json');
    expect(fs.existsSync(path.join(serverDir, 'collection.json'))).toBe(true);
  });

  test('calls flushSync after migration', () => {
    const electronPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(electronPath, JSON.stringify({ search_history: [] }));

    const store = createMockStore();
    migrate(electronPath, store);
    expect(store.flushSync).toHaveBeenCalled();
  });

  test('exports known key lists', () => {
    expect(MIGRATABLE_KEYS).toContain('search_history');
    expect(MIGRATABLE_KEYS).toContain('playlists');
    expect(SENSITIVE_KEYS).toContain('spotify_token');
    expect(SENSITIVE_KEYS).toContain('soundcloud_client_secret');
  });
});

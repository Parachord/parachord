const fs = require('fs');
const path = require('path');
const os = require('os');
const Store = require('../lib/store');

describe('Store', () => {
  let storePath;
  let store;

  beforeEach(() => {
    storePath = path.join(os.tmpdir(), `parachord-test-${Date.now()}.json`);
    store = new Store(storePath);
  });

  afterEach(() => {
    if (store._writeTimer) clearTimeout(store._writeTimer);
    try { fs.unlinkSync(storePath); } catch {}
  });

  test('get/set basic values', () => {
    store.set('foo', 'bar');
    expect(store.get('foo')).toBe('bar');
  });

  test('get returns default for missing key', () => {
    expect(store.get('missing')).toBeUndefined();
    expect(store.get('missing', 42)).toBe(42);
  });

  test('set overwrites existing values', () => {
    store.set('key', 'v1');
    store.set('key', 'v2');
    expect(store.get('key')).toBe('v2');
  });

  test('has checks existence', () => {
    expect(store.has('x')).toBe(false);
    store.set('x', 1);
    expect(store.has('x')).toBe(true);
  });

  test('delete removes key', () => {
    store.set('del', true);
    store.delete('del');
    expect(store.has('del')).toBe(false);
  });

  test('clear removes all keys', () => {
    store.set('a', 1);
    store.set('b', 2);
    store.clear();
    expect(store.has('a')).toBe(false);
    expect(store.has('b')).toBe(false);
  });

  test('flushSync persists to disk', () => {
    store.set('persisted', { nested: true });
    store.flushSync();

    const raw = fs.readFileSync(storePath, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.persisted).toEqual({ nested: true });
  });

  test('loads existing data from file', () => {
    fs.writeFileSync(storePath, JSON.stringify({ loaded: 'yes' }));
    const store2 = new Store(storePath);
    expect(store2.get('loaded')).toBe('yes');
  });

  test('handles missing file gracefully', () => {
    const s = new Store('/tmp/nonexistent-parachord-test.json');
    expect(s.get('anything')).toBeUndefined();
  });

  test('stores complex objects', () => {
    const obj = { resolvers: { spotify: { enabled: true, weight: 5 } } };
    store.set('resolver_configs', obj);
    expect(store.get('resolver_configs')).toEqual(obj);
  });
});

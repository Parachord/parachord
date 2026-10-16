/**
 * main-process/ipc/store.js — the store-* IPC handlers, driven directly with injected
 * fakes (no electron require in the module, by design).
 *
 * Covers the allowlist gate in every direction, the batch handler's
 * one-clone read of store.store (the N×N → N+1 fix), and store-clear's
 * file teardown (plugins dir .axe-only, collection.json, local-files.db
 * + WAL/SHM, ENOENT-tolerant).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerStoreIpc, ALLOWED_STORE_KEYS } = require('../../main-process/ipc/store');

function makeHarness() {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };

  const data = {};
  let storeReads = 0;
  const store = {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    delete: (k) => { delete data[k]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    // electron-store's getter deep-clones the config on every access — the
    // batch handler's perf fix depends on touching it exactly once.
    get store() { storeReads += 1; return { ...data }; },
  };

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-ipc-userdata-'));
  const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-ipc-plugins-'));
  const app = { getPath: () => userDataDir };
  const getPluginsCacheDir = () => pluginsDir;

  registerStoreIpc({ ipcMain, store, app, getPluginsCacheDir });
  return { handlers, store, data, userDataDir, pluginsDir, storeReads: () => storeReads };
}

describe('store-* IPC handlers', () => {
  test('registers the full handler surface', () => {
    const { handlers } = makeHarness();
    expect([...handlers.keys()].sort()).toEqual(['store-clear', 'store-delete', 'store-get', 'store-get-batch', 'store-set']);
  });

  test('store-get passes allowed keys through and refuses non-whitelisted keys', () => {
    const { handlers, data } = makeHarness();
    data['saved_volume'] = 42;
    expect(handlers.get('store-get')(null, 'saved_volume')).toBe(42);
    expect(handlers.get('store-get')(null, 'spotify_token')).toBeUndefined();
    expect(handlers.get('store-get')(null, 'made_up_key')).toBeUndefined();
  });

  test('store-set / store-delete gate on the allowlist and report the refusal', () => {
    const { handlers, data } = makeHarness();
    expect(handlers.get('store-set')(null, 'saved_volume', 7)).toBe(true);
    expect(data['saved_volume']).toBe(7);
    expect(handlers.get('store-set')(null, 'spotify_token', 'x')).toBe(false);
    expect(data['spotify_token']).toBeUndefined();

    expect(handlers.get('store-delete')(null, 'saved_volume')).toBe(true);
    expect(data['saved_volume']).toBeUndefined();
    expect(handlers.get('store-delete')(null, 'not_a_key')).toBe(false);
  });

  test('store-get-batch reads store.store ONCE and filters non-whitelisted keys', () => {
    const { handlers, data, storeReads } = makeHarness();
    data['saved_volume'] = 1;
    data['local_playlists'] = [];
    data['spotify_token'] = 'sensitive';
    const result = handlers.get('store-get-batch')(null, ['saved_volume', 'local_playlists', 'spotify_token', 'nope']);
    expect(result).toEqual({ saved_volume: 1, local_playlists: [] });
    expect(storeReads()).toBe(1);
  });

  test('store-clear wipes the store, cached .axe files only, collection.json and the local-files db (+wal/shm), tolerating ENOENT', async () => {
    const { handlers, data, userDataDir, pluginsDir } = makeHarness();
    data['saved_volume'] = 9;
    fs.writeFileSync(path.join(pluginsDir, 'community.axe'), '{}');
    fs.writeFileSync(path.join(pluginsDir, 'readme.txt'), 'keep me');
    fs.writeFileSync(path.join(userDataDir, 'collection.json'), '{}');
    fs.writeFileSync(path.join(userDataDir, 'local-files.db'), 'db');
    fs.writeFileSync(path.join(userDataDir, 'local-files.db-wal'), 'wal');
    fs.writeFileSync(path.join(userDataDir, 'local-files.db-shm'), 'shm');

    const result = await handlers.get('store-clear')();
    expect(result).toEqual({ success: true });
    expect(data).toEqual({});
    expect(fs.existsSync(path.join(pluginsDir, 'community.axe'))).toBe(false);
    expect(fs.existsSync(path.join(pluginsDir, 'readme.txt'))).toBe(true); // non-.axe files survive
    expect(fs.existsSync(path.join(userDataDir, 'collection.json'))).toBe(false);
    expect(fs.existsSync(path.join(userDataDir, 'local-files.db'))).toBe(false);
    expect(fs.existsSync(path.join(userDataDir, 'local-files.db-wal'))).toBe(false);
    expect(fs.existsSync(path.join(userDataDir, 'local-files.db-shm'))).toBe(false);

    // Second run: everything already gone — still a clean success (ENOENT-tolerant).
    await expect(handlers.get('store-clear')()).resolves.toEqual({ success: true });
  });
});

describe('ALLOWED_STORE_KEYS export', () => {
  test('exports the same allowlist the handlers gate on', () => {
    expect(ALLOWED_STORE_KEYS.size).toBeGreaterThan(50);
    expect(ALLOWED_STORE_KEYS.has('local_playlists')).toBe(true);
    expect(ALLOWED_STORE_KEYS.has('spotify_token')).toBe(false); // sensitive — dedicated handler only
  });
});

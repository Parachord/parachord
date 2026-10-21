// main-process/split-store.js — keep the big persisted keys out of config.json.
//
// electron-store (conf) keeps every key in one JSON file, and every set() of
// any key re-reads and re-parses that whole file, rewrites all of it, and
// makes the next get() parse it again — synchronously, on the main thread.
// On a populated install config.json reached 40 MB (17 MB local_playlists,
// 9 MB cache_track_sources, 2.5 MB cache_album_release_ids, ...): one small
// set() cost ~370 ms and the read after it ~165 ms. The renderer's 5-minute
// cache + settings save does ~25 sets in a row, which froze the window for
// several seconds (the macOS pinwheel), and every track change and playlist
// save paid the same toll.
//
// The fix keeps electron-store's semantics (atomic writes, a fresh copy from
// every get) but gives each big key a file of its own under userData/store/:
// a set() then costs what its own key weighs, and a small setting rewrites a
// config.json of about a megabyte. Callers see the same get/set/delete/has/
// clear/store surface, so nothing outside main.js changes.
//
// Migration is one-way and runs at construction: a split key still in
// config.json is copied to its own file, then config.json is rewritten once
// without it. Where both hold a key (an interrupted migration, or an older
// build that wrote config.json again) the split file wins — it is the copy
// this build has been writing. An older build run after this one sees no
// playlists or caches (the data is in the split files, untouched), and its
// edits there are dropped when this build next starts.
//
// Pure apart from what it is handed ({ main, openKeyStore, listKeyStores }),
// so jest drives it with real conf stores in a temp dir
// (tests/store/split-store.test.js).

'use strict';

// Big or frequently rewritten keys. Every cache_* key the renderer persists
// is split by prefix, so a new cache gets its own file without an edit here.
const SPLIT_KEYS = new Set(['local_playlists', 'sync_playlist_state']);
const SPLIT_PREFIX = 'cache_';
const SAFE_KEY = /^[a-z0-9_]+$/;

function isSplitStoreKey(key) {
  return typeof key === 'string' && SAFE_KEY.test(key)
    && (SPLIT_KEYS.has(key) || key.startsWith(SPLIT_PREFIX));
}

function createSplitStore({ main, openKeyStore, listKeyStores, log = console.log }) {
  const keyStores = new Map();
  const keyStore = (key) => {
    let s = keyStores.get(key);
    if (!s) {
      s = openKeyStore(key);
      keyStores.set(key, s);
    }
    return s;
  };
  // Split keys that currently have a file, so `store` and clear() see keys
  // written by an earlier run as well as this one.
  const splitKeysOnDisk = () => {
    const keys = new Set(keyStores.keys());
    for (const key of listKeyStores()) if (isSplitStoreKey(key)) keys.add(key);
    return keys;
  };

  // One-time migration out of config.json.
  const all = main.store;
  const moved = Object.keys(all).filter(isSplitStoreKey);
  if (moved.length > 0) {
    const t0 = Date.now();
    for (const key of moved) {
      const s = keyStore(key);
      if (!s.has(key)) s.set(key, all[key]);
    }
    const rest = { ...all };
    for (const key of moved) delete rest[key];
    main.store = rest;
    log(`📦 Moved ${moved.length} large key(s) out of config.json into their own files (${Date.now() - t0}ms): ${moved.join(', ')}`);
  }

  const route = (key) => (isSplitStoreKey(key) ? keyStore(key) : main);

  return {
    get(key, defaultValue) {
      return route(key).get(key, defaultValue);
    },
    set(key, value) {
      if (key !== null && typeof key === 'object') {
        const rest = {};
        for (const [k, v] of Object.entries(key)) {
          if (isSplitStoreKey(k)) keyStore(k).set(k, v);
          else rest[k] = v;
        }
        if (Object.keys(rest).length > 0) main.set(rest);
        return;
      }
      route(key).set(key, value);
    },
    has(key) {
      return route(key).has(key);
    },
    delete(key) {
      route(key).delete(key);
    },
    clear() {
      main.clear();
      for (const key of splitKeysOnDisk()) keyStore(key).clear();
    },
    // Every key, as electron-store's `store` getter gives it (a copy).
    get store() {
      const merged = { ...main.store };
      for (const key of splitKeysOnDisk()) {
        const value = keyStore(key).get(key);
        if (value !== undefined) merged[key] = value;
      }
      return merged;
    },
    get path() {
      return main.path;
    },
  };
}

module.exports = { createSplitStore, isSplitStoreKey };

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
//
// `local_playlists` itself is one file per playlist under store/playlists/
// (main-process/playlist-store.js, #801): even in a file of its own, the list
// was 15 MB, and one playlist save re-read, re-parsed and rewrote all of it
// (~260 ms). The array get/set keep working for every caller; `savePlaylist`
// and `getPlaylist` touch one record. The first run of this build moves the
// single file there (built under a temporary name and renamed into place, so
// an interrupted move leaves the single file in charge) and renames the
// single file to local_playlists.json.premigration. An older build run after
// that sees no playlists, as it saw no caches after the first split.
//
// Every `local_playlists` write is also where playlist freshness is stamped
// (`tracksChangedAt`, `lastChangeAdded`; playlist-freshness.js): the renderer's
// playlists.save IPC, the sync IPC and main.js's own handlers all land here.
// The previous version comes from an index of what this store last wrote (or,
// before the first write, from the file), so a write doesn't parse the 17 MB
// list a second time. Stamping never blocks a write: if it throws, the list
// is written as given.

'use strict';

const fsDefault = require('fs');
const { createPlaylistStore } = require('./playlist-store');

// Big or frequently rewritten keys. Every cache_* key the renderer persists
// is split by prefix, so a new cache gets its own file without an edit here.
const SPLIT_KEYS = new Set(['local_playlists', 'sync_playlist_state']);
const SPLIT_PREFIX = 'cache_';
const SAFE_KEY = /^[a-z0-9_]+$/;
const PLAYLISTS_KEY = 'local_playlists';

function isSplitStoreKey(key) {
  return typeof key === 'string' && SAFE_KEY.test(key)
    && (SPLIT_KEYS.has(key) || key.startsWith(SPLIT_PREFIX));
}

function createSplitStore({ main, openKeyStore, listKeyStores, playlistsDir, retireKeyStore, fs = fsDefault, log = console.log, now = Date.now }) {
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
    keys.delete(PLAYLISTS_KEY);
    return keys;
  };

  // `local_playlists`, one file per playlist (see the header).
  const openPlaylists = () => createPlaylistStore({ dir: playlistsDir, fs, log, now });
  let playlists = openPlaylists();
  const migratingDir = `${playlistsDir}.migrating`;
  fs.rmSync(migratingDir, { recursive: true, force: true });
  const migratePlaylists = (list, from) => {
    if (playlists.has()) return false;
    const t0 = Date.now();
    const staging = createPlaylistStore({ dir: migratingDir, fs, log, now });
    staging.importList(Array.isArray(list) ? list : []);
    fs.rmSync(playlistsDir, { recursive: true, force: true });
    fs.renameSync(migratingDir, playlistsDir);
    playlists = openPlaylists();
    log(`📦 Moved ${Array.isArray(list) ? list.length : 0} playlist(s) from ${from} into a file each (${Date.now() - t0}ms)`);
    return true;
  };

  // One-time migration out of config.json.
  const all = main.store;
  const moved = Object.keys(all).filter(isSplitStoreKey);
  if (moved.length > 0) {
    const t0 = Date.now();
    for (const key of moved) {
      if (key === PLAYLISTS_KEY) {
        // Only into an empty playlist store: a split copy is the newer one.
        if (!listKeyStores().includes(PLAYLISTS_KEY)) migratePlaylists(all[key], 'config.json');
        continue;
      }
      const s = keyStore(key);
      if (!s.has(key)) s.set(key, all[key]);
    }
    const rest = { ...all };
    for (const key of moved) delete rest[key];
    main.store = rest;
    log(`📦 Moved ${moved.length} large key(s) out of config.json into their own files (${Date.now() - t0}ms): ${moved.join(', ')}`);
  }

  // The single local_playlists file of the first split, then set aside.
  if (listKeyStores().includes(PLAYLISTS_KEY)) {
    const legacy = keyStore(PLAYLISTS_KEY);
    if (legacy.has(PLAYLISTS_KEY)) migratePlaylists(legacy.get(PLAYLISTS_KEY), 'local_playlists.json');
    keyStores.delete(PLAYLISTS_KEY);
    retireKeyStore(PLAYLISTS_KEY);
  }

  const route = (key) => (isSplitStoreKey(key) ? keyStore(key) : main);

  const writeSplit = (key, value) => {
    if (key === PLAYLISTS_KEY) playlists.set(value);
    else keyStore(key).set(key, value);
  };

  return {
    get(key, defaultValue) {
      if (key === PLAYLISTS_KEY) return playlists.get(defaultValue);
      return route(key).get(key, defaultValue);
    },
    set(key, value) {
      if (key !== null && typeof key === 'object') {
        const rest = {};
        for (const [k, v] of Object.entries(key)) {
          if (isSplitStoreKey(k)) writeSplit(k, v);
          else rest[k] = v;
        }
        if (Object.keys(rest).length > 0) main.set(rest);
        return;
      }
      if (isSplitStoreKey(key)) writeSplit(key, value);
      else main.set(key, value);
    },
    has(key) {
      if (key === PLAYLISTS_KEY) return playlists.has();
      return route(key).has(key);
    },
    delete(key) {
      if (key === PLAYLISTS_KEY) playlists.delete();
      else route(key).delete(key);
    },
    clear() {
      playlists.delete();
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
      if (playlists.has()) merged[PLAYLISTS_KEY] = playlists.get();
      return merged;
    },
    // One playlist: the stored record with this id (a copy), or null.
    getPlaylist(id) {
      return playlists.getPlaylist(id);
    },
    // Save one playlist (replacing the stored record with its id, or adding
    // it), freshness-stamped; writes that playlist's file and nothing else.
    savePlaylist(record) {
      return playlists.savePlaylist(record);
    },
    get path() {
      return main.path;
    },
  };
}

module.exports = { createSplitStore, isSplitStoreKey };

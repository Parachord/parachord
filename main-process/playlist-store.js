// main-process/playlist-store.js — `local_playlists` as one file per playlist
// (#801).
//
// The list used to be one JSON file (15.5 MB on a 199-playlist library, most
// of it each track's resolved sources). electron-store reads and parses its
// file on every get and again inside every set, then rewrites all of it, on
// the main thread: one renderer playlist save (`playlists-save`) cost ~260 ms
// (measured 2026-11-22), and while tracks resolve the renderer flushes sources
// to every changed playlist every 5 seconds. One playlist's file is ~40 KB and
// writes in ~3 ms.
//
// Layout, under `dir` (userData/store/playlists/):
//   index.json        { version: 1, order: [key, ...] }, the list's order
//   p-<sha1>.json     one record, as stored (readable as is)
// A record's key is its id; a second record with the same id, or one with no
// id, gets a key of its own, so the list round-trips exactly as the single
// file kept it (no caller has to change).
//
// Memory: each record's JSON text, so a set() can tell which records changed
// (and writes only those) and a get() hands back a fresh copy, as
// electron-store does. Loaded lazily, on the first call.
//
// Writes are atomic per file (a .tmp then rename). A record is written before
// the index, so a crash between them leaves a file the index doesn't name:
// it is read on the next load and put at the end, rather than lost. A removal
// rewrites the index first and deletes the file after, so the same crash can
// bring a removed playlist back once; a lost playlist would be worse.
//
// Freshness (`tracksChangedAt`, `lastChangeAdded`; playlist-freshness.js) is
// stamped on every write against the stored version, as split-store did for
// the single file. `importList` (the migration) writes records as they are.

'use strict';

const fsDefault = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { indexPlaylists, stampTrackChanges } = require('../playlist-freshness');

const INDEX_FILE = 'index.json';

// A key's file: sha1 so any id (slashes, dots, reserved names, length) is a
// safe file name on every platform.
function fileNameFor(key) {
  return `p-${createHash('sha1').update(String(key)).digest('hex')}.json`;
}

// The keys for a list, in order: the id, then `id\u0000n` for its nth repeat;
// `\u0000noid\u0000n` for the nth record without one.
function keysFor(list) {
  const seen = new Map();
  let noId = 0;
  return list.map((p) => {
    if (!p || typeof p !== 'object' || p.id == null) return `\u0000noid\u0000${noId++}`;
    const id = String(p.id);
    const n = seen.get(id) || 0;
    seen.set(id, n + 1);
    return n === 0 ? id : `${id}\u0000${n}`;
  });
}

function createPlaylistStore({ dir, fs = fsDefault, log = console.log, now = Date.now }) {
  let loaded = false;
  let exists = false;
  let order = [];                 // keys, in list order
  let texts = new Map();          // key -> the record's JSON text
  let freshness = new Map();      // id -> playlist-freshness entry (null: build on use)
  let unclaimed = null;           // load's parsed records, until a get or a write

  const filePath = (name) => path.join(dir, name);

  const writeAtomic = (name, text) => {
    fs.mkdirSync(dir, { recursive: true });
    const target = filePath(name);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, target);
  };
  const remove = (name) => {
    try { fs.unlinkSync(filePath(name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  const writeIndex = () => writeAtomic(INDEX_FILE, JSON.stringify({ version: 1, order }));

  const load = () => {
    if (loaded) return;
    loaded = true;
    let names;
    try { names = fs.readdirSync(dir); } catch { names = []; }
    for (const name of names) if (name.endsWith('.tmp')) remove(name);
    let indexOrder = null;
    if (names.includes(INDEX_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath(INDEX_FILE), 'utf8'));
        if (parsed && Array.isArray(parsed.order)) indexOrder = parsed.order.map(String);
      } catch (error) {
        log(`⚠️ Playlist index couldn’t be read (${error.message}); reading every playlist file`);
      }
    }
    const recordFiles = new Set(names.filter((n) => n.startsWith('p-') && n.endsWith('.json')));
    exists = indexOrder !== null || recordFiles.size > 0;

    const readRecord = (name) => {
      try {
        const text = fs.readFileSync(filePath(name), 'utf8');
        return { text, record: JSON.parse(text) };
      } catch (error) {
        log(`⚠️ Playlist file ${name} couldn’t be read (${error.message}); set aside as ${name}.corrupt`);
        try { fs.renameSync(filePath(name), filePath(`${name}.corrupt`)); } catch {}
        return null;
      }
    };

    const records = [];  // { text } in order
    for (const key of indexOrder || []) {
      const name = fileNameFor(key);
      if (!recordFiles.has(name)) { log(`⚠️ Playlist file for "${key}" is missing; skipped`); continue; }
      recordFiles.delete(name);
      const read = readRecord(name);
      if (read) records.push({ ...read, name });
    }
    // Files the index doesn't name: written before a crash stopped the index
    // write. Oldest first, at the end.
    const orphans = [...recordFiles]
      .map((name) => ({ name, mtime: (() => { try { return fs.statSync(filePath(name)).mtimeMs; } catch { return 0; } })() }))
      .sort((a, b) => a.mtime - b.mtime);
    for (const { name } of orphans) {
      const read = readRecord(name);
      if (!read) continue;
      log(`⚠️ Playlist file ${name} wasn’t in the index; kept`);
      records.push({ ...read, name });
    }

    order = keysFor(records.map((r) => r.record));
    texts = new Map(order.map((key, i) => [key, records[i].text]));
    // Built at the first write, which needs it (most launches read first).
    freshness = null;
    // The records just parsed are a copy nobody else holds: the first get
    // hands them out instead of parsing every file a second time.
    unclaimed = records.map((r) => r.record);
    // An orphan (or a record whose key moved) is renamed to its key's file,
    // and the index is rewritten to match.
    let renamed = false;
    order.forEach((key, i) => {
      const want = fileNameFor(key);
      if (records[i].name !== want) {
        writeAtomic(want, records[i].text);
        remove(records[i].name);
        renamed = true;
      }
    });
    if (renamed || (exists && (indexOrder === null || indexOrder.length !== order.length || indexOrder.some((k, i) => k !== order[i])))) {
      writeIndex();
    }
  };

  // Write `list` as the whole stored list: changed records, then the index if
  // the order moved, then the files of records that went.
  const writeList = (list, { stamp }) => {
    unclaimed = null;
    let next = list;
    let nextFreshness;
    if (stamp) {
      const filled = new Map();
      try {
        next = stampTrackChanges(freshnessIndex(), list, now(), filled);
        nextFreshness = filled;
      } catch (error) {
        log(`⚠️ Playlist freshness stamp skipped: ${error && error.message}`);
        next = list;
        nextFreshness = indexPlaylists(list);
      }
    } else {
      nextFreshness = indexPlaylists(list);
    }
    const keys = keysFor(next);
    const nextTexts = new Map();
    keys.forEach((key, i) => {
      const text = JSON.stringify(next[i] === undefined ? null : next[i]);
      nextTexts.set(key, text);
      if (texts.get(key) !== text) writeAtomic(fileNameFor(key), text);
    });
    const orderMoved = !exists || keys.length !== order.length || keys.some((k, i) => k !== order[i]);
    const gone = order.filter((key) => !nextTexts.has(key));
    order = keys;
    texts = nextTexts;
    freshness = nextFreshness;
    if (orderMoved) writeIndex();
    exists = true;
    for (const key of gone) remove(fileNameFor(key));
  };

  const freshnessIndex = () => {
    if (!freshness) freshness = indexPlaylists(order.map((key) => JSON.parse(texts.get(key))));
    return freshness;
  };

  const keyOfId = (id) => (id == null ? null : (texts.has(String(id)) ? String(id) : null));

  return {
    has() {
      load();
      return exists;
    },
    get(defaultValue) {
      load();
      if (!exists) return defaultValue;
      if (unclaimed) {
        const list = unclaimed;
        unclaimed = null;
        return list;
      }
      return order.map((key) => JSON.parse(texts.get(key)));
    },
    set(list) {
      load();
      if (!Array.isArray(list)) throw new TypeError('local_playlists must be an array');
      writeList(list, { stamp: true });
    },
    // The migration: the records as they were, no freshness stamps.
    importList(list) {
      load();
      writeList(Array.isArray(list) ? list : [], { stamp: false });
    },
    delete() {
      load();
      unclaimed = null;
      for (const key of order) remove(fileNameFor(key));
      remove(INDEX_FILE);
      order = [];
      texts = new Map();
      freshness = new Map();
      exists = false;
    },
    // One stored record (the first with this id), as a copy, or null.
    getPlaylist(id) {
      load();
      const key = keyOfId(id);
      return key == null ? null : JSON.parse(texts.get(key));
    },
    // Replace the first record with this id, or add it at the end; writes its
    // file (and the index, when it is new) and nothing else.
    savePlaylist(record) {
      load();
      if (!record || typeof record !== 'object' || record.id == null) throw new TypeError('a playlist needs an id');
      unclaimed = null;
      const id = String(record.id);
      const filled = new Map();
      let stamped = record;
      try {
        // Only this playlist's previous version is needed; the whole index
        // is built only when a whole-list write asks for it.
        const prev = freshness || indexPlaylists(texts.has(id) ? [JSON.parse(texts.get(id))] : []);
        stamped = stampTrackChanges(prev, [record], now(), filled)[0];
      } catch (error) {
        log(`⚠️ Playlist freshness stamp skipped: ${error && error.message}`);
      }
      const text = JSON.stringify(stamped);
      const isNew = !texts.has(id);
      if (texts.get(id) !== text) writeAtomic(fileNameFor(id), text);
      texts.set(id, text);
      if (freshness && filled.has(id)) freshness.set(id, filled.get(id));
      if (isNew) {
        order = [...order, id];
        writeIndex();
      }
      exists = true;
      return stamped;
    },
  };
}

module.exports = { createPlaylistStore, fileNameFor, keysFor };

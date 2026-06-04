/**
 * Track Tombstones — durable "user removed this on purpose" markers.
 *
 * Addresses parachord#864. The sync diff (`calculateDiff` in this
 * directory's index.js) only knows two cases: "remote has it, local
 * doesn't → add" and "local has it, remote doesn't → remove." Without
 * a tombstone, the diff cannot distinguish "the user never had this"
 * from "the user deleted this," so any remote-remove failure
 * (transient or structural — Apple Music has no remove API at all)
 * results in the user's removal being silently undone by the next
 * sync. The reported symptom is "tracks I removed keep coming back."
 *
 * This module is the per-track analog of `suppressSync(providerId,
 * externalId)` for playlists (app.js ~L7966). Keyed by
 * (providerId, externalId), TTL'd, with re-arm on every sync that
 * confirms the remote still has the track.
 *
 * The module is pure functions taking a store-like object — main.js
 * passes electron-store; tests inject an in-memory fake. No I/O
 * beyond the store interface.
 *
 * Storage shape (electron-store key `removed_track_tombstones`):
 *   {
 *     [providerId]: {
 *       [externalId]: { removedAt: number }
 *     }
 *   }
 *
 * Cleanup invariants:
 *   - Re-add via UI (addTrackToCollection) should call
 *     `clearTombstones` for every (provider, externalId) on the
 *     re-added track shape.
 *   - App start should call `pruneExpired` once.
 *   - Every sync:start should call `filterRemoteByTombstones` BEFORE
 *     passing remote tracks to `calculateDiff`. On any hit the
 *     tombstone's TTL is re-armed automatically — proves the remote
 *     still has the track, so the tombstone stays durable for the
 *     full TTL window after every confirmation.
 */

const TOMBSTONE_KEY = 'removed_track_tombstones';
const TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 365 days

const _isValidStr = (v) => typeof v === 'string' && v.length > 0;
const _read = (store) => store.get(TOMBSTONE_KEY) || {};
const _write = (store, data) => store.set(TOMBSTONE_KEY, data);

/**
 * Add (or refresh) a tombstone for (providerId, externalId).
 * Idempotent — same key updates `removedAt`. Returns true on write.
 */
const addTombstone = (store, providerId, externalId, now = Date.now()) => {
  if (!_isValidStr(providerId) || !_isValidStr(externalId)) return false;
  const all = _read(store);
  if (!all[providerId]) all[providerId] = {};
  all[providerId][externalId] = { removedAt: now };
  _write(store, all);
  return true;
};

/**
 * Batch variant — writes once for multiple entries. Returns the
 * count of valid entries written. Invalid entries are silently
 * skipped (don't reject the whole batch).
 */
const addTombstones = (store, entries, now = Date.now()) => {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  const all = _read(store);
  let written = 0;
  for (const e of entries) {
    if (!e || !_isValidStr(e.providerId) || !_isValidStr(e.externalId)) continue;
    if (!all[e.providerId]) all[e.providerId] = {};
    all[e.providerId][e.externalId] = { removedAt: now };
    written++;
  }
  if (written > 0) _write(store, all);
  return written;
};

/**
 * Read a single tombstone. Returns `{removedAt}` or `null`.
 */
const getTombstone = (store, providerId, externalId) => {
  const all = _read(store);
  return all[providerId]?.[externalId] || null;
};

/**
 * Remove a single tombstone. Returns true if it existed.
 */
const clearTombstone = (store, providerId, externalId) => {
  const all = _read(store);
  if (!all[providerId]?.[externalId]) return false;
  delete all[providerId][externalId];
  if (Object.keys(all[providerId]).length === 0) delete all[providerId];
  _write(store, all);
  return true;
};

/**
 * Batch clear — used by re-add paths where we want to wipe every
 * (providerId, externalId) on a re-added track. Returns the count
 * of entries that existed and were removed.
 */
const clearTombstones = (store, entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  const all = _read(store);
  let cleared = 0;
  for (const e of entries) {
    if (!e || !all[e.providerId]?.[e.externalId]) continue;
    delete all[e.providerId][e.externalId];
    if (Object.keys(all[e.providerId]).length === 0) delete all[e.providerId];
    cleared++;
  }
  if (cleared > 0) _write(store, all);
  return cleared;
};

/**
 * Sweep entries older than TTL. Also removes corrupt entries
 * lacking `removedAt`. Returns the count pruned.
 */
const pruneExpired = (store, ttlMs = TOMBSTONE_TTL_MS, now = Date.now()) => {
  const all = _read(store);
  let pruned = 0;
  for (const providerId of Object.keys(all)) {
    const bucket = all[providerId];
    for (const externalId of Object.keys(bucket)) {
      const entry = bucket[externalId];
      const removedAt = entry && typeof entry.removedAt === 'number' ? entry.removedAt : null;
      if (removedAt === null || (now - removedAt) > ttlMs) {
        delete bucket[externalId];
        pruned++;
      }
    }
    if (Object.keys(bucket).length === 0) delete all[providerId];
  }
  if (pruned > 0) _write(store, all);
  return pruned;
};

/**
 * Filter remote items by tombstones. Items with an `externalId`
 * present in the tombstone bucket for `providerId` are dropped.
 *
 * Side effect by design: every hit re-arms the tombstone's
 * `removedAt` to `now`, extending its TTL. This keeps the user's
 * intent durable for as long as the remote keeps the track AND the
 * user keeps syncing the provider — the tombstone only expires after
 * a full TTL window with no further sync hits, which usually means
 * the remote no longer has it OR the user has stopped using this
 * client.
 *
 * Returns `{filtered, dropped}`. Returns the input unchanged (with
 * dropped=0) if items is empty/null or the provider has no
 * tombstones.
 */
const filterRemoteByTombstones = (store, items, providerId, now = Date.now()) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { filtered: items, dropped: 0 };
  }
  if (!_isValidStr(providerId)) {
    return { filtered: items, dropped: 0 };
  }
  const all = _read(store);
  const providerMap = all[providerId];
  if (!providerMap) return { filtered: items, dropped: 0 };

  const filtered = [];
  let dropped = 0;
  let touched = false;
  for (const item of items) {
    const ext = item?.externalId;
    if (ext && providerMap[ext]) {
      providerMap[ext] = { removedAt: now };
      touched = true;
      dropped++;
    } else {
      filtered.push(item);
    }
  }
  if (touched) _write(store, all);
  return { filtered, dropped };
};

module.exports = {
  TOMBSTONE_KEY,
  TOMBSTONE_TTL_MS,
  addTombstone,
  addTombstones,
  getTombstone,
  clearTombstone,
  clearTombstones,
  pruneExpired,
  filterRemoteByTombstones
};

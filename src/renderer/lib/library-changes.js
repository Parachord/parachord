// src/renderer/lib/library-changes.js — apply a local-files watcher change to
// the renderer's library without reloading all of it (#784).
//
// Every onLibraryChanged used to call getAllTracks: the whole library over
// IPC (and, before #1093, 2-3 blocking file checks per track in main), then
// a full re-render and the stale-source reconcile, for a change that is
// usually one file added or re-tagged. The watcher's per-file results say
// exactly which paths changed, so the renderer can fetch just those rows.
// Anything that is not a per-file result (a folder scan, a rescan, a folder
// removed, "remove missing files", a background poll with changes) still
// triggers a full reload: those can touch any number of rows.
//
// Pure, so jest drives it directly (tests/renderer/library-changes.test.js).

'use strict';

// Above this many changed paths a full reload is simpler and no slower.
const MAX_INCREMENTAL_PATHS = 5000;

// { incremental, upsertPaths, removedPaths }. `changes` is the watcher's
// array of results, or the single { type: 'update', filePath } object the
// ID3 editor sends.
function classifyLibraryChanges(changes) {
  const list = Array.isArray(changes) ? changes : [changes];
  const byPath = new Map(); // path -> 'upsert' | 'remove'; a later change wins
  for (const change of list) {
    if (!change || typeof change !== 'object') return { incremental: false, upsertPaths: [], removedPaths: [] };
    if (change.action === 'error') continue; // a file that failed to index changes nothing
    let filePath = null;
    let kind = null;
    if ((change.action === 'added' || change.action === 'updated') && change.track) {
      filePath = change.track.filePath;
      kind = 'upsert';
    } else if (change.action === 'removed') {
      filePath = change.filePath;
      kind = 'remove';
    } else if (change.type === 'update') {
      filePath = change.filePath;
      kind = 'upsert';
    }
    if (!kind || typeof filePath !== 'string' || !filePath) {
      return { incremental: false, upsertPaths: [], removedPaths: [] };
    }
    byPath.set(filePath, kind);
  }
  if (byPath.size > MAX_INCREMENTAL_PATHS) return { incremental: false, upsertPaths: [], removedPaths: [] };
  const upsertPaths = [];
  const removedPaths = [];
  for (const [filePath, kind] of byPath) (kind === 'upsert' ? upsertPaths : removedPaths).push(filePath);
  return { incremental: true, upsertPaths, removedPaths };
}

// The library with `removedPaths` and the old rows for every upserted path
// dropped, and `fetched` (the current rows for the upserted paths) appended.
// Matching is by filePath, not id: a re-indexed file gets a new DB row id.
// Returns the same array when nothing changes.
function applyLibraryPatch(library, { upsertPaths, removedPaths }, fetched) {
  const drop = new Set([...removedPaths, ...upsertPaths]);
  const rows = Array.isArray(fetched) ? fetched : [];
  if (drop.size === 0 && rows.length === 0) return library;
  const kept = library.filter((track) => !drop.has(track.filePath));
  if (kept.length === library.length && rows.length === 0) return library;
  return kept.concat(rows);
}

// The local-art pass looks up one track per album and applies the cover to
// the whole album (#784). Tracks of one album share this key; a track with
// no album gets a key of its own, because "every untitled track by this
// artist" is not one album and must not share a cover.
function albumArtGroupKey(track) {
  const album = (track.album || '').trim().toLowerCase();
  if (!album) return `file|${track.filePath || track.id}`;
  return `${(track.albumArtist || track.artist || '').trim().toLowerCase()}|${album}`;
}

module.exports = { classifyLibraryChanges, applyLibraryPatch, albumArtGroupKey, MAX_INCREMENTAL_PATHS };

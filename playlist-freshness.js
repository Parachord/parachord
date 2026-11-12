// playlist-freshness.js: when did a playlist's tracks last change, and how
// many tracks did that change add.
//
// Home's "Your playlists, freshest first" orders by `tracksChangedAt` and
// badges "+N" from `lastChangeAdded`. `lastModified` can't do that job,
// because renames and other metadata writes bump it. What counts as a change
// (spec section 5): tracks added, removed or reordered, whether by a local
// edit, a sync pull or a hosted playlist's refresh. A rename, a `syncedFrom`
// heal, a sync-state stamp or a hosted re-poll that brings the same tracks is
// not a change.
//
// Both fields are local only. They ride along on the record through the
// whole-record spread (`buildPlaylistSavePayload`), and no sync push sends
// them to a service: providers get the name, description and tracks.
//
// Where it runs: `main-process/split-store.js` stamps every `local_playlists`
// write (the renderer's playlists.save IPC, the sync IPC, main.js handlers),
// and the renderer stamps first in savePlaylistToStore and the hosted refresh
// so Home sees the change without a reload. A stamp the incoming record
// already moved forward is kept, so the two never fight.
//
// Track identity is the track's artist and title, folded the way trackSlug
// folds them (src/renderer/lib/track-slug.js), not its `id`: hosted XSPF
// tracks have no id at all, and ListenBrainz ids are positions
// (`listenbrainz-track-<playlist>-<index>`), so a weekly playlist that
// replaces every track keeps every id. A track with neither artist nor title
// falls back to its id.
//
// Pure CommonJS with no requires: main.js loads it through split-store (and
// `src/` is not packaged, so the fold is repeated here rather than required),
// and the renderer bundle requires it from app.js.

'use strict';

// Same fold as track-slug.js's slugPart (tests pin the parity).
const slugPart = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, '');

function trackKey(track) {
  if (!track || typeof track !== 'object') return '';
  if (track.artist || track.title) return `${slugPart(track.artist)}-${slugPart(track.title)}`;
  return track.id != null && track.id !== '' ? `id:${track.id}` : '';
}

// The playlist's track keys in order. A record with no tracks array gives [].
function trackIdsOf(playlist) {
  const tracks = playlist && Array.isArray(playlist.tracks) ? playlist.tracks : [];
  const out = new Array(tracks.length);
  for (let i = 0; i < tracks.length; i++) out[i] = trackKey(tracks[i]);
  return out;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// What a previous version contributes: its keys (null when it had no tracks
// array) and its stamp.
function entryOf(playlist) {
  if (!playlist) return null;
  return {
    keys: Array.isArray(playlist.tracks) ? trackIdsOf(playlist) : null,
    tracksChangedAt: num(playlist.tracksChangedAt),
    lastChangeAdded: num(playlist.lastChangeAdded),
  };
}

// Map of playlist id to entry. The split store keeps one of these for the
// list it last wrote, so a write doesn't re-read and re-parse the file.
function indexPlaylists(list) {
  const index = new Map();
  if (!Array.isArray(list)) return index;
  for (const p of list) {
    if (p && p.id != null && !index.has(p.id)) index.set(p.id, entryOf(p));
  }
  return index;
}

function sameKeys(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// How many tracks next has that prev doesn't, counting copies (a second copy
// of a track already there is one added).
function countAdded(prevKeys, nextKeys) {
  const have = new Map();
  for (const k of prevKeys) have.set(k, (have.get(k) || 0) + 1);
  let added = 0;
  for (const k of nextKeys) {
    const n = have.get(k) || 0;
    if (n > 0) have.set(k, n - 1);
    else added++;
  }
  return added;
}

function withStamp(record, tracksChangedAt, lastChangeAdded) {
  if (tracksChangedAt == null) return record;
  if (record.tracksChangedAt === tracksChangedAt && record.lastChangeAdded === lastChangeAdded) return record;
  return { ...record, tracksChangedAt, lastChangeAdded: lastChangeAdded == null ? 0 : lastChangeAdded };
}

// Stamp one record against its previous version's entry.
function stampAgainst(prev, next, now) {
  if (!next || typeof next !== 'object') return next;
  const incomingAt = num(next.tracksChangedAt);
  const incomingAdded = num(next.lastChangeAdded);
  const prevAt = prev ? prev.tracksChangedAt : null;
  const forward = incomingAt != null && (prevAt == null || incomingAt > prevAt);

  // No tracks array (a partial record): we can't tell, so keep what we have.
  const unknown = !Array.isArray(next.tracks);
  const nextKeys = unknown ? null : trackIdsOf(next);
  const changed = !unknown && (!prev || prev.keys == null || !sameKeys(prev.keys, nextKeys));

  if (!changed) {
    // Keep the newer of the stored stamp and the incoming one.
    if (forward || prevAt == null) return next;
    return withStamp(next, prevAt, prev.lastChangeAdded);
  }
  // Someone (the renderer) already stamped this change.
  if (forward) return withStamp(next, incomingAt, incomingAdded);
  const added = prev && prev.keys ? countAdded(prev.keys, nextKeys) : nextKeys.length;
  return withStamp(next, now, added);
}

// stampPlaylist(prevPlaylist | null, nextPlaylist, now): the record to save,
// with the fields set when its tracks changed (next itself when nothing moves).
function stampPlaylist(prevPlaylist, nextPlaylist, now) {
  return stampAgainst(entryOf(prevPlaylist), nextPlaylist, now);
}

// stampTrackChanges(prevList | index, nextList, now): nextList with every
// record whose tracks changed stamped. Returns nextList itself when nothing
// moved, a new array otherwise; never mutates its input. Anything that isn't
// an array passes through.
function stampTrackChanges(prevList, nextList, now) {
  if (!Array.isArray(nextList)) return nextList;
  const prev = prevList instanceof Map ? prevList : indexPlaylists(prevList);
  let out = null;
  for (let i = 0; i < nextList.length; i++) {
    const p = nextList[i];
    if (!p || typeof p !== 'object' || p.id == null) continue;
    const stamped = stampAgainst(prev.get(p.id) || null, p, now);
    if (stamped !== p) {
      if (!out) out = nextList.slice();
      out[i] = stamped;
    }
  }
  return out || nextList;
}

module.exports = { trackKey, trackIdsOf, indexPlaylists, stampPlaylist, stampTrackChanges };

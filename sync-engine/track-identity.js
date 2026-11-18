// sync-engine/track-identity.js: which collection row an incoming library
// track is, when the ids disagree.
//
// A collection id is built from artist, title and album, and different paths
// build it from different inputs: a heart uses the full artist credit
// ("Mondo Cozmo, Jim James"), Spotify sync uses the first artist only, and a
// love import with no album gets `-noalbum` while sync brings the album. So
// the same song can arrive under an id the collection doesn't have. Library
// sync (calculateDiff in ./index.js) matches tracks in tiers:
//   1. the id;
//   2. the provider's native id (Spotify's track URI and so on), read from
//      the row or from its source record for that provider, when the albums
//      are compatible;
//   3. the same artist and title, when either side's album is a placeholder.
// A row is matched at most once. Two rows already in the collection for one
// native id (left by syncs before this rule) are merged into one keeper, and
// so are rows that share one id. A remote item that repeats an id or native id
// already placed is a duplicate: neither matched nor added.
//
// Pure and dependency-free: the main process requires it, and so does the
// renderer (src/renderer/lib/collection-ids.js re-exports isPlaceholderAlbum,
// which lives here so it stays the one rule; packaging excludes src/, so the
// main process can't require the renderer's copy).

'use strict';

const { normalizeStr } = require('../sync-providers/confidence-scoring');

// An album that isn't one: nothing, "Single", or the name of one of the track's
// own sources (a plugin with no album naming its service). A service name with
// no such source could be a real title, so it stays. Never compare through
// normalizeForId here: it strips non-Latin text to nothing.
const isPlaceholderAlbum = (album, sources) => {
  const name = typeof album === 'string' ? album.trim().toLowerCase() : '';
  if (!name || name === 'single') return true;
  const compact = name.replace(/[^a-z0-9]/g, '');
  if (!compact || compact !== name.replace(/[\s\p{P}]/gu, '')) return false;
  const ids = Array.isArray(sources) ? sources : Object.keys(sources || {});
  return ids.some((id) => String(id).toLowerCase() === compact);
};

// Names compare through the shared normalizeStr (confidence-scoring.js):
// case, accents, spaces and punctuation drop out, so Apple Music's
// "Mondo Cozmo & Jim James" and Spotify's "Mondo Cozmo, Jim James" agree,
// while non-Latin letters stay.
const nameOf = (s) => (typeof s === 'string' ? normalizeStr(s) : '');

// An album name without the store's own suffix: Apple Music calls a single
// "X - Single" and an EP "X - EP" where Spotify says "X". Editions ("Deluxe
// Edition", "Live") stay, since those are different releases.
const albumKey = (album) => nameOf(typeof album === 'string'
  ? album.trim().replace(/\s+-\s+(single|ep)\s*$/i, '')
  : '');

// For matching, an album is a placeholder when the shared rule says so, or
// when it's the "Unknown Album" both providers' transforms fall back to.
const UNKNOWN_ALBUM = nameOf('Unknown Album');
const hasPlaceholderAlbum = (row) => !!row
  && (isPlaceholderAlbum(row.album, row.sources) || albumKey(row.album) === UNKNOWN_ALBUM);

// Two copies of one recording can stand for the same saved track when their
// albums agree, or when either has no real album. Two real, different albums
// are two editions the user may have saved on purpose.
const albumsCompatible = (a, b) => {
  if (hasPlaceholderAlbum(a) || hasPlaceholderAlbum(b)) return true;
  const ka = albumKey(a && a.album);
  return !!ka && ka === albumKey(b && b.album);
};

const nameKey = (row) => {
  const artist = nameOf(row.artist);
  const title = nameOf(row.title);
  return artist && title ? `${artist}\u0000${title}` : null;
};

const sameTrackName = (a, b) => {
  const ka = nameKey(a);
  return !!ka && ka === nameKey(b);
};

// The provider's native ids for a row: from the row itself and from its source
// record for that provider (a heart keeps the Spotify id only there).
const nativeIdsOf = (row, nativeIdOf, providerId) => {
  if (!row || typeof nativeIdOf !== 'function') return [];
  const ids = [];
  const add = (v) => { if (typeof v === 'string' && v && !ids.includes(v)) ids.push(v); };
  try { add(nativeIdOf(row)); } catch { /* malformed row */ }
  const source = row.sources && providerId ? row.sources[providerId] : null;
  if (source && typeof source === 'object') {
    try { add(nativeIdOf(source)); } catch { /* malformed source */ }
  }
  return ids;
};

// Keeps a row a person saved (it has a sync source other than this
// provider's) over one this provider's sync added; otherwise the earliest.
const pickKeeper = (rows, providerId) => {
  const owned = (r) => Object.keys(r.syncSources || {}).some((k) => k !== providerId);
  return [...rows].sort((a, b) => {
    const ao = owned(a) ? 0 : 1;
    const bo = owned(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (a.addedAt || Infinity) - (b.addedAt || Infinity);
  })[0];
};

// Folds the other rows of one track into the keeper: the keeper's own fields,
// sources and sync sources win; an externalId it lacks comes from the others.
const mergeRows = (keeper, others) => {
  let merged = { ...keeper };
  for (const o of others) {
    merged = {
      ...merged,
      sources: { ...(o.sources || {}), ...(merged.sources || {}) },
      syncSources: { ...(o.syncSources || {}), ...(merged.syncSources || {}) },
      ...(merged.externalId ? {} : (o.externalId ? { externalId: o.externalId } : {}))
    };
  }
  return merged;
};

// Rows that share one id are one row (parachord#1404 regression: claims are
// keyed by id, so a second row with a claimed id could never be matched,
// merged or removed, and every sync added another copy). Each id keeps one
// row, the others folded into it. Returns the rows in order, one per id, and
// the ids that had copies.
const collapseSameId = (localItems, providerId) => {
  const groups = new Map();
  const rows = [];
  for (const row of localItems) {
    if (!row || !row.id) { rows.push(row); continue; }
    if (!groups.has(row.id)) {
      groups.set(row.id, []);
      rows.push(row.id);
    }
    groups.get(row.id).push(row);
  }
  const collapsed = new Set();
  const out = rows.map((entry) => {
    if (typeof entry !== 'string') return entry;
    const group = groups.get(entry);
    if (group.length === 1) return group[0];
    collapsed.add(entry);
    const keeper = pickKeeper(group, providerId);
    return mergeRows(keeper, group.filter((r) => r !== keeper));
  });
  return { rows: out, collapsed };
};

// Matches remote library tracks to local rows. Returns
//   pairs:  [{ remote, local, viaId }] — local is the row to update, already
//           merged with any rows it absorbed
//   merged: [{ ...row, mergedInto }] — rows folded into a keeper
//   claimed: Set of local ids that are matched or merged
//   unmatched: remote items with no local row
//   duplicates: remote items that repeat an id or native id another remote
//           item already placed (neither matched nor added)
//   rows:   the local rows, one per id (copies with one id folded together)
//   collapsed: Set of ids that had more than one local row
function matchTracks(remoteItems, localItems, { providerId, nativeIdOf } = {}) {
  const { rows, collapsed } = collapseSameId(localItems, providerId);
  const byId = new Map();
  const byNative = new Map();
  const byName = new Map();
  for (const row of rows) {
    if (!row || !row.id) continue;
    byId.set(row.id, row);
    for (const nid of nativeIdsOf(row, nativeIdOf, providerId)) {
      if (!byNative.has(nid)) byNative.set(nid, []);
      byNative.get(nid).push(row);
    }
    const key = nameKey(row);
    if (key) {
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(row);
    }
  }

  const claimed = new Set();
  const pairs = [];
  const pending = [];
  const duplicates = [];

  // Remote items already placed (paired or added), by id and native id: a
  // provider can list one id twice (two catalog copies of one recording) or
  // one native id twice, and the second is the same saved track.
  const seenIds = new Set();
  const seenNatives = new Set();
  const place = (remote) => {
    if (remote.id) seenIds.add(remote.id);
    for (const nid of nativeIdsOf(remote, nativeIdOf, providerId)) seenNatives.add(nid);
  };
  const isDuplicate = (remote) => (remote.id && seenIds.has(remote.id))
    || nativeIdsOf(remote, nativeIdOf, providerId).some((nid) => seenNatives.has(nid));

  // Pass 1: exact ids. A fallback in pass 2 must never take a row that
  // another incoming track carries the exact id of. A second remote with an
  // id already claimed here is a duplicate.
  for (const remote of remoteItems) {
    if (!remote) continue;
    const local = byId.get(remote.id);
    if (local && claimed.has(local.id)) {
      duplicates.push(remote);
    } else if (local) {
      claimed.add(local.id);
      pairs.push({ remote, local, viaId: true });
    } else {
      pending.push(remote);
    }
  }
  for (const pair of pairs) place(pair.remote);

  // Pass 2: the native id, then the name with a placeholder album. A remote
  // that matches no free row and repeats one already placed is a duplicate.
  const unmatched = [];
  for (const remote of pending) {
    let local = null;
    for (const nid of nativeIdsOf(remote, nativeIdOf, providerId)) {
      local = (byNative.get(nid) || []).find((r) => !claimed.has(r.id) && albumsCompatible(r, remote)) || null;
      if (local) break;
    }
    if (!local) {
      const key = nameKey(remote);
      if (key) {
        local = (byName.get(key) || []).find((r) => !claimed.has(r.id)
          && (hasPlaceholderAlbum(r) || hasPlaceholderAlbum(remote))) || null;
      }
    }
    if (local) {
      claimed.add(local.id);
      pairs.push({ remote, local, viaId: false });
      place(remote);
    } else if (isDuplicate(remote)) {
      duplicates.push(remote);
    } else {
      unmatched.push(remote);
      place(remote);
    }
  }

  // Heal: rows already in the collection for the same recording (one native
  // id, same artist and title, compatible albums) become one row.
  const merged = [];
  for (const pair of pairs) {
    const nids = [
      ...nativeIdsOf(pair.local, nativeIdOf, providerId),
      ...nativeIdsOf(pair.remote, nativeIdOf, providerId)
    ];
    const siblings = [];
    for (const nid of nids) {
      for (const r of byNative.get(nid) || []) {
        if (r === pair.local || claimed.has(r.id) || siblings.includes(r)) continue;
        if (sameTrackName(r, pair.local) && albumsCompatible(r, pair.local)) {
          siblings.push(r);
        }
      }
    }
    if (siblings.length === 0) continue;
    const group = [pair.local, ...siblings];
    const keeper = pickKeeper(group, providerId);
    const others = group.filter((r) => r !== keeper);
    for (const o of others) {
      claimed.add(o.id);
      merged.push({ ...o, mergedInto: keeper.id });
    }
    claimed.add(keeper.id);
    pair.local = mergeRows(keeper, others);
    pair.viaId = pair.viaId && keeper.id === pair.remote.id;
  }

  return { pairs, merged, claimed, unmatched, duplicates, rows, collapsed };
}

module.exports = {
  isPlaceholderAlbum,
  hasPlaceholderAlbum,
  albumsCompatible,
  albumKey,
  nameOf,
  nameKey,
  nativeIdsOf,
  pickKeeper,
  mergeRows,
  matchTracks
};

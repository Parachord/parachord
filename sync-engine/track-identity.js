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
// native id (left by syncs before this rule) are merged into one keeper.
//
// Pure and dependency-free: the main process requires it, and so does the
// renderer (src/renderer/lib/collection-ids.js re-exports isPlaceholderAlbum,
// which lives here so it stays the one rule; packaging excludes src/, so the
// main process can't require the renderer's copy).

'use strict';

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

const sameName = (a, b) => {
  const x = typeof a === 'string' ? a.trim().toLowerCase() : '';
  return !!x && x === (typeof b === 'string' ? b.trim().toLowerCase() : '');
};

const hasPlaceholderAlbum = (row) => isPlaceholderAlbum(row && row.album, row && row.sources);

// Two copies of one recording can stand for the same saved track when their
// albums agree, or when either has no real album. Two real, different albums
// are two editions the user may have saved on purpose.
const albumsCompatible = (a, b) =>
  sameName(a && a.album, b && b.album) || hasPlaceholderAlbum(a) || hasPlaceholderAlbum(b);

const nameKey = (row) => {
  const artist = typeof row.artist === 'string' ? row.artist.trim().toLowerCase() : '';
  const title = typeof row.title === 'string' ? row.title.trim().toLowerCase() : '';
  return artist && title ? `${artist}\u0000${title}` : null;
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

// Matches remote library tracks to local rows. Returns
//   pairs:  [{ remote, local, viaId }] — local is the row to update, already
//           merged with any rows it absorbed
//   merged: [{ ...row, mergedInto }] — rows folded into a keeper
//   claimed: Set of local ids that are matched or merged
//   unmatched: remote items with no local row
function matchTracks(remoteItems, localItems, { providerId, nativeIdOf } = {}) {
  const byId = new Map();
  const byNative = new Map();
  const byName = new Map();
  for (const row of localItems) {
    if (!row || !row.id) continue;
    if (!byId.has(row.id)) byId.set(row.id, row);
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

  // Pass 1: exact ids. A fallback in pass 2 must never take a row that
  // another incoming track carries the exact id of.
  for (const remote of remoteItems) {
    const local = remote && byId.get(remote.id);
    if (local && !claimed.has(local.id)) {
      claimed.add(local.id);
      pairs.push({ remote, local, viaId: true });
    } else {
      pending.push(remote);
    }
  }

  // Pass 2: the native id, then the name with a placeholder album.
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
    } else {
      unmatched.push(remote);
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
        if (sameName(r.artist, pair.local.artist) && sameName(r.title, pair.local.title)
          && albumsCompatible(r, pair.local)) {
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

  return { pairs, merged, claimed, unmatched };
}

module.exports = {
  isPlaceholderAlbum,
  albumsCompatible,
  nativeIdsOf,
  pickKeeper,
  matchTracks
};

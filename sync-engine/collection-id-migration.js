// sync-engine/collection-id-migration.js — move stored collection rows from
// the pre-#1401 ids to the current ones (sync-engine/collection-id.js), once.
//
// Only ids the old formula had broken change: names in a non-Latin script
// (and the few Latin letters with no ASCII form, ß ø æ ł). So most profiles
// change nothing, and a profile with non-Latin music changes only those rows.
//
// A row is migrated only when its id is one this app built from the row's
// own fields, so an id from anywhere else is never touched:
//   - the renderer's formula (with the 'unknown' / 'untitled' / 'noalbum'
//     fallbacks), or the sync providers' (no fallbacks);
//   - from the row's artist field or, for Spotify, which ids a row by its
//     first artist but stores them all ("A, B"), the first of them;
//   - for tracks, also the love import's trackSlug id, which it used for a
//     love whose artist or title the old formula emptied (lib/love-import.js
//     loveRowId). Those rows get the id loveRowId now gives them.
// The new id is the same formula, with the same artist choice and fallbacks,
// under the new normalize.
//
// love_pushed_keys (keyed by track id) follows its row. When several rows
// shared one old id (the collapse this fixes), nobody can tell whose mark it
// was, so it is dropped: the next love push re-sends it, which both services
// accept as a no-op. Tombstones are keyed by the provider's own id, and
// playlist sync state by playlist, so neither changes.
//
// Pure: takes and returns plain data, so it is unit-tested; main.js runs it
// at startup (runCollectionIdMigration).

'use strict';

const {
  normalizeForId, legacyNormalizeForId,
} = require('./collection-id');
const { trackSlug } = require('./track-slug');

// Ways a stored id was built: [label, normalize] pairs for the parts, with or
// without the renderer's fallbacks.
const withFallback = (n, value, fallback) => n(value || fallback);
const noFallback = (n, value) => n(value);

// The artist strings a row's id may have been built from. When the old
// formula emptied both (two Cyrillic artists), both give the same old id and
// the order decides: Spotify ids a row by its FIRST artist, so a row Spotify
// synced tries that first. Its next sync then builds the same new id, and
// albums, which sync matches by id alone, don't duplicate.
const artistVariants = (row) => {
  const a = typeof row.artist === 'string' ? row.artist : '';
  const first = a.split(', ')[0];
  if (!first || first === a) return [a];
  return row.syncSources && row.syncSources.spotify ? [first, a] : [a, first];
};

// The new id for a track row, or null when its id isn't one of ours.
function newTrackId(row) {
  for (const artist of artistVariants(row)) {
    const parts = (n, fb) => fb
      ? `${withFallback(n, artist, 'unknown')}-${withFallback(n, row.title, 'untitled')}-${withFallback(n, row.album, 'noalbum')}`
      : `${noFallback(n, artist)}-${noFallback(n, row.title)}-${noFallback(n, row.album)}`;
    for (const fb of [true, false]) {
      if (row.id === parts(legacyNormalizeForId, fb)) return parts(normalizeForId, fb);
    }
  }
  // A love-import row: trackSlug, used when the old normalize emptied the
  // artist or the title. loveRowId now gives generateTrackId (with fallbacks).
  if ((!legacyNormalizeForId(row.artist) || !legacyNormalizeForId(row.title))
      && row.id === trackSlug(row.artist, row.title, row.album)) {
    return `${withFallback(normalizeForId, row.artist, 'unknown')}-${withFallback(normalizeForId, row.title, 'untitled')}-${withFallback(normalizeForId, row.album, 'noalbum')}`;
  }
  return null;
}

function newAlbumId(row) {
  for (const artist of artistVariants(row)) {
    const parts = (n, fb) => fb
      ? `${withFallback(n, artist, 'unknown')}-${withFallback(n, row.title, 'untitled')}`
      : `${noFallback(n, artist)}-${noFallback(n, row.title)}`;
    for (const fb of [true, false]) {
      if (row.id === parts(legacyNormalizeForId, fb)) return parts(normalizeForId, fb);
    }
  }
  return null;
}

function newArtistId(row) {
  for (const fb of [true, false]) {
    const old = fb ? withFallback(legacyNormalizeForId, row.name, 'unknown') : noFallback(legacyNormalizeForId, row.name);
    if (row.id === old) return fb ? withFallback(normalizeForId, row.name, 'unknown') : noFallback(normalizeForId, row.name);
  }
  return null;
}

// Rewrites ids in one list. Returns { rows, moved: Map(oldId -> [newId...]) }.
function migrateList(rows, idFor) {
  const moved = new Map();
  let changed = false;
  const out = (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row.id !== 'string') return row;
    const next = idFor(row);
    if (!next || next === row.id) return row;
    changed = true;
    if (!moved.has(row.id)) moved.set(row.id, []);
    moved.get(row.id).push(next);
    return { ...row, id: next };
  });
  return { rows: changed ? out : rows, moved };
}

// migrateCollectionIds(collection, lovePushedKeys) →
//   { collection, lovePushedKeys, changed: { tracks, albums, artists, loveKeysMoved, loveKeysDropped } }
// The inputs aren't modified. When nothing changes, the same objects come back.
function migrateCollectionIds(collection, lovePushedKeys) {
  const c = collection || {};
  const tracks = migrateList(c.tracks, newTrackId);
  const albums = migrateList(c.albums, newAlbumId);
  const artists = migrateList(c.artists, newArtistId);

  const count = (m) => [...m.values()].reduce((n, ids) => n + ids.length, 0);
  let loveKeysMoved = 0;
  let loveKeysDropped = 0;
  let keys = lovePushedKeys;
  if (lovePushedKeys && typeof lovePushedKeys === 'object' && tracks.moved.size > 0) {
    keys = { ...lovePushedKeys };
    for (const [oldId, newIds] of tracks.moved) {
      if (!(oldId in keys)) continue;
      // Another row still holding the old id keeps the mark where it is.
      const stillHeld = (tracks.rows || []).some((r) => r && r.id === oldId);
      if (newIds.length === 1 && !stillHeld) {
        if (!(newIds[0] in keys)) keys[newIds[0]] = keys[oldId];
        delete keys[oldId];
        loveKeysMoved += 1;
      } else if (!stillHeld) {
        delete keys[oldId];
        loveKeysDropped += 1;
      }
    }
  }

  const changed = {
    tracks: count(tracks.moved), albums: count(albums.moved), artists: count(artists.moved),
    loveKeysMoved, loveKeysDropped,
  };
  const any = changed.tracks || changed.albums || changed.artists;
  return {
    collection: any ? { ...c, tracks: tracks.rows, albums: albums.rows, artists: artists.rows } : collection,
    lovePushedKeys: keys,
    changed,
  };
}

module.exports = { migrateCollectionIds, newTrackId, newAlbumId, newArtistId };

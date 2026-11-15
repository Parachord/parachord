// What a pull does with a local playlist whose source playlist is missing from
// the provider's list. PURE: no electron, no store.
//
// A playlist that was made in Parachord, or copied in from another service,
// gives up its `syncedFrom` link so the push loops can create it again. A
// playlist IMPORTED from this provider (id `${providerId}-<externalId>`) keeps
// the link:
//   - the startup repair (`healImportedSyncedFromMismatch`, main.js) restores
//     it on every launch anyway, so clearing it only made the two flip back
//     and forth, logging "no longer on <provider>" on every sync;
//   - the push loops never send an imported playlist back to its source, so
//     clearing it never led to a re-push.
// A playlist that drops out of the person's library is often still there: on
// Spotify, deleting a playlist only unfollows it. Following it again brings it
// back, and keeping the link means the next pull picks it up.
//
// A response missing too many at once looks partial (rate limit, pagination
// failure), so then nothing is detached.

const MASS_MISSING_FLOOR = 3;
const MASS_MISSING_RATIO = 0.3;

function isImportedFrom(playlist, providerId) {
  return typeof playlist?.id === 'string' && playlist.id.startsWith(`${providerId}-`);
}

function detachMissingSources(playlists, remotePlaylists, providerId) {
  const list = playlists || [];
  const remoteIds = new Set((remotePlaylists || []).map((p) => p.externalId));
  const fromProvider = list.filter((p) => p?.syncedFrom?.resolver === providerId);
  const missing = fromProvider.filter((p) => !remoteIds.has(p.syncedFrom.externalId));
  const looksPartial = fromProvider.length > 0
    && missing.length > MASS_MISSING_FLOOR
    && missing.length / fromProvider.length > MASS_MISSING_RATIO;

  if (looksPartial) {
    return { playlists: list, detached: [], kept: [], looksPartial, missingCount: missing.length, total: fromProvider.length };
  }

  const missingIds = new Set(missing.map((p) => p.id));
  const detached = [];
  const kept = [];
  const next = list.map((p) => {
    if (!missingIds.has(p.id)) return p;
    if (isImportedFrom(p, providerId)) {
      kept.push(p);
      return p;
    }
    detached.push(p);
    return { ...p, syncedFrom: null };
  });
  return { playlists: next, detached, kept, looksPartial, missingCount: missing.length, total: fromProvider.length };
}

module.exports = { detachMissingSources, MASS_MISSING_FLOOR, MASS_MISSING_RATIO };

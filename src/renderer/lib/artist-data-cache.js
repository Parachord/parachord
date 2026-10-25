// src/renderer/lib/artist-data-cache.js — which saved artist-data entries survive a restart.
//
// cache_artist_data holds two kinds of entry under the same key:
//  - full entries from the artist page: { artist, releases, timestamp, cacheVersion: 2 }
//  - ID-only entries from Fresh Drops' MBID lookup: { artist: { name, mbid }, timestamp }
// The startup restore kept only cacheVersion 2, so every ID-only entry was
// dropped as an "old version" and Fresh Drops searched MusicBrainz again for
// each artist's ID on every launch (48 of 55 saved entries on one install,
// 2026-10). Readers already treat an entry without releases as ID-only (the
// artist page requires releases), so keeping them is safe.

const ARTIST_CACHE_VERSION = 2; // release-group categorization (live, compilation)

const isFullEntry = (entry) => entry.cacheVersion === ARTIST_CACHE_VERSION;
const isIdOnlyEntry = (entry) => !entry.releases && typeof entry.artist?.mbid === 'string' && entry.artist.mbid.length > 0;

// Returns { entries, full, idOnly, dropped }: entries is the object to restore.
function restorableArtistDataEntries(saved, now, ttlMs) {
  const entries = {};
  let full = 0;
  let idOnly = 0;
  let dropped = 0;
  for (const [key, entry] of Object.entries(saved || {})) {
    const fresh = entry && entry.timestamp && (now - entry.timestamp) < ttlMs;
    if (fresh && isFullEntry(entry)) {
      entries[key] = entry;
      full++;
    } else if (fresh && isIdOnlyEntry(entry)) {
      entries[key] = entry;
      idOnly++;
    } else {
      dropped++;
    }
  }
  return { entries, full, idOnly, dropped };
}

module.exports = { restorableArtistDataEntries, ARTIST_CACHE_VERSION };

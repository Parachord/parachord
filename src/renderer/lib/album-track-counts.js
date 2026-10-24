// src/renderer/lib/album-track-counts.js — fill in collection albums' track
// counts from MusicBrainz in the background.
//
// The loop this replaced (parachord#1117) ran on every launch for every album
// with no count, sent its MusicBrainz requests on the user lane (so artist and
// album pages waited behind it at 1 req/s), saved the whole collection once per
// album, and cancelled itself on its own first update: the effect depended on
// collectionData.albums, which that update replaced. Misses were only
// remembered for the session, so the same albums were searched again at every
// start. Here: batched updates, misses remembered across launches
// (persisted as cache_album_track_counts, retried after MISS_RETRY_MS), and the
// caller passes a background-lane lookup.

const MISS_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 10;

// Albums worth looking up: no count yet, and no recent recorded miss.
function albumsNeedingTrackCount(albums, misses, now) {
  return (albums || []).filter(a =>
    a && a.id && a.trackCount == null &&
    !(misses && misses[a.id] && now - misses[a.id] < MISS_RETRY_MS)
  );
}

// Total tracks across a MusicBrainz release's media (browse with inc=media).
function trackCountFromRelease(release) {
  const media = (release && release.media) || [];
  return media.reduce((sum, m) => sum + (m['track-count'] || (m.tracks ? m.tracks.length : 0) || 0), 0);
}

// lookup(album) resolves { trackCount } for a hit, { miss: true } when
// MusicBrainz has nothing, or { transient: true } for a failed request (not
// recorded, so the next launch tries again). applyBatch receives
// [{ id, trackCount }] at most every BATCH_SIZE albums and once at the end;
// persistMisses receives the updated miss map whenever it changed.
async function runAlbumTrackCountSync({ albums, misses, lookup, applyBatch, persistMisses, isCancelled, now = Date.now, batchSize = BATCH_SIZE }) {
  const pending = albumsNeedingTrackCount(albums, misses, now());
  const missMap = { ...(misses || {}) };
  let batch = [];
  let missesChanged = false;
  let found = 0;

  const flush = async () => {
    if (batch.length) { applyBatch(batch); found += batch.length; batch = []; }
    if (missesChanged) { missesChanged = false; await persistMisses({ ...missMap }); }
  };

  for (const album of pending) {
    if (isCancelled && isCancelled()) break;
    let result;
    try {
      result = await lookup(album);
    } catch (_) {
      result = { transient: true };
    }
    if (result && result.trackCount > 0) {
      batch.push({ id: album.id, trackCount: result.trackCount });
      if (missMap[album.id]) { delete missMap[album.id]; missesChanged = true; }
    } else if (result && (result.miss || result.trackCount === 0)) {
      missMap[album.id] = now();
      missesChanged = true;
    }
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  return { checked: pending.length, found };
}

module.exports = { albumsNeedingTrackCount, trackCountFromRelease, runAlbumTrackCountSync, MISS_RETRY_MS, BATCH_SIZE };

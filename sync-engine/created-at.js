// sync-engine/created-at.js: a synced playlist's "Created" date.
//
// No service tells us when a playlist was made, so an import's createdAt is
// the earliest date any of its tracks was added (sync:start, the new-import
// branch). Each later sync recalculated it from the CURRENT tracks only, so a
// playlist the service rebuilds every day (Spotify's Daily Brew, Daily Mix,
// Discover Weekly; a ListenBrainz weekly) had its "Created" date move forward
// with every rebuild: to whenever the oldest track still in it was added
// (Daily Brew read "Created" yesterday, 2026-11-20).
//
// The rule: a created date only ever moves earlier. It is the earliest of
//   - the createdAt the playlist already has,
//   - the earliest track added date in the tracks this sync sees,
//   - syncSources[providerId].addedAt, the earliest track date the import
//     recorded the first time it saw the playlist,
// so a rebuilt playlist keeps the date it first came in with, and one that
// drifted heals back to it on its next sync.
//
// Pure; loads under plain Node.

'use strict';

// A usable timestamp (ms), or null. Accepts a number or a date string.
function asTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === 'string' && value) {
    const t = Date.parse(value);
    return Number.isFinite(t) && t > 0 ? t : null;
  }
  return null;
}

// The earliest date any of `tracks` was added to the playlist on
// `providerId`, or null when none says.
function earliestTrackAddedAt(tracks, providerId) {
  let earliest = null;
  for (const t of Array.isArray(tracks) ? tracks : []) {
    if (!t) continue;
    const at = asTime(t.addedAt) ?? asTime(t.syncSources && t.syncSources[providerId] && t.syncSources[providerId].addedAt);
    if (at !== null && (earliest === null || at < earliest)) earliest = at;
  }
  return earliest;
}

// The playlist's createdAt after a sync from `providerId` that sees `tracks`.
// Never later than the one it has. Returns the playlist's own value
// unchanged when nothing gives a date.
function stableCreatedAt(playlist, tracks, providerId) {
  const p = playlist || {};
  const candidates = [
    asTime(p.createdAt),
    earliestTrackAddedAt(tracks, providerId),
    asTime(p.syncSources && p.syncSources[providerId] && p.syncSources[providerId].addedAt),
  ].filter((t) => t !== null);
  return candidates.length ? Math.min(...candidates) : p.createdAt;
}

module.exports = { stableCreatedAt, earliestTrackAddedAt };

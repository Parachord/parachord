// src/renderer/lib/cached-miss.js: a plug-in's cached "no match" for a track,
// and whether it still holds (#1535).
//
// When a plug-in finds nothing for a track, resolveTrack saves a miss in the
// track-sources cache and on the track (`sources[resolverId]`), so the plug-in
// isn't asked again for that track. A miss records the version of the plug-in
// that gave it: a plug-in update can fix its matching (Bandcamp 1.4.9 reads
// all 50 search results, not the first 20, #1532), and a miss from the older
// version would otherwise hide the new match until it expired.
//
// A miss holds only while it is inside its TTL and came from the version of
// the plug-in that is loaded now. A miss with no version (written before this
// change) is stale. A stale miss is not swept: it reads as "not answered", so
// the plug-in is asked again the next time the track is resolved anyway (on
// screen, the idle trickle), through the normal path and lanes. Found sources
// are not misses and keep their own expiry.
//
// Readiness failures (a plug-in that isn't signed in, `plan-ineligible`, a
// superseded play) throw and are never cached as misses; nothing here changes
// that.
//
// Pure; loads under plain Node.

'use strict';

// Whether a saved `sources[resolverId]` value is a miss.
const isMiss = (entry) => !!entry && typeof entry === 'object' && entry.noMatch === true;

// The one way to build a miss: the plug-in that answered, and when.
const newMiss = (resolver, now = Date.now()) => ({
  noMatch: true,
  resolvedAt: now,
  version: resolver && resolver.version != null ? String(resolver.version) : null,
});

const versionKnown = (v) => v != null && v !== '';

// Whether a miss still holds. `currentVersion` is the loaded plug-in's
// manifest version; when it isn't known (the plug-in hasn't loaded yet) the
// miss holds, since nothing can ask that plug-in now anyway. `ttlMs`, when
// given, expires a miss `ttlMs` after its `resolvedAt`, whatever the version.
// Anything that isn't a miss returns false.
function missStillValid(entry, currentVersion, now = Date.now(), ttlMs) {
  if (!isMiss(entry)) return false;
  if (typeof ttlMs === 'number') {
    if (typeof entry.resolvedAt !== 'number' || now - entry.resolvedAt >= ttlMs) return false;
  }
  if (!versionKnown(currentVersion)) return true;
  return versionKnown(entry.version) && String(entry.version) === String(currentVersion);
}

// A miss that no longer holds: the plug-in is to be asked again.
const isStaleMiss = (entry, currentVersion, now = Date.now(), ttlMs) =>
  isMiss(entry) && !missStillValid(entry, currentVersion, now, ttlMs);

module.exports = { isMiss, newMiss, missStillValid, isStaleMiss };

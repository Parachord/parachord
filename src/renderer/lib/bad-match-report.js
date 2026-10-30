// src/renderer/lib/bad-match-report.js — "Report Bad Match" (right-click a
// source in the playbar): which source to blocklist, and what to clear.
//
// The report must act on the reported TRACK's source only. It used to read
// the source from a mount-time (always empty) copy of trackSources, so every
// entry was saved with sourceId null and blocked nothing, and its cleanup
// removed that service's source from every track in trackSources.

// The id a blocklist entry stores for a source, and the id resolution compares
// against. One list for the report, the source-selection filter and the
// re-resolve so all three agree (an Amazon source's id is 'amazonmusic-<ASIN>').
function sourceBlockId(source) {
  if (!source || typeof source !== 'object') return null;
  return source.youtubeId || source.spotifyUri || source.spotifyId || source.bandcampUrl ||
    source.soundcloudId || source.appleMusicId || source.filePath || source.id || null;
}

// trackSources without the reported track's source for that resolver. Other
// tracks are untouched. Returns the same object when there is nothing to drop.
function withoutTrackSource(trackSources, trackId, resolverId) {
  const own = trackSources && trackId != null ? trackSources[trackId] : null;
  if (!own || !own[resolverId]) return trackSources;
  const { [resolverId]: removed, ...rest } = own;
  return { ...trackSources, [trackId]: rest };
}

module.exports = { sourceBlockId, withoutTrackSource };

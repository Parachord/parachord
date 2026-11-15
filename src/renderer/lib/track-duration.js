// src/renderer/lib/track-duration.js — the length a track row shows. One rule
// for every track list (the queue drawer, the playlist view, Collection,
// Search, album rows, Recommendations).
//
// Tracks that arrive without a duration (a playlist imported from a URL, such
// as a hosted XSPF with no <duration>) used to show "0:00" everywhere, even
// after resolution had found sources that know the length: the rows read only
// `track.duration`.
//
// The rule:
//   1. the track's own `duration` (seconds) when it is a positive number;
//   2. otherwise the duration of one of its sources, merged as the source
//      icons merge them (lib/visible-sources `mergedSources`: track.sources
//      with trackSources[track.id], no-match sentinels dropped): the
//      highest-confidence source that has a duration, ties broken by the
//      user's resolver order (a resolver not in the order goes last);
//   3. otherwise null: nothing knows the length, and the row shows nothing
//      rather than "0:00".
//
// Durations are seconds, as every resolver writes them. Pure, no React, loads
// under plain Node.

const { mergedSources } = require('./visible-sources');

const isLength = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

// Seconds, or null when nothing knows the length.
function trackDuration(track, { trackSources, resolverOrder } = {}) {
  if (!track) return null;
  if (isLength(track.duration)) return track.duration;
  const sources = mergedSources(track, trackSources);
  const order = Array.isArray(resolverOrder) ? resolverOrder : [];
  const rank = (id) => {
    const i = order.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const best = Object.keys(sources)
    .filter((id) => isLength(sources[id].duration))
    .sort((a, b) => ((sources[b].confidence || 0) - (sources[a].confidence || 0)) || (rank(a) - rank(b)))[0];
  return best ? sources[best].duration : null;
}

// "m:ss" for a length in seconds; '' when it is unknown.
function formatDuration(seconds) {
  if (!isLength(seconds)) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// The text a row's duration cell shows: trackDuration, formatted; '' when unknown.
function trackDurationLabel(track, opts) {
  return formatDuration(trackDuration(track, opts));
}

module.exports = { trackDuration, formatDuration, trackDurationLabel };

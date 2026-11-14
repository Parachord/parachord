// src/renderer/lib/progress-interpolation.js — the playbar's position for a
// track that plays outside the renderer.
//
// Spotify and native Apple Music play in their own apps, so the playbar only
// learns their position from polls every few seconds. Between polls it counts
// forward from the last one (`baseline`: { progress (s), timestamp (ms),
// isPlaying }). Returns the position in seconds, or null to leave the bar
// where it is:
//   - while a new track is loading: the old one is already paused, and the
//     bar used to keep moving under the loading shimmer (2026-11-14);
//   - while the user drags the seek bar;
//   - before the first poll, or when the service reported a pause;
//   - outside 0..duration.
// Pure, so jest drives it directly (tests/renderer/progress-interpolation.test.js).

function interpolatedProgress({ baseline, now, duration, seeking = false, loading = false }) {
  if (loading || seeking) return null;
  if (!baseline || !(baseline.timestamp > 0) || !baseline.isPlaying) return null;
  if (!(duration > 0)) return null;
  const position = baseline.progress + (now - baseline.timestamp) / 1000;
  return position >= 0 && position < duration ? position : null;
}

module.exports = { interpolatedProgress };

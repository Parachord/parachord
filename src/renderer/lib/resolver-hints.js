// src/renderer/lib/resolver-hints.js — facts about the track being resolved
// that a resolver may use to choose between same-named candidates.
//
// Passed as the optional last argument of a resolver's resolve() (5th) and of
// search() when the search resolves one specific track (3rd); never on a
// plain user search. Each plugin decides what to do with them; a plugin that
// ignores the argument is unaffected. Amazon Music uses the duration to drop
// a candidate whose length is clearly another recording: an Amazon ASIN
// labeled with the right artist and title, 3:12 against the requested 4:04,
// played different, unrelated audio every time.
//
// duration is seconds, or null when unknown. Track rows carry seconds in
// `duration`; Spotify-shaped rows carry `duration_ms`, MusicBrainz rows
// `length` in ms. A `duration` above 10000 is taken as milliseconds.

function resolverHints(track) {
  if (!track || typeof track !== 'object') return { duration: null };
  let seconds = null;
  if (typeof track.duration === 'number' && track.duration > 0) {
    seconds = track.duration > 10000 ? track.duration / 1000 : track.duration;
  } else if (typeof track.duration_ms === 'number' && track.duration_ms > 0) {
    seconds = track.duration_ms / 1000;
  } else if (typeof track.length === 'number' && track.length > 0) {
    seconds = track.length / 1000;
  }
  return { duration: seconds != null ? Math.round(seconds) : null };
}

module.exports = { resolverHints };

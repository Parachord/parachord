// src/renderer/lib/track-isrc.js: a track's ISRC, from wherever it's kept.
// Moved out of app.js (window.pickTrackIsrc, which app.js still sets from
// here) so pure modules can read an ISRC the same way (#1635).
//
// Pick an ISRC from a track. ISRC is per-recording, not per-service, so
// any valid match anywhere on the track object is authoritative.
//
// Checks top-level `track.isrc` first (where the native MusicKit AM path
// and the iTunes-Search-fallback put it), then walks each
// `track.sources[*].isrc` (where Spotify writes it after parachord#893,
// and where Apple Music's source record carries it because the resolver
// result is spread into the source). Validates the canonical ISRC format
// (2-letter country + 3-char alphanumeric registrant + 7 digits) and
// normalizes (trim + uppercase) before returning.
//
// Returns null when no source carries a usable one. Skips sources with
// `noMatch` set — those are dropped resolutions, not real source links.
//
// Mirrors the achordion.axe `resolveIsrc` helper (parachord#892) — same
// rules so the two stay byte-equivalent across desktop's two ISRC sites.
function pickTrackIsrc(track) {
  if (!track) return null;
  const isValidIsrc = (s) => typeof s === 'string' && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(s);
  if (typeof track.isrc === 'string' && track.isrc) {
    const norm = track.isrc.trim().toUpperCase();
    if (isValidIsrc(norm)) return norm;
  }
  if (track.sources) {
    for (const id of Object.keys(track.sources)) {
      const s = track.sources[id];
      if (!s || s.noMatch) continue;
      if (typeof s.isrc === 'string' && s.isrc) {
        const norm = s.isrc.trim().toUpperCase();
        if (isValidIsrc(norm)) return norm;
      }
    }
  }
  return null;
}

module.exports = { pickTrackIsrc };

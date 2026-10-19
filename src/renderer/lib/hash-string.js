// src/renderer/lib/hash-string.js — the 32-bit string hash used by
// generateArtistPattern (artist-name fuzzy matching, components/cards.js) and
// app.js's own call sites. Extracted from app.js module scope (Track 2b,
// presentational slice 3) so both consumers share one definition.

module.exports = function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};

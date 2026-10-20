// src/renderer/lib/track-slug.js — Unicode-aware track id slugs.
//
// The id formula this replaced —
//   `${artist}-${title}-${album}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
// — strips every non-ASCII character, so a release by a Cyrillic/CJK/Arabic
// artist collapsed EVERY track to the same id ("--" for a fully non-Latin
// release): every row on the release page showed as playing, every row
// shared whichever one track resolved first (badges for the wrong song), and
// clicking any other row re-scored that shared source against the clicked
// row's title and failed the 0.6 confidence floor — "sources exist, resolver
// active, still No Enabled Source" (live-reported 2026-10, a Король и Шут
// release). Same bug class confidence-scoring.js fixed for normalizeStr.
//
// The fold is byte-identical to the old formula for pure-ASCII input.
// Accented-Latin ids change once (Beyoncé: beyonc → beyonce) — these ids key
// session state (trackSources) and queue entries, NOT `cache_track_sources`
// (keyed by raw `artist|title`), so the worst case is a restored queue item
// not showing as playing on a release page until it is replayed.
//
// Ordering matters: NFKD → combining-mark strip → LOWERCASE (review, PR
// #1079). Lowercasing before the decomposition lets NFKD's uppercase output
// leak into ids: '™' → 'TM', '℡' → 'TEL', math-bold letters → uppercase
// ASCII. Lowercase after the strip folds all of those; ASCII input is
// unaffected either way.
//
// KNOWN SIBLINGS (not fixed here — follow-ups): `normalizeForId` in app.js +
// sync-providers/spotify.js (hyphen-replace semantics, byte-parity pair
// behind generateTrackId/generateAlbumId/generateArtistId — collection /
// love-push / sync / Achordion ids) collapses non-Latin the same way; and
// the remaining same-class id sites in app.js (createTrackFromMeta
// ~L6152, critics-${artist}-${album} ~L27085, the hyphen-replace artist ids
// ~L29288/L29389/L41763/L41777).

'use strict';

const slugPart = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, '');

// trackSlug(artist, title[, album]) — the per-surface track id. The
// two-part form is a DISTINCT call (arguments.length), so a three-part call
// with an explicitly undefined album keeps the three-part shape (empty third
// axis, "a-b-") instead of silently falling into the two-part form and
// colliding across albums. Fallbacks ('unknown'/'untitled'/'noalbum') are
// the CALLER's choice, preserved from the old inline formulas.
function trackSlug(artist, title, album) {
  if (arguments.length === 2) {
    return `${slugPart(artist)}-${slugPart(title)}`;
  }
  return `${slugPart(artist)}-${slugPart(title)}-${slugPart(album)}`;
}

// slug(value) — the single-part form (artist ids), same fold.
function slug(value) {
  return slugPart(value);
}

module.exports = { trackSlug, slug };

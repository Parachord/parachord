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
// The fold mirrors that philosophy (NFKD + combining-mark strip + Unicode
// letters/digits keepset, hyphens kept) while staying BYTE-IDENTICAL to the
// old formula for pure-ASCII input, so Latin-script track ids — and the
// sources cached under them — do not churn.
//
// KNOWN SIBLING (not fixed here): `normalizeForId` in app.js +
// sync-providers/spotify.js (hyphen-replace semantics, byte-parity pair
// used for collection/library ids) collapses non-Latin scripts the same
// way. Fixing it means changing both sides of the parity pair plus the
// sync provider's id namespace — tracked as a follow-up.

'use strict';

const slugPart = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}-]/gu, '');

// trackSlug(artist, title, album?) — the per-surface track id. Fallbacks
// ('unknown'/'untitled'/'noalbum') are the CALLER's choice, preserved from
// the old inline formulas; album is omitted for the two-part id sites.
function trackSlug(artist, title, album) {
  if (album === undefined) {
    return `${slugPart(artist)}-${slugPart(title)}`;
  }
  return `${slugPart(artist)}-${slugPart(title)}-${slugPart(album)}`;
}

// slug(value) — the single-part form (artist ids), same fold.
function slug(value) {
  return slugPart(value);
}

module.exports = { trackSlug, slug };

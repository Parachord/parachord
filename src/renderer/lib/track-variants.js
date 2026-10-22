// src/renderer/lib/track-variants.js — is a search result another version of
// the requested track?
//
// Containment matching (validateResolvedTrack) accepts "Dear Prudence (Cover)"
// for "Dear Prudence" and "Steven Gilpin (covering the Foo Fighters)" for
// "Foo Fighters". Bandcamp's search API returns many of those, and the
// playbar's Buy button sent people to covers, fan remixes and live cuts
// (2026-10). A version word counts only when the requested name lacks it, so
// "Live Forever" and "Take Me Out (Live)" still match themselves.
//
// The Bandcamp plugin (plugins-src/bandcamp/implementation.js, resolve) keeps
// its own copy of this list: plugin functions run isolated and cannot require
// renderer modules. Keep the two lists the same.

const VARIANT_WORDS = /\b(live|remix(es|ed)?|rmx|cover(s|ed)?|covering|tribute|karaoke|instrumental|acoustic|demo|unplugged|rework|bootleg|mashup|reprise|edit|jam track|sped up|slowed|in the style of)\b/gi;

function hasVariantWord(name, target) {
  const words = String(name || '').match(VARIANT_WORDS) || [];
  const t = String(target || '').toLowerCase();
  return words.some(w => !t.includes(w.toLowerCase()));
}

function isOtherVersion(result, targetArtist, targetTitle) {
  if (!result) return false;
  return hasVariantWord(result.title, targetTitle) || hasVariantWord(result.artist, targetArtist);
}

module.exports = { isOtherVersion, VARIANT_WORDS };

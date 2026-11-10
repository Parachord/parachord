// sync-providers/track-variants.js — is a search result another version of
// the requested track?
//
// Containment matching (validateResolvedTrack) accepts "Dear Prudence (Cover)"
// for "Dear Prudence" and "Steven Gilpin (covering the Foo Fighters)" for
// "Foo Fighters". Bandcamp's search API returns many of those, and the
// playbar's Buy button sent people to covers, fan remixes and live cuts
// (2026-10). A version word counts only when the requested name lacks it, so
// "Live Forever" and "Take Me Out (Live)" still match themselves. A medley
// counts too, by name or by a slash-joined title (#1306).
//
// The Bandcamp plugin (plugins-src/bandcamp/implementation.js, resolve) keeps
// its own copy of this list: plugin functions run isolated and cannot require
// renderer modules. The SoundCloud and Amazon Music plugins (plugins-src/soundcloud,
// plugins-src/amazonmusic) have copies too. Keep them all the same, the slash check
// included (tests/resolver/bandcamp-version-variants.test.js holds them to it).

const VARIANT_WORDS = /\b(live|medley|remix(es|ed)?|rmx|cover(s|ed)?|covering|tribute|karaoke|instrumental|acoustic|demo|unplugged|rework|bootleg|mashup|reprise|edit|jam track|sped up|slowed|in the style of)\b/gi;

function hasVariantWord(name, target) {
  const words = String(name || '').match(VARIANT_WORDS) || [];
  const t = String(target || '').toLowerCase();
  return words.some(w => !t.includes(w.toLowerCase()));
}

// A title that joins several songs with a slash ("You Never Give Me Your
// Money/Sun King/.../Her Majesty") is a medley, which containment accepts for
// any song it lists (#1306). Not when the requested title has a slash itself, a
// slash between digits ("24/7"), "w/" ("Song (w/ Guest)"), or one inside the
// requested artist's name ("AC/DC - Back in Black").
function joinsSongs(title, targetTitle, targetArtist) {
  if (String(targetTitle || '').indexOf('/') !== -1) return false;
  let s = String(title || '').toLowerCase();
  const artist = String(targetArtist || '').toLowerCase();
  if (artist.indexOf('/') !== -1) s = s.split(artist).join(' ');
  s = s.replace(/\bw\/\s*/g, ' ');
  return /[^\s\d]\s*\/\s*[^\s\d]/.test(s);
}

function isOtherVersion(result, targetArtist, targetTitle) {
  if (!result) return false;
  return hasVariantWord(result.title, targetTitle) || hasVariantWord(result.artist, targetArtist) ||
    joinsSongs(result.title, targetTitle, targetArtist);
}

module.exports = { isOtherVersion, joinsSongs, VARIANT_WORDS };

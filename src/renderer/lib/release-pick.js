// src/renderer/lib/release-pick.js: which release of an album to show (#1288).
//
// A MusicBrainz release group (the album) holds every edition: CDs, vinyl,
// digital, reissues, deluxe sets. The album page used to take whichever
// release MusicBrainz listed first. For George Michael's "The Faith Tour"
// that was a 9-track CD; the digital release has all 18, as Apple's does.
//
// The rule:
//   1. Prefer releases that are digital only (every medium "Digital Media"):
//      they are what streaming services carry, and the tracks have to resolve
//      on those services.
//   2. Among those, take the most common track count, which is the standard
//      edition. "Most tracks" would pick a 40-track super deluxe Abbey Road
//      over the 17-track album.
//   3. A tie in counts, and the choice within a count, goes to the earliest
//      release date; undated releases sort last. Otherwise MusicBrainz order.
// With no digital-only release, the same rule runs over all of them.
//
// This is a default, not a choice; #1238 asks for a way to pick an edition.

'use strict';

const DIGITAL = 'Digital Media';

function releaseTrackCount(release) {
  const media = (release && Array.isArray(release.media)) ? release.media : [];
  return media.reduce((sum, m) => {
    if (!m) return sum;
    const n = Number.isFinite(m['track-count']) ? m['track-count'] : (Array.isArray(m.tracks) ? m.tracks.length : 0);
    return sum + n;
  }, 0);
}

const isDigitalOnly = (release) => Array.isArray(release.media) && release.media.length > 0
  && release.media.every((m) => m && m.format === DIGITAL);

// Undated releases sort after dated ones; partial dates ("2001") compare as text.
const dateKey = (release) => (release && typeof release.date === 'string' && release.date) || '￿';

function pickRelease(releases) {
  const list = (Array.isArray(releases) ? releases : []).filter((r) => r && typeof r === 'object');
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];

  const digital = list.filter(isDigitalOnly);
  const pool = digital.length ? digital : list;

  // Group by track count (0 means MusicBrainz didn't say), keeping MB order.
  const groups = new Map();
  for (const r of pool) {
    const n = releaseTrackCount(r);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(r);
  }
  const counted = [...groups.entries()].filter(([n]) => n > 0);
  if (counted.length === 0) return pool[0];

  const earliestIn = (rs) => rs.reduce((best, r) => (dateKey(r) < dateKey(best) ? r : best), rs[0]);
  let best = null;
  for (const [, rs] of counted) {
    const first = earliestIn(rs);
    if (!best
      || rs.length > best.rs.length
      || (rs.length === best.rs.length && dateKey(first) < dateKey(best.first))) {
      best = { rs, first };
    }
  }
  return best.first;
}

module.exports = { pickRelease, releaseTrackCount };

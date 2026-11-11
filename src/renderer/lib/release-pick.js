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
//   3. Within that count, a Worldwide release (MusicBrainz country XW), then
//      a US one, then any other (#1312). MusicBrainz lists one digital
//      release per storefront, all on the same day, and "the first listed"
//      put Bahrain on Bon Iver's "For Emma, Forever Ago".
//   4. Then the earliest release date; undated releases sort last.
//      Otherwise MusicBrainz order. A tie between counts goes to the count
//      with the earliest release.
// With no digital-only release, the same rule runs over all of them.
//
// This is a default, not a choice: the album page's source dropdown (#1238)
// lets the user pick another edition — the MusicBrainz releases of the group
// and the resolvers' editions — and an MB pick sticks for the session
// (albumEditionPicksRef in app.js, consulted before loadRelease).

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

// Worldwide, then the US, then anywhere else (#1312).
const COUNTRY_RANK = { XW: 0, US: 1 };
const countryRank = (release) => {
  const country = release && typeof release.country === 'string' ? release.country.toUpperCase() : '';
  return Object.prototype.hasOwnProperty.call(COUNTRY_RANK, country) ? COUNTRY_RANK[country] : 2;
};

// The release to show from a set the earlier rules can't tell apart: the
// preferred country, then the earliest date, then MusicBrainz order.
const preferredIn = (rs) => rs.reduce((best, r) => {
  const a = countryRank(r);
  const b = countryRank(best);
  if (a !== b) return a < b ? r : best;
  return dateKey(r) < dateKey(best) ? r : best;
}, rs[0]);

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
  if (counted.length === 0) return preferredIn(pool);

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
  return preferredIn(best.rs);
}

// The rule's version. A release group's pick is remembered for 30 days (the
// alias in the release-details cache, release-lookup.js), so a change to the
// rule bumps this and a pick made under an older rule is made again. 2: the
// Worldwide/US preference (#1312).
const PICK_RULE = 2;

module.exports = { pickRelease, releaseTrackCount, PICK_RULE };

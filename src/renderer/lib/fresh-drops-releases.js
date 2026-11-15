// src/renderer/lib/fresh-drops-releases.js: one row per release in Fresh Drops.
//
// Fresh Drops asks MusicBrainz for each artist in the collection, so a
// collaboration comes back once per artist who's on it, each copy carrying
// the artist it was found under: "Colly Strings (Reimagined)" as
// "Manchester Orchestra" and again as "Manchester Orchestra, Julien Baker",
// both with the same release-group id. The list used to de-duplicate by
// artist + title only, so both copies survived. The release grid keys its
// cards by release id, and two cards with one key leave React unable to tell
// them apart: after a couple of filter clicks stale cards pile up and the
// filters look dead (2026-11).
//
// The rule: the first copy of a release wins, matched by release-group id,
// or by lowercased artist + title as before (which also covers a release with
// no id). Callers put fresh results first, so they keep priority. Order is
// kept; sorting is the caller's.
//
// No hooks, no window: loads under plain Node.

function artistTitleKey(r) {
  return `${String(r.artist || '').toLowerCase()}-${String(r.title || '').toLowerCase()}`;
}

function uniqueReleases(releases) {
  const ids = new Set();
  const keys = new Set();
  const out = [];
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || typeof r !== 'object') continue;
    const key = artistTitleKey(r);
    if ((r.id && ids.has(r.id)) || keys.has(key)) continue;
    if (r.id) ids.add(r.id);
    keys.add(key);
    out.push(r);
  }
  return out;
}

// The window: releases from the last three months, up to two weeks ahead.
// It applies to everything Fresh Drops keeps, not only to what a scan
// fetches: the cache load and every merge go through
// withinFreshDropsWindow, or releases that aged out stay forever (one
// library had 436, 312 of them over six months old, 2026-11). Two weeks
// ahead surfaces upcoming drops without months-out announcements.
// MusicBrainz dates are ISO strings, sometimes only a year or a month, so
// they compare as strings. An undated release can't be placed and is
// dropped; a scan never keeps one either.
const FRESH_DROPS_MONTHS_BACK = 3;
const FRESH_DROPS_DAYS_AHEAD = 14;

function isoDay(d) {
  return d.toISOString().split('T')[0];
}

function freshDropsWindow(now = new Date()) {
  const from = new Date(now.getTime());
  from.setUTCMonth(from.getUTCMonth() - FRESH_DROPS_MONTHS_BACK);
  const to = new Date(now.getTime());
  to.setUTCDate(to.getUTCDate() + FRESH_DROPS_DAYS_AHEAD);
  return { from: isoDay(from), to: isoDay(to) };
}

function withinFreshDropsWindow(releases, now = new Date()) {
  const { from, to } = freshDropsWindow(now);
  return (Array.isArray(releases) ? releases : []).filter(r =>
    r && typeof r === 'object' && typeof r.date === 'string' && r.date !== ''
    && r.date >= from && r.date <= to
  );
}

module.exports = {
  uniqueReleases,
  freshDropsWindow,
  withinFreshDropsWindow,
  FRESH_DROPS_MONTHS_BACK,
  FRESH_DROPS_DAYS_AHEAD,
};

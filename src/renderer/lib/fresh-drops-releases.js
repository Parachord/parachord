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

module.exports = { uniqueReleases };

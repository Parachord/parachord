// src/renderer/lib/concert-events.js: one row per show in Concerts.
//
// Concerts asks every ticket service once per artist in the collection, so a
// show with two of the user's artists on the bill comes back twice with one
// event id: Ticketmaster's tm-vv1A7Zk4aGkeVuzpx is Modest Mouse AND Interpol
// at the Aragon Ballroom on 2026-12-09. Both de-duplication keys used to
// contain the artist, so both copies survived, and the list keys its rows by
// event id: two rows with one key leave React unable to tell them apart, and
// stale rows pile up after a search or filter (2026-11). The merge with the
// cached list also kept a stale cached copy whose date or venue name had
// changed since (sg-18739689 under two dates).
//
// The rule: one row per event id. Without a shared id, the old text key
// (date + artist + the first 20 characters of the venue) still merges, as
// before. The first copy wins its fields (callers put fresh results first,
// then the cache). The copies' ticket sources are unioned, and every artist
// a copy was found under joins the kept row's lineup, so a shared bill lists
// each artist once and the row's "with" line names the others. Order is kept;
// sorting is the caller's. Inputs are not mutated.
//
// No hooks, no window: loads under plain Node.

// Same normalization the concerts loader used for its text key.
function normalizeForDedup(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function textKey(e) {
  return `${e.date || ''}-${normalizeForDedup(e.artist)}-${normalizeForDedup(e.venue && e.venue.name).slice(0, 20)}`;
}

function sameSeller(a, b) {
  return a.source === b.source && (a.aiProvider || null) === (b.aiProvider || null);
}

function mergeInto(kept, other) {
  for (const src of Array.isArray(other.ticketSources) ? other.ticketSources : []) {
    if (src && src.ticketUrl && !kept.ticketSources.some(s => sameSeller(s, src))) kept.ticketSources.push(src);
  }
  const names = [...(Array.isArray(other.lineup) ? other.lineup : []), other.artist];
  const have = new Set(kept.lineup.map(a => String(a).trim().toLowerCase()));
  for (const name of names) {
    const k = typeof name === 'string' ? name.trim().toLowerCase() : '';
    if (!k || have.has(k)) continue;
    have.add(k);
    kept.lineup.push(name.trim());
  }
  if (!kept.artistSource && other.artistSource) kept.artistSource = other.artistSource;
}

function uniqueConcerts(events) {
  const byId = new Map();
  const byText = new Map();
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object') continue;
    const tk = textKey(e);
    const kept = (e.id && byId.get(e.id)) || byText.get(tk);
    if (kept) {
      mergeInto(kept, e);
      if (e.id && !byId.has(e.id)) byId.set(e.id, kept);
      if (!byText.has(tk)) byText.set(tk, kept);
      continue;
    }
    const copy = {
      ...e,
      ticketSources: Array.isArray(e.ticketSources) ? [...e.ticketSources] : [],
      lineup: Array.isArray(e.lineup) ? [...e.lineup] : [],
    };
    // The row's own artist is on its bill even when the service sent no lineup.
    if (copy.artist && !copy.lineup.some(a => String(a).trim().toLowerCase() === String(copy.artist).trim().toLowerCase())) {
      copy.lineup.unshift(copy.artist);
    }
    if (e.id) byId.set(e.id, copy);
    byText.set(tk, copy);
    out.push(copy);
  }
  return out;
}

module.exports = { uniqueConcerts, normalizeForDedup };

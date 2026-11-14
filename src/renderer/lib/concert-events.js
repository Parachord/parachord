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
// then the cache), except the artist: the row is listed under the headliner
// among the copies' artists (pickHeadliner), with that copy's artistSource.
// The copies' ticket sources are unioned, and every artist a copy was found
// under joins the kept row's lineup, so a shared bill lists each artist once
// and the row's "with" line names the others. Order is kept; sorting is the
// caller's. Inputs are not mutated.
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

// Lineup membership compares normalized names, so "Fontaines DC" and
// "Fontaines D.C." are one artist.
function addToLineup(kept, names) {
  const have = new Set(kept.lineup.map(normalizeForDedup));
  for (const name of names) {
    const k = typeof name === 'string' ? normalizeForDedup(name) : '';
    if (!k || have.has(k)) continue;
    have.add(k);
    kept.lineup.push(name.trim());
  }
}

function mergeInto(kept, other, meta) {
  for (const src of Array.isArray(other.ticketSources) ? other.ticketSources : []) {
    if (src && src.ticketUrl && !kept.ticketSources.some(s => sameSeller(s, src))) kept.ticketSources.push(src);
  }
  const billing = Array.isArray(other.lineup) ? other.lineup : [];
  addToLineup(kept, [...billing, other.artist]);
  for (const name of billing) {
    const k = typeof name === 'string' ? normalizeForDedup(name) : '';
    if (k && !meta.billing.includes(k)) meta.billing.push(k);
  }
  if (other.artist) meta.candidates.push({ artist: other.artist, artistSource: other.artistSource });
}

const SOURCE_RANK = { collection: 0, library: 1, history: 2 };

// The row's artist is the headliner among the user's artists the show was
// found under: the lowest index on the provider's lineup (billing order). A
// copy whose artist isn't on the lineup ranks after those that are; ties go
// to collection, then library, then history, then the first copy. The
// artistSource moves with the artist, so the row's reason describes the
// artist it shows. Every other field stays the first (fresh) copy's.
function pickHeadliner(kept, meta) {
  if (meta.candidates.length < 2) return;
  const rank = (c) => {
    const at = meta.billing.indexOf(normalizeForDedup(c.artist));
    return [at === -1 ? Infinity : at, SOURCE_RANK[c.artistSource] ?? 3];
  };
  let best = meta.candidates[0];
  let bestRank = rank(best);
  for (const c of meta.candidates.slice(1)) {
    const r = rank(c);
    if (r[0] < bestRank[0] || (r[0] === bestRank[0] && r[1] < bestRank[1])) {
      best = c;
      bestRank = r;
    }
  }
  kept.artist = best.artist;
  if (best.artistSource) kept.artistSource = best.artistSource;
  else delete kept.artistSource;
}

function uniqueConcerts(events) {
  const byId = new Map();
  const byText = new Map();
  const metas = new Map(); // kept row -> { billing, candidates }
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object') continue;
    const tk = textKey(e);
    const kept = (e.id && byId.get(e.id)) || byText.get(tk);
    if (kept) {
      mergeInto(kept, e, metas.get(kept));
      if (e.id && !byId.has(e.id)) byId.set(e.id, kept);
      if (!byText.has(tk)) byText.set(tk, kept);
      continue;
    }
    const copy = {
      ...e,
      ticketSources: Array.isArray(e.ticketSources) ? [...e.ticketSources] : [],
      lineup: [],
    };
    addToLineup(copy, Array.isArray(e.lineup) ? e.lineup : []);
    const billing = copy.lineup.map(normalizeForDedup);
    // The row's own artist is on its bill even when the service sent no
    // lineup (shown in the "with" line once another artist joins). It is not
    // part of the billing order the headliner is ranked by.
    if (copy.artist && !billing.includes(normalizeForDedup(copy.artist))) {
      copy.lineup.unshift(copy.artist);
    }
    metas.set(copy, { billing, candidates: copy.artist ? [{ artist: copy.artist, artistSource: copy.artistSource }] : [] });
    if (e.id) byId.set(e.id, copy);
    byText.set(tk, copy);
    out.push(copy);
  }
  for (const row of out) pickHeadliner(row, metas.get(row));
  return out;
}

module.exports = { uniqueConcerts, normalizeForDedup };

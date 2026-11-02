// search-requests.js — the network half of Search (performSearch in app.js),
// with `fetch` injected so tests can count what a query costs
// (tests/renderer/page-load-budget.test.js): MusicBrainz's three searches and
// ListenBrainz popularity. Ranking, merging and stable rows are
// search-catalog.js; which results are still current and when they publish
// stay in performSearch.

const { popularityFromListens } = require('./search-catalog');
const { isMusicBrainzId } = require('./album-catalog');

const MB = 'https://musicbrainz.org/ws/2';

// Map Search's field syntax to each MusicBrainz endpoint's: album: is
// releasegroup: for release groups and release: for recordings (stripped for
// artists); track:/song: are recording: for recordings (stripped elsewhere).
function preprocessQuery(query, endpoint) {
  let processed = query;
  if (endpoint === 'release-group') {
    processed = processed.replace(/\balbum:/gi, 'releasegroup:');
  } else if (endpoint === 'recording') {
    processed = processed.replace(/\balbum:/gi, 'release:');
  } else if (endpoint === 'artist') {
    // quoted values (album:"dark side") and unquoted (album:thriller)
    processed = processed.replace(/\balbum:(?:"[^"]*"|[^\s]*)/gi, '').trim();
  }
  if (endpoint === 'recording') {
    processed = processed.replace(/\b(track|song):/gi, 'recording:');
  } else {
    // quoted values (track:"let it be") and unquoted (track:yesterday)
    processed = processed.replace(/\b(track|song):(?:"[^"]*"|[^\s]*)/gi, '').trim();
  }
  return processed.replace(/\s+/g, ' ').trim();
}

// Dedupe by a key, keeping the first (MusicBrainz's best) of each.
const dedupeBy = (items, keyOf) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// One request each. fetchOptions carries the query's abort signal, so a
// superseded query's requests leave the MusicBrainz queue unsent.
// Each resolves to { ok, rows }; an AbortError rejects.

async function searchMusicBrainzArtists(query, { fetch, fetchOptions }) {
  const response = await fetch(`${MB}/artist?query=${encodeURIComponent(preprocessQuery(query, 'artist'))}&fmt=json&limit=25`, fetchOptions);
  const data = response.ok ? await response.json() : {};
  return { ok: response.ok, rows: dedupeBy(data.artists, a => (a.name || '').toLowerCase()) };
}

// A network failure (an outage) answers { ok: false, failed: true } instead of
// rejecting: Search then leans on the catalogs.
async function searchMusicBrainzAlbums(query, { fetch, fetchOptions }) {
  let response;
  try {
    response = await fetch(`${MB}/release-group?query=${encodeURIComponent(preprocessQuery(query, 'release-group'))}&fmt=json&limit=30`, fetchOptions);
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    return { ok: false, failed: true, error, rows: [] };
  }
  const data = response.ok ? await response.json() : {};
  const rows = dedupeBy(data['release-groups'], a =>
    `${((a['artist-credit'] || [])[0] || {}).name || ''}|${a.title || ''}`.toLowerCase());
  return { ok: response.ok, rows };
}

// Tracks start unresolved; recording.id IS the MusicBrainz recording MBID
// (stored as mbid for downstream enrichment); score is MusicBrainz's text
// relevance.
async function searchMusicBrainzTracks(query, { fetch, fetchOptions }) {
  const response = await fetch(`${MB}/recording?query=${encodeURIComponent(preprocessQuery(query, 'recording'))}&fmt=json&limit=50`, fetchOptions);
  const data = response.ok ? await response.json() : {};
  const rows = (data.recordings || []).map(recording => {
    const release = (recording.releases || [])[0] || null;
    return {
      id: recording.id,
      mbid: recording.id,
      artistMbids: (recording['artist-credit'] || []).map(ac => ac.artist && ac.artist.id).filter(Boolean),
      releaseMbid: (release && release.id) || null,
      title: recording.title,
      artist: ((recording['artist-credit'] || [])[0] || {}).name || 'Unknown',
      duration: Math.floor((recording.length || 180000) / 1000),
      album: (release && release.title) || '',
      releaseId: (release && release.id) || null,
      releaseGroupId: (release && release['release-group'] && release['release-group'].id) || null, // for cache lookup
      length: recording.length,
      score: recording.score,
      sources: {},
      _needsResolution: true,
    };
  });
  return { ok: response.ok, rows };
}

// ListenBrainz listen counts for MusicBrainz release groups, recordings or
// artists, as Search popularity (popularityFromListens): one batched POST to
// /1/popularity/<kind>, no account needed (headersFor adds the user's token
// when there is one). Search waits for it before showing MusicBrainz's rows,
// because rows hold still once shown, so it is capped at timeoutMs; a slow or
// failed call just leaves those rows without popularity. Answers (an unknown
// id's null too) are kept for ttlMs.
function createPopularityLookup({ fetch, ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now(), headersFor = () => ({}), log = () => {} }) {
  const cache = new Map(); // `${kind}:${mbid}` → { value, at }

  // Map<mbid, 0-100>
  const fetchPopularity = async (kind, mbids, { timeoutMs = 800, reference } = {}) => {
    const out = new Map();
    const t = now();
    const need = [];
    for (const id of new Set((mbids || []).filter(isMusicBrainzId))) {
      const hit = cache.get(`${kind}:${id}`);
      if (hit && t - hit.at < ttlMs) { if (hit.value !== null) out.set(id, hit.value); } else need.push(id);
    }
    if (need.length === 0) return out;
    const field = `${kind.replace('-', '_')}_mbid`;
    const url = `https://api.listenbrainz.org/1/popularity/${kind}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersFor(url) },
        body: JSON.stringify({ [`${field}s`]: need }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        for (const entry of (await res.json()) || []) {
          const id = entry && entry[field];
          if (!id) continue;
          const value = popularityFromListens(entry.total_listen_count, reference);
          cache.set(`${kind}:${id}`, { value, at: t });
          if (value !== null) out.set(id, value);
        }
      }
    } catch (e) {
      log(`🔍 ListenBrainz popularity (${kind}) skipped: ${e && e.name === 'AbortError' ? `over ${timeoutMs}ms` : (e && e.message) || e}`);
    } finally {
      clearTimeout(timer);
    }
    return out;
  };

  // rows with _popularity added where ListenBrainz knew it. idOf: the MBID a
  // row is looked up by (its own id, or its artist's for tracks).
  const withPopularity = async (kind, rows, { idOf = r => r.id, reference, timeoutMs } = {}) => {
    const popularity = await fetchPopularity(kind, rows.map(idOf), { reference, timeoutMs });
    return popularity.size ? rows.map(r => (popularity.has(idOf(r)) ? { ...r, _popularity: popularity.get(idOf(r)) } : r)) : rows;
  };

  return { fetchPopularity, withPopularity };
}

module.exports = {
  preprocessQuery,
  searchMusicBrainzArtists,
  searchMusicBrainzAlbums,
  searchMusicBrainzTracks,
  createPopularityLookup,
};

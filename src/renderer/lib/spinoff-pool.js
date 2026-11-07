// src/renderer/lib/spinoff-pool.js: the tracks a spinoff plays (#1281).
//
// Spinoff starts from Last.fm's track.getsimilar. Some of the most played songs
// have no similar-track data there ("Shape of You" answers an empty list), so
// when it returns fewer than MIN_SIMILAR_TRACKS the pool is topped up from the
// seed artist's similar artists: each one's top tracks, dealt round-robin so no
// two tracks in a row are by the same artist.
//
// A failed request is not the same as an empty answer. Only an empty answer
// (or Last.fm's error 6, "not found") falls back; a failure stops there, so an
// outage costs one request rather than ten.
//
// Pure apart from the fetchJson it is given, so it loads under plain Node.
// fetchJson(url) resolves to the parsed body, or null when the request failed.

'use strict';

const { normalizeStr } = require('../../../sync-providers/confidence-scoring');

const MIN_SIMILAR_TRACKS = 5; // below this, top up from similar artists
const SIMILAR_TRACKS_LIMIT = 20;
const FALLBACK_ARTISTS = 8;
const TOP_TRACKS_PER_ARTIST = 3;
const LASTFM_NOT_FOUND = 6;

function lastfmUrl(method, params, apiKey) {
  const q = new URLSearchParams({ method, ...params, api_key: apiKey, format: 'json' });
  return `https://ws.audioscrobbler.com/2.0/?${q.toString()}`;
}

const toArray = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : []));

// The list under `body[listKey][itemKey]`: an array, [] for an empty answer or
// a "not found", null for a failure or any other Last.fm error.
async function fetchList(fetchJson, url, listKey, itemKey) {
  let body;
  try {
    body = await fetchJson(url);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  if (body.error !== undefined) return body.error === LASTFM_NOT_FOUND ? [] : null;
  return toArray(body[listKey] && body[listKey][itemKey]);
}

const matchPercent = (m) => {
  const n = Math.round(parseFloat(m) * 100);
  return Number.isFinite(n) ? n : 0;
};

const trackKey = (artist, title) => {
  const a = normalizeStr(artist) || String(artist || '').trim().toLowerCase();
  const t = normalizeStr(title) || String(title || '').trim().toLowerCase();
  return `${a}|${t}`;
};

function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// One track from each artist per round, the artist order shuffled every round.
// When a round would start with the artist that ended the last one, its first
// two artists swap. Runs only happen once a single artist has tracks left.
function dealRoundRobin(groups, rng = Math.random) {
  const queues = groups.map((g) => [...g.tracks]).filter((q) => q.length);
  const out = [];
  while (queues.some((q) => q.length)) {
    const order = shuffle(queues.filter((q) => q.length), rng);
    const last = out[out.length - 1];
    if (last && order.length > 1 && order[0][0].artist === last.artist) {
      [order[0], order[1]] = [order[1], order[0]];
    }
    for (const q of order) out.push(q.shift());
  }
  return out;
}

async function similarArtistGroups(fetchJson, apiKey, artist, rng) {
  const artists = await fetchList(
    fetchJson,
    lastfmUrl('artist.getsimilar', { artist, limit: String(FALLBACK_ARTISTS) }, apiKey),
    'similarartists', 'artist'
  );
  if (!artists || !artists.length) return [];
  const picked = artists.filter((a) => a && a.name).slice(0, FALLBACK_ARTISTS);
  const lists = await Promise.all(picked.map((a) => fetchList(
    fetchJson,
    lastfmUrl('artist.gettoptracks', { artist: a.name, limit: String(TOP_TRACKS_PER_ARTIST) }, apiKey),
    'toptracks', 'track'
  )));
  return picked.map((a, i) => ({
    artist: a.name,
    tracks: (lists[i] || []).filter((t) => t && t.name).slice(0, TOP_TRACKS_PER_ARTIST).map((t) => ({
      title: t.name,
      artist: (t.artist && t.artist.name) || a.name,
      match: matchPercent(a.match),
      source: 'lastfm-similar-artist',
    })),
  }));
}

/**
 * The spinoff pool for a seed track.
 * Resolves to { tracks, failed, usedFallback }. `failed` means the similar-
 * tracks request itself failed, so the caller can say so rather than "none".
 */
async function buildSpinoffPool({ fetchJson, apiKey, artist, title, rng = Math.random }) {
  if (!apiKey || !artist || !title) return { tracks: [], failed: true, usedFallback: false };
  const raw = await fetchList(
    fetchJson,
    lastfmUrl('track.getsimilar', { artist, track: title, limit: String(SIMILAR_TRACKS_LIMIT) }, apiKey),
    'similartracks', 'track'
  );
  if (raw === null) return { tracks: [], failed: true, usedFallback: false };

  const seedKey = trackKey(artist, title);
  const seen = new Set([seedKey]);
  const keep = (t) => {
    const key = trackKey(t.artist, t.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  const similar = shuffle(raw.filter((t) => t && t.name).map((t) => ({
    title: t.name,
    artist: (t.artist && t.artist.name) || 'Unknown Artist',
    match: matchPercent(t.match),
    source: 'lastfm-similar',
  })), rng).filter(keep);

  if (similar.length >= MIN_SIMILAR_TRACKS) return { tracks: similar, failed: false, usedFallback: false };

  const groups = await similarArtistGroups(fetchJson, apiKey, artist, rng);
  const dealt = dealRoundRobin(groups, rng).filter(keep);
  return { tracks: [...similar, ...dealt], failed: false, usedFallback: dealt.length > 0 };
}

/**
 * Whether the Spinoff button should be enabled: any similar track, or failing
 * that any similar artist. A failed request answers false and asks nothing more.
 */
async function checkSpinoffAvailable({ fetchJson, apiKey, artist, title }) {
  if (!apiKey || !artist || !title) return false;
  const tracks = await fetchList(
    fetchJson,
    lastfmUrl('track.getsimilar', { artist, track: title, limit: '1' }, apiKey),
    'similartracks', 'track'
  );
  if (tracks === null) return false;
  if (tracks.length > 0) return true;
  const artists = await fetchList(
    fetchJson,
    lastfmUrl('artist.getsimilar', { artist, limit: '1' }, apiKey),
    'similarartists', 'artist'
  );
  return !!(artists && artists.length > 0);
}

/** fetchJson over the app's lastfmFetch: the parsed body, or null on a failed request. */
function lastfmJsonFetcher(lastfmFetch) {
  return async (url) => {
    const response = await lastfmFetch(url);
    if (!response || !response.ok) return null;
    return response.json();
  };
}

module.exports = {
  MIN_SIMILAR_TRACKS,
  FALLBACK_ARTISTS,
  TOP_TRACKS_PER_ARTIST,
  dealRoundRobin,
  buildSpinoffPool,
  checkSpinoffAvailable,
  lastfmJsonFetcher,
};

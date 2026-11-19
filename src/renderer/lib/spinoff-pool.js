// src/renderer/lib/spinoff-pool.js: the tracks a spinoff plays (#1281).
//
// Spinoff starts from the seed track's similar tracks. Some of the most played
// songs have none ("Shape of You" answers an empty list on Last.fm), so when
// there are fewer than MIN_SIMILAR_TRACKS the pool is topped up from the seed
// artist's similar artists: each one's top tracks, dealt round-robin so no two
// tracks in a row are by the same artist.
//
// Similar tracks and artists come from every plug-in that can name them
// (capabilities.similarTracks / similarArtists, lib/similar-music.js, #1539);
// the caller hands in the lookups:
//   similarTracks({ artist, title, limit }) → { tracks: [{ artist, title, match }], failed }
//   similarArtists({ name, limit })         → { artists: [{ name, match }], failed }
//   topTracks({ name, mbid? }, limit)       → [{ title, artist? }] ([] on failure;
//                                             capabilities.artistTopTracks)
// `failed` means no plug-in answered (none to ask, or every one failed).
//
// A failure is not the same as an empty answer. Only an empty answer falls
// back to the top-up; a failure stops there, so an outage costs one round of
// requests rather than ten.
//
// Pure apart from the lookups it is given, so it loads under plain Node.

'use strict';

const { trackKey } = require('./similar-music');

const MIN_SIMILAR_TRACKS = 5; // below this, top up from similar artists
const SIMILAR_TRACKS_LIMIT = 20;
const FALLBACK_ARTISTS = 8;
const TOP_TRACKS_PER_ARTIST = 3;

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

const safely = async (fn, fallback) => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

async function similarArtistGroups({ similarArtists, topTracks }, artist) {
  const found = await safely(() => similarArtists({ name: artist, limit: FALLBACK_ARTISTS }), null);
  if (!found || found.failed || !Array.isArray(found.artists) || !found.artists.length) return [];
  const picked = found.artists.filter((a) => a && a.name).slice(0, FALLBACK_ARTISTS);
  const lists = await Promise.all(picked.map((a) => safely(() => topTracks({ name: a.name, mbid: a.mbid }, TOP_TRACKS_PER_ARTIST), [])));
  return picked.map((a, i) => ({
    artist: a.name,
    tracks: (Array.isArray(lists[i]) ? lists[i] : []).filter((t) => t && t.title).slice(0, TOP_TRACKS_PER_ARTIST).map((t) => ({
      title: t.title,
      artist: t.artist || a.name,
      match: Number(a.match) || 0,
      source: 'similar-artist',
    })),
  }));
}

/**
 * The spinoff pool for a seed track.
 * Resolves to { tracks, failed, usedFallback }. `failed` means no plug-in could
 * answer for similar tracks, so the caller can say so rather than "none".
 */
async function buildSpinoffPool({ similarTracks, similarArtists, topTracks, artist, title, rng = Math.random }) {
  if (typeof similarTracks !== 'function' || !artist || !title) return { tracks: [], failed: true, usedFallback: false };
  const found = await safely(() => similarTracks({ artist, title, limit: SIMILAR_TRACKS_LIMIT }), null);
  if (!found || found.failed) return { tracks: [], failed: true, usedFallback: false };

  const seen = new Set([trackKey(artist, title)]);
  const keep = (t) => {
    const key = trackKey(t.artist, t.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  const similar = shuffle((found.tracks || []).filter((t) => t && t.title).map((t) => ({
    title: t.title,
    artist: t.artist || 'Unknown Artist',
    match: Number(t.match) || 0,
    source: 'similar',
  })), rng).filter(keep);

  if (similar.length >= MIN_SIMILAR_TRACKS) return { tracks: similar, failed: false, usedFallback: false };
  if (typeof similarArtists !== 'function' || typeof topTracks !== 'function') {
    return { tracks: similar, failed: false, usedFallback: false };
  }

  const groups = await similarArtistGroups({ similarArtists, topTracks }, artist);
  const dealt = dealRoundRobin(groups, rng).filter(keep);
  return { tracks: [...similar, ...dealt], failed: false, usedFallback: dealt.length > 0 };
}

/**
 * Whether the Spinoff button should be enabled: any similar track, or failing
 * that any similar artist. A failure answers false and asks nothing more.
 */
async function checkSpinoffAvailable({ similarTracks, similarArtists, artist, title }) {
  if (typeof similarTracks !== 'function' || !artist || !title) return false;
  const tracks = await safely(() => similarTracks({ artist, title, limit: 1 }), null);
  if (!tracks || tracks.failed) return false;
  if ((tracks.tracks || []).length > 0) return true;
  if (typeof similarArtists !== 'function') return false;
  const artists = await safely(() => similarArtists({ name: artist, limit: 1 }), null);
  return !!(artists && !artists.failed && (artists.artists || []).length > 0);
}

module.exports = {
  MIN_SIMILAR_TRACKS,
  FALLBACK_ARTISTS,
  TOP_TRACKS_PER_ARTIST,
  dealRoundRobin,
  buildSpinoffPool,
  checkSpinoffAvailable,
};

// src/renderer/lib/artist-image-chain.js — artist photos when there is no
// Spotify or Apple Music sign-in.
//
// getArtistImage (src/renderer/app.js) feeds every artist photo outside the
// artist page: Home's Shuffleupagus suggestions, recommendations, related
// artists, Search, top artists, friends, chat cards. It only asked Spotify
// and Apple Music (MusicKit), and returned nothing at all for a user signed
// in to neither, so their suggestions were all placeholders (2026-10-27).
// Only the artist page had its own Wikipedia → Discogs fallback.
//
// The chain is now, first photo wins: Spotify, Apple Music, Deezer's public
// artist search (no account), the user's active resolvers that declare
// capabilities.artistImage (searchArtistImage; docs/architecture/plugins.md),
// Wikipedia through Wikidata when the caller knows the MusicBrainz id, and
// Discogs when the user has a Discogs token. Deezer goes before the
// resolvers because it is one cheap request, and a resolver's lookup can be
// a full page load on a queue that track resolution shares (Amazon Music):
// the resolvers fill Deezer's gaps. This module is the pure part:
// reading Deezer's answer, refusing unusable URLs, running the steps, and
// remembering misses.
//
// Pure (fetching is the caller's), so jest drives it directly
// (tests/renderer/artist-image-chain.test.js).

const { normalizeArtistName } = require('./album-catalog');
const { looksLikeCredentialBearingUrl } = require('../../../discord-presence-logic');

// Last.fm's grey-star placeholder, which servers relaying Last.fm images
// (Navidrome, Airsonic) hand back for artists Last.fm has no photo of.
const LASTFM_PLACEHOLDER_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

// Each step is bounded: one slow source (a self-hosted server on a sleeping
// NAS) must not hold every photo behind it.
const ARTIST_IMAGE_STEP_TIMEOUT_MS = 8000;

// How long "no source has a photo of this artist" is remembered. Without it
// every render of a photo-less artist asked every source again.
const ARTIST_IMAGE_MISS_TTL_MS = 6 * 60 * 60 * 1000;

const TIMED_OUT = Symbol('timed out');

// An http(s) URL that can go into the image cache and an <img>: no
// credentials in it (the cache is persisted; a Subsonic getCoverArt URL
// carries the user's auth token and salt), and not a known placeholder.
function isUsableArtistImageUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return false;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch (_err) {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (looksLikeCredentialBearingUrl(parsed)) return false;
  if (url.includes(LASTFM_PLACEHOLDER_HASH)) return false;
  return true;
}

// The photo for `name` from a Deezer /search/artist response, or null. Only
// an artist whose name matches (normalizeArtistName: case, marks, a leading
// "The", "&") counts; Deezer's first result for an obscure name is often
// someone else. An artist without a photo has an empty md5_image, and its
// picture URLs point at Deezer's blank placeholder (".../artist//...").
function deezerArtistImageFromSearch(json, name) {
  const wanted = normalizeArtistName(name);
  if (!wanted) return null;
  const artists = (json && Array.isArray(json.data)) ? json.data : [];
  for (const a of artists) {
    if (!a || normalizeArtistName(a.name) !== wanted) continue;
    const url = a.picture_xl || a.picture_big || a.picture_medium || null;
    if (!url || a.md5_image === '' || url.includes('/artist//')) return null;
    return isUsableArtistImageUrl(url) ? url : null;
  }
  return null;
}

// Run steps ([{ id, run: async () => url | null }]) in order and return the
// first usable photo: { url, source, complete }. complete is false when a
// step threw or timed out, so the caller doesn't remember the miss (the next
// render asks again, as with a network error).
async function firstArtistImage(steps, { timeoutMs = ARTIST_IMAGE_STEP_TIMEOUT_MS, log = null } = {}) {
  let complete = true;
  for (const step of steps || []) {
    if (!step || typeof step.run !== 'function') continue;
    let timer = null;
    try {
      const timedOut = new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      });
      const url = await Promise.race([Promise.resolve().then(step.run), timedOut]);
      if (url === TIMED_OUT) {
        complete = false;
        if (log) log(`${step.id} timed out`);
        continue;
      }
      if (isUsableArtistImageUrl(url)) return { url, source: step.id, complete };
    } catch (err) {
      complete = false;
      if (log) log(`${step.id} failed: ${(err && err.message) || err}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { url: null, source: null, complete };
}

// Artists no source had a photo of, keyed by normalized name.
function createArtistImageMissCache({ now = () => Date.now(), ttlMs = ARTIST_IMAGE_MISS_TTL_MS } = {}) {
  const misses = new Map(); // key -> ms
  const keyOf = (name) => normalizeArtistName(name);
  return {
    has(name) {
      const key = keyOf(name);
      const at = misses.get(key);
      if (at === undefined) return false;
      if (now() - at > ttlMs) {
        misses.delete(key);
        return false;
      }
      return true;
    },
    add(name) {
      const key = keyOf(name);
      if (key) misses.set(key, now());
    },
    // A new sign-in can find photos the earlier misses didn't have.
    clear() {
      misses.clear();
    },
  };
}

module.exports = {
  ARTIST_IMAGE_STEP_TIMEOUT_MS,
  ARTIST_IMAGE_MISS_TTL_MS,
  isUsableArtistImageUrl,
  deezerArtistImageFromSearch,
  firstArtistImage,
  createArtistImageMissCache,
};

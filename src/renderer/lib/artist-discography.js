// artist-discography.js — the MusicBrainz requests behind an uncached artist
// page (fetchArtistData in app.js), with `fetch` injected so tests can count
// what the page costs (tests/renderer/page-load-budget.test.js). Matching the
// artist, the not-on-MusicBrainz fallbacks and the page state stay in app.js.

const ARTIST_RELEASE_TYPES = ['album', 'ep', 'single'];

// Which request finds the artist:
//   - the caller knows the MBID (Search rows, credits): none;
//   - the MBID mapper knows it: a lookup by id, which needs no matching
//     (fetchArtistData falls back to a name search if that lookup fails);
//   - otherwise: a name search.
// Returns { kind: 'known' | 'lookup' | 'search', url }.
function artistLookupPlan({ name, knownMbid = null, mapperMbid = null } = {}) {
  if (knownMbid) return { kind: 'known', url: null };
  if (mapperMbid) return { kind: 'lookup', url: `https://musicbrainz.org/ws/2/artist/${mapperMbid}?fmt=json` };
  return { kind: 'search', url: `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(name || '')}&fmt=json&limit=5` };
}

// A MusicBrainz release group as an artist-page release. `type` is the type
// the request asked for, used when the group has no primary type.
function releaseFromReleaseGroup(rg, type) {
  const primaryType = (rg['primary-type'] || '').toLowerCase();
  const secondaryTypes = (rg['secondary-types'] || []).map(t => t.toLowerCase());
  // Categorize: studio album, live, compilation, or the primary type (ep/single)
  let releaseType = primaryType || type;
  if (secondaryTypes.includes('live')) {
    releaseType = 'live';
  } else if (secondaryTypes.includes('compilation')) {
    releaseType = 'compilation';
  } else if (primaryType === 'album' && secondaryTypes.length === 0) {
    releaseType = 'album'; // Studio album (no secondary types)
  }
  return {
    id: rg.id,
    title: rg.title,
    date: rg['first-release-date'] || null,
    releaseType,
    secondaryTypes,
    disambiguation: rg.disambiguation,
    // fetchReleaseData / the hover prefetch skip the release-id probe, a
    // guaranteed 404 for a release-group id
    isReleaseGroup: true,
  };
}

// The artist's release groups: one request per type (album, EP, single), all
// three started at once (the MusicBrainz limiter spaces them 1.1s apart).
// Release groups rather than releases, so each album appears once. Each type
// is handed to onBatch as it answers, so the page shows albums first instead
// of waiting for all three. A failed type answers [] and is reported to
// onError, a refused request (an HTTP error) as well as a thrown one, so the
// caller can tell "MusicBrainz couldn't answer" from "no releases"
// (discographyOutcome). Resolves to every release, in request order (the
// caller sorts).
async function loadArtistReleaseGroups(artistMbid, { fetch, onBatch = () => {}, onError = () => {} } = {}) {
  const results = await Promise.all(ARTIST_RELEASE_TYPES.map(async (type) => {
    try {
      const response = await fetch(`https://musicbrainz.org/ws/2/release-group?artist=${artistMbid}&type=${type}&fmt=json&limit=100`);
      if (!response.ok) {
        onError(musicBrainzHttpError(response.status), type);
        return [];
      }
      const data = await response.json();
      if (!data['release-groups']) return [];
      const releases = data['release-groups'].map(rg => releaseFromReleaseGroup(rg, type));
      onBatch(releases, type);
      return releases;
    } catch (error) {
      onError(error, type);
      return [];
    }
  }));
  return results.flat();
}

// An error for a MusicBrainz request that answered with an HTTP error,
// flagged the way describeMusicBrainzError words it: throttled for 429 and
// 503 (the fetch interceptor normally throws those itself after its retries),
// unreachable for any other 5xx.
function musicBrainzHttpError(status) {
  const err = new Error(`MusicBrainz answered HTTP ${status}`);
  err.status = status;
  if (status === 429 || status === 503) err.mbThrottled = true;
  else if (status >= 500) err.mbUnreachable = true;
  return err;
}

// What the artist page does with MusicBrainz's answer (#874):
//   'complete': releases, and every type answered. Cache it.
//   'empty':    no releases, and every type answered. The artist really has
//               none; cache it and show the plain empty state.
//   'partial':  releases, but a type failed. Show them, don't cache, so the
//               next visit asks again.
//   'failed':   no releases because a type failed. Never cache it; show
//               "couldn't load" with Try again (after the services' fallback).
function discographyOutcome({ releaseCount = 0, failedTypes = 0 } = {}) {
  if (failedTypes > 0) return releaseCount > 0 ? 'partial' : 'failed';
  return releaseCount > 0 ? 'complete' : 'empty';
}

module.exports = { ARTIST_RELEASE_TYPES, artistLookupPlan, releaseFromReleaseGroup, loadArtistReleaseGroups, musicBrainzHttpError, discographyOutcome };

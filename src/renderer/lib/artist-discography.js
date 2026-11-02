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
// of waiting for all three. A failed type answers []. Resolves to every
// release, in request order (the caller sorts).
async function loadArtistReleaseGroups(artistMbid, { fetch, onBatch = () => {}, onError = () => {} } = {}) {
  const results = await Promise.all(ARTIST_RELEASE_TYPES.map(async (type) => {
    try {
      const response = await fetch(`https://musicbrainz.org/ws/2/release-group?artist=${artistMbid}&type=${type}&fmt=json&limit=100`);
      if (!response.ok) return [];
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

module.exports = { ARTIST_RELEASE_TYPES, artistLookupPlan, releaseFromReleaseGroup, loadArtistReleaseGroups };

// release-lookup.js — an album page's MusicBrainz lookup and its cache, with
// `fetch` injected so tests can count the requests a page costs
// (tests/renderer/page-load-budget.test.js). app.js creates one instance over
// releaseDetailsCache and the global fetch (the MusicBrainz interceptor).
//
// Release details (tracklist + artist credits) by MusicBrainz release ID.
// Album pages used to refetch /ws/2/release/{id}?inc=recordings on every
// open, even for an album opened a minute earlier, and MB allows one call
// per second. A release's tracklist never changes for a given ID, so it is
// cached like album art. One cached shape serves every caller (sites that only
// need recordings get a superset). Results mimic the subset of Response the
// callers use (ok / status / json()); non-OK responses are passed through
// untouched so the 404 → "maybe it's a release-group ID" fallback works.
//
// Cache entries are either { data, timestamp } for a release ID, or
// { alias: <releaseId>, timestamp } for a release-group ID that was resolved
// to a release (rememberReleaseGroupAlias). Following the alias means an album
// opened from search (which carries a release-group ID) costs zero MusicBrainz
// calls on a revisit. A result carries the real `releaseId`; callers that keep
// using the ID afterwards should adopt it.
//
// getCache: () => the cache object (app.js replaces releaseDetailsCache.current
// wholesale when the saved caches load, so it is read on every call).

const MB_HEADERS = { 'User-Agent': 'Parachord/1.0.0 (https://github.com/harmonix)' };

function createReleaseLookup({ getCache, fetch: defaultFetch, ttlMs, now = () => Date.now(), log = () => {} }) {
  // The cached details for a release ID, or for the release a release-group ID
  // was resolved to: { releaseId, data }, or null when nothing fresh is cached.
  const cachedReleaseDetails = (requestedId) => {
    const cache = getCache();
    const t = now();
    let releaseId = requestedId;
    const aliasEntry = cache[requestedId];
    if (aliasEntry && aliasEntry.alias && (t - aliasEntry.timestamp) < ttlMs) {
      releaseId = aliasEntry.alias;
    }
    const cached = cache[releaseId];
    return cached && cached.data && (t - cached.timestamp) < ttlMs
      ? { releaseId, data: cached.data }
      : null;
  };

  const fetchReleaseDetails = async (requestedId, fetchImpl = defaultFetch) => {
    const hit = cachedReleaseDetails(requestedId);
    if (hit) {
      const { releaseId } = hit;
      log(`📦 Release details from cache: ${releaseId}${releaseId !== requestedId ? ` (via release-group ${requestedId})` : ''}`);
      return { ok: true, status: 200, fromCache: true, releaseId, json: async () => hit.data };
    }
    const releaseId = requestedId;
    const response = await fetchImpl(
      `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits+release-groups&fmt=json`,
      { headers: MB_HEADERS }
    );
    if (!response.ok) return response;
    const data = await response.json();
    getCache()[releaseId] = { data, timestamp: now() };
    return { ok: true, status: response.status, fromCache: false, releaseId, json: async () => data };
  };

  const rememberReleaseGroupAlias = (releaseGroupId, releaseId) => {
    if (releaseGroupId && releaseId && releaseGroupId !== releaseId) {
      getCache()[releaseGroupId] = { alias: releaseId, timestamp: now() };
    }
  };

  // A release group's first official release WITH its track list, in one
  // MusicBrainz request: the browse takes inc=recordings, and its release
  // carries everything the /release/<id>?inc=recordings+artist-credits lookup
  // does (plus label-info). Opening a group used to cost a browse for the
  // release id and then that lookup, two slots in the 1.1s queue. Same result
  // shape as fetchReleaseDetails; an empty group answers
  // { ok: false, status: 404, noReleases: true }.
  const fetchReleaseGroupDetails = async (releaseGroupId, fetchImpl = defaultFetch) => {
    const response = await fetchImpl(
      `https://musicbrainz.org/ws/2/release?release-group=${releaseGroupId}&status=official&inc=recordings+artist-credits+labels&fmt=json&limit=1`,
      { headers: MB_HEADERS }
    );
    if (!response.ok) return response;
    const body = await response.json();
    const data = body.releases && body.releases[0];
    if (!data || !data.id) return { ok: false, status: 404, noReleases: true };
    getCache()[data.id] = { data, timestamp: now() };
    rememberReleaseGroupAlias(releaseGroupId, data.id);
    return { ok: true, status: response.status, fromCache: false, releaseId: data.id, json: async () => data };
  };

  // The album page's lookup (fetchReleaseData, and the hover prefetch with the
  // background lane's fetch): a release id, or a release group's first
  // official release. An id known to be a group (isReleaseGroup: artist-page
  // cards, parachord://album matches, search) skips the release-id probe, a
  // guaranteed 404, unless the group's release is already cached. Budget: a
  // cached album 0 requests, a known group 1, a release id 1, an unflagged
  // group 2 (the probe, then the browse).
  const loadRelease = async ({ id, isReleaseGroup }, fetchImpl = defaultFetch) => {
    const skipProbe = !!isReleaseGroup && !(getCache()[id] && getCache()[id].alias);
    let response = skipProbe ? null : await fetchReleaseDetails(id, fetchImpl);
    if (!response || (!response.ok && response.status === 404)) {
      response = await fetchReleaseGroupDetails(id, fetchImpl);
    }
    return response;
  };

  return { cachedReleaseDetails, fetchReleaseDetails, rememberReleaseGroupAlias, fetchReleaseGroupDetails, loadRelease };
}

module.exports = { createReleaseLookup };

/**
 * Page-load budgets: how many MusicBrainz requests stand between a click and
 * a page's content, counted against a fake fetch. MusicBrainz starts at most
 * one request every 1.1s, so each request on a page's critical path is a
 * second or more of waiting; wall-clock timings would be flaky in CI, request
 * counts aren't.
 *
 *   Album page (loadRelease, src/renderer/lib/release-lookup.js)
 *     cached album, or a group opened before ............ 0
 *     release-group id the opener flags (isReleaseGroup) . 1   (was 3 before 2026-11)
 *     release id ......................................... 1
 *     unflagged release-group id ......................... 2   (a 404 probe, then the browse)
 *
 *   The album page's source dropdown (#1238) is deliberately NOT in these
 *   budgets: its group-editions fetch (fetchReleaseGroupReleases) runs when
 *   the user opens the dropdown, after the page loaded, and is usually cached
 *   by the browse that loaded the page (tests/renderer/album-versions.test.js).
 *
 *   Artist page, uncached (src/renderer/lib/artist-discography.js)
 *     MBID known to the caller (Search, credits) ......... 3   (albums, EPs, singles)
 *     MBID from the mapper, or a name .................... 4   (a lookup or search, then the 3)
 *     the three release-group requests start together and each type shows
 *     as it answers
 *
 * Covered elsewhere: the view changes before any lookup
 * (tests/ui/scroll-state-coalescing.test.js), a cached artist page and the
 * relaunch restore (tests/ui/discovery-cache-first.test.js), the catalogs
 * racing MusicBrainz (tests/ui/album-catalog-fallback.test.js,
 * tests/renderer/album-track-list.test.js), the slow-MusicBrainz artist
 * fallback (tests/renderer/artist-page-speed.test.js).
 */

const { createReleaseLookup } = require('../../src/renderer/lib/release-lookup');
const { artistLookupPlan, loadArtistReleaseGroups, releaseFromReleaseGroup, ARTIST_RELEASE_TYPES } = require('../../src/renderer/lib/artist-discography');

const RG = '48140466-cff6-3222-bd55-63c27e43190d';
const REL = '76df3287-6cda-33eb-8e9a-044b5e15ffdd';
const ARTIST = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11';

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const releaseBody = { id: REL, title: 'Dummy', media: [{ tracks: [{ position: 1, title: 'Mysterons', recording: { id: 'rec-1' } }] }] };

// A fetch that records every URL and answers from `route(url)`.
function recordingFetch(route) {
  const calls = [];
  const fetch = async (url) => { calls.push(url); return route(url); };
  return { fetch, calls };
}

// Every release-group URL answers the group's release; a release URL answers
// the release, or 404 when the id is the group's.
const musicBrainz = (url) => {
  if (url.includes(`/release?release-group=${RG}`)) return response(200, { releases: [releaseBody] });
  if (url.includes(`/release/${RG}?`)) return response(404, {});
  if (url.includes(`/release/${REL}?`)) return response(200, releaseBody);
  return response(500, {});
};

function lookup(fetch) {
  const cache = {};
  const instance = createReleaseLookup({ getCache: () => cache, fetch, ttlMs: 30 * 24 * 3600e3 });
  return { ...instance, cache };
}

describe('album page: MusicBrainz requests before the track list', () => {
  test('a release-group id the opener flags: 1 request, the browse that carries the track list', async () => {
    const { fetch, calls } = recordingFetch(musicBrainz);
    const { loadRelease } = lookup(fetch);
    const res = await loadRelease({ id: RG, isReleaseGroup: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`release?release-group=${RG}`);
    expect(calls[0]).toContain('inc=recordings');
    expect(res.releaseId).toBe(REL);
    expect((await res.json()).media[0].tracks).toHaveLength(1);
  });

  test('a release id: 1 request', async () => {
    const { fetch, calls } = recordingFetch(musicBrainz);
    const res = await lookup(fetch).loadRelease({ id: REL });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`/release/${REL}?`);
    expect(res.ok).toBe(true);
  });

  test('an unflagged release-group id: 2 requests, the 404 probe and the browse', async () => {
    const { fetch, calls } = recordingFetch(musicBrainz);
    const res = await lookup(fetch).loadRelease({ id: RG });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(`/release/${RG}?`);
    expect(calls[1]).toContain(`release?release-group=${RG}`);
    expect(res.releaseId).toBe(REL);
  });

  test('a group opened before, flagged or not: 0 requests', async () => {
    const { fetch, calls } = recordingFetch(musicBrainz);
    const l = lookup(fetch);
    await l.loadRelease({ id: RG, isReleaseGroup: true });
    calls.length = 0;
    const flagged = await l.loadRelease({ id: RG, isReleaseGroup: true });
    const unflagged = await l.loadRelease({ id: RG });
    expect(calls).toHaveLength(0);
    expect(flagged.fromCache && unflagged.fromCache).toBe(true);
    expect(flagged.releaseId).toBe(REL);
  });

  test('a cached release: 0 requests', async () => {
    const { fetch, calls } = recordingFetch(musicBrainz);
    const l = lookup(fetch);
    await l.loadRelease({ id: REL });
    calls.length = 0;
    await l.loadRelease({ id: REL });
    expect(calls).toHaveLength(0);
  });

  test('a busy MusicBrainz on the probe stops there, with its status', async () => {
    const { fetch, calls } = recordingFetch(() => response(503, {}));
    const res = await lookup(fetch).loadRelease({ id: REL });
    expect(calls).toHaveLength(1);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });

  test('an empty group says so, after 1 request', async () => {
    const { fetch, calls } = recordingFetch(() => response(200, { releases: [] }));
    const res = await lookup(fetch).loadRelease({ id: RG, isReleaseGroup: true });
    expect(calls).toHaveLength(1);
    expect(res.noReleases).toBe(true);
  });

  test('the hover prefetch\'s fetch (the background lane) is the one used', async () => {
    const foreground = recordingFetch(musicBrainz);
    const background = recordingFetch(musicBrainz);
    await lookup(foreground.fetch).loadRelease({ id: RG, isReleaseGroup: true }, background.fetch);
    expect(foreground.calls).toHaveLength(0);
    expect(background.calls).toHaveLength(1);
  });
});

describe('artist page, uncached: MusicBrainz requests before the discography', () => {
  test('finding the artist: none for a known MBID, one lookup or one search otherwise', () => {
    expect(artistLookupPlan({ name: 'Portishead', knownMbid: ARTIST })).toEqual({ kind: 'known', url: null });
    expect(artistLookupPlan({ name: 'Portishead', mapperMbid: ARTIST }).url).toBe(`https://musicbrainz.org/ws/2/artist/${ARTIST}?fmt=json`);
    const search = artistLookupPlan({ name: 'Simon & Garfunkel' });
    expect(search.kind).toBe('search');
    expect(search.url).toContain('query=Simon%20%26%20Garfunkel');
    // a known MBID wins over the mapper's
    expect(artistLookupPlan({ name: 'x', knownMbid: ARTIST, mapperMbid: 'other' }).kind).toBe('known');
  });

  test('the release groups: exactly 3 requests, all started before any answers', async () => {
    const pending = [];
    const calls = [];
    const fetch = (url) => { calls.push(url); return new Promise(resolve => pending.push({ url, resolve })); };
    const done = loadArtistReleaseGroups(ARTIST, { fetch });
    await Promise.resolve();
    expect(calls).toHaveLength(3);
    expect(ARTIST_RELEASE_TYPES.map(t => calls.some(u => u.includes(`type=${t}`)))).toEqual([true, true, true]);
    pending.forEach(p => p.resolve(response(200, { 'release-groups': [] })));
    await done;
    expect(calls).toHaveLength(3);
  });

  test('each type shows as it answers, in the order they answer', async () => {
    const pending = {};
    const fetch = (url) => new Promise(resolve => { pending[url.match(/type=(\w+)/)[1]] = resolve; });
    const batches = [];
    const done = loadArtistReleaseGroups(ARTIST, { fetch, onBatch: (releases, type) => batches.push(`${type}:${releases.length}`) });
    await Promise.resolve();
    pending.single(response(200, { 'release-groups': [{ id: 's1', title: 'Glory Box', 'primary-type': 'Single' }] }));
    await new Promise(r => setTimeout(r, 0));
    expect(batches).toEqual(['single:1']); // singles show without waiting for albums
    pending.album(response(200, { 'release-groups': [{ id: 'a1', title: 'Dummy', 'primary-type': 'Album' }, { id: 'a2', title: 'Portishead', 'primary-type': 'Album' }] }));
    pending.ep(response(503, {}));
    const all = await done;
    expect(batches).toEqual(['single:1', 'album:2']); // a failed type adds nothing
    expect(all.map(r => r.id).sort()).toEqual(['a1', 'a2', 's1']);
  });

  test('budget: 3 requests with a known MBID, 4 by mapper MBID or by name', () => {
    const budget = (opts) => (artistLookupPlan(opts).kind === 'known' ? 0 : 1) + ARTIST_RELEASE_TYPES.length;
    expect(budget({ name: 'Portishead', knownMbid: ARTIST })).toBe(3);
    expect(budget({ name: 'Portishead', mapperMbid: ARTIST })).toBe(4);
    expect(budget({ name: 'Portishead' })).toBe(4);
  });

  test('releases are flagged as release groups (their album pages cost 1 request) and categorized', () => {
    const studio = releaseFromReleaseGroup({ id: 'a', title: 'Dummy', 'primary-type': 'Album', 'first-release-date': '1994-08-22' }, 'album');
    expect(studio).toMatchObject({ releaseType: 'album', isReleaseGroup: true, date: '1994-08-22' });
    expect(releaseFromReleaseGroup({ id: 'l', 'primary-type': 'Album', 'secondary-types': ['Live'] }, 'album').releaseType).toBe('live');
    expect(releaseFromReleaseGroup({ id: 'c', 'primary-type': 'Album', 'secondary-types': ['Compilation'] }, 'album').releaseType).toBe('compilation');
    expect(releaseFromReleaseGroup({ id: 'e', 'primary-type': 'EP' }, 'ep').releaseType).toBe('ep');
    expect(releaseFromReleaseGroup({ id: 'x' }, 'single').releaseType).toBe('single');
  });
});

describe('app.js uses these, so the budgets are the real ones', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  const slice = (from, to) => { const s = app.indexOf(from); expect(s).toBeGreaterThan(-1); return app.slice(s, app.indexOf(to, s)); };

  test('the album page and its hover prefetch go through loadRelease', () => {
    expect(slice('const fetchReleaseData = async (release, artist) => {', '// Prefetch release tracks on hover'))
      .toMatch(/await releaseLookupRef\.current\.loadRelease\(\{\s*id: releaseId,\s*isReleaseGroup: sessionPick \? false : release\.isReleaseGroup\s*\}\)/);
    expect(slice('const prefetchReleaseTracks = async (release, artist) => {', '\n  };'))
      .toMatch(/await releaseLookupRef\.current\.loadRelease\(\{\s*id: \(prefetchedEdition\?\.kind === 'mb' && prefetchedEdition\??\.releaseId\) \|\| release\.id,\s*isReleaseGroup: \(prefetchedEdition\?\.kind === 'mb' && prefetchedEdition\??\.releaseId\) \? false : release\.isReleaseGroup\s*\}, bgFetch\)/);
    expect(app).toMatch(/createReleaseLookup\(\{\s*getCache: \(\) => releaseDetailsCache\.current,/);
  });

  test('the artist page goes through artistLookupPlan and loadArtistReleaseGroups', () => {
    const fetchArtist = slice('const fetchArtistData = async (artistName, options = {}) => {', '\n  // Fetch release data (album/EP/single) with full track listing');
    expect(fetchArtist).toMatch(/artistLookupPlan\(\{ name: artistName, knownMbid, mapperMbid: mapperArtistMbid \}\)/);
    expect(fetchArtist).toMatch(/await loadArtistReleaseGroups\(artist\.id, \{/);
    expect(fetchArtist).not.toMatch(/ws\/2\/release-group\?artist=/); // no second copy of the requests
  });
});

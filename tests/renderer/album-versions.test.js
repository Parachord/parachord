/**
 * The album page's source dropdown (#1238): pick which edition of the album
 * the page shows — another official release of the MusicBrainz release group,
 * or an edition one of the user's services carries.
 *
 * Covered here, the pure parts:
 *   - release-lookup's group-releases list: the browse an album open already
 *     made keeps it (0 extra requests), a release-id open fetches it with one
 *     light browse (inc=media, no track lists), and summaries carry what the
 *     dropdown rows show (formats, date, country, track count)
 *   - the session stickiness: picking an edition writes the group's alias, so
 *     reopening the album loads the picked edition from cache
 *   - album-catalog's edition filter: "Queen I (2011 Remaster)" is a version
 *     of "Queen I", "Queen II" is not
 *   - the dropdown menu (AlbumVersionsMenu) renders the sections, marks the
 *     current edition, and hands the pick to onSelect
 *
 * app.js's openAlbumVersions/selectAlbumVersion are the wiring; the
 * page-load budgets (tests/renderer/page-load-budget.test.js) stay intact
 * because the versions list loads lazily, when the dropdown opens.
 */

global.React = require('react');
global.ReactDOM = require('react-dom');
global.ReactVirtual = require('@tanstack/react-virtual');

const { renderToStaticMarkup } = require('react-dom/server');
const { createReleaseLookup } = require('../../src/renderer/lib/release-lookup');
const { isCatalogAlbumEdition, albumVersionsGroup, albumVersionsKey } = require('../../src/renderer/lib/album-catalog');
const { AlbumVersionsMenu } = require('../../src/renderer/components/cards');

const RG = '25267682-bdfc-435a-b6a7-89c266f7d0e8';
const REL_A = '0e187cba-8211-4b55-a6b7-cdfe853df0ad';
const REL_B = '712f6a74-df89-436b-a8c4-009d92018e65';

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const fullRelease = (id, format, trackCount, extra = {}) => ({
  id,
  title: 'Absolute Elsewhere',
  date: '2024-10-04',
  country: 'DE',
  disambiguation: '',
  media: [{ format, 'track-count': trackCount, position: 1, tracks: [] }],
  ...extra,
});

function lookup(fetch) {
  const cache = {};
  const instance = createReleaseLookup({ getCache: () => cache, fetch, ttlMs: 30 * 24 * 3600e3 });
  return { ...instance, cache };
}

// A fetch that records every URL and answers from route(url).
function recordingFetch(route) {
  const calls = [];
  const fetch = async (url) => { calls.push(url); return route(url); };
  return { fetch, calls };
}

const groupBrowse = (releases) => (url) => {
  if (url.includes(`/release?release-group=${RG}`)) return response(200, { releases });
  return response(500, {});
};

describe('release-lookup: the group\'s editions for the source dropdown', () => {
  test('the browse an album open already made keeps the group\'s editions — the dropdown costs 0 requests', async () => {
    const { fetch, calls } = recordingFetch(groupBrowse([fullRelease(REL_A, 'CD', 6), fullRelease(REL_B, 'Digital Media', 8)]));
    const l = lookup(fetch);
    await l.loadRelease({ id: RG, isReleaseGroup: true });
    expect(calls).toHaveLength(1);
    calls.length = 0;

    const res = await l.fetchReleaseGroupReleases(RG);
    expect(calls).toHaveLength(0);
    expect(res.ok).toBe(true);
    expect(res.releases.map(r => r.id)).toEqual([REL_A, REL_B]);
    // the summaries carry what a dropdown row shows
    expect(res.releases[0]).toMatchObject({ title: 'Absolute Elsewhere', date: '2024-10-04', country: 'DE', formats: ['CD'], trackCount: 6 });
    expect(res.releases[1].formats).toEqual(['Digital Media']);
  });

  test('an album opened by release id fetches the list with one light browse (inc=media, no recordings)', async () => {
    const { fetch, calls } = recordingFetch(groupBrowse([fullRelease(REL_A, 'CD', 6)]));
    const l = lookup(fetch);
    const res = await l.fetchReleaseGroupReleases(RG);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('inc=media');
    expect(calls[0]).not.toContain('recordings');
    expect(res.ok).toBe(true);
    expect(res.releases).toHaveLength(1);
    // and it sticks: the second open is cached
    calls.length = 0;
    const again = await l.fetchReleaseGroupReleases(RG);
    expect(calls).toHaveLength(0);
    expect(again.fromCache).toBe(true);
  });

  test('the alias and the editions share the group\'s cache entry without clobbering each other', async () => {
    const { fetch } = recordingFetch(groupBrowse([fullRelease(REL_A, 'CD', 6)]));
    const l = lookup(fetch);
    await l.fetchReleaseGroupReleases(RG);
    // an edition pick (selectAlbumVersion) writes its pick into the session map,
    // while the persisted alias stays what fetchReleaseGroupDetails wrote; this
    // test writes the alias directly to pin the cache-entry sharing.
    l.rememberReleaseGroupAlias(RG, REL_B);
    const entry = l.cache[RG];
    expect(entry.alias).toBe(REL_B);
    expect(entry.releases.map(r => r.id)).toEqual([REL_A]);

    // and the alias redirects a group open to the picked edition, from cache
    const { fetch: f2, calls: calls2 } = recordingFetch(groupBrowse([fullRelease(REL_A, 'CD', 6)]));
    const l2 = lookup(f2);
    l2.cache[RG] = { alias: REL_B, releases: [fullRelease(REL_A, 'CD', 6)], timestamp: Date.now() };
    l2.cache[REL_B] = { data: fullRelease(REL_B, 'Digital Media', 8, { media: [{ format: 'Digital Media', 'track-count': 8, position: 1, tracks: [{ position: 1, title: 'Track', recording: { id: 'r' } }] }] }), timestamp: Date.now() };
    const open = await l2.loadRelease({ id: RG, isReleaseGroup: true });
    expect(calls2).toHaveLength(0);
    expect(open.releaseId).toBe(REL_B);
    expect(open.fromCache).toBe(true);
  });

  test('formats count per-medium and name unlabeled mediums by position', async () => {
    const releases = [
      fullRelease(REL_A, 'CD', 6, { media: [
        { format: 'CD', 'track-count': 6, position: 1, tracks: [] },
        { format: 'CD', 'track-count': 6, position: 2, tracks: [] },
        { format: 'Vinyl', 'track-count': 6, position: 3, tracks: [] }
      ] }),
      fullRelease(REL_B, null, 8, { media: [{ format: null, 'track-count': 8, position: 1, tracks: [] }] }),
    ];
    const { fetch } = recordingFetch(groupBrowse(releases));
    const res = await lookup(fetch).fetchReleaseGroupReleases(RG);
    expect(res.releases[0].formats).toEqual(['2×CD', 'Vinyl']);
    expect(res.releases[0].trackCount).toBe(18);
    expect(res.releases[1].formats).toEqual(['Disc 1']);
  });

  test('a group with no official releases answers an empty list, not an error', async () => {
    const { fetch } = recordingFetch(groupBrowse([]));
    const res = await lookup(fetch).fetchReleaseGroupReleases(RG);
    expect(res.ok).toBe(true);
    expect(res.releases).toEqual([]);
  });

  test('a busy MusicBrainz answers its status, not an empty list', async () => {
    const { fetch } = recordingFetch(() => response(503, {}));
    const res = await lookup(fetch).fetchReleaseGroupReleases(RG);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });
});

describe('album-catalog: which release group the dropdown lists', () => {
  const artist = { id: null, name: 'Absolute Elsewhere' };

  test('a loaded release names its group', () => {
    expect(albumVersionsGroup({ id: REL_A, title: 'Absolute Elsewhere', artist, releaseGroupMbid: RG })).toBe(RG);
    expect(albumVersionsKey({ id: REL_A, title: 'Absolute Elsewhere', artist, releaseGroupMbid: RG }))
      .toBe(`absoluteelsewhere\u0000absoluteelsewhere\u0000${RG}`);
  });

  test('a still-loading page opened by a group knows it (isReleaseGroup)', () => {
    expect(albumVersionsGroup({ id: RG, title: 'Absolute Elsewhere', artist, isReleaseGroup: true })).toBe(RG);
    expect(albumVersionsKey({ id: RG, title: 'Absolute Elsewhere', artist, isReleaseGroup: true }))
      .toBe(`absoluteelsewhere\u0000absoluteelsewhere\u0000${RG}`);
  });

  test('a plain release id is NOT a group id — no section until the release answers with one', () => {
    expect(albumVersionsGroup({ id: REL_A, title: 'Absolute Elsewhere', artist })).toBe(null);
    expect(albumVersionsGroup({ id: 'spotify-album-1', title: 'Absolute Elsewhere', artist })).toBe(null);
    // and the keys differ, so a page that learns its group invalidates a list loaded without one
    const before = albumVersionsKey({ id: REL_A, title: 'Absolute Elsewhere', artist });
    const after = albumVersionsKey({ id: REL_A, title: 'Absolute Elsewhere', artist, releaseGroupMbid: RG });
    expect(before).not.toBe(after);
  });

  test('nothing to key on', () => {
    expect(albumVersionsKey(null)).toBe(null);
    expect(albumVersionsKey({ id: REL_A, title: 'Absolute Elsewhere' })).toBe(null); // no artist
  });
});

describe('album-catalog: the keys an album\'s picked edition is remembered under', () => {
  const { albumEditionPickKeys } = require('../../src/renderer/lib/album-catalog');

  test('the album\'s identity first, then its group', () => {
    expect(albumEditionPickKeys({ groupId: RG, artist: 'Absolute Elsewhere', title: 'Absolute Elsewhere' }))
      .toEqual([`album:absoluteelsewhere\u0000absoluteelsewhere`, `group:${RG}`]);
  });

  test('an album with no group is remembered by identity alone', () => {
    expect(albumEditionPickKeys({ groupId: null, artist: 'Wild Pink', title: 'Dulling the Horns' }))
      .toEqual(['album:wildpink\u0000dullingthehorns']);
  });

  test('edition suffixes aside in the title key', () => {
    expect(albumEditionPickKeys({ artist: 'Queen', title: 'Queen I (Deluxe)' }))
      .toEqual(['album:queen\u0000queeni']);
  });
});

describe('album-catalog: which catalog results are editions of the album', () => {
  const target = { artist: 'Queen', title: 'Queen I' };

  test('edition suffixes aside, the same album is an edition', () => {
    expect(isCatalogAlbumEdition(target, { name: 'Queen I', artist: 'Queen' })).toBe(true);
    expect(isCatalogAlbumEdition(target, { name: 'Queen I (2011 Remaster)', artist: 'Queen' })).toBe(true);
    expect(isCatalogAlbumEdition(target, { name: 'Queen I (Deluxe)', artist: 'Queen' })).toBe(true);
    expect(isCatalogAlbumEdition(target, { name: 'Queen I (Collector\'s Edition)', artist: 'Queen' })).toBe(true);
    // a joint credit with a suffixed title still counts (the artist rules pass
    // through albumMatchScore's split even when the bare titles differ)
    expect(isCatalogAlbumEdition({ artist: 'Erykah Badu', title: 'The Soul of a Woman' }, { name: 'The Soul of a Woman (Deluxe)', artist: 'Erykah Badu & The Alchemist' })).toBe(true);
    // a dash-form suffix ("Queen I - Collector's Edition") is NOT stripped by
    // normalizeAlbumTitle's bracket-only EDITION rule — same limitation
    // pickCatalogAlbum has always had; not this feature's to change.
    expect(isCatalogAlbumEdition(target, { name: 'Queen I - Collector\'s Edition', artist: 'Queen' })).toBe(false);
  });

  test('another album is not, even when its title contains the album\'s', () => {
    expect(isCatalogAlbumEdition(target, { name: 'Queen II', artist: 'Queen' })).toBe(false);
    expect(isCatalogAlbumEdition(target, { name: 'Greatest Hits', artist: 'Queen' })).toBe(false);
    expect(isCatalogAlbumEdition(target, { name: 'Queen I', artist: 'Queen + Adam Lambert' })).toBe(false);
  });

  test('a joint credit still names the same artist', () => {
    // one side of a joint credit is enough — the documented pickCatalogAlbum
    // rule — when that side is a single name: an edition the service credits
    // to both artists still counts. (Both sides joined with different joins —
    // "and" vs "," — is a pre-existing albumMatchScore limitation, not this
    // filter's.)
    expect(isCatalogAlbumEdition({ artist: 'Erykah Badu', title: 'The Soul of a Woman' }, { name: 'The Soul of a Woman', artist: 'Erykah Badu & The Alchemist' })).toBe(true);
    expect(isCatalogAlbumEdition({ artist: 'Erykah Badu and The Alchemist', title: 'The Soul of a Woman' }, { name: 'The Soul of a Woman', artist: 'Erykah Badu, The Alchemist' })).toBe(false);
  });
});

describe('the app wiring (source markers)', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  const artistPage = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'artist-page.js'), 'utf8');

  test('openAlbumVersions loads the group editions and the resolvers\' editions', () => {
    expect(app).toMatch(/releaseLookupRef\.current\.fetchReleaseGroupReleases\(releaseGroupId\)/);
    expect(app).toMatch(/isCatalogAlbumEdition\(\{ artist: artistName, title: release\.title \}, a\)/);
    expect(app).toMatch(/loader\.searchAlbums\(resolver\.id, \{ artist: artistName, title: release\.title \}, config\)/);
  });

  test('selectAlbumVersion switches through the release lookup and the cached catalog lookup, and the pick sticks for the session', () => {
    expect(app).toMatch(/releaseLookupRef\.current\.fetchReleaseDetails\(version\.release\.id\)/);
    expect(app).toMatch(/await lookupAlbumEditionCached\(version\.resolverId, version\.album\.url\)/);
    // both pick keys are written (group + album identity)
    expect(app).toMatch(/for \(const k of albumEditionPickKeys\(\{ groupId: releaseInfo\.releaseGroupMbid, artist: artistName, title: release\.title \}\)\)/);
    // the pick is consulted (group first, then identity) by the album open, the
    // card actions, the hover prefetch and the playbar open
    expect(app).toMatch(/const pickEdition = editionPickFor\(\{/);
    expect(app).toMatch(/const prefetchedEdition = editionPickFor\(\{/);
    expect(app).toMatch(/const pickedEdition = editionPickFor\(\{ artist: track\.artist, title: albumName \}\)/);
  });

  test('the artist page feeds ReleasePage the versions and the two handlers', () => {
    expect(artistPage).toMatch(/albumVersions: albumVersions,/);
    expect(artistPage).toMatch(/onOpenAlbumVersions: openAlbumVersions,/);
    expect(artistPage).toMatch(/onSelectAlbumVersion: selectAlbumVersion,/);
  });
});

describe('ReleasePage: the source button', () => {
  const { ReleasePage } = require('../../src/renderer/components/cards');
  const release = {
    id: REL_A,
    title: 'Absolute Elsewhere',
    artist: { id: null, name: 'Absolute Elsewhere' },
    date: '2024-10-04',
    releaseType: 'album',
    albumArt: null,
    tracks: [{ position: 1, title: 'Music is the Drug', length: 200000 }],
  };

  const render = (rel, extra = {}) => renderToStaticMarkup(React.createElement(ReleasePage, {
    release: rel,
    setShareDropdownOpen: () => {},
    ...extra,
  }));

  test('sits above Share and names the current source', () => {
    const html = render(release);
    const sourceAt = html.indexOf('Source: MusicBrainz');
    const shareAt = html.indexOf('>Share</button>');
    expect(sourceAt).toBeGreaterThan(-1);
    expect(shareAt).toBeGreaterThan(-1);
    expect(sourceAt).toBeLessThan(shareAt);
  });

  test('names the catalog source a catalog track list came from', () => {
    const html = render({ ...release, _catalogSource: { resolverId: 'spotify', name: 'Spotify', url: 'u' } });
    expect(html).toContain('Source: Spotify');
  });

  test('says just "Source" while the list still loads', () => {
    const html = render({ ...release, tracks: null });
    expect(html).not.toContain('Source:');
    expect(html).toContain('Source');
  });
});

describe('AlbumVersionsMenu', () => {
  const release = {
    id: REL_A,
    title: 'Absolute Elsewhere',
    artist: { id: null, name: 'Absolute Elsewhere' },
    tracks: [{ position: 1, title: 'Music is the Drug', length: 200000 }],
  };

  const versions = {
    key: albumVersionsKey(release),
    loading: false,
    mb: {
      releaseGroupId: RG,
      releases: [
        { id: REL_A, title: 'Absolute Elsewhere', date: '2024-10-04', country: 'DE', disambiguation: null, formats: ['CD'], trackCount: 6 },
        { id: REL_B, title: 'Absolute Elsewhere', date: '2024-10-04', country: 'XE', disambiguation: 'limited earbook', formats: ['2×CD', 'Digital Media'], trackCount: 18 },
      ]
    },
    catalogs: [
      {
        resolverId: 'spotify', resolverName: 'Spotify',
        albums: [
          { id: 'spotify-1', name: 'Absolute Elsewhere', artist: 'Absolute Elsewhere', releaseDate: '2024-10-04', trackCount: 6, url: 'https://open.spotify.com/album/1' },
          { id: 'spotify-2', name: 'Absolute Elsewhere (Deluxe)', artist: 'Absolute Elsewhere', releaseDate: '2025-04-11', trackCount: 18, url: 'https://open.spotify.com/album/2' },
        ]
      }
    ]
  };

  const render = (props) => renderToStaticMarkup(React.createElement(AlbumVersionsMenu, props));

  test('lists the MusicBrainz editions and the resolvers\' editions, marking the current one', () => {
    const html = render({ release, versions, resolvers: [{ id: 'spotify', name: 'Spotify', color: '#1DB954' }] });
    expect(html).toContain('MusicBrainz');
    // the MB row on screen is marked current
    expect(html).toContain('✓');
    // MB row: the disambiguation is the main line, formats join the secondary
    expect(html).toContain('limited earbook');
    expect(html).toContain('2×CD + Digital Media · Oct 4, 2024 · XE · 18 tracks');
    // a same-titled release falls back to its formats as the main line
    expect(html).toContain('CD</span>');
    // resolver section with its editions
    expect(html).toContain('Spotify');
    expect(html).toContain('Absolute Elsewhere (Deluxe)');
    expect(html).toContain('Apr 11, 2025 · 18 tracks');
  });

  test('a catalog-sourced page marks its edition current by resolver and url', () => {
    const catalogRelease = {
      ...release,
      id: RG, // catalogAlbumToRelease keeps the requested id
      _catalogSource: { resolverId: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/album/1' }
    };
    const html = render({ release: catalogRelease, versions, resolvers: [{ id: 'spotify', name: 'Spotify', color: '#1DB954' }] });
    // exactly one current marker: the Spotify edition that is on screen, not
    // an MB row (the list came from the catalog)
    expect(html.match(/✓/g)).toHaveLength(1);
    expect(html).toContain('✓</span><span class="min-w-0" style="flex:1 1 0"><span class="block truncate" style="font-weight:500;color:var(--accent-soft)">Absolute Elsewhere</span>');
  });

  test('while the MusicBrainz part is on its way, its header shows above a shimmer, no rows', () => {
    const html = render({ release, versions: { ...versions, loading: true, mb: { releaseGroupId: RG, releases: null } }, resolvers: [] });
    expect(html).toContain('MusicBrainz');
    expect(html).toContain('animate-shimmer');
    expect(html).not.toContain('limited earbook');
  });

  test('a list that never loaded for this key is shimmer alone, with no headers', () => {
    const html = render({ release, versions: null, resolvers: [] });
    expect(html).toContain('animate-shimmer');
    expect(html).not.toContain('MusicBrainz');
    expect(html).not.toContain('No other versions found');
  });

  test('nothing else to pick says so', () => {
    const html = render({
      release,
      versions: { key: albumVersionsKey(release), loading: false, mb: { releaseGroupId: RG, releases: [] }, catalogs: [] },
      resolvers: []
    });
    expect(html).toContain('No other versions found');
    expect(html).not.toContain('>MusicBrainz<');
  });
});

const m = require('../../src/renderer/lib/home-model');

const DAY = 86400000;
const now = new Date(2026, 10, 12, 15, 0, 0).getTime();

describe('freshness', () => {
  test('falls back tracksChangedAt, lastModified, createdAt, 0', () => {
    expect(m.playlistFreshness({ tracksChangedAt: 5, lastModified: 9, createdAt: 1 })).toBe(5);
    expect(m.playlistFreshness({ lastModified: 9, createdAt: 1 })).toBe(9);
    expect(m.playlistFreshness({ createdAt: 1 })).toBe(1);
    expect(m.playlistFreshness({})).toBe(0);
  });
  test('a renamed playlist sorts by tracksChangedAt', () => {
    const renamed = { id: 'r', lastModified: now, tracksChangedAt: now - 10 * DAY };
    const edited = { id: 'e', lastModified: now - 2 * DAY, tracksChangedAt: now - 2 * DAY };
    expect(m.freshestPlaylists([renamed, edited]).map((p) => p.id)).toEqual(['e', 'r']);
  });
  test('limit defaults to 6', () => {
    const ps = Array.from({ length: 9 }, (_, i) => ({ id: i, lastModified: i }));
    expect(m.freshestPlaylists(ps)).toHaveLength(6);
    expect(m.freshestPlaylists(ps)[0].id).toBe(8);
  });
});

describe('recentLoves', () => {
  test('newest first, no addedAt last in input order', () => {
    const t = [{ id: 'x' }, { id: 'a', addedAt: 1 }, { id: 'y' }, { id: 'b', addedAt: 5 }];
    expect(m.recentLoves(t).map((x) => x.id)).toEqual(['b', 'a', 'x', 'y']);
    expect(m.recentLoves(t, 2).map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('badge and change line', () => {
  test('null when nothing was added', () => {
    expect(m.changeBadge({ lastChangeAdded: 0, tracksChangedAt: now }, now)).toBeNull();
  });
  test('null when older than 7 days', () => {
    expect(m.changeBadge({ lastChangeAdded: 12, tracksChangedAt: now - 8 * DAY }, now)).toBeNull();
  });
  test('Δ N inside the window', () => {
    expect(m.changeBadge({ lastChangeAdded: 12, tracksChangedAt: now - 7 * DAY }, now)).toBe('Δ 12');
  });
  test('line wording', () => {
    const p = { title: 'Daily Brew', lastChangeAdded: 12, tracksChangedAt: new Date(2026, 10, 12, 8).getTime() };
    expect(m.freshChangeLine(p, now)).toBe('Daily Brew picked up 12 new tracks this morning');
    expect(m.freshChangeLine({ ...p, lastChangeAdded: 0 }, now)).toBeNull();
  });
});

describe('isActiveContext', () => {
  test('playlist and mix by id', () => {
    expect(m.isActiveContext({ kind: 'playlist', id: 'a' }, { playing: { type: 'playlist', id: 'a' } })).toBe(true);
    expect(m.isActiveContext({ kind: 'playlist', id: 'a' }, { queued: { type: 'playlist', id: 'b' } })).toBe(false);
    expect(m.isActiveContext({ kind: 'mix', id: 'm' }, { queued: { type: 'mix', id: 'm' } })).toBe(true);
  });
  test('album by mbid, else normalised names', () => {
    expect(m.isActiveContext({ kind: 'album', mbid: 'x', album: 'A', artist: 'B' },
      { playing: { type: 'album', mbid: 'x', name: 'Other', artist: 'Z' } })).toBe(true);
    expect(m.isActiveContext({ kind: 'album', album: 'Hartsdale Hotbox (Deluxe)', artist: 'The Frog' },
      { queued: { type: 'album', name: 'hartsdale hotbox', artist: 'Frog' } })).toBe(true);
    expect(m.isActiveContext({ kind: 'album', album: 'Other', artist: 'Frog' },
      { queued: { type: 'album', name: 'hartsdale hotbox', artist: 'Frog' } })).toBe(false);
  });
  test('a playlist context with no id matches by title', () => {
    // Several play sites emit { type: 'playlist', name } only.
    expect(m.isActiveContext({ kind: 'playlist', id: 'a', title: 'Daily Brew' },
      { playing: { type: 'playlist', name: 'Daily Brew' } })).toBe(true);
    expect(m.isActiveContext({ kind: 'playlist', id: 'a', title: 'Daily Brew' },
      { queued: { type: 'playlist', name: 'Other' } })).toBe(false);
    // A context that has an id is compared by id, never by title.
    expect(m.isActiveContext({ kind: 'playlist', id: 'a', title: 'Daily Brew' },
      { playing: { type: 'playlist', id: 'b', name: 'Daily Brew' } })).toBe(false);
    expect(m.isActiveContext({ kind: 'playlist', id: 'a' },
      { playing: { type: 'playlist', name: 'Daily Brew' } })).toBe(false);
  });
  test('jumpBackInTiles skips a playlist playing by title only', () => {
    const playlists = [
      { id: 'p1', title: 'Daily Brew', tracksChangedAt: 10 },
      { id: 'p2', title: 'Older', tracksChangedAt: 5 },
    ];
    const tiles = m.jumpBackInTiles({ playlists, active: { playing: { type: 'playlist', name: 'Daily Brew' } } });
    expect(tiles[0].item.id).toBe('p2');
  });
  test('loves by context type', () => {
    expect(m.isActiveContext({ kind: 'loves' }, { playing: { type: 'loves' } })).toBe(true);
    expect(m.isActiveContext({ kind: 'loves' }, { playing: { type: 'album' } })).toBe(false);
    expect(m.isActiveContext({ kind: 'loves' }, {})).toBe(false);
  });
});

describe('latestLoveAlbum', () => {
  test('skips singles and a queued album', () => {
    const loves = [
      { title: 'S', artist: 'A' },
      { title: 'Q', artist: 'Frog', album: 'Queued' },
      { title: 'Frog', artist: 'Hovvdy', album: 'Hotbox', releaseMbid: 'r1' },
    ];
    const active = { queued: { type: 'album', name: 'Queued', artist: 'Frog' } };
    expect(m.latestLoveAlbum(loves, active)).toEqual({ album: 'Hotbox', artist: 'Hovvdy', mbid: 'r1', trackTitle: 'Frog' });
    expect(m.latestLoveAlbum([], {})).toBeNull();
  });
});

describe('jumpBackInTiles', () => {
  const playlists = [
    { id: 'p1', title: 'One', tracksChangedAt: 300 },
    { id: 'p2', title: 'Two', tracksChangedAt: 200 },
  ];
  const loves = [{ title: 'T', artist: 'A', album: 'Al', addedAt: 1 }];
  const mixes = [{ id: 'm1' }];
  test('order and one of each kind', () => {
    const t = m.jumpBackInTiles({ playlists, loves, mixes, active: {}, now });
    expect(t.map((x) => x.kind)).toEqual(['playlist', 'loves', 'album', 'mix']);
    expect(t[0].item.id).toBe('p1');
  });
  test('the playing freshest playlist gives way to the second', () => {
    const t = m.jumpBackInTiles({ playlists, loves, mixes, active: { playing: { type: 'playlist', id: 'p1' } }, now });
    expect(t[0].item.id).toBe('p2');
  });
  test('empty sources are left out', () => {
    expect(m.jumpBackInTiles({ playlists: [], loves: [], mixes: [], active: {}, now })).toEqual([]);
  });
});

describe('playlistSubtitle', () => {
  test('relative time and year', () => {
    expect(m.playlistSubtitle({ tracksChangedAt: now - 2 * 3600000, createdAt: Date.UTC(2023, 0, 1) }, now))
      .toBe('Refreshed 2h ago · since 2023');
  });
  test('omits since without createdAt', () => {
    expect(m.playlistSubtitle({ tracksChangedAt: now - 3 * DAY }, now)).toBe('Refreshed 3d ago');
  });
});

describe('homeSections', () => {
  test('everything empty', () => {
    const s = m.homeSections({ bannerItems: [], tiles: [], mixes: [], playlists: [], albums: [], fresh: [], critical: [], concerts: [], concertsLocation: '' });
    expect(Object.keys(s).filter((k) => s[k]).sort()).toEqual(['ask', 'importCard']);
  });
  test('the import card is for a new user only: no collection and no playlists', () => {
    // Empty tiles alone don't bring it back (a collection with no loves).
    expect(m.homeSections({ tiles: [], playlists: [], hasCollection: true }).importCard).toBe(false);
    expect(m.homeSections({ tiles: [], playlists: [{ id: 'p' }], hasCollection: false }).importCard).toBe(false);
    expect(m.homeSections({ tiles: [], playlists: [], hasCollection: false }).importCard).toBe(true);
    // A new user with a service mix sees the tile and the card's flag both;
    // the row shows tiles when it has them.
    expect(m.homeSections({ tiles: [1], playlists: [], hasCollection: false })).toMatchObject({ jump: true, importCard: true });
  });
  test('albums shows with Shuffleupagus items; concerts needs a location', () => {
    const s = m.homeSections({ tiles: [1], albums: [1], concerts: [1], concertsLocation: '', hasCollection: true });
    expect(s).toMatchObject({ jump: true, importCard: false, albums: true, concerts: false, ask: true });
    expect(m.homeSections({ concerts: [1], concertsLocation: 'Austin' }).concerts).toBe(true);
  });
});

describe('exampleShufflePrompt', () => {
  test('generic with no artists', () => {
    expect(m.exampleShufflePrompt([], 0)).toBe('Make me a playlist for right now');
  });
  test('first three artists, phrasing by seed % 4', () => {
    expect(m.exampleShufflePrompt(['A', 'B', 'C', 'D'], 0)).toBe('A rainy Sunday playlist built around A, B and C');
    const all = [0, 1, 2, 3].map((s) => m.exampleShufflePrompt(['A'], s));
    expect(new Set(all).size).toBe(4);
    expect(m.exampleShufflePrompt(['A'], 4)).toBe(all[0]);
    expect(all.every((p) => !p.includes('D'))).toBe(true);
  });
});

describe('filterBySource', () => {
  const items = [{ resolverId: 'lastfm' }, { resolverId: 'x', sourceIds: ['x', 'lastfm'] }, { resolverId: 'y' }];
  test('All returns the same array', () => { expect(m.filterBySource(items, 'All')).toBe(items); });
  test('filters by resolverId or sourceIds', () => { expect(m.filterBySource(items, 'lastfm')).toHaveLength(2); });
});

describe('homeTopArtists', () => {
  test('most frequent artists among the loves, ties by recency, capped', () => {
    const loves = [
      { artist: 'Hovvdy' }, { artist: 'Nap Eyes' }, { artist: 'Hovvdy' },
      { artist: 'Frog' }, { artist: 'Nap Eyes' }, { artist: 'Frog' }, { artist: 'Frog' },
    ];
    expect(m.homeTopArtists(loves)).toEqual(['Frog', 'Hovvdy', 'Nap Eyes']);
    expect(m.homeTopArtists(loves, 1)).toEqual(['Frog']);
  });
  test('drops blank and over-long names', () => {
    expect(m.homeTopArtists([{ artist: ' ' }, { artist: 'x'.repeat(81) }, { artist: 'Frog' }])).toEqual(['Frog']);
  });
});

describe('exampleShufflePrompt hardening', () => {
  test('bidi controls and other control characters are stripped from names', () => {
    const evil = 'Frog‮evil⁦x⁩\u0007‏';
    const p = m.exampleShufflePrompt([evil], 0);
    expect(p).toBe('A rainy Sunday playlist built around Frogevilx');
    expect(p).not.toMatch(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/);
  });
  test('the Arabic letter mark and zero-width characters are stripped', () => {
    const p = m.exampleShufflePrompt(['Fr\u061Cog\u200B\u200C\u200D'], 0);
    expect(p).toBe('A rainy Sunday playlist built around Frog');
  });
  test('whitespace controls become one space', () => {
    expect(m.exampleShufflePrompt(['Nap\t\nEyes'], 0)).toBe('A rainy Sunday playlist built around Nap Eyes');
  });
  test('each name is capped at 40 characters', () => {
    const p = m.exampleShufflePrompt(['y'.repeat(60), 'Frog'], 0);
    expect(p).toBe(`A rainy Sunday playlist built around ${'y'.repeat(40)} and Frog`);
  });
  test('a name that is only controls is dropped', () => {
    expect(m.exampleShufflePrompt(['‮⁦', 'Frog'], 0)).toBe('A rainy Sunday playlist built around Frog');
    expect(m.exampleShufflePrompt(['‮'], 0)).toBe('Make me a playlist for right now');
  });
});

describe('albumsNeedingArt', () => {
  const mk = (src, n, extra = {}) => Array.from({ length: n }, (_, i) => ({ title: `${src}${i}`, resolverId: src, ...extra }));
  test('the first six overall plus the first six of each source', () => {
    const albums = [...mk('lastfm', 10), ...mk('applemusic', 10)];
    const want = m.albumsNeedingArt(albums, 6);
    expect(want.map((a) => a.title)).toEqual([
      'lastfm0', 'lastfm1', 'lastfm2', 'lastfm3', 'lastfm4', 'lastfm5',
      'applemusic0', 'applemusic1', 'applemusic2', 'applemusic3', 'applemusic4', 'applemusic5',
    ]);
  });
  test('a pick two sources share counts for both', () => {
    const shared = { title: 'shared', resolverId: 'lastfm', sourceIds: ['lastfm', 'listenbrainz'] };
    const albums = [...mk('lastfm', 8), ...mk('listenbrainz', 3), shared];
    const titles = m.albumsNeedingArt(albums, 6).map((a) => a.title);
    expect(titles).toContain('shared');
    expect(titles.filter((t) => t === 'shared')).toHaveLength(1);
  });
  test('empty and missing input', () => {
    expect(m.albumsNeedingArt(null)).toEqual([]);
    expect(m.albumsNeedingArt([])).toEqual([]);
  });
});

describe('shouldLoadHomeRecommendations', () => {
  const t = 1_000_000_000;
  const ok = { loading: false, loadStarted: true, lastFullLoadAt: 0, now: t };
  test('loads when idle and no full load has finished', () => {
    expect(m.shouldLoadHomeRecommendations(ok)).toBe(true);
    // `loading` is true before any load has run: the first visit still loads.
    expect(m.shouldLoadHomeRecommendations({ ...ok, loading: true, loadStarted: false })).toBe(true);
  });
  test('skips while a load runs', () => {
    expect(m.shouldLoadHomeRecommendations({ ...ok, loading: true })).toBe(false);
  });
  test('skips within 10 minutes of a finished full load, loads after', () => {
    expect(m.HOME_RECOMMENDATIONS_THROTTLE_MS).toBe(10 * 60 * 1000);
    expect(m.shouldLoadHomeRecommendations({ ...ok, lastFullLoadAt: t - 9 * 60 * 1000 })).toBe(false);
    expect(m.shouldLoadHomeRecommendations({ ...ok, lastFullLoadAt: t - 10 * 60 * 1000 })).toBe(true);
  });
});

describe('shouldStampHomeRecommendationsLoad', () => {
  test('every asked provider failed: no stamp', () => {
    expect(m.shouldStampHomeRecommendationsLoad({ fetched: 3, failed: 3, sectionCount: 0 })).toBe(false);
    // Even with stale cached sections still on screen.
    expect(m.shouldStampHomeRecommendationsLoad({ fetched: 2, failed: 2, sectionCount: 4 })).toBe(false);
  });
  test('some answered: a stamp', () => {
    expect(m.shouldStampHomeRecommendationsLoad({ fetched: 3, failed: 1, sectionCount: 2 })).toBe(true);
  });
  test('all served from the cache: a stamp', () => {
    expect(m.shouldStampHomeRecommendationsLoad({ fetched: 0, failed: 0, sectionCount: 5 })).toBe(true);
  });
  test('no section ended up on the page: no stamp', () => {
    expect(m.shouldStampHomeRecommendationsLoad({ fetched: 2, failed: 0, sectionCount: 0 })).toBe(false);
  });
});

describe('pluginColors', () => {
  test('maps every plugin in the registry, meta services included, to its colour', () => {
    const registry = [
      { id: 'spotify', color: '#1DB954' },
      { id: 'listenbrainz', manifest: { color: '#353070' } },
      { id: 'lastfm', color: '#D51007', manifest: { color: '#000000' } },
    ];
    expect(m.pluginColors(registry)).toEqual({ spotify: '#1DB954', listenbrainz: '#353070', lastfm: '#D51007' });
  });
  test('skips entries with no id or no colour, and tolerates no registry', () => {
    expect(m.pluginColors([{ id: 'x' }, { color: '#fff' }, null])).toEqual({});
    expect(m.pluginColors(undefined)).toEqual({});
  });
});

describe('recent loves in Made from your listening', () => {
  test('the mosaic takes the newest distinct albums, at most four', () => {
    const loves = [
      { artist: 'A', album: 'X', albumArt: 'ax' }, { artist: 'A', album: 'X' }, { artist: 'B', album: '' },
      { artist: 'B', album: 'Y' }, { artist: 'C', album: 'Z' }, { artist: 'D', album: 'W' }, { artist: 'E', album: 'V' },
    ];
    expect(m.lovesMosaicAlbums(loves)).toEqual([
      { artist: 'A', album: 'X', albumArt: 'ax' }, { artist: 'B', album: 'Y', albumArt: null },
      { artist: 'C', album: 'Z', albumArt: null }, { artist: 'D', album: 'W', albumArt: null },
    ]);
    expect(m.lovesMosaicAlbums(undefined)).toEqual([]);
  });
  test('the row shows with loves even when no service has mixes', () => {
    expect(m.homeSections({ mixes: [], loves: [{ title: 't' }] }).mixes).toBe(true);
    expect(m.homeSections({ mixes: [], loves: [] }).mixes).toBe(false);
  });
});

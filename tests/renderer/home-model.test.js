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
  test('+N inside the window', () => {
    expect(m.changeBadge({ lastChangeAdded: 12, tracksChangedAt: now - 7 * DAY }, now)).toBe('+12');
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
  test('albums shows with Shuffleupagus items; concerts needs a location', () => {
    const s = m.homeSections({ tiles: [1], albums: [1], concerts: [1], concertsLocation: '' });
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

describe('releaseTag', () => {
  // now is Thursday 12 November 2026, 15:00 local.
  test('today, a coming day this week, a later date', () => {
    expect(m.releaseTag('2026-11-12', now)).toBe('Out today');
    expect(m.releaseTag('2026-11-13', now)).toBe('Out Friday');
    expect(m.releaseTag('2026-11-30', now)).toBe('Out Nov 30');
  });
  test('this week, then the date', () => {
    expect(m.releaseTag('2026-11-10', now)).toBe('This week');
    expect(m.releaseTag('2026-11-06', now)).toBe('This week');
    expect(m.releaseTag('2026-10-01', now)).toBe('Oct 1');
  });
  test('nothing for a missing or bad date', () => {
    expect(m.releaseTag(null, now)).toBeNull();
    expect(m.releaseTag('soon', now)).toBeNull();
  });
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

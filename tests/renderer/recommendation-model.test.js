// The pure model behind the sectioned Recommendations page
// (src/renderer/lib/recommendation-model.js). The page used to be a flat
// Last.fm/ListenBrainz track list; the sections model is what lets plugin
// providers (Amazon Music titled rows, Shuffleupagus, the generic buckets)
// share one page. These tests pin the contract the providers and the view
// both rely on.

const {
  blockedItemPick,
  normalizeRecommendationItem,
  normalizeRecommendationSections,
  deriveArtistsFromSongs,
  recommendationItemKey,
  dedupeItems,
  TYPE_SECTIONS,
  buildRecommendationPage,
  filterRowBySource, pageSources,
  flattenRecommendationItems,
  weeklyHomeEntries,
  shuffleupagusSection,
  FRIEND_SERVICES
} = require('../../src/renderer/lib/recommendation-model');
const recommendationModel = require('../../src/renderer/lib/recommendation-model');
const { trackSlug } = require('../../src/renderer/lib/track-slug');

describe('normalizeRecommendationItem', () => {
  test('normalizes a song with a track object whose id matches the item', () => {
    const item = normalizeRecommendationItem({ type: 'song', id: 'amz-track-1', name: 'Doberman', artist: 'Deafheaven', duration: 394, imageUrl: 'https://m.media-amazon.com/images/I/1.jpg', url: 'https://music.amazon.com/tracks/B0DTRL3P23/' }, 'amazonmusic');
    expect(item).toMatchObject({ type: 'song', id: 'amz-track-1', name: 'Doberman', artist: 'Deafheaven', duration: 394, resolverId: 'amazonmusic' });
    expect(item.track).toEqual({ id: 'amz-track-1', title: 'Doberman', artist: 'Deafheaven', duration: 394, sources: {} });
  });

  test('a song with no provider id falls back to the trackSlug of artist+title', () => {
    const item = normalizeRecommendationItem({ type: 'song', name: 'Sunbather', artist: 'Deafheaven' }, 'lastfm');
    expect(item.id).toBe(trackSlug('Deafheaven', 'Sunbather'));
    expect(item.track.id).toBe(item.id);
  });

  test("a song's mbid/isrc ride onto the item and the track (no re-asking the mapper, exact-MBID match tier)", () => {
    const item = normalizeRecommendationItem({ type: 'song', id: 'lb-1', name: 'Dream House', artist: 'Deafheaven', mbid: '9d59b396-1f9d-4a70-8b17-6b1dd97d1c73', isrc: 'GB5EP1400001' }, 'listenbrainz');
    expect(item.mbid).toBe('9d59b396-1f9d-4a70-8b17-6b1dd97d1c73');
    expect(item.isrc).toBe('GB5EP1400001');
    expect(item.track.mbid).toBe('9d59b396-1f9d-4a70-8b17-6b1dd97d1c73');
    expect(item.track.isrc).toBe('GB5EP1400001');
  });

  test('a song without mbid/isrc keeps a lean track (no null fields)', () => {
    const item = normalizeRecommendationItem({ type: 'song', name: 'Sunbather', artist: 'Deafheaven', mbid: '', isrc: '  ' }, 'lastfm');
    expect(item.mbid).toBeUndefined();
    expect(item.isrc).toBeUndefined();
    expect(item.track.mbid).toBeUndefined();
    expect(item.track.isrc).toBeUndefined();
  });

  test('an artist item carries no artist field; artists do not need one', () => {
    const item = normalizeRecommendationItem({ type: 'artist', id: 'B004RUHJBC', name: 'Deafheaven' }, 'amazonmusic');
    expect(item).toMatchObject({ type: 'artist', id: 'B004RUHJBC', name: 'Deafheaven' });
    expect(item.artist).toBeUndefined();
    expect(item.track).toBeUndefined();
  });

  test('unknown types, nameless items and non-objects are dropped', () => {
    expect(normalizeRecommendationItem({ type: 'audiobook', name: 'Harry Potter' })).toBeNull();
    expect(normalizeRecommendationItem({ type: 'album', name: '   ' })).toBeNull();
    expect(normalizeRecommendationItem(null)).toBeNull();
    expect(normalizeRecommendationItem({ type: 'song' })).toBeNull();
  });

  test('optional fields are kept only when non-empty strings', () => {
    const item = normalizeRecommendationItem({ type: 'playlist', id: 'pl1', name: 'Heavy Classics', url: 'https://music.amazon.com/playlists/pl1', imageUrl: '', reason: '  ', description: 'x' });
    expect(item.url).toBe('https://music.amazon.com/playlists/pl1');
    expect(item.imageUrl).toBeUndefined();
    expect(item.reason).toBeUndefined();
  });

  test('an artist field on a non-song/album item is dropped (artist items carry their name)', () => {
    const item = normalizeRecommendationItem({ type: 'artist', id: 'a1', name: 'Björk', artist: 'Björk' });
    expect(item.artist).toBeUndefined();
  });
});

describe('normalizeRecommendationItem releaseDate', () => {
  test('an album keeps a provider release date (date part only); anything else drops it', () => {
    const album = (releaseDate) => normalizeRecommendationItem({ type: 'album', name: 'A', artist: 'B', releaseDate }, 'applemusic');
    expect(album('2026-12-05').releaseDate).toBe('2026-12-05');
    expect(album('2026-12-05T00:00:00Z').releaseDate).toBe('2026-12-05');
    expect(album('2027').releaseDate).toBe('2027');
    expect(album('soon')).not.toHaveProperty('releaseDate');
    expect(album(20261205)).not.toHaveProperty('releaseDate');
    expect(normalizeRecommendationItem({ type: 'playlist', name: 'P', releaseDate: '2026-12-05' }, 'x')).not.toHaveProperty('releaseDate');
  });
});

describe('normalizeRecommendationSections', () => {
  test('normalizes sections, drops empty ones and untitled sections keep no title', () => {
    const result = normalizeRecommendationSections({
      sections: [
        { title: 'Albums for You', id: 'uri:///recommendations/browse-home/albumsStrategy', description: 'For you', items: [
          { type: 'album', id: 'B0G2TSTWXD', name: 'Overspace & Supertime', artist: 'Cryptic Shift', imageUrl: 'https://m.media-amazon.com/images/I/81swThQtLTL.jpg' }
        ] },
        { items: [] }, // dropped: no items
        { items: [{ type: 'song', name: 'Doberman', artist: 'Deafheaven' }] } // generic
      ]
    }, { resolverId: 'amazonmusic', resolverName: 'Amazon Music' });
    expect(result.resolverId).toBe('amazonmusic');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].title).toBe('Albums for You');
    expect(result.sections[0].id).toBe('uri:///recommendations/browse-home/albumsStrategy');
    expect(result.sections[1].title).toBeUndefined();
  });

  test('a bare array is tolerated and a non-array answer is empty', () => {
    expect(normalizeRecommendationSections([{ items: [{ type: 'artist', name: 'Björk' }] }]).sections).toHaveLength(1);
    expect(normalizeRecommendationSections(null).sections).toEqual([]);
    expect(normalizeRecommendationSections({ sections: 'nope' }).sections).toEqual([]);
  });
});

describe('deriveArtistsFromSongs', () => {
  test('unique artist names in first-appearance order, case-insensitive', () => {
    const artists = deriveArtistsFromSongs([
      { type: 'song', artist: 'Deafheaven' },
      { type: 'song', artist: 'deafheaven' },
      { type: 'song', artist: 'Anathema' },
      { type: 'album', artist: 'Ignored' },
      { type: 'song', artist: '' }
    ]);
    expect(artists.map(a => a.name)).toEqual(['Deafheaven', 'Anathema']);
    expect(artists[0]).toMatchObject({ type: 'artist', derived: true });
  });
});

describe('blockedItemPick', () => {
  test('an artist item is its artist; songs/albums are artist+title; playlists are not blocklisted', () => {
    // Raw values — recommendation-blocklist.isBlocked normalizes case itself.
    expect(blockedItemPick({ type: 'artist', name: 'Burzum' })).toEqual({ artist: 'Burzum' });
    expect(blockedItemPick({ type: 'song', name: 'Filosofem', artist: 'Burzum' })).toEqual({ artist: 'Burzum', title: 'Filosofem' });
    expect(blockedItemPick({ type: 'album', name: 'Filosofem', artist: 'Burzum' })).toEqual({ artist: 'Burzum', title: 'Filosofem' });
    expect(blockedItemPick({ type: 'playlist', name: 'x' })).toBeNull();
  });
});

describe('dedupeItems / recommendationItemKey', () => {
  test('same artist+title is one song; playlists dedupe by url', () => {
    const out = dedupeItems([
      { type: 'song', artist: 'Deafheaven', name: 'Sunbather' },
      { type: 'song', artist: 'deafheaven', name: 'sunbather' },
      { type: 'playlist', name: 'A', url: 'https://music.amazon.com/playlists/p1' },
      { type: 'playlist', name: 'B', url: 'https://music.amazon.com/playlists/p1' }
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('buildRecommendationPage', () => {
  const norm = (resolverId, resolverName, sections) =>
    normalizeRecommendationSections({ sections }, { resolverId, resolverName });
  const song = (name, artist = 'Art') => ({ type: 'song', name, artist });
  const names = (sub) => sub.items.map(i => i.name);
  const sub = (page, key) => page.flatMap(s => s.subsections).find(x => x.key === key);

  test('TYPE_SECTIONS is the five-type order', () => {
    expect(TYPE_SECTIONS).toEqual([
      { type: 'song', title: 'Songs' }, { type: 'album', title: 'Albums' },
      { type: 'artist', title: 'Artists' }, { type: 'playlist', title: 'Playlists' },
      { type: 'friend', title: 'Listeners' }
    ]);
  });

  test('sections come in the five-type order and empty ones are left out', () => {
    // A song makes a derived artist, so Artists appears without being sent.
    const providers = [norm('lastfm', 'Last.fm', [
      { items: [{ type: 'album', name: 'Alb', artist: 'X' }, song('s1')] }
    ])];
    const page = buildRecommendationPage({ providers });
    expect(page.map(s => s.type)).toEqual(['song', 'album', 'artist']);
    const only = buildRecommendationPage({ providers: [norm('lastfm', 'Last.fm', [
      { items: [{ type: 'album', name: 'Alb', artist: 'X' }, { type: 'song', name: 's1' }] }
    ])] });
    expect(only.map(s => s.type)).toEqual(['song', 'album']);
    expect(buildRecommendationPage({})).toEqual([]);
  });

  test('For you interleaves providers round-robin with Shuffleupagus last', () => {
    const providers = [
      norm('lastfm', 'Last.fm', [{ items: [song('a'), song('b'), song('c')] }]),
      // `personal`, like Shuffleupagus's albums (#1377), so every album shares
      // one category and the Albums section stays its single blended row.
      norm('listenbrainz', 'ListenBrainz', [{ category: 'personal', items: [song('d'), song('e'), { type: 'album', name: 'x', artist: 'A' }, { type: 'album', name: 'y', artist: 'A' }] }])
    ];
    const shuffle = shuffleupagusSection({
      albums: [{ title: 's1', artist: 'A', reason: 'r1' }, { title: 's2', artist: 'A', reason: 'r2' }]
    });
    const page = buildRecommendationPage({ providers, shuffleupagus: shuffle });
    expect(names(sub(page, 'type:song')).filter(n => n.length === 1)).toEqual(['a', 'd', 'b', 'e', 'c']);
    expect(names(sub(page, 'type:album'))).toEqual(['x', 's1', 'y', 's2']);
    expect(sub(page, 'type:album').sources.map(s => s.id)).toEqual(['listenbrainz', 'shuffleupagus']);
    expect(sub(page, 'type:album')).toMatchObject({ title: 'Albums', blended: true, pagingKey: null, resolverId: null, canLoadMore: false, pageable: [] });
  });

  test('a duplicate keeps the first provider and records every source', () => {
    const providers = [
      norm('lastfm', 'Last.fm', [{ items: [{ type: 'song', id: 'l1', name: 'Doberman', artist: 'Deafheaven' }] }]),
      norm('listenbrainz', 'ListenBrainz', [{ items: [{ type: 'song', id: 'b1', name: 'doberman', artist: 'deafheaven' }] }])
    ];
    const row = sub(buildRecommendationPage({ providers }), 'type:song');
    expect(row.items).toHaveLength(1);
    expect(row.items[0]).toMatchObject({ id: 'l1', resolverId: 'lastfm', sourceIds: ['lastfm', 'listenbrainz'] });
    expect(row.sources.map(s => s.id)).toEqual(['lastfm', 'listenbrainz']);
  });

  test('a Shuffleupagus duplicate keeps its reason on the merged item', () => {
    const providers = [norm('lastfm', 'Last.fm', [{ items: [{ type: 'album', name: 'Sunbather', artist: 'Deafheaven' }] }])];
    const shuffle = shuffleupagusSection({ albums: [{ title: 'Sunbather', artist: 'Deafheaven', reason: 'peak' }] });
    const row = sub(buildRecommendationPage({ providers, shuffleupagus: shuffle }), 'type:album');
    expect(row.items).toHaveLength(1);
    expect(row.items[0]).toMatchObject({ resolverId: 'lastfm', reason: 'peak', sourceIds: ['lastfm', 'shuffleupagus'] });
  });

  test('derived artists join Artists For you with the song provider as source', () => {
    const providers = [norm('lastfm', 'Last.fm', [{ items: [song('a', 'Deafheaven')] }])];
    const row = sub(buildRecommendationPage({ providers }), 'type:artist');
    expect(row.items).toHaveLength(1);
    expect(row.items[0]).toMatchObject({ name: 'Deafheaven', derived: true, sourceIds: ['lastfm'] });
    expect(row.sources).toEqual([{ id: 'lastfm', name: 'Last.fm' }]);
    expect(row.blended).toBe(false);
  });

  test('every type section is one row; titled sections blend in with untitled items', () => {
    const providers = [
      norm('lastfm', 'Last.fm', [{ items: [{ type: 'album', name: 'L1', artist: 'A' }, { type: 'album', name: 'L2', artist: 'A' }] }]),
      norm('amazonmusic', 'Amazon Music', [
        { id: 's1', title: 'Albums for You', items: [{ type: 'album', name: 'M1', artist: 'B' }, { type: 'playlist', name: 'P', url: 'https://x/p' }] },
        { id: 's2', title: 'Based on Your Recents', items: [{ type: 'album', name: 'M2', artist: 'B' }, { type: 'album', name: 'M3', artist: 'B' }] }
      ])
    ];
    const page = buildRecommendationPage({ providers });
    for (const section of page) expect(section.subsections).toHaveLength(1);
    const albums = page.find(s => s.type === 'album').subsections[0];
    expect(albums.key).toBe('type:album');
    expect(names(albums)).toEqual(['L1', 'M1', 'L2', 'M2', 'M3']);
    expect(albums.sources.map(s => s.id)).toEqual(['lastfm', 'amazonmusic']);
    expect(names(page.find(s => s.type === 'playlist').subsections[0])).toEqual(['P']);
  });

  test('a section keeps an album and its same-named title track', () => {
    // Album "Blue" and its title track "Blue" share artist+title; the dedupe
    // key carries the type, so each survives in its own section.
    const providers = [norm('amazonmusic', 'Amazon Music', [{ id: 's1', title: 'Hot', items: [
      { type: 'album', name: 'Blue', artist: 'X' }, { type: 'song', name: 'Blue', artist: 'X' }
    ] }])];
    const page = buildRecommendationPage({ providers });
    expect(names(sub(page, 'type:album'))).toEqual(['Blue']);
    expect(names(sub(page, 'type:song'))).toEqual(['Blue']);
  });

  test('a row lists the provider sections that can page its type, sharing one pagingKey across types', () => {
    const providers = [norm('amazonmusic', 'Amazon Music', [
      { id: 's1', title: 'Hot', nextCursor: 'c0', items: [{ type: 'playlist', name: 'P', url: 'https://x/p' }, { type: 'album', name: 'Alb', artist: 'X' }] },
      { title: 'No id', items: [{ type: 'album', name: 'Alb2', artist: 'X' }] }
    ])];
    const page = buildRecommendationPage({ providers, expandableResolverIds: ['amazonmusic'] });
    const pl = sub(page, 'type:playlist');
    const al = sub(page, 'type:album');
    const entry = { resolverId: 'amazonmusic', resolverName: 'Amazon Music', sectionId: 's1', title: 'Hot', category: null, pagingKey: 'amazonmusic|s1', nextCursor: 'c0' };
    expect(pl.pageable).toEqual([entry]);
    expect(al.pageable).toEqual([entry]);
    expect(pl.canLoadMore).toBe(true);
    // A resolver that can't page, or an exhausted section, lists nothing.
    expect(sub(buildRecommendationPage({ providers }), 'type:album').canLoadMore).toBe(false);
    const done = buildRecommendationPage({ providers, expandableResolverIds: ['amazonmusic'], expandedSections: { 'amazonmusic|s1': { items: [], exhausted: true } } });
    expect(sub(done, 'type:album').pageable).toEqual([]);
  });

  test('paged items append after the blended first pages, in their type, and carry the cursor', () => {
    const providers = [
      norm('lastfm', 'Last.fm', [{ items: [{ type: 'album', name: 'L1', artist: 'A' }, { type: 'album', name: 'L2', artist: 'A' }] }]),
      norm('amazonmusic', 'Amazon Music', [{ id: 's1', title: 'Hot', nextCursor: 'c0', items: [
        { type: 'playlist', name: 'P', url: 'https://x/p' }, { type: 'album', name: 'M1', artist: 'X' }
      ] }])
    ];
    const expandedSections = { 'amazonmusic|s1': { nextCursor: 'c1', items: [
      { type: 'album', name: 'M2', artist: 'X' }, { type: 'album', name: 'M1', artist: 'X' }, { type: 'playlist', name: 'P2', url: 'https://x/p2' }
    ] } };
    const page = buildRecommendationPage({ providers, expandedSections, expandableResolverIds: ['amazonmusic'] });
    expect(names(sub(page, 'type:album'))).toEqual(['L1', 'M1', 'L2', 'M2']);
    expect(names(sub(page, 'type:playlist'))).toEqual(['P', 'P2']);
    expect(sub(page, 'type:album').pageable[0].nextCursor).toBe('c1');
  });

  test('weekly playlists with the same name stay separate (keyed by their own id)', () => {
    const w = (id, contextType) => ({ id, contextType, label: id, weekLabel: 'This Week' });
    const providers = [norm('listenbrainz', 'ListenBrainz', [
      { id: 'weekly-exploration', title: 'Weekly Exploration', items: [{ type: 'playlist', name: 'This Week', weekly: w('e1', 'weekly-exploration') }] },
      { id: 'weekly-jams', title: 'Weekly Jams', items: [{ type: 'playlist', name: 'This Week', weekly: w('j1', 'weekly-jam') }] }
    ])];
    const row = sub(buildRecommendationPage({ providers }), 'type:playlist');
    expect(row.items.map(i => i.weekly.id)).toEqual(['e1', 'j1']);
  });

  test('only the newest week of each weekly playlist is kept (by date, else the provider\'s first)', () => {
    const w = (id, contextType, date) => ({ id, contextType, label: id, weekLabel: id, date });
    const providers = [norm('listenbrainz', 'ListenBrainz', [
      { id: 'weekly-exploration', title: 'Weekly Exploration', items: [
        { type: 'playlist', name: 'Last', weekly: w('e-last', 'weekly-exploration', '2026-11-02') },
        { type: 'playlist', name: 'This', weekly: w('e-this', 'weekly-exploration', '2026-11-09') }
      ] },
      { id: 'weekly-jams', title: 'Weekly Jams', items: [
        { type: 'playlist', name: 'J this', weekly: { id: 'j-this', contextType: 'weekly-jam', label: 'x', weekLabel: 'This Week' } },
        { type: 'playlist', name: 'J last', weekly: { id: 'j-last', contextType: 'weekly-jam', label: 'x', weekLabel: 'Last Week' } }
      ] },
      { items: [{ type: 'playlist', name: 'Mix', url: 'https://x/mix' }] }
    ])];
    // Weekly playlists are Made for you and the uncategorized Mix is More
    // playlists, so the section is two category rows, in that order.
    const playlists = buildRecommendationPage({ providers }).find(s => s.type === 'playlist');
    const items = playlists.subsections.flatMap(s => s.items);
    expect(items.map(i => (i.weekly ? i.weekly.id : i.name))).toEqual(['e-this', 'j-this', 'Mix']);
  });

  test('weekly playlists lead Playlists, Exploration before Jams, the rest blended', () => {
    const w = (id, contextType) => ({ id: `lb-${id}`, contextType, label: id, weekLabel: 'Week of x' });
    const providers = [
      norm('amazonmusic', 'Amazon Music', [{ id: 'am', title: 'Amazon Picks', items: [{ type: 'playlist', name: 'AP', url: 'https://x/ap' }] }]),
      norm('listenbrainz', 'ListenBrainz', [
        { id: 'weekly-jams', title: 'Weekly Jams', items: [{ type: 'playlist', name: 'J1', weekly: w('j1', 'weekly-jam') }] },
        { id: 'weekly-exploration', title: 'Weekly Exploration', items: [{ type: 'playlist', name: 'E1', weekly: w('e1', 'weekly-exploration') }] },
        { items: [{ type: 'playlist', name: 'Mix', url: 'https://x/mix' }] }
      ])
    ];
    const playlists = buildRecommendationPage({ providers }).find(s => s.type === 'playlist');
    // Weekly playlists are Made for you; the uncategorized ones are More
    // playlists, still in their blended order.
    expect(playlists.subsections.map(s => s.key)).toEqual(['playlists:personal', 'playlists:other']);
    expect(playlists.subsections.flatMap(names)).toEqual(['E1', 'J1', 'AP', 'Mix']);
  });

  describe('Friends', () => {
    const similarUsers = [
      { resolverId: 'lastfm', resolverName: 'Last.fm', users: [
        { username: 'Bob', similarity: 0.9 }, { username: 'Cy', similarity: 0.8, avatarUrl: 'https://a/cy.png' }, { username: 'Di', similarity: 0.7 }
      ] },
      { resolverId: 'listenbrainz', resolverName: 'ListenBrainz', users: [
        { username: 'me', similarity: 0.5 }, { username: 'Ed', similarity: 0.4 }
      ] }
    ];

    test('drops followed, removed and self; each service most similar first, the services alternating', () => {
      const exclude = { friendKeys: new Set(['lastfm:bob']), selfKeys: new Set(['listenbrainz:me']) };
      const friends = buildRecommendationPage({ similarUsers, exclude }).find(s => s.type === 'friend');
      expect(friends.subsections).toHaveLength(1);
      const row = friends.subsections[0];
      expect(row.items.map(i => i.id)).toEqual(['similar:lastfm:Cy', 'similar:listenbrainz:Ed', 'similar:lastfm:Di']);
      expect(row.items[0]).toMatchObject({ type: 'friend', name: 'Cy', service: 'lastfm', resolverId: 'lastfm', similarity: 0.8, avatarUrl: 'https://a/cy.png', sourceIds: ['lastfm'] });
      expect(row).toMatchObject({ blended: true, title: 'Listeners', key: 'friends:similar' });
      expect(row.sources).toEqual([{ id: 'lastfm', name: 'Last.fm' }, { id: 'listenbrainz', name: 'ListenBrainz' }]);
    });

    test('each service sorts by its own score before they alternate; no score sorts last; topArtists carried', () => {
      const su = [
        { resolverId: 'lastfm', resolverName: 'Last.fm', users: [{ username: 'A', similarity: 0.1 }, { username: 'B' }, { username: 'C', similarity: 0.5, topArtists: ['X', 'Y', 'Z', 'W'] }] },
        { resolverId: 'listenbrainz', resolverName: 'ListenBrainz', users: [{ username: 'E', similarity: 0.5 }, { username: 'D', similarity: 0.9, topArtists: 'nope' }] }
      ];
      const row = buildRecommendationPage({ similarUsers: su }).find(s => s.type === 'friend').subsections[0];
      // Last.fm: C, A, B; ListenBrainz: D, E; alternated.
      expect(row.items.map(i => i.name)).toEqual(['C', 'D', 'A', 'E', 'B']);
      expect(row.items[0].topArtists).toEqual(['X', 'Y', 'Z']);
      expect(row.items[1].topArtists).toEqual([]);
    });

    test('with one provider is a single-source row', () => {
      const row = buildRecommendationPage({ similarUsers: [similarUsers[0]] }).find(s => s.type === 'friend').subsections[0];
      expect(row.blended).toBe(false);
      expect(row.sources).toEqual([{ id: 'lastfm', name: 'Last.fm' }]);
    });

    test('the same name on both services stays two entries', () => {
      const su = [
        { resolverId: 'lastfm', resolverName: 'Last.fm', users: [{ username: 'Zed', similarity: 1 }] },
        { resolverId: 'listenbrainz', resolverName: 'ListenBrainz', users: [{ username: 'zed', similarity: 1 }] }
      ];
      const row = buildRecommendationPage({ similarUsers: su }).find(s => s.type === 'friend').subsections[0];
      expect(row.items).toHaveLength(2);
    });

    test('only a friend service makes Friends entries (Follow can only look up Last.fm or ListenBrainz)', () => {
      expect(FRIEND_SERVICES).toEqual(['lastfm', 'listenbrainz']);
      const su = [
        { resolverId: 'someservice', resolverName: 'Some Service', users: [{ username: 'Zed', similarity: 1 }] },
        similarUsers[0]
      ];
      const row = buildRecommendationPage({ similarUsers: su }).find(s => s.type === 'friend').subsections[0];
      expect(row.items.map(i => i.service)).toEqual(['lastfm', 'lastfm', 'lastfm']);
      expect(row.sources).toEqual([{ id: 'lastfm', name: 'Last.fm' }]);
      expect(buildRecommendationPage({ similarUsers: [su[0]] })).toEqual([]);
    });

    test('everyone excluded leaves no Friends section', () => {
      const exclude = { friendKeys: new Set(['lastfm:bob', 'lastfm:cy', 'lastfm:di', 'listenbrainz:ed']), selfKeys: new Set(['listenbrainz:me']) };
      expect(buildRecommendationPage({ similarUsers, exclude })).toEqual([]);
    });
  });

  describe('filters and flatten', () => {
    const providers = [
      norm('lastfm', 'Last.fm', [{ items: [song('a'), song('both')] }]),
      norm('listenbrainz', 'ListenBrainz', [{ items: [song('d'), song('both')] }])
    ];
    const page = buildRecommendationPage({ providers });
    const row = sub(page, 'type:song');

    test('filterRowBySource keeps the items one source sent, shared ones included', () => {
      expect(names(row)).toEqual(['a', 'd', 'both']);
      expect(filterRowBySource(row, 'lastfm').map(i => i.name)).toEqual(['a', 'both']);
      expect(filterRowBySource(row, 'listenbrainz').map(i => i.name)).toEqual(['d', 'both']);
      expect(filterRowBySource(row, 'amazonmusic')).toEqual([]);
      expect(filterRowBySource(row, 'all')).toBe(row.items);
      expect(filterRowBySource(row, null)).toBe(row.items);
      expect(row.items).toHaveLength(3);
    });

    test('pageSources lists every source on the page in order, with its item count', () => {
      // a, d, both (songs) plus the derived artist "Art", which both sent.
      expect(pageSources(page)).toEqual([
        { id: 'lastfm', name: 'Last.fm', count: 3 },
        { id: 'listenbrainz', name: 'ListenBrainz', count: 3 }
      ]);
      expect(pageSources(undefined)).toEqual([]);
    });

    test('flattenRecommendationItems returns every item in page order', () => {
      const flat = flattenRecommendationItems(page);
      const expected = page.flatMap(s => s.subsections.flatMap(x => x.items));
      expect(flat).toEqual(expected);
      expect(flat[0].name).toBe('a');
      expect(flattenRecommendationItems(undefined)).toEqual([]);
    });
  });
});

describe('weeklyHomeEntries', () => {
  // The playlist view's pendingPlaylistLoad lookup and the weekly covers
  // effect read homeData.weeklyJams / weeklyExploration in Home's old entry
  // shape; the page fills them from its weekly rows.
  const w = (id, contextType, weekLabel, date) => ({ id, contextType, label: contextType === 'weekly-jam' ? 'Weekly Jams' : 'Weekly Exploration', weekLabel, date });
  const page = () => buildRecommendationPage({ providers: [
    normalizeRecommendationSections({ sections: [
      { id: 'weekly-exploration', title: 'Weekly Exploration', items: [
        { type: 'playlist', id: 'e1', name: 'This Week', weekly: w('e1', 'weekly-exploration', 'This Week', '2026-11-09') },
        { type: 'playlist', id: 'e2', name: 'Last Week', weekly: w('e2', 'weekly-exploration', 'Last Week', '2026-11-02') }
      ] },
      { id: 'weekly-jams', title: 'Weekly Jams', items: [
        { type: 'playlist', id: 'j1', name: 'This Week', weekly: w('j1', 'weekly-jam', 'This Week', '2026-11-09') }
      ] },
      { items: [{ type: 'playlist', name: 'Not weekly', url: 'https://x/p' }] }
    ] }, { resolverId: 'lbish', resolverName: 'Brainz' })
  ] });

  test('builds Home\'s entry shape from items carrying weekly, by context type', () => {
    const out = weeklyHomeEntries(page(), {});
    // Only the newest week of each is on the page, so only it is here.
    expect(out.weeklyExploration.map(e => e.id)).toEqual(['e1']);
    expect(out.weeklyJams).toEqual([{
      id: 'j1', title: 'Weekly Jams', weekLabel: 'This Week', date: '2026-11-09',
      description: 'Your favorite tracks from the past week, curated by Brainz',
      tracks: [], tracksLoaded: false
    }]);
    expect(out.weeklyExploration[0].description).toBe('New discoveries based on your listening habits, curated by Brainz');
  });

  test('no weekly items is null for both, as Home had before they loaded', () => {
    expect(weeklyHomeEntries([], {})).toEqual({ weeklyJams: null, weeklyExploration: null });
    expect(weeklyHomeEntries(undefined, undefined)).toEqual({ weeklyJams: null, weeklyExploration: null });
  });

  test('an entry that already loaded its tracks keeps them, and an unchanged list keeps its identity', () => {
    const first = weeklyHomeEntries(page(), {});
    const loaded = { ...first, weeklyJams: [{ ...first.weeklyJams[0], tracks: [{ id: 't' }], tracksLoaded: true }] };
    const again = weeklyHomeEntries(page(), loaded);
    expect(again.weeklyJams).toBe(loaded.weeklyJams);
    expect(again.weeklyJams[0].tracks).toEqual([{ id: 't' }]);
    expect(again.weeklyExploration).toBe(loaded.weeklyExploration);
  });

  test('a changed week makes a new list but keeps loaded tracks for the ids that stayed', () => {
    const first = weeklyHomeEntries(page(), {});
    // Last time the list also had an older week; it is gone now.
    const prev = { weeklyJams: null, weeklyExploration: [{ ...first.weeklyExploration[0], tracks: [{ id: 't' }], tracksLoaded: true }, { id: 'old', title: 'Weekly Exploration', weekLabel: 'Last Week', tracks: [], tracksLoaded: false }] };
    const out = weeklyHomeEntries(page(), prev);
    expect(out.weeklyExploration).not.toBe(prev.weeklyExploration);
    expect(out.weeklyExploration).toHaveLength(1);
    expect(out.weeklyExploration[0]).toBe(prev.weeklyExploration[0]);
    expect(out.weeklyJams[0].tracksLoaded).toBe(false);
  });
});

describe('the legacy flat builder', () => {
  test('is gone (app.js reads the grouped page only)', () => {
    expect(recommendationModel.buildRecommendationSections).toBeUndefined();
  });
});

describe('normalizeRecommendationItem weekly field', () => {
  test('keeps a valid weekly field and drops a malformed one', () => {
    const weekly = { id: 'pl1', contextType: 'weekly-jam', label: 'Jams', weekLabel: 'Week of Nov 3', date: '2026-11-03' };
    const ok = normalizeRecommendationItem({ type: 'playlist', name: 'P', weekly }, 'listenbrainz');
    expect(ok.weekly).toEqual(weekly);
    const noDate = normalizeRecommendationItem({ type: 'playlist', name: 'P', weekly: { id: 'a', contextType: 'weekly-exploration', label: 'L', weekLabel: 'W' } }, 'x');
    expect(noDate.weekly).toEqual({ id: 'a', contextType: 'weekly-exploration', label: 'L', weekLabel: 'W' });
    for (const bad of [{ ...weekly, contextType: 'daily' }, { ...weekly, id: '' }, { ...weekly, label: 5 }, { ...weekly, weekLabel: undefined }, 'nope']) {
      expect(normalizeRecommendationItem({ type: 'playlist', name: 'P', weekly: bad }, 'x').weekly).toBeUndefined();
    }
  });
});

describe('shuffleupagusSection', () => {
  test('albums and artists become items with reasons and image passthrough', () => {
    const shuffle = shuffleupagusSection({
      albums: [{ title: 'Sunbather', artist: 'Deafheaven', reason: 'Doom-gaze peak', art: 'https://example.com/sunbather.jpg' }],
      artists: [{ name: 'Anathema', reason: '因为他们', image: null }]
    });
    expect(shuffle.sections[0].items[0]).toMatchObject({
      type: 'album', name: 'Sunbather', artist: 'Deafheaven', reason: 'Doom-gaze peak', imageUrl: 'https://example.com/sunbather.jpg'
    });
    expect(shuffle.sections[0].items[1]).toMatchObject({ type: 'artist', name: 'Anathema', reason: '因为他们', imageUrl: null });
  });

  test('entries without both artist and title (or name) are dropped; empty → null', () => {
    expect(shuffleupagusSection({ albums: [{ title: 'No Artist' }], artists: [{}] })).toBeNull();
    expect(shuffleupagusSection({})).toBeNull();
  });
});

describe('playlist categories: contract and helpers', () => {
  const m = recommendationModel;
  test('playlistCategory: weekly, then item, then section, then other', () => {
    expect(m.playlistCategory({ weekly: { id: 'w' }, category: 'editorial' }, 'community')).toBe('personal');
    expect(m.playlistCategory({ category: 'editorial' }, 'community')).toBe('editorial');
    expect(m.playlistCategory({}, 'community')).toBe('community');
    expect(m.playlistCategory({ category: 'bogus' }, 'nope')).toBe('other');
    expect(m.playlistCategory({}, undefined)).toBe('other');
  });
  test('artistRowTitle: one, two, three, four or more; blanks and case-repeats dropped', () => {
    expect(m.artistRowTitle(['Radiohead'])).toBe('Because you like Radiohead');
    expect(m.artistRowTitle(['Radiohead', 'Arctic Monkeys'])).toBe('Because you like Radiohead and Arctic Monkeys');
    expect(m.artistRowTitle(['Radiohead', 'Arctic Monkeys', 'The Strokes'])).toBe('Because you like Radiohead, Arctic Monkeys and The Strokes');
    expect(m.artistRowTitle(['A', 'B', 'C', 'D'])).toBe('Because you like A, B, C and more');
    expect(m.artistRowTitle(['Radiohead', ' radiohead ', '', '  ', 'Blur'])).toBe('Because you like Radiohead and Blur');
    expect(m.artistRowTitle([])).toBe('Because of artists you like');
  });
  test('normalizers keep valid category and seedArtist', () => {
    const out = m.normalizeRecommendationSections({ sections: [
      { id: 's1', title: 'Fans Like', category: 'artist', seedArtist: ' Radiohead ', items: [
        { type: 'playlist', id: 'p1', name: 'P1', category: 'editorial' },
        { type: 'album', id: 'a1', name: 'A1', artist: 'X', category: 'editorial' },
      ] },
      { id: 's2', title: 'Odd', category: 'bogus', seedArtist: 'Ignored', items: [{ type: 'playlist', id: 'p2', name: 'P2', category: 'nope' }] },
      { id: 's3', title: 'Mixes', category: 'personal', seedArtist: 'Ignored', items: [{ type: 'playlist', id: 'p3', name: 'P3' }] },
    ] }, { resolverId: 'x' });
    const [s1, s2, s3] = out.sections;
    expect(s1.category).toBe('artist');
    expect(s1.seedArtist).toBe('Radiohead');
    expect(s1.items[0].category).toBe('editorial');
    // An album keeps a category valid for albums (#1377); `editorial` is one.
    expect(s1.items[1].category).toBe('editorial');
    expect(s2.category).toBeUndefined();
    expect(s2.seedArtist).toBeUndefined();
    expect(s2.items[0].category).toBeUndefined();
    expect(s3.seedArtist).toBeUndefined();
    expect(m.PLAYLIST_CATEGORIES.map(c => c.id)).toEqual(['personal', 'artist', 'editorial', 'community', 'other']);
  });
});

describe('playlist category rows', () => {
  const m = recommendationModel;
  const norm = (resolverId, resolverName, sections) =>
    m.normalizeRecommendationSections({ sections }, { resolverId, resolverName });
  const pl = (id, extra = {}) => ({ type: 'playlist', id, name: id.toUpperCase(), url: `https://x/${id}`, ...extra });
  const playlistRows = (page) => (page.find(s => s.type === 'playlist') || { subsections: [] }).subsections;
  const row = (page, key) => playlistRows(page).find(s => s.key === key);
  const ids = (sub) => sub.items.map(i => i.id);

  test('rows follow category order and blend providers', () => {
    const providers = [
      norm('a', 'A', [
        { id: 'mine', title: 'Mine', category: 'personal', items: [pl('p1'), pl('p2')] },
        { id: 'comm', title: 'Comm', category: 'community', items: [pl('c1')] }
      ]),
      norm('b', 'B', [
        { id: 'ed', title: 'Ed', category: 'editorial', items: [pl('e1')] },
        { id: 'misc', title: 'Misc', items: [pl('o1')] }
      ])
    ];
    const page = m.buildRecommendationPage({ providers });
    const section = page.find(s => s.type === 'playlist');
    expect(section.title).toBe('Playlists');
    expect(section.subsections.map(s => s.key)).toEqual(['playlists:personal', 'playlists:editorial', 'playlists:community', 'playlists:other']);
    expect(section.subsections.map(s => s.title)).toEqual(['Made for you', 'From the editors', 'From other listeners', 'More playlists']);
    expect(section.subsections.map(s => s.category)).toEqual(['personal', 'editorial', 'community', 'other']);
    expect(ids(row(page, 'playlists:personal'))).toEqual(['p1', 'p2']);
    expect(row(page, 'playlists:personal').sources).toEqual([{ id: 'a', name: 'A' }]);
    expect(row(page, 'playlists:personal').blended).toBe(false);
    expect(section.subsections.every(s => s.type === 'playlist')).toBe(true);
  });

  test('an item category overrides its section, and a mixed section feeds two rows with one pagingKey each', () => {
    const providers = [norm('amazonmusic', 'Amazon Music', [
      { id: 'g', title: 'G', category: 'editorial', items: [
        { type: 'playlist', id: 'e1', name: 'E1' },
        { type: 'playlist', id: 'p1', name: 'P1', category: 'personal' }
      ] }
    ])];
    const page = m.buildRecommendationPage({ providers, expandableResolverIds: ['amazonmusic'] });
    expect(ids(row(page, 'playlists:personal'))).toEqual(['p1']);
    expect(ids(row(page, 'playlists:editorial'))).toEqual(['e1']);
    for (const key of ['playlists:personal', 'playlists:editorial']) {
      const r = row(page, key);
      expect(r.pageable).toHaveLength(1);
      expect(r.pageable[0]).toMatchObject({ pagingKey: 'amazonmusic|g', category: 'editorial' });
      expect(r.canLoadMore).toBe(true);
    }
  });

  test("one category: today's single Playlists row", () => {
    const w = (id, contextType) => ({ id, contextType, label: id, weekLabel: 'This Week' });
    const providers = [norm('listenbrainz', 'ListenBrainz', [
      { id: 'weekly-jams', title: 'Weekly Jams', items: [{ type: 'playlist', name: 'Jams', weekly: w('j1', 'weekly-jam') }] },
      { id: 'weekly-exploration', title: 'Weekly Exploration', items: [{ type: 'playlist', name: 'Exploration', weekly: w('e1', 'weekly-exploration') }] }
    ])];
    const page = m.buildRecommendationPage({ providers, expandableResolverIds: ['listenbrainz'] });
    const subs = playlistRows(page);
    expect(subs.length).toBe(1);
    expect(subs[0]).toMatchObject({ key: 'type:playlist', title: 'Playlists', category: null });
    expect(subs[0].items.map(i => i.weekly.id)).toEqual(['e1', 'j1']);
    expect(subs[0].pageable.map(p => p.pagingKey)).toEqual(['listenbrainz|weekly-jams', 'listenbrainz|weekly-exploration']);
    expect(subs[0].pageable.every(p => p.category === null)).toBe(true);
  });

  test('weekly items lead Made for you even without a category', () => {
    const providers = [
      norm('b', 'B', [
        { id: 'mine', title: 'Mine', category: 'personal', items: [pl('p1')] },
        { id: 'ed', title: 'Ed', category: 'editorial', items: [pl('e1')] }
      ]),
      norm('a', 'A', [
        { id: 'weekly-jams', title: 'Weekly Jams', items: [{ type: 'playlist', name: 'Jams', weekly: { id: 'j1', contextType: 'weekly-jam', label: 'Jams', weekLabel: 'This Week' } }] }
      ])
    ];
    const page = m.buildRecommendationPage({ providers });
    const personal = row(page, 'playlists:personal');
    expect(personal.items[0].weekly.id).toBe('j1');
    expect(personal.items.map(i => i.name)).toEqual(['Jams', 'P1']);
    expect(ids(row(page, 'playlists:editorial'))).toEqual(['e1']);
  });

  test('an uncategorized older plugin beside a categorized one', () => {
    const providers = [
      norm('a', 'A', [{ id: 'old', title: 'Old', items: [pl('o1'), pl('o2')] }]),
      norm('b', 'B', [{ id: 'mine', title: 'Mine', category: 'personal', items: [pl('p1')] }])
    ];
    const page = m.buildRecommendationPage({ providers });
    expect(ids(row(page, 'playlists:other'))).toEqual(['o1', 'o2']);
    expect(ids(row(page, 'playlists:personal'))).toEqual(['p1']);
    const all = playlistRows(page).flatMap(s => s.items.map(i => i.id));
    expect(all.filter(id => id === 'o1')).toHaveLength(1);
    expect(all.filter(id => id === 'o2')).toHaveLength(1);
  });

  test('two providers disagree: the earliest category wins', () => {
    const providers = [
      norm('a', 'A', [{ id: 'ed', title: 'Ed', category: 'editorial', items: [pl('x'), pl('e2')] }]),
      norm('b', 'B', [{ id: 'mine', title: 'Mine', category: 'personal', items: [pl('x')] }])
    ];
    const page = m.buildRecommendationPage({ providers });
    const personal = row(page, 'playlists:personal');
    expect(ids(personal)).toEqual(['x']);
    expect(personal.items[0].sourceIds).toEqual(expect.arrayContaining(['a', 'b']));
    expect(ids(row(page, 'playlists:editorial'))).toEqual(['e2']);
    const all = playlistRows(page).flatMap(s => s.items.map(i => i.id));
    expect(all.filter(id => id === 'x')).toHaveLength(1);
  });

  test('artist row title from seeds', () => {
    const providers = [norm('a', 'A', [
      { id: 'fl1', title: 'Fans Like Radiohead', category: 'artist', seedArtist: 'Radiohead', items: [pl('r1')] },
      { id: 'fl2', title: 'Fans Like radiohead', category: 'artist', seedArtist: 'radiohead', items: [pl('r2')] },
      { id: 'fl3', title: 'Fans Like Blur', category: 'artist', seedArtist: 'Blur', items: [pl('b1')] },
      { id: 'mine', title: 'Mine', category: 'personal', items: [pl('p1')] }
    ])];
    const page = m.buildRecommendationPage({ providers });
    const artist = row(page, 'playlists:artist');
    expect(artist.title).toBe('Because you like Radiohead and Blur');
    expect(artist.category).toBe('artist');
    expect(artist.items.map(i => i.seedArtist)).toEqual(['Radiohead', 'radiohead', 'Blur']);
    expect(row(page, 'playlists:personal').items[0].seedArtist).toBeUndefined();
  });

  test('paged items take their section category', () => {
    const providers = [
      norm('a', 'A', [{ id: 'mine', title: 'Mine', category: 'personal', items: [pl('p1')] }]),
      norm('amazonmusic', 'Amazon Music', [{ id: 'comm', title: 'Comm', category: 'community', items: [pl('c1'), pl('c2')] }])
    ];
    const expandedSections = { 'amazonmusic|comm': { nextCursor: 'n1', items: [{ type: 'playlist', id: 'c3', name: 'C3', url: 'https://x/c3' }] } };
    const page = m.buildRecommendationPage({ providers, expandedSections, expandableResolverIds: ['amazonmusic'] });
    const community = row(page, 'playlists:community');
    expect(ids(community)).toEqual(['c1', 'c2', 'c3']);
    expect(community.pageable).toEqual([expect.objectContaining({ pagingKey: 'amazonmusic|comm', category: 'community', nextCursor: 'n1' })]);
    expect(row(page, 'playlists:personal').pageable).toEqual([]);
    expect(ids(row(page, 'playlists:personal'))).toEqual(['p1']);
  });

  test('history mixes still excluded before the split', () => {
    const providers = [norm('a', 'A', [
      { id: 'mine', title: 'Mine', category: 'personal', items: [pl('mix1'), pl('p1')] },
      { id: 'ed', title: 'Ed', category: 'editorial', items: [pl('e1')] }
    ])];
    const page = m.buildRecommendationPage({ providers, excludePlaylistIds: new Set(['mix1']) });
    const all = playlistRows(page).flatMap(s => s.items.map(i => i.id));
    expect(all).not.toContain('mix1');
    expect(ids(row(page, 'playlists:personal'))).toEqual(['p1']);
  });

  test('every other subsection carries category null, and stamping leaves the provider items alone', () => {
    const providers = [norm('a', 'A', [
      { id: 'mine', title: 'Mine', category: 'personal', items: [pl('p1'), { type: 'album', name: 'Alb', artist: 'X' }, { type: 'song', name: 'S', artist: 'X' }] },
      { id: 'misc', title: 'Misc', items: [pl('o1')] }
    ])];
    const page = m.buildRecommendationPage({ providers, similarUsers: [{ resolverId: 'lastfm', resolverName: 'Last.fm', users: [{ username: 'Bob', similarity: 1 }] }] });
    for (const section of page) {
      if (section.type === 'playlist') continue;
      for (const sub of section.subsections) expect(sub.category).toBeNull();
    }
    expect(providers[0].sections[1].items[0].category).toBeUndefined();
    expect(providers[0].sections[0].items[1].category).toBeUndefined();
    // Albums are stamped too (#1377); on the single Albums row the items keep
    // their stamped category while the row's own stays null.
    expect(page.find(s => s.type === 'album').subsections[0].items[0].category).toBe('personal');
  });
});

describe('album categories: tables and helpers', () => {
  const m = recommendationModel;
  test('categoryFor: album values, playlist values, type-specific validity', () => {
    expect(m.categoryFor('album', { category: 'new' }, 'personal')).toBe('new');
    expect(m.categoryFor('album', {}, 'personal')).toBe('personal');
    expect(m.categoryFor('album', { category: 'community' }, undefined)).toBe('other');
    expect(m.categoryFor('playlist', { category: 'new' }, undefined)).toBe('other');
    expect(m.categoryFor('playlist', { weekly: { id: 'w' } }, 'editorial')).toBe('personal');
    expect(m.categoryFor('album', { weekly: { id: 'w' } }, 'editorial')).toBe('editorial');
    expect(m.categoryFor('song', { category: 'personal' }, 'personal')).toBeNull();
    expect(m.playlistCategory({ category: 'community' }, undefined)).toBe('community');
    expect(m.ALBUM_CATEGORIES.map(c => c.id)).toEqual(['new', 'personal', 'artist', 'editorial', 'other']);
  });
  test('normalizers keep album categories valid for albums only', () => {
    const out = m.normalizeRecommendationSections({ sections: [
      { id: 'n', title: 'New', category: 'new', items: [
        { type: 'album', id: 'a1', name: 'A1', artist: 'X' },
        { type: 'album', id: 'a2', name: 'A2', artist: 'X', category: 'community' },
        { type: 'playlist', id: 'p1', name: 'P1', category: 'new' },
      ] },
    ] }, { resolverId: 'x' });
    const [sec] = out.sections;
    expect(sec.category).toBe('new');
    expect(sec.items[1].category).toBeUndefined();
    expect(sec.items[2].category).toBeUndefined();
  });
});

describe('album category rows', () => {
  const m = recommendationModel;
  const norm = (resolverId, resolverName, sections) =>
    m.normalizeRecommendationSections({ sections }, { resolverId, resolverName });
  const al = (name, artist = 'X', extra = {}) => ({ type: 'album', name, artist, ...extra });
  const rowsOf = (page, type) => (page.find(s => s.type === type) || { subsections: [] }).subsections;
  const row = (page, key) => page.flatMap(s => s.subsections).find(s => s.key === key);
  const names = (sub) => sub.items.map(i => i.name);

  test('album rows follow the album order, keys and titles', () => {
    const providers = [norm('a', 'A', [
      { id: 'ed', title: 'Ed', category: 'editorial', items: [al('E1')] },
      { id: 'misc', title: 'Misc', items: [al('O1')] },
      { id: 'mine', title: 'Mine', category: 'personal', items: [al('P1')] },
      { id: 'fresh', title: 'Fresh', category: 'new', items: [al('N1')] }
    ])];
    const page = m.buildRecommendationPage({ providers });
    const subs = rowsOf(page, 'album');
    expect(page.find(s => s.type === 'album').title).toBe('Albums');
    expect(subs.map(s => s.key)).toEqual(['albums:new', 'albums:personal', 'albums:editorial', 'albums:other']);
    expect(subs.map(s => s.title)).toEqual(['New for you', 'Based on your listening', 'From the editors', 'More albums']);
    expect(subs.map(s => s.category)).toEqual(['new', 'personal', 'editorial', 'other']);
    expect(subs.every(s => s.type === 'album')).toBe(true);
    expect(names(row(page, 'albums:new'))).toEqual(['N1']);
    expect(names(row(page, 'albums:other'))).toEqual(['O1']);
    expect(row(page, 'albums:new').sources).toEqual([{ id: 'a', name: 'A' }]);
  });

  test("one album category: today's single Albums row", () => {
    const providers = [norm('a', 'A', [{ items: [al('O1'), al('O2')] }])];
    const subs = rowsOf(m.buildRecommendationPage({ providers }), 'album');
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ key: 'type:album', title: 'Albums', category: null });
    expect(names(subs[0])).toEqual(['O1', 'O2']);
  });

  test('Shuffleupagus albums land in Based on your listening', () => {
    const shuffle = m.shuffleupagusSection({ albums: [{ title: 'S', artist: 'Y', reason: 'r' }], artists: [] });
    expect(shuffle.sections[0].category).toBe('personal');
    const providers = [norm('a', 'A', [{ id: 'ed', title: 'Ed', category: 'editorial', items: [al('E1')] }])];
    const page = m.buildRecommendationPage({ providers, shuffleupagus: shuffle });
    expect(names(row(page, 'albums:personal'))).toEqual(['S']);
    expect(row(page, 'albums:personal').sources).toEqual([{ id: 'shuffleupagus', name: 'Shuffleupagus' }]);
    expect(names(row(page, 'albums:editorial'))).toEqual(['E1']);
  });

  test('an artist album row titles from its seeds', () => {
    const providers = [norm('a', 'A', [
      { id: 'fl', title: 'Fans Like', category: 'artist', seedArtist: 'FIDLAR', items: [al('F1', 'Z')] },
      { id: 'mine', title: 'Mine', category: 'personal', items: [al('P1')] }
    ])];
    const page = m.buildRecommendationPage({ providers });
    expect(row(page, 'albums:artist').title).toBe('Because you like FIDLAR');
    expect(row(page, 'albums:artist').items[0].seedArtist).toBe('FIDLAR');
    expect(row(page, 'albums:personal').items[0].seedArtist).toBeUndefined();
  });

  test('providers disagree on an album: the earliest album category wins', () => {
    // A owns the merged copy (editorial); B's `new` ranks earlier in the album
    // table, so mergeOwned moves it. `new` ranks nowhere in the playlist table,
    // so this only passes when the album rank is the one consulted.
    const providers = [
      norm('a', 'A', [{ id: 'ed', title: 'Ed', category: 'editorial', items: [al('Same', 'Q'), al('E2')] }]),
      norm('b', 'B', [{ id: 'fresh', title: 'Fresh', category: 'new', items: [al('same', 'q')] }])
    ];
    const page = m.buildRecommendationPage({ providers });
    const fresh = row(page, 'albums:new');
    expect(names(fresh)).toEqual(['Same']);
    expect(fresh.items[0].sourceIds).toEqual(['a', 'b']);
    expect(names(row(page, 'albums:editorial'))).toEqual(['E2']);
    const all = rowsOf(page, 'album').flatMap(s => s.items.map(i => i.name.toLowerCase()));
    expect(all.filter(n => n === 'same')).toHaveLength(1);
  });

  test('paged albums take their section category', () => {
    const providers = [
      norm('a', 'A', [{ id: 'mine', title: 'Mine', category: 'personal', items: [al('P1')] }]),
      norm('amazonmusic', 'Amazon Music', [{ id: 'ed', title: 'Ed', category: 'editorial', items: [al('E1'), al('E2')] }])
    ];
    const expandedSections = { 'amazonmusic|ed': { nextCursor: 'n1', items: [{ type: 'album', name: 'E3', artist: 'X' }] } };
    const page = m.buildRecommendationPage({ providers, expandedSections, expandableResolverIds: ['amazonmusic'] });
    const editorial = row(page, 'albums:editorial');
    expect(names(editorial)).toEqual(['E1', 'E2', 'E3']);
    expect(editorial.items[2].category).toBe('editorial');
    expect(editorial.pageable).toEqual([expect.objectContaining({ pagingKey: 'amazonmusic|ed', category: 'editorial', nextCursor: 'n1' })]);
    expect(editorial.canLoadMore).toBe(true);
    expect(row(page, 'albums:personal').pageable).toEqual([]);
    expect(names(row(page, 'albums:personal'))).toEqual(['P1']);
  });

  test("a single Albums row's pageable entries carry the section's category", () => {
    const providers = [norm('amazonmusic', 'Amazon Music', [{ id: 'fresh', title: 'Fresh', category: 'new', items: [al('N1')] }])];
    const subs = rowsOf(m.buildRecommendationPage({ providers, expandableResolverIds: ['amazonmusic'] }), 'album');
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ key: 'type:album', category: null });
    expect(subs[0].pageable).toEqual([expect.objectContaining({ pagingKey: 'amazonmusic|fresh', category: 'new' })]);
  });

  test('album items carry their position in the blend, categorized or not', () => {
    const providers = [
      norm('a', 'A', [{ items: [al('A0'), al('A1')] }]),
      norm('b', 'B', [
        { id: 'mine', title: 'Mine', category: 'personal', items: [al('B0')] },
        { id: 'ed', title: 'Ed', category: 'editorial', items: [al('B1'), { type: 'playlist', id: 'p1', name: 'P1', url: 'https://x/p1' }] }
      ])
    ];
    const page = m.buildRecommendationPage({ providers });
    const byName = Object.fromEntries(rowsOf(page, 'album').flatMap(s => s.items).map(i => [i.name, i.blendIndex]));
    expect(byName).toEqual({ A0: 0, B0: 1, A1: 2, B1: 3 });
    expect(rowsOf(page, 'playlist')[0].items[0].blendIndex).toBeUndefined();
    for (const p of providers) for (const sec of p.sections) for (const item of sec.items) {
      expect(item).not.toHaveProperty('blendIndex');
    }

    const single = [norm('a', 'A', [{ items: [al('O1'), al('O2')] }]), norm('b', 'B', [{ items: [al('O3')] }])];
    const subs = rowsOf(m.buildRecommendationPage({ providers: single }), 'album');
    expect(subs.map(s => s.key)).toEqual(['type:album']);
    expect(subs[0].items.map(i => [i.name, i.blendIndex])).toEqual([['O1', 0], ['O3', 1], ['O2', 2]]);
    for (const p of single) for (const sec of p.sections) for (const item of sec.items) {
      expect(item).not.toHaveProperty('blendIndex');
    }
  });

  test('playlist rows are unchanged beside album rows', () => {
    const pl = (id) => ({ type: 'playlist', id, name: id.toUpperCase(), url: `https://x/${id}` });
    const sections = [
      { id: 'pa', title: 'Picks A', category: 'personal', items: [al('P1')] },
      { id: 'pp', title: 'Picks P', category: 'personal', items: [pl('p1')] }
    ];
    const page = m.buildRecommendationPage({ providers: [norm('a', 'A', sections)] });
    expect(rowsOf(page, 'playlist').map(s => s.key)).toEqual(['type:playlist']);
    expect(rowsOf(page, 'album').map(s => s.key)).toEqual(['type:album']);
    const more = m.buildRecommendationPage({ providers: [norm('a', 'A', [
      ...sections, { id: 'pc', title: 'Comm', category: 'community', items: [pl('c1')] }
    ])] });
    expect(rowsOf(more, 'playlist').map(s => s.key)).toEqual(['playlists:personal', 'playlists:community']);
    expect(rowsOf(more, 'playlist').map(s => s.title)).toEqual(['Made for you', 'From other listeners']);
    expect(rowsOf(more, 'album').map(s => s.key)).toEqual(['type:album']);
  });
});

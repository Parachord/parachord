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
  filterSubsectionItems,
  flattenRecommendationItems,
  weeklyHomeEntries,
  shuffleupagusSection
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
      { type: 'friend', title: 'Friends' }
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
      norm('listenbrainz', 'ListenBrainz', [{ items: [song('d'), song('e'), { type: 'album', name: 'x', artist: 'A' }, { type: 'album', name: 'y', artist: 'A' }] }])
    ];
    const shuffle = shuffleupagusSection({
      albums: [{ title: 's1', artist: 'A', reason: 'r1' }, { title: 's2', artist: 'A', reason: 'r2' }]
    });
    const page = buildRecommendationPage({ providers, shuffleupagus: shuffle });
    expect(names(sub(page, 'foryou:song')).filter(n => n.length === 1)).toEqual(['a', 'd', 'b', 'e', 'c']);
    expect(names(sub(page, 'foryou:album'))).toEqual(['x', 's1', 'y', 's2']);
    expect(sub(page, 'foryou:album').sources.map(s => s.id)).toEqual(['listenbrainz', 'shuffleupagus']);
    expect(sub(page, 'foryou:album')).toMatchObject({ title: 'For you', blended: true, pagingKey: null, resolverId: null });
  });

  test('a duplicate keeps the first provider and records every source', () => {
    const providers = [
      norm('lastfm', 'Last.fm', [{ items: [{ type: 'song', id: 'l1', name: 'Doberman', artist: 'Deafheaven' }] }]),
      norm('listenbrainz', 'ListenBrainz', [{ items: [{ type: 'song', id: 'b1', name: 'doberman', artist: 'deafheaven' }] }])
    ];
    const row = sub(buildRecommendationPage({ providers }), 'foryou:song');
    expect(row.items).toHaveLength(1);
    expect(row.items[0]).toMatchObject({ id: 'l1', resolverId: 'lastfm', sourceIds: ['lastfm', 'listenbrainz'] });
    expect(row.sources.map(s => s.id)).toEqual(['lastfm', 'listenbrainz']);
  });

  test('a Shuffleupagus duplicate keeps its reason on the merged item', () => {
    const providers = [norm('lastfm', 'Last.fm', [{ items: [{ type: 'album', name: 'Sunbather', artist: 'Deafheaven' }] }])];
    const shuffle = shuffleupagusSection({ albums: [{ title: 'Sunbather', artist: 'Deafheaven', reason: 'peak' }] });
    const row = sub(buildRecommendationPage({ providers, shuffleupagus: shuffle }), 'foryou:album');
    expect(row.items).toHaveLength(1);
    expect(row.items[0]).toMatchObject({ resolverId: 'lastfm', reason: 'peak', sourceIds: ['lastfm', 'shuffleupagus'] });
  });

  test('derived artists join Artists For you with the song provider as source', () => {
    const providers = [norm('lastfm', 'Last.fm', [{ items: [song('a', 'Deafheaven')] }])];
    const row = sub(buildRecommendationPage({ providers }), 'foryou:artist');
    expect(row.items).toHaveLength(1);
    expect(row.items[0]).toMatchObject({ name: 'Deafheaven', derived: true, sourceIds: ['lastfm'] });
    expect(row.sources).toEqual([{ id: 'lastfm', name: 'Last.fm' }]);
    expect(row.blended).toBe(false);
  });

  test('a mixed titled section splits by type and every split shares one pagingKey', () => {
    const providers = [
      norm('lastfm', 'Last.fm', [{ items: [song('a')] }]),
      norm('amazonmusic', 'Amazon Music', [{ id: 's1', title: 'Hot', description: 'd', items: [
        { type: 'playlist', name: 'P', url: 'https://x/p' }, { type: 'album', name: 'Alb', artist: 'X' }
      ] }])
    ];
    const page = buildRecommendationPage({ providers, expandableResolverIds: ['amazonmusic'] });
    const pl = sub(page, 'amazonmusic:s1:playlist');
    const al = sub(page, 'amazonmusic:s1:album');
    expect(pl).toMatchObject({ type: 'playlist', title: 'Hot', description: 'd', pagingKey: 'amazonmusic|s1', canLoadMore: true, resolverId: 'amazonmusic', sectionId: 's1', blended: false });
    expect(al.pagingKey).toBe('amazonmusic|s1');
    expect(pl.items[0].sourceIds).toEqual(['amazonmusic']);
    const albums = page.find(s => s.type === 'album');
    expect(albums.subsections.map(s => s.key)).toEqual(['amazonmusic:s1:album']); // no For you here
    const songs = page.find(s => s.type === 'song');
    expect(songs.subsections[0].key).toBe('foryou:song');
  });

  test('titled rows come after For you in their section', () => {
    const providers = [
      norm('amazonmusic', 'Amazon Music', [{ id: 's1', title: 'Hot', items: [song('t1')] }]),
      norm('lastfm', 'Last.fm', [{ items: [song('a')] }])
    ];
    const songs = buildRecommendationPage({ providers }).find(s => s.type === 'song');
    expect(songs.subsections.map(s => s.key)).toEqual(['foryou:song', 'amazonmusic:s1:song']);
  });

  test('expanded items land only in the split of their type', () => {
    const providers = [norm('amazonmusic', 'Amazon Music', [{ id: 's1', title: 'Hot', nextCursor: 'c0', items: [
      { type: 'playlist', name: 'P', url: 'https://x/p' }, { type: 'album', name: 'Alb', artist: 'X' }
    ] }])];
    const expandedSections = { 'amazonmusic|s1': { nextCursor: 'c1', items: [{ type: 'playlist', name: 'P2', url: 'https://x/p2' }] } };
    const page = buildRecommendationPage({ providers, expandedSections, expandableResolverIds: ['amazonmusic'] });
    expect(names(sub(page, 'amazonmusic:s1:playlist'))).toEqual(['P', 'P2']);
    expect(names(sub(page, 'amazonmusic:s1:album'))).toEqual(['Alb']);
    expect(sub(page, 'amazonmusic:s1:playlist').nextCursor).toBe('c1');
    expect(sub(page, 'amazonmusic:s1:album').nextCursor).toBe('c1');
  });

  test('weekly sections come first among Playlists titled rows, Exploration before Jams', () => {
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
    expect(playlists.subsections.map(s => s.key)).toEqual([
      'foryou:playlist',
      'listenbrainz:weekly-exploration:playlist',
      'listenbrainz:weekly-jams:playlist',
      'amazonmusic:am:playlist'
    ]);
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

    test('drops followed, removed and self, and blends providers round-robin', () => {
      const exclude = { friendKeys: new Set(['lastfm:bob']), selfKeys: new Set(['listenbrainz:me']) };
      const friends = buildRecommendationPage({ similarUsers, exclude }).find(s => s.type === 'friend');
      expect(friends.subsections).toHaveLength(1);
      const row = friends.subsections[0];
      expect(row.items.map(i => i.id)).toEqual(['similar:lastfm:Cy', 'similar:listenbrainz:Ed', 'similar:lastfm:Di']);
      expect(row.items[0]).toMatchObject({ type: 'friend', name: 'Cy', service: 'lastfm', resolverId: 'lastfm', similarity: 0.8, avatarUrl: 'https://a/cy.png', sourceIds: ['lastfm'] });
      expect(row).toMatchObject({ blended: true, title: 'Listen like you' });
      expect(row.sources).toEqual([{ id: 'lastfm', name: 'Last.fm' }, { id: 'listenbrainz', name: 'ListenBrainz' }]);
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
    const row = sub(page, 'foryou:song');

    test('filterSubsectionItems hides an item only when every source is off', () => {
      expect(names(row)).toEqual(['a', 'd', 'both']);
      const out = (off) => filterSubsectionItems(row, new Set(off)).map(i => i.name);
      expect(out(['lastfm'])).toEqual(['d', 'both']);
      expect(out(['lastfm', 'listenbrainz'])).toEqual([]);
      expect(out([])).toEqual(['a', 'd', 'both']);
    });

    test('filterSubsectionItems on one row never touches another', () => {
      const other = { ...row, key: 'x', items: row.items.map(i => ({ ...i })) };
      const before = JSON.stringify(other);
      const kept = filterSubsectionItems(row, new Set(['lastfm', 'listenbrainz']));
      expect(kept).toEqual([]);
      expect(JSON.stringify(other)).toBe(before);
      expect(row.items).toHaveLength(3);
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
    expect(out.weeklyExploration.map(e => e.id)).toEqual(['e1', 'e2']);
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
    const prev = { weeklyJams: null, weeklyExploration: [{ ...first.weeklyExploration[0], tracks: [{ id: 't' }], tracksLoaded: true }] };
    const out = weeklyHomeEntries(page(), prev);
    expect(out.weeklyExploration).not.toBe(prev.weeklyExploration);
    expect(out.weeklyExploration[0]).toBe(prev.weeklyExploration[0]);
    expect(out.weeklyExploration[1].tracksLoaded).toBe(false);
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

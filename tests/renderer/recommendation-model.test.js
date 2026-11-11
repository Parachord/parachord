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
  buildRecommendationSections,
  shuffleupagusSection
} = require('../../src/renderer/lib/recommendation-model');
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

describe('buildRecommendationSections', () => {
  const providers = [
    {
      resolverId: 'amazonmusic', resolverName: 'Amazon Music', sections: [
        { title: 'Albums for You', id: 'uri:///rec/albums', items: [
          { type: 'album', id: 'a1', name: 'Tempelschlaf', artist: 'The Ruins Of Beverast' }
        ] },
        { title: 'Your Frequent Plays', id: 'uri:///rec/frequent', items: [
          { type: 'song', id: 's1', name: 'Doberman', artist: 'Deafheaven', duration: 394 },
          { type: 'artist', id: 'ar1', name: 'Deafheaven' }
        ] }
      ]
    },
    {
      resolverId: 'lastfm', resolverName: 'Last.fm', sections: [
        { items: [
          { type: 'song', id: 'l1', name: 'Doberman', artist: 'Deafheaven' },
          { type: 'song', id: 'l2', name: 'Dream House', artist: 'Deafheaven' }
        ] }
      ]
    }
  ];

  test('generic buckets first, then titled sections in provider order; songs dedupe across providers; artists derived from generic songs', () => {
    const sections = buildRecommendationSections({ providers });
    expect(sections.map(s => s.key)).toEqual([
      'generic:artist', 'generic:song',
      'amazonmusic:uri:///rec/albums', 'amazonmusic:uri:///rec/frequent'
    ]);
    const songBucket = sections.find(s => s.key === 'generic:song');
    // Provider order: lastfm answered second but its generic songs were the
    // only ones — the deduped bucket keeps first-appearance order.
    expect(songBucket.items.map(i => i.id)).toEqual(['l1', 'l2']);
    expect(songBucket.items).toHaveLength(2);
    const artistBucket = sections.find(s => s.key === 'generic:artist');
    expect(artistBucket.items.map(i => i.name)).toEqual(['Deafheaven']); // derived from generic songs
  });

  test('a titled section keeps provider identity and canLoadMore only for expandable resolvers with a section id', () => {
    const sections = buildRecommendationSections({ providers, expandableResolverIds: ['amazonmusic'] });
    const frequent = sections.find(s => s.key === 'amazonmusic:uri:///rec/frequent');
    expect(frequent).toMatchObject({
      resolverId: 'amazonmusic',
      resolverName: 'Amazon Music',
      sectionId: 'uri:///rec/frequent',
      title: 'Your Frequent Plays',
      canLoadMore: true
    });
    const noExpand = buildRecommendationSections({ providers, expandableResolverIds: [] });
    expect(noExpand.find(s => s.key === 'amazonmusic:uri:///rec/frequent').canLoadMore).toBe(false);
  });

  test('expanded items merge into their section and keep the cursor', () => {
    const expandedSections = {
      'amazonmusic|uri:///rec/albums': {
        items: [{ type: 'album', id: 'a2', name: 'Sunbather', artist: 'Deafheaven' }],
        nextCursor: 'albumsStrategy.20'
      }
    };
    const sections = buildRecommendationSections({ providers, expandableResolverIds: ['amazonmusic'], expandedSections });
    const albums = sections.find(s => s.key === 'amazonmusic:uri:///rec/albums');
    expect(albums.items.map(i => i.id)).toEqual(['a1', 'a2']);
    expect(albums.nextCursor).toBe('albumsStrategy.20');
  });

  test('the shuffleupagus section renders last, after titled sections', () => {
    const shuffle = shuffleupagusSection({
      albums: [{ title: 'Sunbather', artist: 'Deafheaven', reason: 'because' }],
      artists: [{ name: 'Anathema', reason: 'why' }]
    });
    const sections = buildRecommendationSections({ providers: [], shuffleupagus: shuffle });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: 'shuffleupagus:Shuffleupagus', title: 'Shuffleupagus', resolverId: 'shuffleupagus' });
    expect(sections[0].items.map(i => i.type)).toEqual(['album', 'artist']);
  });

  test('no providers and no shuffleupagus → empty array', () => {
    expect(buildRecommendationSections({})).toEqual([]);
    expect(buildRecommendationSections({ providers: [{ resolverId: 'x', sections: [] }] })).toEqual([]);
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

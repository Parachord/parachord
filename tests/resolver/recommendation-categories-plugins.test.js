/**
 * Plugins that send a recommended-playlist category on their
 * getRecommendations sections (Amazon Music, ListenBrainz).
 */
const fs = require('fs');
const path = require('path');

const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins/${name}.axe`), 'utf8'));

describe('Amazon Music sends playlist categories', () => {
  afterEach(() => { delete global.window; });

  // #1356 M8: the recommendations run in the plugin against the webSession
  // bridge — the categories are driven through the real getRecommendations
  // flow (a home walk whose sections are the fixture below; the synthesis
  // answers nothing, so the home sections stand alone).
  const { loadAmazonAxe, instantiateAmazonPlugin, amazonRecommendationsMock, amazonMusicHomeData, amazonSeeMoreData } = require('../helpers/amazon-plugin-bridge');
  const axe = loadAmazonAxe();

  const album = (artist) => ({ __typename: 'Album', id: 'A' + Math.random(), title: 'An Album', shortTitle: 'An Album', images: [], url: 'https://music.amazon.com/albums/A1', contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: artist } }] } });
  const pl = { __typename: 'Playlist', id: 'PP1', title: 'A Mix', images: [], url: 'https://music.amazon.com/playlists/PP1' };
  const base = 'uri:///recommendations/browse-home/browse-home_';
  const section = (id, title, items) => ({ id: base + id, name: title, recommendedContent: { edges: items.map(node => ({ node })) } });

  const runAmazon = async (sections) => {
    amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData(sections),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    return { axe, sections: out.sections };
  };

  test('Amazon maps its playlist strategies', async () => {
    const item = album('X');
    const { sections } = await runAmazon([
      section('playlistStrategy', 'Playlists for You', [pl]),
      section('mp3CommunityPlaylistsStrategy', 'Community', [pl]),
      section('mp3PrimeAlbumsStrategy', 'Albums for You', [item]),
      section('mp3OtherShelfStrategy', 'Something else', [item])
    ]);
    expect(sections.map(s => s.category)).toEqual(['personal', 'community', 'personal', undefined]);
    expect(sections[3].category).toBeUndefined();
    expect(sections[3].seedArtist).toBeUndefined();
  });

  test('Amazon maps its album strategies', async () => {
    const { sections } = await runAmazon([
      section('mp3YmlRecentPlaybackStrategy', 'Recent', [album('X')]),
      section('mp3PrimeAlbumsStrategy', 'Prime', [album('Y')]),
      section('mp3ByArtistStrategy', 'Because you like FIDLAR', [album('FIDLAR'), album(' fidlar ')])
    ]);
    expect(sections.map(s => s.category)).toEqual(['personal', 'personal', 'artist']);
    expect(sections[0].seedArtist).toBeUndefined();
    expect(sections[1].seedArtist).toBeUndefined();
    expect(sections[2].seedArtist).toBe('FIDLAR');
    expect(axe.manifest.version).toBe('1.21.1');
  });

  test('Amazon files its other shelves too, and drops only Featured', async () => {
    // #1491: every shelf but "Featured This Week", each under a category —
    // a UUID shelf titled "Recently Played" is personal, the other UUID and
    // GET_STARTED shelves are editorial, and a title starting "Featured"
    // (even "  featured artists  ") is dropped.
    const editorial = 'uri:///recommendations/browse-home/';
    const byId = (id, title, items) => ({ id, name: title, recommendedContent: { edges: items.map(node => ({ node })) } });
    const { sections } = await runAmazon([
      byId('uri:///recommendations/music-home/music-home_mp3YourHeaviestListeningStrategy', 'Your Frequent Plays', [album('X')]),
      byId('uri:///recommendations/music-home/music-home_newReleasesForYouStrategy', 'New Releases for You', [album('Y')]),
      byId(base + 'mp3GenreForYouStrategy', 'Soundtracks', [album('Z')]),
      byId(editorial + 'f5c621d6-7ba8-4d44-9e72-433921bb5203', 'Recently Played', [album('W')]),
      byId(editorial + '6a0d8250-d85c-42c0-868a-01dc91991473', 'Top Playlists', [album('V')]),
      byId(editorial + 'GET_STARTED', "Let's Get Started", [album('U')]),
      byId(editorial + '3cdd6257-e173-4d3b-bd27-e5e7b400492e', 'Featured This Week', [album('T')]),
      byId(editorial + '11111111-2222-3333-4444-555555555555', '  featured artists  ', [album('S')])
    ]);
    expect(sections.map(s => [s.title, s.category])).toEqual([
      ['Your Frequent Plays', 'personal'],
      ['New Releases for You', 'new'],
      ['Soundtracks', 'editorial'],
      ['Recently Played', 'personal'],
      ['Top Playlists', 'editorial'],
      ["Let's Get Started", 'editorial']
    ]);
  });

  test('Amazon artist shelf with blank artists has no seed', async () => {
    const { sections } = await runAmazon([
      section('mp3ByArtistStrategy', 'Because you like someone', [album(''), album('   ')])
    ]);
    expect(sections[0].category).toBe('artist');
    expect(sections[0].seedArtist).toBeUndefined();
  });

  test('Amazon artist shelf with mixed artists has no seed', async () => {
    const { sections } = await runAmazon([
      section('mp3ByArtistStrategy', 'Because you like FIDLAR', [album('FIDLAR'), album('Wavves')])
    ]);
    expect(sections[0].category).toBe('artist');
    expect(sections[0].seedArtist).toBeUndefined();
  });
});

describe('ListenBrainz sends playlist categories', () => {
  afterEach(() => { delete global.fetch; });

  test('ListenBrainz weekly sections are personal', async () => {
    const axe = load('listenbrainz');
    const entry = (id, title) => ({ playlist: { identifier: `https://listenbrainz.org/playlist/${id}`, title, date: new Date().toISOString() } });
    const list = [entry('e1', 'Weekly Exploration for someone'), entry('j1', 'Weekly Jams for someone')];
    global.fetch = jest.fn(async (url) => {
      if (url.includes('/playlists/createdfor') || url.includes('/playlists/recommendations')) return { ok: true, status: 200, json: async () => ({ playlists: list }) };
      return { ok: true, status: 200, json: async () => ({ playlist: { track: [] } }) };
    });
    const getRecommendations = new Function('return ' + axe.implementation.getRecommendations)();
    const { sections } = await getRecommendations({ username: 'someone' });
    const weekly = sections.filter(s => s.id === 'weekly-exploration' || s.id === 'weekly-jams');
    expect(weekly).toHaveLength(2);
    expect(weekly.every(s => s.category === 'personal')).toBe(true);
    expect(axe.manifest.version).toBe('1.6.5');
  });
});

describe('Apple Music sends playlist categories', () => {
  afterEach(() => { delete global.window; });

  const pl = (id, name, playlistType) => ({ id, type: 'playlists', attributes: { name, playlistType, url: `https://music.apple.com/us/playlist/x/${id}` } });
  const grp = (id, title, contents) => ({
    id, type: 'personal-recommendation',
    attributes: { kind: 'music-recommendations', title: { stringForDisplay: title } },
    relationships: { contents: { data: contents } }
  });
  const run = async (data) => {
    const axe = load('applemusic');
    global.window = { appleMusicPersonalRecommendations: jest.fn().mockResolvedValue({ data }) };
    const getRecommendations = new Function('return ' + axe.implementation.getRecommendations)();
    return { axe, ...(await getRecommendations({})) };
  };

  test('Apple maps playlistType to category', async () => {
    const { axe, sections } = await run([grp('g1', 'Made for You', [
      pl('p1', 'Chill Mix', 'personal-mix'),
      pl('p2', 'Indie Essentials', 'editorial'),
      pl('p3', 'Fan Picks', 'user-shared'),
      pl('p4', 'Other', 'external'),
      pl('p5', 'Heavy Rotation', 'personal-mix')
    ])]);
    const items = sections.flatMap(s => s.items);
    expect(items.map(i => i.category)).toEqual(['personal', 'editorial', 'community', undefined]);
    expect(axe.manifest.version).toBe('1.5.3');
  });

  test('Apple ignores inherited property names as playlistType', async () => {
    const { sections } = await run([grp('g3', 'Made for You', [pl('p7', 'Odd', 'constructor'), pl('p8', 'Odder', 'toString')])]);
    expect(sections.flatMap(s => s.items).map(i => i.category)).toEqual([undefined, undefined]);
  });

  test('Apple sends no artist category', async () => {
    const { sections } = await run([grp('g2', 'Radiohead Fans Like', [pl('p6', 'Some Picks', 'editorial')])]);
    expect(sections.some(s => s.category === 'artist')).toBe(false);
    expect(sections.flatMap(s => s.items).some(i => i.category === 'artist')).toBe(false);
  });
});

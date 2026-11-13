/**
 * Plugins that send a recommended-playlist category on their
 * getRecommendations sections (Amazon Music, ListenBrainz).
 */
const fs = require('fs');
const path = require('path');

const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins/${name}.axe`), 'utf8'));

describe('Amazon Music sends playlist categories', () => {
  afterEach(() => { delete global.window; });

  test('Amazon maps its playlist strategies', async () => {
    const axe = load('amazonmusic');
    const item = { type: 'playlist', id: 'PP1', name: 'A Mix' };
    const base = 'uri:///recommendations/browse-home/browse-home_';
    global.window = { electron: { amazonMusic: { getRecommendations: jest.fn().mockResolvedValue({ success: true, sections: [
      { id: base + 'playlistStrategy', title: 'Playlists for You', items: [item], nextCursor: 12 },
      { id: base + 'mp3CommunityPlaylistsStrategy', title: 'Community', items: [item] },
      { id: base + 'mp3PrimeAlbumsStrategy', title: 'Albums for You', items: [item] }
    ] }) } } };
    const getRecommendations = new Function('return ' + axe.implementation.getRecommendations)();
    const { sections } = await getRecommendations({});
    expect(sections.map(s => s.category)).toEqual(['personal', 'community', undefined]);
    expect(sections[0].nextCursor).toBe('12');
    expect(axe.manifest.version).toBe('1.11.0');
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
    expect(axe.manifest.version).toBe('1.6.0');
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
    expect(axe.manifest.version).toBe('1.5.0');
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

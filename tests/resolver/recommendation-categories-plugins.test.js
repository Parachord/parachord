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

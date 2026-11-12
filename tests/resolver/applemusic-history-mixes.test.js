/**
 * Apple Music's history mixes (the plugin's getHistoryMixes,
 * capabilities.historyMixes): the personal mixes made from the account's own
 * plays, which getRecommendations leaves off the Recommendations page.
 */
const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/applemusic.axe'), 'utf8'));
const getHistoryMixes = new Function('return ' + axe.implementation.getHistoryMixes)();
const getRecommendations = new Function('return ' + axe.implementation.getRecommendations)();

const artwork = (id) => ({ url: `https://is1-ssl.mzstatic.com/image/thumb/${id}/{w}x{h}bb.{f}`, width: 3000, height: 3000 });
const playlist = (id, name, playlistType, slug) => ({ id, type: 'playlists', attributes: { name, playlistType, url: `https://music.apple.com/us/playlist/${slug}/${id}`, artwork: artwork(id) } });
const group = (id, title, contents) => ({
  id, type: 'personal-recommendation',
  attributes: { kind: 'music-recommendations', title: { stringForDisplay: title } },
  relationships: { contents: { data: contents } }
});
const body = {
  data: [
    group('g1', 'Playlists Made for You', [
      playlist('pl.pm-1', 'Heavy Rotation', 'personal-mix', 'heavy-rotation'),
      playlist('pl.rp-1', 'Replay 2026', 'replay', 'replay-2026'),
      playlist('pl.pm-3', 'Chill Mix', 'personal-mix', 'chill-mix')
    ])
  ]
};

describe('Apple Music history mixes (capabilities.historyMixes)', () => {
  afterEach(() => { delete global.window; });

  test('the manifest declares the capability', () => {
    expect(axe.capabilities.historyMixes).toBe(true);
    expect(typeof axe.implementation.getHistoryMixes).toBe('string');
  });

  test('Heavy Rotation and Replay are mixes, Chill Mix is not', async () => {
    global.window = { appleMusicPersonalRecommendations: jest.fn().mockResolvedValue(body) };
    const { mixes } = await getHistoryMixes({});
    expect(mixes.map(m => m.id)).toEqual(['applemusic-playlist-pl.pm-1', 'applemusic-playlist-pl.rp-1']);
    expect(mixes[0]).toEqual({
      type: 'playlist',
      id: 'applemusic-playlist-pl.pm-1',
      name: 'Heavy Rotation',
      imageUrl: 'https://is1-ssl.mzstatic.com/image/thumb/pl.pm-1/600x600bb.jpg',
      url: 'https://music.apple.com/us/playlist/heavy-rotation/pl.pm-1'
    });
  });

  test('getRecommendations still leaves those two out and keeps the rest', async () => {
    global.window = { appleMusicPersonalRecommendations: jest.fn().mockResolvedValue(body) };
    const { sections } = await getRecommendations({});
    const ids = sections.flatMap(s => s.items.map(i => i.id));
    expect(ids).toEqual(['applemusic-playlist-pl.pm-3']);
  });

  test('a host without the hook answers no mixes', async () => {
    global.window = {};
    expect(await getHistoryMixes({})).toEqual({ mixes: [] });
    delete global.window;
    expect(await getHistoryMixes({})).toEqual({ mixes: [] });
  });

  test('a refused sign-in is rethrown with notReady', async () => {
    const err = Object.assign(new Error('not signed in'), { notReady: true });
    global.window = { appleMusicPersonalRecommendations: jest.fn().mockRejectedValue(err) };
    await expect(getHistoryMixes({})).rejects.toMatchObject({ notReady: true });
  });
});

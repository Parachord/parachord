/**
 * Apple Music's personal recommendations (the plugin's getRecommendations,
 * capabilities.recommendations). The fixture follows the shape of a live
 * /v1/me/recommendations answer (2026-11-12): groups of
 * { type: 'personal-recommendation', attributes: { kind, title: { stringForDisplay },
 * isGroupRecommendation, resourceTypes, nextUpdateDate }, relationships: { contents } }.
 */
const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/applemusic.axe'), 'utf8'));
const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

function instantiate(axeContent) {
  const { manifest, capabilities, implementation } = axeContent;
  const resolver = {
    id: manifest.id,
    name: manifest.name,
    capabilities,
    ...Object.fromEntries(Object.entries(implementation).map(([k, src]) => [k, new Function('return ' + src)()]))
  };
  for (const key of Object.keys(implementation)) {
    const original = resolver[key];
    resolver[key] = function (...args) { return original.call(resolver, ...args); };
  }
  return resolver;
}

const artwork = (id) => ({ url: `https://is1-ssl.mzstatic.com/image/thumb/${id}/{w}x{h}bb.{f}`, width: 3000, height: 3000 });
const album = (id, name, artistName, releaseDate) => ({ id, type: 'albums', attributes: { name, artistName, releaseDate, url: `https://music.apple.com/us/album/x/${id}`, artwork: artwork(id), isSingle: false } });
const playlist = (id, name, playlistType = 'editorial', slug = 'x') => ({ id, type: 'playlists', attributes: { name, curatorName: 'Apple Music', playlistType, url: `https://music.apple.com/us/playlist/${slug}/${id}`, artwork: artwork(id) } });
const station = (id, name) => ({ id, type: 'stations', attributes: { name, url: `https://music.apple.com/us/station/x/${id}`, artwork: artwork(id), isLive: false } });
const group = (id, title, contents, extra = {}) => ({
  id, type: 'personal-recommendation',
  attributes: { kind: 'music-recommendations', title: { stringForDisplay: title }, isGroupRecommendation: false, resourceTypes: [...new Set(contents.map(c => c.type))], ...extra },
  relationships: { contents: { data: contents } }
});

const answer = {
  data: [
    group('6-27s5hU6azhJY', 'Playlists Made for You', [
      playlist('pl.pm-1', 'Heavy Rotation', 'personal-mix', 'heavy-rotation'),
      playlist('pl.pm-2', 'Your Essentials', 'personal-mix', 'your-essentials'),
      playlist('pl.pm-3', 'Chill', 'personal-mix', 'chill'),
      playlist('pl.pm-4', 'Favorites Mix', 'personal-mix', 'favorites-mix'),
      playlist('pl.pm-5', 'Get Up!', 'personal-mix', 'get-up'),
      playlist('pl.rp-1', 'Replay 2026', 'replay', 'replay-2026')
    ]),
    group('6-history-only', 'Your Mixes', [playlist('pl.pm-6', 'Heavy Rotation Mix', 'personal-mix', 'heavy-rotation-mix')]),
    group('6-editorial', 'Editors', [playlist('pl.7', 'Favorites', 'editorial', 'favorites')]),
    group('6-recent', 'Recently Played', [album('100', 'It Goes On', 'Westside Cowboy', '2026-08-21')], { kind: 'recently-played' }),
    group('6-new', 'New Releases for You', [album('200', 'The Holy Cross Tigers', 'Twisted Teens', '2026-11-06'), album('201', 'Upcoming LP', 'Twisted Teens', '2026-12-05')]),
    group('6-stations', 'Stations for You', [station('ra.1', 'Discovery Station')]),
    group('6-mixed', 'I Miss ’90s Indie', [album('300', 'Either/Or', 'Elliott Smith', '1997-02-25'), playlist('pl.3', 'I Miss ’90s Indie'), station('ra.2', 'Indie Station')]),
    {
      id: '6-outer', type: 'personal-recommendation',
      attributes: { kind: 'music-recommendations', title: { stringForDisplay: 'Outer' }, isGroupRecommendation: true },
      relationships: { recommendations: { data: [group('6-inner', 'Inner', [album('400', 'Inner Album', 'Someone', '2020')])] } }
    },
    group('6-songs', 'Songs for You', [{ id: '500', type: 'songs', attributes: { name: 'A Song', artistName: 'Someone', durationInMillis: 201000, isrc: 'USABC2600001', url: 'https://music.apple.com/us/song/x/500', artwork: artwork('500') } }]),
    group('6-empty', 'Only Stations', [station('ra.3', 'X Station')])
  ]
};

describe('Apple Music recommendations (capabilities.recommendations)', () => {
  afterEach(() => { delete global.window; });

  test('the manifest declares the capability', () => {
    expect(axe.capabilities.recommendations).toBe(true);
    expect(typeof axe.implementation.getRecommendations).toBe('string');
  });

  test('Apple\'s groups become titled sections of albums, playlists and songs', async () => {
    const hook = jest.fn().mockResolvedValue(answer);
    global.window = { appleMusicPersonalRecommendations: hook };
    const { sections } = await instantiate(axe).getRecommendations({});
    expect(hook).toHaveBeenCalledWith(30);
    // Recently Played (history) and a stations-only group are left out; a
    // group of groups is flattened.
    // A group left with only play-history mixes goes too.
    expect(sections.map(s => s.title)).toEqual([
      'Playlists Made for You', 'Editors', 'New Releases for You', 'I Miss ’90s Indie', 'Inner', 'Songs for You'
    ]);
    expect(sections.map(s => s.id)).toEqual(['applemusic:6-27s5hU6azhJY', 'applemusic:6-editorial', 'applemusic:6-new', 'applemusic:6-mixed', 'applemusic:6-inner', 'applemusic:6-songs']);
    const mix = sections[0].items[0];
    expect(mix).toEqual({
      type: 'playlist', id: 'applemusic-playlist-pl.pm-3', name: 'Chill',
      imageUrl: 'https://is1-ssl.mzstatic.com/image/thumb/pl.pm-3/600x600bb.jpg',
      url: 'https://music.apple.com/us/playlist/chill/pl.pm-3', category: 'personal'
    });
    sections.splice(1, 1);
    expect(sections[1].items[1]).toEqual({
      type: 'album', id: 'applemusic-album-201', name: 'Upcoming LP', artist: 'Twisted Teens',
      imageUrl: 'https://is1-ssl.mzstatic.com/image/thumb/201/600x600bb.jpg',
      url: 'https://music.apple.com/us/album/x/201', releaseDate: '2026-12-05'
    });
    // Stations never reach a section.
    expect(sections[2].items.map(i => i.type)).toEqual(['album', 'playlist']);
    expect(sections[4].items[0]).toMatchObject({ type: 'song', name: 'A Song', artist: 'Someone', duration: 201, isrc: 'USABC2600001' });
  });

  test('mixes made from what the account plays are left out; discovery mixes stay', async () => {
    global.window = { appleMusicPersonalRecommendations: jest.fn().mockResolvedValue(answer) };
    const { sections } = await instantiate(axe).getRecommendations({});
    const names = sections.flatMap(s => s.items).filter(i => i.type === 'playlist').map(i => i.name);
    // Heavy Rotation, Your Essentials, Favorites Mix and Replay are history.
    expect(names).toEqual(['Chill', 'Get Up!', 'Favorites', 'I Miss ’90s Indie']);
  });

  test('a mix is known by its URL slug when its name is translated', async () => {
    const localized = { data: [group('6-l', 'Für dich', [
      playlist('pl.pm-8', 'Häufig gehört', 'personal-mix', 'heavy-rotation'),
      playlist('pl.pm-9', 'Entspannen', 'personal-mix', 'chill')
    ])] };
    global.window = { appleMusicPersonalRecommendations: jest.fn().mockResolvedValue(localized) };
    const { sections } = await instantiate(axe).getRecommendations({});
    expect(sections[0].items.map(i => i.name)).toEqual(['Entspannen']);
  });

  test('an empty answer is a miss', async () => {
    global.window = { appleMusicPersonalRecommendations: jest.fn().mockResolvedValue({ data: [] }) };
    await expect(instantiate(axe).getRecommendations({})).resolves.toEqual({ sections: [] });
  });

  test('a host without the hook is a quiet empty provider', async () => {
    global.window = {};
    await expect(instantiate(axe).getRecommendations({})).resolves.toEqual({ sections: [] });
  });

  test('a refused or missing sign-in is rethrown as notReady, never answered as a miss', async () => {
    const refused = Object.assign(new Error('Apple Music refused the sign-in (HTTP 403)'), { notReady: true, code: 'token-refused' });
    global.window = { appleMusicPersonalRecommendations: jest.fn().mockRejectedValue(refused) };
    await expect(instantiate(axe).getRecommendations({})).rejects.toBe(refused);
  });
});

describe('the host hook (window.appleMusicPersonalRecommendations)', () => {
  const hook = app.slice(app.indexOf('window.appleMusicPersonalRecommendations = async'), app.indexOf('// MusicKit-enabled Apple Music search wrapper'));

  test('asks only /v1/me/recommendations, with the developer token and the app\'s user token of record', () => {
    expect(hook).toContain('const url = `https://api.music.apple.com/v1/me/recommendations?limit=${n}`;');
    expect(hook).toContain("headers: { Authorization: `Bearer ${developerToken}`, 'Music-User-Token': userToken }");
    expect(hook).toContain('let userToken = localStorage.getItem(AppleMusicUserToken.APP_TOKEN_KEY) || \'\';');
    // Never a general proxy: no path parameter.
    expect(hook).toMatch(/window\.appleMusicPersonalRecommendations = async \(limit = 30\) =>/);
  });

  test('a refusal adopts another stored token Apple accepts once, else throws notReady', () => {
    expect(hook).toContain('const check = await checkAppleMusicUserToken(developerToken);');
    expect(hook).toContain("throw notReady('token-refused'");
    expect(hook).toContain("throw notReady('not-signed-in'");
    expect(hook).toContain("throw notReady('no-developer-token'");
  });
});

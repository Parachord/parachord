/**
 * A plugin with no album to report leaves `album` out. It used to send its own
 * service name ('SoundCloud', 'YouTube'), which every host took for a real album:
 * it showed in the player and reached scrobbles and album lookups. Found on
 * mobile (parachord-mobile#516).
 */

const fs = require('fs');
const path = require('path');

const PLUGINS_SRC = path.join(__dirname, '../../plugins-src');
const pluginIds = fs.readdirSync(PLUGINS_SRC).filter((id) =>
  fs.existsSync(path.join(PLUGINS_SRC, id, 'implementation.js')));

const soundcloud = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/soundcloud.axe'), 'utf8')).implementation;
const youtube = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/youtube.axe'), 'utf8')).implementation;
const compile = (source) => new Function('return ' + source)();

const reply = (body) => ({ ok: true, json: async () => body, text: async () => body });
const API_TRACK = {
  kind: 'track',
  id: 1,
  title: 'A Song',
  duration: 1000,
  permalink_url: 'https://soundcloud.com/someone/a-song',
  user: { username: 'Someone' },
};

afterEach(() => { delete global.fetch; });

describe('a plugin never names itself as the album', () => {
  const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

  test.each(pluginIds)('%s', (id) => {
    const source = fs.readFileSync(path.join(PLUGINS_SRC, id, 'implementation.js'), 'utf8');
    const literals = [...source.matchAll(/\balbum\s*:\s*(?:[^,\n]*\|\|\s*)?(['"`])(.*?)\1/g)].map((m) => m[2]);
    expect(literals.filter((literal) => normalize(literal) === normalize(id))).toEqual([]);
  });
});

describe('SoundCloud with no album', () => {
  test('search leaves it out', async () => {
    global.fetch = jest.fn(async () => reply([API_TRACK]));
    const [track] = await compile(soundcloud.search)('a song', { token: 't' });
    expect(track.album).toBeUndefined();
  });

  test('a signed-in lookupUrl leaves it out', async () => {
    global.fetch = jest.fn(async () => reply(API_TRACK));
    const track = await compile(soundcloud.lookupUrl)(API_TRACK.permalink_url, { token: 't' });
    expect(track.album).toBeUndefined();
  });

  test('a signed-out lookupUrl leaves it out', async () => {
    global.fetch = jest.fn(async () => reply({
      title: 'A Song by Someone',
      author_name: 'Someone',
      html: '<iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F1"></iframe>',
    }));
    const track = await compile(soundcloud.lookupUrl)(API_TRACK.permalink_url, {});
    expect(track.title).toBe('A Song');
    expect(track.album).toBeUndefined();
  });

  test('lookupPlaylist leaves it out', async () => {
    global.fetch = jest.fn(async () => reply({ title: 'A Set', tracks: [API_TRACK] }));
    const { tracks } = await compile(soundcloud.lookupPlaylist)('https://soundcloud.com/someone/sets/a-set', { token: 't' });
    expect(tracks[0].album).toBeUndefined();
  });

  test('a label name still comes through', async () => {
    global.fetch = jest.fn(async () => reply({ ...API_TRACK, label_name: 'A Label' }));
    const track = await compile(soundcloud.lookupUrl)(API_TRACK.permalink_url, { token: 't' });
    expect(track.album).toBe('A Label');
  });
});

describe('YouTube with no album', () => {
  test('lookupUrl leaves it out', async () => {
    global.fetch = jest.fn(async () => reply({ title: 'Someone - A Song', author_name: 'Someone VEVO' }));
    const track = await compile(youtube.lookupUrl)('https://www.youtube.com/watch?v=abc123def45', {});
    expect(track.title).toBe('A Song');
    expect(track.album).toBeUndefined();
  });
});

describe('apps older than the fix keep the old plugins', () => {
  // Without an album these tracks hit the desktop's old handling: "Single" as
  // the album, and a saved track that stops matching (#1237). That's fixed in
  // 0.9.13, so 0.9.12 stays on the copies it has. The floor is per platform, so
  // mobile still gets them.
  test.each([['soundcloud'], ['youtube']])('%s needs the desktop release with the fix', (id) => {
    const { manifest } = JSON.parse(fs.readFileSync(path.join(PLUGINS_SRC, id, 'manifest.json'), 'utf8'));
    expect(manifest.minAppVersion).toEqual({ desktop: '0.9.13' });
  });
});

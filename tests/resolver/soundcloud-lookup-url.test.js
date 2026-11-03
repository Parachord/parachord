/**
 * SoundCloud lookupUrl: a dropped or pasted soundcloud.com track link.
 *
 * GET /resolve answers with a redirect to /tracks/<id>, and fetch follows it,
 * so the body is the track itself. lookupUrl used to read only the older
 * { location } shape, so every link came back null and the app said
 * "Could not load track metadata".
 */

const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/soundcloud.axe'), 'utf8'));
const lookupUrl = new Function('return ' + axe.implementation.lookupUrl)();

const TRACK = {
  kind: 'track',
  id: 43218785,
  title: 'Desos - House Music (Original Mix)',
  duration: 232029,
  access: 'playable',
  streamable: true,
  permalink_url: 'https://soundcloud.com/desos/housemus-mp3',
  artwork_url: 'https://i1.sndcdn.com/artworks-abc-large.jpg',
  user: { username: 'Desos' },
};

const reply = (body, ok = true) => ({ ok, json: async () => body });

afterEach(() => { delete global.fetch; });

describe('SoundCloud lookupUrl', () => {
  test('reads the track when /resolve redirects straight to it', async () => {
    global.fetch = jest.fn(async () => reply(TRACK));
    const result = await lookupUrl(TRACK.permalink_url, { token: 't' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: 'soundcloud-43218785',
      title: TRACK.title,
      artist: 'Desos',
      duration: 232,
      soundcloudId: 43218785,
      soundcloudUrl: TRACK.permalink_url,
      albumArt: 'https://i1.sndcdn.com/artworks-abc-t500x500.jpg',
      limitedPlayback: false,
    });
  });

  test('still follows the older { location } reply', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(reply({ status: '302 - Found', location: 'https://api.soundcloud.com/tracks/soundcloud:tracks:43218785' }))
      .mockResolvedValueOnce(reply(TRACK));
    const result = await lookupUrl(TRACK.permalink_url, { token: 't' });
    expect(global.fetch.mock.calls[1][0]).toBe('https://api.soundcloud.com/tracks/43218785');
    expect(result.soundcloudId).toBe(43218785);
  });

  test('a link that is not a track (a user or a playlist) is not one', async () => {
    global.fetch = jest.fn(async () => reply({ kind: 'playlist', id: 1, tracks: [] }));
    expect(await lookupUrl('https://soundcloud.com/desos/sets/x', { token: 't' })).toBeNull();
  });

  test('a failed resolve, or no sign-in, is null', async () => {
    global.fetch = jest.fn(async () => reply({}, false));
    expect(await lookupUrl(TRACK.permalink_url, { token: 't' })).toBeNull();
    global.fetch = jest.fn();
    expect(await lookupUrl(TRACK.permalink_url, {})).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

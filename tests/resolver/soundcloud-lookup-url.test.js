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

  test('a failed resolve is null', async () => {
    global.fetch = jest.fn(async () => reply({}, false));
    expect(await lookupUrl(TRACK.permalink_url, { token: 't' })).toBeNull();
  });
});

// Without a sign-in, the public oEmbed endpoint describes the link (#1217).
// Shapes copied from live replies on 2026-11-03.
describe('SoundCloud lookupUrl without a sign-in (oEmbed)', () => {
  const PERMALINK = 'https://soundcloud.com/flume/never-be-like-you-feat-kai';
  const embedFor = (kind, id) => '<iframe width="100%" height="400" scrolling="no" frameborder="no" allow="autoplay; encrypted-media" '
    + `src="https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2F${kind}%2F${id}&show_artwork=true"></iframe>`;
  const OEMBED = {
    version: 1.0,
    type: 'rich',
    provider_name: 'SoundCloud',
    title: 'Never Be Like You feat. Kai by Flume',
    thumbnail_url: 'https://i1.sndcdn.com/artworks-000143264206-mtz96c-t500x500.jpg',
    html: embedFor('tracks', 242136202),
    author_name: 'Flume',
    author_url: 'https://soundcloud.com/flume',
  };

  test('builds the track from the embed, asking without credentials', async () => {
    global.fetch = jest.fn(async () => reply(OEMBED));
    const result = await lookupUrl(`${PERMALINK}?si=abc&utm_source=clipboard`, {});
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [requested, options] = global.fetch.mock.calls[0];
    expect(requested).toBe(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(PERMALINK)}`);
    expect(options).toBeUndefined();
    expect(result).toEqual({
      id: 'soundcloud-242136202',
      title: 'Never Be Like You feat. Kai',
      artist: 'Flume',
      sources: ['soundcloud'],
      soundcloudId: 242136202,
      soundcloudUrl: PERMALINK,
      albumArt: OEMBED.thumbnail_url,
    });
  });

  test('keeps a title that does not end with the uploader', async () => {
    global.fetch = jest.fn(async () => reply({ ...OEMBED, title: 'Never Be Like You' }));
    expect((await lookupUrl(PERMALINK, {})).title).toBe('Never Be Like You');
  });

  test('a set or a user page is not a track', async () => {
    global.fetch = jest.fn(async () => reply({ ...OEMBED, title: 'SKIN by Flume', html: embedFor('playlists', 1) }));
    expect(await lookupUrl('https://soundcloud.com/flume/sets/skin', {})).toBeNull();
    global.fetch = jest.fn(async () => reply({ ...OEMBED, title: 'Flume', html: embedFor('users', 2976616) }));
    expect(await lookupUrl('https://soundcloud.com/flume', {})).toBeNull();
  });

  test('a link oEmbed does not know (404), or a network error, is null', async () => {
    global.fetch = jest.fn(async () => reply(null, false));
    expect(await lookupUrl('https://soundcloud.com/nope/nothing', {})).toBeNull();
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect(await lookupUrl(PERMALINK, {})).toBeNull();
  });
});

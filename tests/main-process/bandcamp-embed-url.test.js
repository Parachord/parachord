// Which embed URLs the main process will load, and how it finds one from a
// track's Bandcamp page. Everything here decides what a renderer message can
// make the app load, so anything that isn't plainly a Bandcamp track is refused.
const {
  bandcampEmbedUrl, isBandcampEmbedUrl, isBandcampTrackPage, resolveBandcampEmbedUrl
} = require('../../main-process/bandcamp-embed-url');

const TRACK_URL = 'https://bandcamp.com/EmbeddedPlayer/track=123/size=large/bgcol=333333/linkcol=ffffff/tracklist=false/artwork=small/transparent=true/';

describe('bandcampEmbedUrl', () => {
  test('a track id makes a single-track embed, never one that could run on through an album', () => {
    expect(bandcampEmbedUrl(123)).toBe(TRACK_URL);
    expect(bandcampEmbedUrl('123')).toBe(TRACK_URL);
    expect(bandcampEmbedUrl(123)).not.toContain('album=');
  });
  test.each([[null], [undefined], [''], [0], [-1], ['12/../evil'], ['abc'], [1.5], [{}]])('refuses %p', (id) => {
    expect(bandcampEmbedUrl(id)).toBeNull();
  });
});

describe('isBandcampEmbedUrl', () => {
  test('accepts exactly what bandcampEmbedUrl builds', () => {
    expect(isBandcampEmbedUrl(TRACK_URL)).toBe(true);
  });
  test.each([
    ['https://evil.example/EmbeddedPlayer/track=123/'],
    ['https://bandcamp.com.evil.example/EmbeddedPlayer/track=123/'],
    ['http://bandcamp.com/EmbeddedPlayer/track=123/size=large/bgcol=333333/linkcol=ffffff/tracklist=false/artwork=small/transparent=true/'],
    ['https://bandcamp.com/EmbeddedPlayer/album=9/size=large/'],
    [`${TRACK_URL}?x=1`],
    ['about:blank'],
    [null]
  ])('refuses %p', (url) => {
    expect(isBandcampEmbedUrl(url)).toBe(false);
  });
});

describe('isBandcampTrackPage', () => {
  test('a track page on a bandcamp.com subdomain', () => {
    expect(isBandcampTrackPage('https://artist.bandcamp.com/track/a-song')).toBe(true);
  });
  test.each([
    ['https://artist.bandcamp.com/album/a-record'], // not one track
    ['http://artist.bandcamp.com/track/a-song'],
    ['https://artist.bandcamp.com.evil.example/track/a-song'],
    ['https://evil.example/track/a-song'],
    ['https://localhost/track/a-song'],
    ['https://user@artist.bandcamp.com/track/a-song'],
    ['not a url'],
    [null]
  ])('refuses %p', (url) => {
    expect(isBandcampTrackPage(url)).toBe(false);
  });
});

describe('resolveBandcampEmbedUrl', () => {
  const page = 'https://artist.bandcamp.com/track/a-song';
  const json = (body) => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
  const html = (current) => ({
    ok: true,
    text: async () => `<script data-tralbum="${JSON.stringify({ current }).replace(/"/g, '&quot;')}"></script>`,
    json: async () => { throw new Error('not json'); }
  });

  test('a known track id needs no network at all', async () => {
    const fetch = jest.fn();
    await expect(resolveBandcampEmbedUrl({ bandcampUrl: page, bandcampTrackId: 123 }, { fetch })).resolves.toBe(TRACK_URL);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('otherwise the search API finds the id by the page URL', async () => {
    const fetch = jest.fn(async () => json({ results: [
      { id: 7, url: 'https://other.bandcamp.com/track/another' },
      { id: 123, url: page }
    ] }));
    await expect(resolveBandcampEmbedUrl({ bandcampUrl: page }, { fetch })).resolves.toBe(TRACK_URL);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('the search API doubling a URL still matches', async () => {
    const fetch = jest.fn(async () => json({ results: [{ id: 123, url: 'https://artist.bandcamp.comhttps://artist.bandcamp.com/track/a-song' }] }));
    await expect(resolveBandcampEmbedUrl({ bandcampUrl: page }, { fetch })).resolves.toBe(TRACK_URL);
  });

  test('a search hit with the same slug on another artist does not count', async () => {
    const fetch = jest.fn(async (url) => (String(url).includes('app_autocomplete')
      ? json({ results: [{ id: 7, url: 'https://other.bandcamp.com/track/a-song' }] })
      : html({ type: 'track', id: 123 })));
    await expect(resolveBandcampEmbedUrl({ bandcampUrl: page }, { fetch })).resolves.toBe(TRACK_URL);
  });

  test('then the page itself', async () => {
    const fetch = jest.fn(async (url) => (String(url).includes('app_autocomplete')
      ? json({ results: [] })
      : html({ type: 'track', id: 123, album_id: 9 })));
    await expect(resolveBandcampEmbedUrl({ bandcampUrl: page }, { fetch })).resolves.toBe(TRACK_URL);
    expect(fetch.mock.calls[1][0]).toBe(page);
  });

  test('an album page, or a page that is not Bandcamp, is never fetched', async () => {
    const fetch = jest.fn();
    await expect(resolveBandcampEmbedUrl({ bandcampUrl: 'https://artist.bandcamp.com/album/a-record' }, { fetch })).resolves.toBeNull();
    await expect(resolveBandcampEmbedUrl({ bandcampUrl: 'http://192.168.1.1/track/x' }, { fetch })).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a page that turns out to be an album is not a track', async () => {
    const fetch = jest.fn(async (url) => (String(url).includes('app_autocomplete')
      ? json({ results: [] })
      : html({ type: 'album', id: 9 })));
    await expect(resolveBandcampEmbedUrl({ bandcampUrl: page }, { fetch })).resolves.toBeNull();
  });

  test('network failures are a miss, not a throw', async () => {
    const fetch = jest.fn(async () => { throw new Error('offline'); });
    await expect(resolveBandcampEmbedUrl({ bandcampUrl: page }, { fetch })).resolves.toBeNull();
  });
});

/**
 * iTunes → Deezer catalog art fallback (album-art-catalog.js), the tail of
 * the shared album-art pipeline. Ported from Achordion with one addition:
 * a hit must name the artist and the album/track we asked for.
 */

const {
  nameMatch,
  getItunesAlbumArtwork, getItunesTrackArtwork,
  getDeezerAlbumArtwork, getDeezerTrackArtwork,
  getCatalogAlbumArtwork, getCatalogTrackArtwork,
} = require('../../album-art-catalog');

const ok = (body) => async () => ({ ok: true, json: async () => body });
const status = (code) => async () => ({ ok: false, status: code, json: async () => ({}) });
const boom = async () => { throw new TypeError('Failed to fetch'); };

// Real-shaped iTunes answer for "Lustmord Black Star": a different album by the same artist.
const itunesWrongAlbum = { resultCount: 1, results: [{ artistName: 'Lustmord', collectionName: 'The Place Where the Black Stars Hang', artworkUrl100: 'https://a.mzstatic.com/x/100x100bb.jpg' }] };
const itunesRight = { resultCount: 2, results: [
  { artistName: 'Someone Else', collectionName: 'Black Star', artworkUrl100: 'https://a.mzstatic.com/wrong/100x100bb.jpg' },
  { artistName: 'Lustmord', collectionName: 'Black Star', artworkUrl100: 'https://a.mzstatic.com/right/100x100bb.jpg' },
] };
const deezerRight = { data: [{ title: 'Black Star', artist: { name: 'Lustmord' }, cover_big: 'https://cdn-images.dzcdn.net/big.jpg', cover_medium: 'https://cdn-images.dzcdn.net/med.jpg' }] };

describe('nameMatch', () => {
  test('normalizes case and punctuation and allows containment either way', () => {
    expect(nameMatch('Black Star (Remastered)', 'black star')).toBe(true);
    expect(nameMatch('Beatles', 'The Beatles')).toBe(true);
    expect(nameMatch('Lustmord', 'Lustmord')).toBe(true);
  });
  test('rejects empty and unrelated names', () => {
    expect(nameMatch('', 'x')).toBe(false);
    expect(nameMatch('The Place Where the Black Stars Hang', 'Black Star')).toBe(false);
  });
});

describe('iTunes', () => {
  test('rejects a top hit for the wrong album by the right artist', async () => {
    expect(await getItunesAlbumArtwork('Lustmord', 'Black Star', { fetchItunes: ok(itunesWrongAlbum) })).toBeNull();
  });
  test('picks the first result naming both artist and album, upsized to 500px', async () => {
    const calls = [];
    const fetchItunes = async (url) => { calls.push(url); return { ok: true, json: async () => itunesRight }; };
    expect(await getItunesAlbumArtwork('Lustmord', 'Black Star', { fetchItunes })).toBe('https://a.mzstatic.com/right/500x500bb.jpg');
    expect(calls[0]).toBe('https://itunes.apple.com/search?term=Lustmord+Black+Star&entity=album&limit=5');
  });
  test('track variant matches artistName + trackName', async () => {
    const body = { results: [{ artistName: 'Lustmord', trackName: 'Black Star', artworkUrl100: 'https://a/100x100bb.jpg' }] };
    expect(await getItunesTrackArtwork('Lustmord', 'Black Star', { fetchItunes: ok(body) })).toBe('https://a/500x500bb.jpg');
    expect(await getItunesTrackArtwork('Lustmord', 'Other', { fetchItunes: ok(body) })).toBeNull();
  });
  test('fails soft on HTTP errors, thrown fetches and missing fetch', async () => {
    expect(await getItunesAlbumArtwork('A', 'B', { fetchItunes: status(429) })).toBeNull();
    expect(await getItunesAlbumArtwork('A', 'B', { fetchItunes: boom })).toBeNull();
    expect(await getItunesAlbumArtwork('A', 'B', {})).toBeNull();
    expect(await getItunesAlbumArtwork('', 'B', { fetchItunes: ok(itunesRight) })).toBeNull();
  });
});

describe('Deezer', () => {
  test('album search uses the field query, matches artist + title, prefers cover_big', async () => {
    const calls = [];
    const fetchDeezer = async (url) => { calls.push(url); return { ok: true, json: async () => deezerRight }; };
    expect(await getDeezerAlbumArtwork('Lustmord', 'Black Star', { fetchDeezer })).toBe('https://cdn-images.dzcdn.net/big.jpg');
    expect(decodeURIComponent(calls[0]).replace(/\+/g, ' ')).toBe('https://api.deezer.com/search/album?q=artist:"Lustmord" album:"Black Star"&limit=5');
  });
  test('strips quotes from the field query and rejects wrong-artist hits', async () => {
    const calls = [];
    const fetchDeezer = async (url) => { calls.push(url); return { ok: true, json: async () => ({ data: [{ title: 'Black Star', artist: { name: 'Nobody' }, cover_big: 'x' }] }) }; };
    expect(await getDeezerAlbumArtwork('Lust"mord', 'Black Star', { fetchDeezer })).toBeNull();
    expect(decodeURIComponent(calls[0])).not.toContain('Lust"mord');
  });
  test('track variant takes the matched track\'s album cover', async () => {
    const body = { data: [{ title: 'Black Star', artist: { name: 'Lustmord' }, album: { cover_medium: 'https://d/med.jpg' } }] };
    expect(await getDeezerTrackArtwork('Lustmord', 'Black Star', { fetchDeezer: ok(body) })).toBe('https://d/med.jpg');
  });
});

describe('chain', () => {
  test('Deezer is only asked when iTunes misses', async () => {
    const deezer = jest.fn(ok(deezerRight));
    expect(await getCatalogAlbumArtwork('Lustmord', 'Black Star', { fetchItunes: ok(itunesRight), fetchDeezer: deezer })).toMatch(/mzstatic/);
    expect(deezer).not.toHaveBeenCalled();
    expect(await getCatalogAlbumArtwork('Lustmord', 'Black Star', { fetchItunes: ok(itunesWrongAlbum), fetchDeezer: deezer })).toMatch(/dzcdn/);
    expect(deezer).toHaveBeenCalledTimes(1);
  });
  test('both miss: null', async () => {
    expect(await getCatalogAlbumArtwork('A', 'B', { fetchItunes: ok({ results: [] }), fetchDeezer: ok({ data: [] }) })).toBeNull();
    expect(await getCatalogTrackArtwork('A', 'B', { fetchItunes: boom, fetchDeezer: status(500) })).toBeNull();
  });
});

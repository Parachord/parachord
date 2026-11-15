/**
 * Playlists imported by sync carry the service's playlist cover (`coverArt`),
 * as link imports have since #1394: the sync services report it on each
 * playlist, sync:start stores it, and an unchanged playlist whose cover moved
 * is not short-circuited, so existing imports pick theirs up.
 */

const spotify = require('../../sync-providers/spotify');
const applemusic = require('../../sync-providers/applemusic');
const { canShortCircuitPlaylistUpdate } = require('../../sync-engine');

describe('the sync services report a playlist cover', () => {
  test('Spotify: the playlist image', () => {
    const out = spotify.transformPlaylist({ id: 'p1', name: 'Mix', images: [{ url: 'https://i.scdn.co/image/ab67706c' }], owner: { id: 'spotify' } });
    expect(out.coverArt).toBe('https://i.scdn.co/image/ab67706c');
  });

  test("Spotify: its generated mosaic is not a cover (our own mosaic shows those tracks)", () => {
    const out = spotify.transformPlaylist({ id: 'p1', name: 'Mine', images: [{ url: 'https://mosaic.scdn.co/640/ab67616d0000b273aaa' }] });
    expect(out.coverArt).toBeNull();
  });

  test('Spotify: no image is no cover', () => {
    expect(spotify.transformPlaylist({ id: 'p1', name: 'Empty', images: [] }).coverArt).toBeNull();
  });

  test('Apple Music: the artwork at 500px', () => {
    const out = applemusic.transformPlaylist({ id: 'p.1', attributes: { name: 'AM', artwork: { url: 'https://is1.mzstatic.com/x/{w}x{h}bb.jpg' } } });
    expect(out.coverArt).toBe('https://is1.mzstatic.com/x/500x500bb.jpg');
  });

  test('Apple Music: no artwork is no cover', () => {
    expect(applemusic.transformPlaylist({ id: 'p.1', attributes: { name: 'AM' } }).coverArt).toBeNull();
  });
});

describe('canShortCircuitPlaylistUpdate and covers', () => {
  const local = (over = {}) => ({
    id: 'spotify-p1',
    tracks: [{ title: 'T', artist: 'A' }],
    creator: 'me',
    source: 'spotify-import',
    syncedFrom: { resolver: 'spotify', externalId: 'p1', snapshotId: 's1', ownerId: 'o' },
    ...over,
  });
  const remote = (over = {}) => ({ externalId: 'p1', snapshotId: 's1', ownerId: 'o', ownerName: 'me', ...over });

  test('a cover the playlist lacks is worth a full pass', () => {
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local(), remotePlaylist: remote({ coverArt: 'https://img/a.jpg' }), providerId: 'spotify' })).toBe(false);
  });

  test('a cover removed on the service is worth a full pass', () => {
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local({ coverArt: 'https://img/a.jpg' }), remotePlaylist: remote({ coverArt: null }), providerId: 'spotify' })).toBe(false);
  });

  test('the same cover, or a service that reports none, still short-circuits', () => {
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local({ coverArt: 'https://img/a.jpg' }), remotePlaylist: remote({ coverArt: 'https://img/a.jpg' }), providerId: 'spotify' })).toBe(true);
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local({ coverArt: 'https://img/a.jpg' }), remotePlaylist: remote(), providerId: 'spotify' })).toBe(true);
  });
});

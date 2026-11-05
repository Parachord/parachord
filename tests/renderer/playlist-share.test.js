/**
 * Playlist share links (parachord#1084). The share entry points pass a display
 * summary without the playlist's sync fields, so every share of a
 * ListenBrainz-synced playlist ended at "Sync this playlist to ListenBrainz
 * first". The MBID now comes from the stored playlist by id.
 */

const fs = require('fs');
const path = require('path');
const { playlistListenbrainzMbid, playlistShareTarget } = require('../../src/renderer/lib/playlist-share');

const MBID = '0b1f6a7c-1d2e-4f3a-9b8c-7d6e5f4a3b2c';
const playlists = [
  { id: 'playlist-1', title: 'Pushed', syncedTo: { listenbrainz: { externalId: MBID } } },
  { id: 'listenbrainz-x', title: 'Imported', syncedFrom: { resolver: 'listenbrainz', externalId: 'imported-mbid' } },
  { id: 'spotify-y', title: 'Spotify only', syncedFrom: { resolver: 'spotify', externalId: 'sp' } },
];

describe('playlistListenbrainzMbid', () => {
  test('a summary with only an id resolves through the stored playlist', () => {
    expect(playlistListenbrainzMbid({ playlistId: 'playlist-1', title: 'Pushed', type: 'playlist' }, playlists)).toBe(MBID);
    expect(playlistListenbrainzMbid({ id: 'listenbrainz-x' }, playlists)).toBe('imported-mbid');
  });

  test('sync fields on the object itself still win', () => {
    expect(playlistListenbrainzMbid({ syncedTo: { listenbrainz: { externalId: 'own' } }, playlistId: 'playlist-1' }, playlists)).toBe('own');
  });

  test('a playlist not on ListenBrainz, or unknown, has none', () => {
    expect(playlistListenbrainzMbid({ playlistId: 'spotify-y' }, playlists)).toBeNull();
    expect(playlistListenbrainzMbid({ playlistId: 'nope' }, playlists)).toBeNull();
    expect(playlistListenbrainzMbid({ title: 'no id' }, playlists)).toBeNull();
    expect(playlistListenbrainzMbid({ playlistId: 'playlist-1' }, undefined)).toBeNull();
  });
});

describe('wiring', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

  test('publishCollectionSmartLink resolves the MBID through the stored playlists', () => {
    const app = read('src/renderer/app.js');
    const start = app.indexOf('const publishCollectionSmartLink = useCallback');
    const body = app.slice(start, start + 2000);
    expect(body).toMatch(/playlistShareTarget\(collection, playlistsRef\.current,/);
  });

  test('the playlist page Share button and the context menu pass the playlist id', () => {
    const page = read('src/renderer/components/playlist-view-page.js');
    const i = page.indexOf('publishCollectionSmartLink(collectionData)');
    expect(page.slice(i - 900, i)).toMatch(/playlistId: selectedPlaylist\.id/);
    const main = read('main.js');
    const j = main.indexOf("action: 'publish-collection-smart-link'");
    expect(main.slice(j - 1600, j)).toMatch(/playlistId: isPlaylist \? \(data\.playlistId \|\| null\) : undefined/);
  });
});

// A link to a playlist that's gone from ListenBrainz is a 404 for everyone, its
// owner included. Sharing has to say so instead of handing the link out.
describe('playlistShareTarget', () => {
  const summary = { id: 'playlist-1', title: 'Pushed' };
  const gone = async () => false;
  const there = async () => true;

  test('a playlist that is not on ListenBrainz is not shareable, and nothing is asked', async () => {
    const check = jest.fn(there);
    await expect(playlistShareTarget({ id: 'spotify-y' }, playlists, check)).resolves.toEqual({ status: 'not-synced' });
    expect(check).not.toHaveBeenCalled();
  });

  test('a playlist that exists gives its MBID', async () => {
    const check = jest.fn(there);
    await expect(playlistShareTarget(summary, playlists, check)).resolves.toEqual({ status: 'ok', mbid: MBID });
    expect(check).toHaveBeenCalledWith(MBID);
  });

  test('a playlist that is gone is reported', async () => {
    await expect(playlistShareTarget(summary, playlists, gone)).resolves.toEqual({ status: 'gone' });
  });

  test('a mirror already marked remote-deleted is gone, and nothing is asked', async () => {
    const check = jest.fn(there);
    const flagged = [{ id: 'playlist-1', syncedTo: { listenbrainz: { externalId: MBID, pendingAction: 'remote-deleted' } } }];
    await expect(playlistShareTarget(summary, flagged, check)).resolves.toEqual({ status: 'gone' });
    expect(check).not.toHaveBeenCalled();
  });

  test('when the check cannot answer, the link is still handed out', async () => {
    await expect(playlistShareTarget(summary, playlists, async () => null)).resolves.toEqual({ status: 'ok', mbid: MBID });
    await expect(playlistShareTarget(summary, playlists, async () => { throw new Error('offline'); })).resolves.toEqual({ status: 'ok', mbid: MBID });
    await expect(playlistShareTarget(summary, playlists)).resolves.toEqual({ status: 'ok', mbid: MBID });
  });

  test('the share path uses it and has a message for a missing playlist', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    const start = app.indexOf('const publishCollectionSmartLink = useCallback');
    const body = app.slice(start, app.indexOf('showToast(openInBrowser ? \'Opening Achordion', start));
    expect(body).toContain('playlistShareTarget(');
    expect(body).toContain("target.status === 'gone'");
  });
});

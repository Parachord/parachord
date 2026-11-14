/**
 * Playlist share links (parachord#1084). The share entry points pass a display
 * summary without the playlist's sync fields, so every share of a
 * ListenBrainz-synced playlist ended at "Sync this playlist to ListenBrainz
 * first". The MBID now comes from the stored playlist by id.
 */

const fs = require('fs');
const path = require('path');
const { playlistListenbrainzMbid, playlistShareTarget, notSyncedSharePrompt } = require('../../src/renderer/lib/playlist-share');

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
    const i = page.indexOf('onSelect: () => publishCollectionSmartLink({');
    expect(i).toBeGreaterThan(-1);
    expect(page.slice(i, i + 300)).toMatch(/playlistId: selectedPlaylist\.id/);
    const main = read('main.js');
    const j = main.indexOf("action: 'publish-collection-smart-link'");
    expect(main.slice(j - 1600, j)).toMatch(/playlistId: isPlaylist \? \(data\.playlistId \|\| null\) : undefined/);
  });
});

// A link to a playlist that's gone from ListenBrainz is a 404 for everyone, its
// owner included. Sharing has to say so instead of handing the link out.
describe('playlistShareTarget', () => {
  const summary = { id: 'playlist-1', title: 'Pushed' };
  const gone = async () => ({ exists: false, isPublic: null });
  const open = async () => ({ exists: true, isPublic: true });
  const hidden = async () => ({ exists: true, isPublic: false });

  test('a playlist that is not on ListenBrainz is not shareable, and nothing is asked', async () => {
    const check = jest.fn(open);
    await expect(playlistShareTarget({ id: 'spotify-y' }, playlists, check)).resolves.toEqual({ status: 'not-synced' });
    expect(check).not.toHaveBeenCalled();
  });

  test('a public playlist gives its MBID', async () => {
    const check = jest.fn(open);
    await expect(playlistShareTarget(summary, playlists, check)).resolves.toEqual({ status: 'ok', mbid: MBID });
    expect(check).toHaveBeenCalledWith(MBID);
  });

  test('a private playlist is reported, with its MBID', async () => {
    await expect(playlistShareTarget(summary, playlists, hidden)).resolves.toEqual({ status: 'private', mbid: MBID });
  });

  test('a playlist that is gone is reported', async () => {
    await expect(playlistShareTarget(summary, playlists, gone)).resolves.toEqual({ status: 'gone' });
  });

  test('a mirror already marked remote-deleted is gone, and nothing is asked', async () => {
    const check = jest.fn(open);
    const flagged = [{ id: 'playlist-1', syncedTo: { listenbrainz: { externalId: MBID, pendingAction: 'remote-deleted' } } }];
    await expect(playlistShareTarget(summary, flagged, check)).resolves.toEqual({ status: 'gone' });
    expect(check).not.toHaveBeenCalled();
  });

  test('when the check cannot answer, the link is still handed out', async () => {
    const ok = { status: 'ok', mbid: MBID };
    await expect(playlistShareTarget(summary, playlists, async () => null)).resolves.toEqual(ok);
    await expect(playlistShareTarget(summary, playlists, async () => ({ exists: null, isPublic: null }))).resolves.toEqual(ok);
    await expect(playlistShareTarget(summary, playlists, async () => ({ exists: true, isPublic: null }))).resolves.toEqual(ok);
    await expect(playlistShareTarget(summary, playlists, async () => { throw new Error('offline'); })).resolves.toEqual(ok);
    await expect(playlistShareTarget(summary, playlists)).resolves.toEqual(ok);
  });

  test('the share path uses it and has a message for a missing playlist', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    const start = app.indexOf('const publishCollectionSmartLink = useCallback');
    const body = app.slice(start, app.indexOf('showToast(openInBrowser ? \'Opening Achordion', start));
    expect(body).toContain('playlistShareTarget(');
    expect(body).toContain("target.status === 'gone'");
    expect(body).toContain("target.status === 'private'");
  });

  test('only the confirm button makes a playlist public, and only when copying a link', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    const start = app.indexOf("if (target.status === 'private'");
    const prompt = app.slice(start, app.indexOf('const lbMbid = target.mbid;', start));
    expect(prompt).toContain('!openInBrowser');
    expect(prompt).toContain('!opts.visibilityConfirmed');
    const onConfirm = prompt.indexOf('onConfirm:');
    expect(onConfirm).toBeGreaterThan(-1);
    expect(prompt.indexOf('setPlaylistPublic')).toBeGreaterThan(onConfirm);
    expect(prompt).toContain("cancelLabel: 'Cancel'");
    // Clicking outside the dialog must not count as saying yes.
    const dialog = app.indexOf('confirmDialog.show && React.createElement');
    const backdrop = app.slice(dialog, app.indexOf('e.stopPropagation()', dialog));
    expect(backdrop).not.toContain('onConfirm');
  });
});

// Copy Link is the only way to a playlist link, and links go through ListenBrainz.
// Without a next step, someone on Spotify alone hit a toast with nowhere to go.
describe('notSyncedSharePrompt', () => {
  test('not connected to ListenBrainz: offers to connect', () => {
    for (const config of [null, undefined, {}, { userToken: '' }]) {
      expect(notSyncedSharePrompt(config)).toEqual({
        message: 'Playlist links go through ListenBrainz. Connect your account with a user token to share this playlist.',
        actionLabel: 'Connect ListenBrainz',
        next: 'connect',
      });
    }
  });

  test('connected, but this playlist is not on ListenBrainz: offers sync settings', () => {
    expect(notSyncedSharePrompt({ userToken: 'tok' })).toEqual({
      message: 'Sync this playlist to ListenBrainz first to enable sharing via Achordion.',
      actionLabel: 'Sync Settings',
      next: 'sync',
    });
  });

  test('the share path offers the button, and each button goes somewhere', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    const start = app.indexOf('const publishCollectionSmartLink = useCallback');
    const body = app.slice(start, app.indexOf("if (target.status === 'gone')", start));
    expect(body).toContain('notSyncedSharePrompt(');
    expect(body).toContain("store.get('scrobbler-config-listenbrainz')");
    expect(body).toContain('openListenBrainzSettingsRef.current');
    expect(body).toContain("openSyncSetupModalRef.current('listenbrainz')");
    // Sharing needs the token, and a username alone doesn't save one. The field
    // is optional and hidden under Advanced, so the button has to open it.
    const opener = app.slice(app.indexOf('openListenBrainzSettingsRef.current = '), app.indexOf('openListenBrainzSettingsRef.current = ') + 400);
    expect(opener).toContain('setListenbrainzAdvancedOpen(true)');
  });
});

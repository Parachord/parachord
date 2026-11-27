/**
 * lib/playlist-context.js: the queue's context bar ("Playing from Weekly
 * Jams") reopens the playlist it names. An ephemeral playlist (Weekly Jams,
 * a recommended playlist) is in no saved list, so the bar's click found
 * nothing and only closed the drawer.
 */
const fs = require('fs');
const path = require('path');
const {
  playlistRef,
  playlistPlaybackContext,
  contextPlaylistTarget,
  withLinkFetch,
} = require('../../src/renderer/lib/playlist-context');

const weekly = {
  id: 'listenbrainz-abc',
  listenbrainzId: 'abc',
  title: 'Weekly Jams',
  weekLabel: 'This week',
  description: 'Your favorite tracks',
  tracks: [{ id: 't1' }, { id: 't2' }],
  tracksLoaded: true,
  isExternal: true,
  isEphemeral: true,
  source: 'listenbrainz',
  creator: 'ListenBrainz',
};

describe('playlistRef', () => {
  test('a saved playlist needs no reference', () => {
    expect(playlistRef({ id: 'p1', title: 'Mine', tracks: [] })).toBeUndefined();
    expect(playlistRef(null)).toBeUndefined();
  });

  test('an ephemeral one keeps what loadPlaylist needs, never its tracks', () => {
    const ref = playlistRef(weekly);
    expect(ref).toMatchObject({ id: 'listenbrainz-abc', listenbrainzId: 'abc', title: 'Weekly Jams', isEphemeral: true });
    expect(ref.tracks).toEqual([]);
    expect(ref.tracksLoaded).toBe(false);
  });

  test('no functions: the context is persisted over IPC with the queue', () => {
    const ref = playlistRef({ ...weekly, fetchTracks: () => [] });
    expect(Object.values(ref).some((v) => typeof v === 'function')).toBe(false);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
  });
});

describe('playlistPlaybackContext', () => {
  test('a saved playlist: type, id and name, as before', () => {
    expect(playlistPlaybackContext({ id: 'p1', title: 'Mine' })).toEqual({ type: 'playlist', id: 'p1', name: 'Mine' });
  });

  test('an ephemeral playlist carries its reference', () => {
    const ctx = playlistPlaybackContext(weekly);
    expect(ctx).toMatchObject({ type: 'playlist', id: 'listenbrainz-abc', name: 'Weekly Jams' });
    expect(ctx.playlist.listenbrainzId).toBe('abc');
  });
});

// A service's recommended playlist (Apple Music's "Get Up", #1653), as
// openServicePlaylist builds it: its tracks come from a lookup of its link.
const recommended = {
  id: 'applemusic-rec-pl.123',
  title: 'Get Up',
  creator: 'Apple Music',
  description: 'Recommended by Apple Music',
  coverArt: 'https://is1-ssl.mzstatic.com/image/thumb/get-up.jpg',
  tracks: [],
  tracksLoaded: false,
  isExternal: true,
  isEphemeral: true,
  source: 'applemusic',
  sourceUrl: 'https://music.apple.com/us/playlist/get-up/pl.123',
  fetchTracks: () => Promise.resolve([]),
};

describe('a recommended playlist reopens from its link (#1653)', () => {
  test('its reference keeps the link and the cover it was shown with', () => {
    const ref = playlistRef(recommended);
    expect(ref).toMatchObject({ id: 'applemusic-rec-pl.123', source: 'applemusic', sourceUrl: recommended.sourceUrl, coverArt: recommended.coverArt });
    expect(ref.fetchTracks).toBeUndefined();
  });

  test('a cover that is not a web link stays off the persisted reference', () => {
    expect(playlistRef({ ...recommended, coverArt: 'data:image/png;base64,AAAA' }).coverArt).toBeUndefined();
  });

  test("the queue's context bar finds it, from its page's play context", () => {
    expect(contextPlaylistTarget(playlistPlaybackContext(recommended), [])).toMatchObject({ id: 'applemusic-rec-pl.123', sourceUrl: recommended.sourceUrl });
  });

  test('withLinkFetch gives the reference its lookup again, by its link', async () => {
    const fetchByLink = jest.fn(async (link) => [{ title: 'T', artist: 'A', link }]);
    const reopened = withLinkFetch(playlistRef(recommended), fetchByLink);
    expect(typeof reopened.fetchTracks).toBe('function');
    await expect(reopened.fetchTracks()).resolves.toEqual([{ title: 'T', artist: 'A', link: recommended.sourceUrl }]);
    expect(fetchByLink).toHaveBeenCalledWith(recommended.sourceUrl);
  });

  test('withLinkFetch leaves everything else as it was', () => {
    const fetchByLink = jest.fn();
    const saved = { id: 'p1', title: 'Mine', tracks: [{ id: 't' }] };
    const withOwnFetch = recommended;
    const loaded = { ...playlistRef(recommended), tracks: [{ id: 't' }] };
    const noLink = playlistRef({ ...recommended, sourceUrl: undefined });
    const weeklyRef = playlistRef({ ...weekly, sourceUrl: 'https://listenbrainz.org/playlist/abc' });
    for (const p of [saved, withOwnFetch, loaded, noLink, weeklyRef, null]) {
      expect(withLinkFetch(p, fetchByLink)).toBe(p);
    }
    expect(fetchByLink).not.toHaveBeenCalled();
  });
});

describe('contextPlaylistTarget', () => {
  const saved = [{ id: 'p1', title: 'Mine' }];

  test('a saved playlist is found by id', () => {
    expect(contextPlaylistTarget({ type: 'playlist', id: 'p1' }, saved)).toBe(saved[0]);
  });

  test('a Weekly Jams page context reopens from its reference (the bug)', () => {
    const target = contextPlaylistTarget(playlistPlaybackContext(weekly), saved);
    expect(target).toMatchObject({ id: 'listenbrainz-abc', listenbrainzId: 'abc' });
  });

  test("the weekly card's play-button context reopens too", () => {
    const ctx = { type: 'weekly-jam', name: "This week's Weekly Jams", playlist: playlistRef(weekly) };
    expect(contextPlaylistTarget(ctx, saved)).toMatchObject({ id: 'listenbrainz-abc' });
  });

  test('null when nothing can be reopened (the caller falls back to Recommendations)', () => {
    expect(contextPlaylistTarget({ type: 'weekly-jam', name: 'Weekly Jams' }, saved)).toBeNull();
    expect(contextPlaylistTarget({ type: 'playlist', id: 'gone' }, saved)).toBeNull();
    const rec = playlistPlaybackContext({ id: 'spotify-rec-1', title: 'Rec', isEphemeral: true, source: 'spotify' });
    expect(contextPlaylistTarget(rec, saved)).toBeNull();
    expect(contextPlaylistTarget({ type: 'album', id: 'p1' }, saved)).toBeNull();
    expect(contextPlaylistTarget(null, saved)).toBeNull();
  });
});

describe('call sites', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', rel), 'utf8');

  test('the playlist view builds every play context with playlistPlaybackContext', () => {
    const src = read('components/playlist-view-page.js');
    expect(src).not.toMatch(/const context = \{ type: 'playlist'/);
    // The row and its source icons share one onPlay (the shared TrackRow).
    expect(src.match(/playlistPlaybackContext\(selectedPlaylist\)/g).length).toBeGreaterThanOrEqual(3);
  });

  test("the queue's context bar opens contextPlaylistTarget, and the weekly play button carries the ref", () => {
    const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages moved out of it (#1451)
    expect(app).toMatch(/const contextPlaylist = contextPlaylistTarget\(playbackContext, playlists\);/);
    expect(app).toMatch(/playTrackCollection\(tracks, \{ type: item\.weekly\.contextType, name, playlist: playlistRef\(playlist\) \}\)/);
  });

  // #1653: Play or Add to queue on a recommended playlist's card stamped
  // the queue with its name alone, so "Playing from" had nothing to open.
  test("a recommended playlist card's play and queue carry the same reference its page does", () => {
    const app = require('../helpers/renderer-source').appWithPages();
    expect(app.match(/context \|\| playlistPlaybackContext\(servicePlaylistRecord\(item\)\)/g)).toHaveLength(2);
    expect(app).not.toMatch(/context \|\| \{ type: 'playlist', name: item\.name \}/);
    expect(app).toMatch(/loadPlaylist\(servicePlaylistRecord\(item, sourceName\)\)/);
  });

  test('loadPlaylist reopens a reference by its link through the shared playlist lookup', () => {
    const app = require('../helpers/renderer-source').appWithPages();
    expect(app).toMatch(/playlist = withLinkFetch\(playlistOrId, \(link\) => recommendationPlaylistTracks\(\{ url: link, name: playlistOrId\.title \}\)\);/);
  });
});

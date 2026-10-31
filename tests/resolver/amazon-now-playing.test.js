/**
 * Amazon's page says what it is really playing (navigator.mediaSession
 * metadata, kept by the media-session hijack). For a track the account can
 * only start as a station, /tracks/<ASIN>?do=play plays a station seeded from
 * it: "Ready or Not" by Shakey Graves played Mumford & Sons, then another
 * Shakey Graves song, under the requested track's name. The play now checks
 * the page's now-playing before reporting success, and fails (so the next
 * source is tried) on a clear title mismatch.
 */

const fs = require('fs');
const path = require('path');
const { amazonNowPlayingMismatch } = require('../../amazon-music-logic');

describe('amazonNowPlayingMismatch', () => {
  test('a station\'s song is a mismatch', () => {
    expect(amazonNowPlayingMismatch('Ready or Not', { title: 'Little Lion Man', artist: 'Mumford & Sons' })).toBe(true);
    expect(amazonNowPlayingMismatch('Ready or Not', { title: 'Roll the Bones', artist: 'Shakey Graves' })).toBe(true);
  });

  test('the same song spelled differently is not', () => {
    expect(amazonNowPlayingMismatch('Ready or Not', { title: 'Ready or Not (feat. Sierra Ferrell)' })).toBe(false);
    expect(amazonNowPlayingMismatch('Ready or Not (feat. Sierra Ferrell)', { title: 'Ready or Not' })).toBe(false);
    expect(amazonNowPlayingMismatch('Kunnioita', { title: 'Kunnioita [Explicit]' })).toBe(false);
    expect(amazonNowPlayingMismatch('Wanderluster', { title: 'Wanderluster - Remastered 2024' })).toBe(false);
    expect(amazonNowPlayingMismatch('Café', { title: 'CAFE' })).toBe(false);
    expect(amazonNowPlayingMismatch('Яйца', { title: 'Яйца' })).toBe(false);
  });

  test('unknown is never a mismatch', () => {
    expect(amazonNowPlayingMismatch('Ready or Not', null)).toBe(false);
    expect(amazonNowPlayingMismatch('Ready or Not', { title: '' })).toBe(false);
    expect(amazonNowPlayingMismatch('Ready or Not', { artist: 'Mumford & Sons' })).toBe(false);
    expect(amazonNowPlayingMismatch('', { title: 'Little Lion Man' })).toBe(false);
    expect(amazonNowPlayingMismatch(null, { title: 'Little Lion Man' })).toBe(false);
  });
});



// The hornet-player wiring this used to assert (HOOK_SCRIPT's now-playing
// read, playByAsin's mismatch check, readState's title fill) died with the
// hornet audio path: native playback never lands on a page that could
// silently substitute a station — the dmls manifest is fetched per ASIN and
// the served pressing rides `substituteAsin` in daylight. The pure matcher
// stays because a dmls-level substitution check may reuse it someday.

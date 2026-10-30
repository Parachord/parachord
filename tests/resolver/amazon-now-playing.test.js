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

describe('amazon-web-player.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../amazon-web-player.js'), 'utf8');

  test('the page read reports the page\'s own now-playing', () => {
    const hook = src.slice(src.indexOf('window.__parachordAmazonRead = () =>'), src.indexOf('window.__parachordAmazonRead = () =>') + 4000);
    expect(hook).toMatch(/navigator\.mediaSession && navigator\.mediaSession\.metadata/);
    expect(hook).toMatch(/return \{\s*nowPlaying,/);
  });

  test('a play checks the page\'s now-playing before reporting success', () => {
    const play = src.slice(src.indexOf('async playByAsin('), src.indexOf('async readState('));
    const check = play.indexOf('amazonNowPlayingMismatch(title, nowPlaying)');
    const success = play.indexOf("return { success: true, confirmed: true, asin, engine: 'web' }");
    expect(check).toBeGreaterThan(-1);
    expect(success).toBeGreaterThan(check);
    // A mismatch halts the page and fails the play (so the next source plays).
    const branch = play.slice(check, success);
    expect(branch).toMatch(/await this\.haltPlayback\(generation\)/);
    expect(branch).toMatch(/reason: 'playback-failed'/);
  });

  test('readState fills title/artist from the page\'s now-playing', () => {
    expect(src).toMatch(/title: \(state\.nowPlaying && state\.nowPlaying\.title\) \|\| null,/);
    expect(src).toMatch(/artist: \(state\.nowPlaying && state\.nowPlaying\.artist\) \|\| null,/);
  });
});

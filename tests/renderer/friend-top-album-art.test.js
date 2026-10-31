/**
 * A ListenBrainz friend's Top Albums showed no covers until a MusicBrainz
 * name search and a HEAD request had run for each album, one at a time, with
 * a full render per album, although the stats response already names each
 * cover (caa_release_mbid + caa_id). The cover now comes from the payload,
 * the rest go through getAlbumArt in batches, and a dead cover is reported
 * like every other grid's (#1179).
 */

const fs = require('fs');
const path = require('path');
const { listenBrainzCoverUrl } = require('../../src/renderer/lib/listenbrainz-cover');

describe('listenBrainzCoverUrl', () => {
  test('builds the Cover Art Archive URL for the release ListenBrainz counted', () => {
    expect(listenBrainzCoverUrl({
      release_name: '(What’s the Story) Morning Glory?',
      caa_id: 39250165476,
      caa_release_mbid: 'ed286309-6e64-48e3-835b-61aaf86cdb86'
    })).toBe('https://coverartarchive.org/release/ed286309-6e64-48e3-835b-61aaf86cdb86/front-250');
  });

  test('no caa_id means no known front image, so no URL', () => {
    expect(listenBrainzCoverUrl({ caa_id: null, caa_release_mbid: 'ed286309-6e64-48e3-835b-61aaf86cdb86' })).toBeNull();
    expect(listenBrainzCoverUrl({ caa_id: 39250165476, caa_release_mbid: null })).toBeNull();
    expect(listenBrainzCoverUrl({})).toBeNull();
    expect(listenBrainzCoverUrl(undefined)).toBeNull();
  });
});

describe('app.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const sliceFrom = (marker, endMarker) => {
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf(endMarker, start));
  };

  test('the ListenBrainz branch takes its cover from the stats payload', () => {
    const body = sliceFrom('const loadFriendTopAlbums = async', 'const FRIEND_TOP_ALBUM_ART_CONCURRENCY');
    expect(body).toMatch(/image: listenBrainzCoverUrl\(release\)/);
    expect(body).not.toMatch(/image: null/);
  });

  test('the remaining covers go through getAlbumArt and the coalesced writer, not a per-album search', () => {
    const body = sliceFrom('const resolveFriendTopAlbumImages = (albums) => {', 'const navigateToFriend = ');
    expect(body).toMatch(/await getAlbumArt\(album\.artist, album\.name\)/);
    expect(body).toMatch(/writer\.queue\(album\.id, \{ generation, image \}\)/);
    expect(body).not.toMatch(/musicbrainz\.org/);
    expect(body).not.toMatch(/setFriendHistoryData/);
  });

  test('a dead cover on the card is reported for a retry', () => {
    expect(src).toMatch(/retryBrokenListArt\(album\.image, \{ artist: album\.artist, album: album\.name, id: album\.id \}/);
  });
});

/**
 * Every ListenBrainz listen carries the cover ListenBrainz matched
 * (track_metadata.mbid_mapping.caa_release_mbid, plus caa_id when the archive
 * holds a front image), but the friend card, a friend's Recent tab and your
 * own History all set albumArt to null and searched MusicBrainz per row
 * instead. Weekly playlists built the URL from caa_release_mbid alone, without
 * the caa_id check. All four now use listenBrainzCoverUrl (#1182); rows it
 * can't cover keep the getAlbumArt fallback.
 */

const fs = require('fs');
const path = require('path');
const { listenBrainzCoverUrl } = require('../../src/renderer/lib/listenbrainz-cover');

describe('listenBrainzCoverUrl on a listen', () => {
  // Shape of /1/user/{user}/listens track_metadata.mbid_mapping (2026-10)
  const mapping = {
    artist_mbids: ['39ab1aed-75e0-4140-bd47-540276886b60'],
    caa_id: 39250165476,
    caa_release_mbid: 'ed286309-6e64-48e3-835b-61aaf86cdb86',
    recording_mbid: 'b2f3dc71-0f80-4b22-a1a4-d8f8cbd9e5f0',
    release_mbid: 'ed286309-6e64-48e3-835b-61aaf86cdb86'
  };

  test('a mapped listen with a cover gets its Cover Art Archive URL', () => {
    expect(listenBrainzCoverUrl(mapping))
      .toBe('https://coverartarchive.org/release/ed286309-6e64-48e3-835b-61aaf86cdb86/front-250');
  });

  test('an unmapped listen, or one with no front image, gets none', () => {
    expect(listenBrainzCoverUrl(undefined)).toBeNull();
    expect(listenBrainzCoverUrl({ ...mapping, caa_id: null })).toBeNull();
  });
});

describe('app.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const sliceFrom = (marker, endMarker) => {
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf(endMarker, start + marker.length);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };
  const LISTEN_COVER = /albumArt: listenBrainzCoverUrl\(listen\.track_metadata\?\.mbid_mapping\)/;

  test('the friend card takes the listen\'s cover', () => {
    const body = sliceFrom('const fetchFriendRecentTrack = async', '\n  };\n');
    expect(body).toMatch(LISTEN_COVER);
  });

  test('a friend\'s Recent tab takes each listen\'s cover', () => {
    const body = sliceFrom('const loadFriendRecentTracks = async', 'const loadFriendTopTracks = async');
    expect(body).toMatch(LISTEN_COVER);
    expect(body).not.toMatch(/albumArt: null/);
  });

  test('your own ListenBrainz History takes each listen\'s cover', () => {
    const body = sliceFrom('const loadListenbrainzHistory = async', '\n  };\n');
    expect(body).toMatch(LISTEN_COVER);
    expect(body).not.toMatch(/albumArt: null/);
  });

  test('weekly playlists gate on caa_id through the same helper', () => {
    const body = sliceFrom('const loadWeeklyJamTracks = async', '\n  };\n');
    expect(body).toMatch(/const albumArt = listenBrainzCoverUrl\(addlMeta\);/);
    expect(body).not.toMatch(/caa_release_mbid/);
  });
});

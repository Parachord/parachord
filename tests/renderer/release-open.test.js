/**
 * Opening an album from the playbar or a Collection card showed its cover,
 * blanked it when fetchReleaseData replaced the placeholder (its cover came
 * only from id-keyed caches), then faded in the Cover Art Archive's copy of
 * the same image. Opening also re-ran MusicBrainz lookups the queue fetch had
 * already made, at one request a second. src/renderer/lib/release-open.js
 * holds the pure parts; the markers below pin how app.js uses them.
 */

const fs = require('fs');
const path = require('path');
const { carriedReleaseArt, withArchiveCover, createReleaseGroupPicks } = require('../../src/renderer/lib/release-open');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

function slice(startMarker, endMarker) {
  const s = app.indexOf(startMarker);
  expect(s).toBeGreaterThan(-1);
  const e = app.indexOf(endMarker, s);
  expect(e).toBeGreaterThan(s);
  return app.slice(s, e);
}

describe('carriedReleaseArt', () => {
  const placeholder = { id: 'pending-radiohead-ok computer', title: 'OK Computer', artist: { name: 'Radiohead' }, albumArt: 'https://i.scdn.co/image/abc' };

  test('keeps the cover of the same album across an id change', () => {
    expect(carriedReleaseArt(placeholder, { title: 'OK Computer', artist: 'Radiohead' })).toBe('https://i.scdn.co/image/abc');
  });
  test('matches across edition suffixes and artist spelling', () => {
    expect(carriedReleaseArt(placeholder, { title: 'OK Computer (Remastered)', artist: 'radiohead' })).toBe('https://i.scdn.co/image/abc');
  });
  test('never carries another album\'s cover', () => {
    expect(carriedReleaseArt(placeholder, { title: 'Kid A', artist: 'Radiohead' })).toBeNull();
    expect(carriedReleaseArt(placeholder, { title: 'OK Computer', artist: 'Someone Else' })).toBeNull();
  });
  test('nothing on screen, or no cover on it, gives null', () => {
    expect(carriedReleaseArt(null, { title: 'OK Computer', artist: 'Radiohead' })).toBeNull();
    expect(carriedReleaseArt({ ...placeholder, albumArt: null }, { title: 'OK Computer', artist: 'Radiohead' })).toBeNull();
  });
});

describe('withArchiveCover', () => {
  const caa = 'https://coverartarchive.org/release/r1/front-500.jpg';
  test('fills a page that has no cover', () => {
    expect(withArchiveCover({ id: 'r1', albumArt: null, title: 'X' }, 'r1', caa)).toEqual({ id: 'r1', albumArt: caa, title: 'X' });
  });
  test('a page already showing a cover keeps it (same object, no re-render)', () => {
    const prev = { id: 'r1', albumArt: 'https://i.scdn.co/image/abc' };
    expect(withArchiveCover(prev, 'r1', caa)).toBe(prev);
  });
  test('a different page, or no page, is left alone', () => {
    const other = { id: 'r2', albumArt: null };
    expect(withArchiveCover(other, 'r1', caa)).toBe(other);
    expect(withArchiveCover(null, 'r1', caa)).toBeNull();
  });
});

describe('createReleaseGroupPicks', () => {
  test('remembers a release group by normalized artist and album', () => {
    const picks = createReleaseGroupPicks();
    const rg = { id: 'rg-1', title: 'OK Computer', 'primary-type': 'Album' };
    picks.set('Radiohead', 'OK Computer', rg);
    expect(picks.get('radiohead', 'OK Computer (Deluxe Edition)')).toBe(rg);
    expect(picks.get('Radiohead', 'Kid A')).toBeNull();
  });
  test('ignores entries without an id or a key', () => {
    const picks = createReleaseGroupPicks();
    picks.set('Radiohead', 'OK Computer', { title: 'no id' });
    picks.set('', 'OK Computer', { id: 'rg-1' });
    expect(picks.get('Radiohead', 'OK Computer')).toBeNull();
    expect(picks.get('', 'OK Computer')).toBeNull();
  });
});

describe('app.js wiring', () => {
  const fetchRelease = slice('const fetchReleaseData = async (release, artist) => {', '// Prefetch release tracks on hover');

  test('fetchReleaseData falls back to the cover on screen in the partial and the loaded release', () => {
    expect(fetchRelease).toMatch(/partialCachedArt \|\| onScreenArt \|\| null/);
    expect(fetchRelease).toMatch(/cachedLookupArt\s*\|\| carriedReleaseArt\(currentReleaseRef\.current/);
  });
  test('the Cover Art Archive result only fills a page with no cover', () => {
    expect(fetchRelease).toContain('setCurrentRelease(prev => withArchiveCover(prev, releaseData.id, albumArt))');
    expect(fetchRelease).not.toMatch(/prev\.id === releaseData\.id \? \{ \.\.\.prev, albumArt \}/);
  });
  test('a known release-group id skips the release-id probe unless its release is cached', () => {
    expect(fetchRelease).toMatch(/const skipReleaseProbe = !!release\.isReleaseGroup && !releaseDetailsCache\.current\[release\.id\]\?\.alias;/);
    expect(fetchRelease).toMatch(/skipReleaseProbe \? null : await fetchReleaseDetails\(releaseId\)/);
  });

  const openForTrack = slice('const openAlbumForTrack = async (track) => {', 'const handleAlbumClick = async (album) => {');

  test('openAlbumForTrack asks the mapper up front only when it has no album name', () => {
    expect(openForTrack).toContain('if (!albumName) await askMapper();');
    expect(openForTrack).toContain('if (!releaseMbid) await askMapper();');
    // The release-group search comes before the deferred mapper call.
    expect(openForTrack.indexOf('release-group?query=')).toBeLessThan(openForTrack.indexOf('if (!releaseMbid) await askMapper();'));
  });
  test('openAlbumForTrack reuses and records release-group picks', () => {
    expect(openForTrack).toContain('releaseGroupPicksRef.current.get(track.artist, albumName)');
    expect(openForTrack).toContain('releaseGroupPicksRef.current.set(track.artist, albumName, album)');
    expect(openForTrack).toContain('handleAlbumClick({ ...album, isReleaseGroup: true })');
  });
  test('handleAlbumClick passes the release-group flag through', () => {
    expect(slice('const handleAlbumClick = async (album) => {', '// Handle playlist click from search')).toContain('isReleaseGroup: !!album.isReleaseGroup');
  });
  test('the Collection opener reuses and records picks', () => {
    const collection = slice('const handleCollectionAlbumClick = async (album) => {', '// Validate cached sources in background');
    expect(collection).toContain('releaseGroupPicksRef.current.get(album.artist, album.title)');
    expect(collection).toContain('releaseGroupPicksRef.current.set(album.artist, album.title, match)');
  });
  test('the queue-album fetches record the release group and its release', () => {
    const fromMb = slice('const fetchAlbumTracksFromMusicBrainz = async', '// Load AI recommendations when HOME is active');
    expect(fromMb).toContain('releaseGroupPicksRef.current.set(artistName, albumTitle, match)');
    expect(fromMb).toContain('rememberReleaseGroupAlias(match.id, release.id)');
    const byName = slice('const fetchAlbumTracksByName = async', '// Keep fetchAlbumTracksByNameRef in sync');
    expect(byName).toContain('rememberReleaseGroupAlias(releaseGroup.id, releaseId)');
    const searchAlbum = slice('const fetchSearchAlbumTracksAsync = async (album) => {', 'return result;');
    expect(searchAlbum).toContain('rememberReleaseGroupAlias(album.id, releaseId)');
  });
});

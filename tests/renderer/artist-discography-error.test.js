/**
 * #874: a MusicBrainz failure on an artist page is not an artist with no
 * releases. The page used to show "No albums found" (and, when the three
 * release-group requests were the ones failing, cache that empty list for a
 * month). Now a failure is told apart from a genuine empty answer, never
 * cached, the services' discography stands in, and only when none has one
 * does the page say it couldn't load, with Try again.
 */
const fs = require('fs');
const path = require('path');
const {
  loadArtistReleaseGroups, discographyOutcome, musicBrainzHttpError,
} = require('../../src/renderer/lib/artist-discography');
const { describeMusicBrainzError } = require('../../src/renderer/lib/musicbrainz-fetch');

const ROOT = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
const artistPage = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', 'artist-page.js'), 'utf8');

const fetchArtistData = (() => {
  const start = app.indexOf('const fetchArtistData = async (artistName, options = {}) => {');
  const end = app.indexOf('const fetchReleaseData = async (release, artist) => {', start);
  return app.slice(start, end);
})();

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const ARTIST = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11';

describe('discographyOutcome', () => {
  test.each([
    [{ releaseCount: 12, failedTypes: 0 }, 'complete'],
    [{ releaseCount: 0, failedTypes: 0 }, 'empty'],
    [{ releaseCount: 5, failedTypes: 1 }, 'partial'],
    [{ releaseCount: 0, failedTypes: 1 }, 'failed'],
    [{ releaseCount: 0, failedTypes: 3 }, 'failed'],
  ])('%j is %s', (input, expected) => {
    expect(discographyOutcome(input)).toBe(expected);
  });
});

describe('loadArtistReleaseGroups reports every failed type', () => {
  test('an HTTP error is reported, not just a thrown one', async () => {
    const errors = [];
    const fetch = async (url) => {
      if (url.includes('type=album')) return response(502, {});
      if (url.includes('type=ep')) throw Object.assign(new TypeError('Failed to fetch'));
      return response(200, { 'release-groups': [] });
    };
    const releases = await loadArtistReleaseGroups(ARTIST, { fetch, onError: (err, type) => errors.push([type, err]) });
    expect(releases).toEqual([]);
    expect(errors.map(([type]) => type).sort()).toEqual(['album', 'ep']);
    expect(errors.find(([type]) => type === 'album')[1].status).toBe(502);
  });

  test('a genuine empty answer reports nothing', async () => {
    const errors = [];
    const fetch = async () => response(200, { 'release-groups': [] });
    await loadArtistReleaseGroups(ARTIST, { fetch, onError: (err) => errors.push(err) });
    expect(errors).toEqual([]);
  });
});

describe('musicBrainzHttpError words like the other MusicBrainz failures', () => {
  test('throttled for 429 and 503, unreachable for other 5xx', () => {
    expect(describeMusicBrainzError(musicBrainzHttpError(429))).toMatch(/busy/);
    expect(describeMusicBrainzError(musicBrainzHttpError(503))).toMatch(/busy/);
    expect(describeMusicBrainzError(musicBrainzHttpError(502))).toMatch(/Couldn't reach MusicBrainz/);
    expect(musicBrainzHttpError(400).mbUnreachable).toBeUndefined();
  });
});

describe('fetchArtistData', () => {
  test('a failure is recorded on the page, never as a dialog', () => {
    expect(fetchArtistData).not.toMatch(/title: 'Service Busy'/);
    expect(fetchArtistData).not.toMatch(/title: 'Load Failed'/);
    expect(fetchArtistData).toMatch(/await discographyFailed\(musicBrainzHttpError\(searchResponse\.status\)\);/);
    expect(fetchArtistData).toMatch(/catch \(error\) \{[\s\S]*?await discographyFailed\(error\);/);
  });

  test('every release type failing is a failure, not an empty discography', () => {
    const outcome = fetchArtistData.indexOf('const outcome = discographyOutcome(');
    const failed = fetchArtistData.indexOf("if (outcome === 'failed') {", outcome);
    const cache = fetchArtistData.indexOf('artistDataCache.current[cacheKey] = {', failed);
    expect(outcome).toBeGreaterThan(-1);
    expect(failed).toBeGreaterThan(outcome);
    // the failed branch returns before the cache write
    expect(fetchArtistData.slice(failed, cache)).toMatch(/await discographyFailed\(releaseGroupErrors\[0\]\);\s*return;/);
  });

  test('a partial discography is shown but not cached', () => {
    expect(fetchArtistData).toMatch(/if \(outcome === 'partial'\) \{[\s\S]*?\} else \{\s*artistDataCache\.current\[cacheKey\] = \{/);
  });

  test('the services stand in before the page gives up, and an error never covers releases', () => {
    const fn = fetchArtistData.slice(fetchArtistData.indexOf('const discographyFailed = async (error) => {'));
    const body = fn.slice(0, fn.indexOf('\n    };') + 7);
    expect(body).toMatch(/if \(!mbReleasesShown && !serviceDiscographySource\) await showServiceDiscography\(\);/);
    expect(body).toMatch(/if \(!mbReleasesShown && !serviceDiscographySource\) \{\s*setArtistLoadError\(\{ name: shownArtistName, message: describeMusicBrainzError\(/);
    expect(body).toMatch(/setLoadingArtist\(false\);/);
    // one services pass, shared with the slow-load timer
    expect(fetchArtistData).toMatch(/const showServiceDiscography = \(\) => serviceDiscographyRun \|\| \(serviceDiscographyRun = /);
    expect(fetchArtistData).toMatch(/setTimeout\(showServiceDiscography, ARTIST_SLOW_FALLBACK_MS\)/);
  });

  test('a new visit clears the last error', () => {
    const clear = fetchArtistData.indexOf('setArtistLoadError(null);');
    const cached = fetchArtistData.indexOf('if (cacheValid) {');
    expect(clear).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(cached);
  });
});

describe('ArtistPage', () => {
  test('shows the error with Try again for the artist it belongs to, in place of the empty state', () => {
    expect(app).toMatch(/React\.createElement\(ArtistPage, \{[^}]*artistLoadError,/);
    const at = artistPage.indexOf("'Couldn’t load this artist’s discography'");
    expect(at).toBeGreaterThan(-1);
    const block = artistPage.slice(artistPage.lastIndexOf('!loadingArtist && artistReleases.length === 0 && artistLoadError', at), at + 900);
    expect(block).toMatch(/artistLoadError\.name === currentArtist\.name/);
    // The shared ErrorState (components/states.js) supplies "Try again".
    expect(block).toMatch(/onRetry: \(\) => fetchArtistData\(currentArtist\.name, \{ mbid: currentArtist\.mbid \}\)/);
    expect(block).toMatch(/React\.createElement\(ErrorState, \{/);
    // the plain empty state is the other branch
    expect(artistPage.indexOf('// Empty state (only show when not loading)', at)).toBeGreaterThan(at);
  });
});

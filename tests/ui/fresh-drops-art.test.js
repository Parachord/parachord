/**
 * Fresh Drops album art. The page used to assign a Cover Art Archive
 * release-group URL to every release without requesting it and persist that
 * guess as a cache hit, so a release with no CAA art (most brand-new ones)
 * showed the placeholder for 90 days and the resolver / iTunes / Deezer
 * fallbacks never ran (2026-10-17). The helpers are module-scope in app.js;
 * this extracts and runs the real source.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

function extract(startMarker, endMarker) {
  const s = app.indexOf(startMarker);
  expect(s).toBeGreaterThan(-1);
  const e = app.indexOf(endMarker, s);
  expect(e).toBeGreaterThan(s);
  return app.slice(s, e);
}

const src = extract('window.isUnverifiedCoverArtUrl = ', 'window.headerCollapseDecision = ');
const win = {};
new Function('window', src)(win);
const { isUnverifiedCoverArtUrl, hydrateReleaseArt } = win;

const RG = '1b022e01-4da6-387b-8658-8678046e4cef';

describe('isUnverifiedCoverArtUrl', () => {
  test('matches the guessed release-group front URL in every size', () => {
    expect(isUnverifiedCoverArtUrl(`https://coverartarchive.org/release-group/${RG}/front-250`)).toBe(true);
    expect(isUnverifiedCoverArtUrl(`https://coverartarchive.org/release-group/${RG}/front-500`)).toBe(true);
    expect(isUnverifiedCoverArtUrl(`https://coverartarchive.org/release-group/${RG}/front`)).toBe(true);
    expect(isUnverifiedCoverArtUrl(`http://coverartarchive.org/release-group/${RG}/front-250/`)).toBe(true);
  });

  test('does not match verified art or anything else', () => {
    expect(isUnverifiedCoverArtUrl(`https://archive.org/download/mbid-${RG}/mbid-${RG}-123_thumb250.jpg`)).toBe(false);
    expect(isUnverifiedCoverArtUrl(`https://coverartarchive.org/release/${RG}/front-250`)).toBe(false); // release, not release-group
    expect(isUnverifiedCoverArtUrl(`https://coverartarchive.org/release-group/${RG}`)).toBe(false); // the JSON index
    expect(isUnverifiedCoverArtUrl('https://i.scdn.co/image/abc')).toBe(false);
    expect(isUnverifiedCoverArtUrl(null)).toBe(false);
    expect(isUnverifiedCoverArtUrl(undefined)).toBe(false);
  });
});

describe('hydrateReleaseArt', () => {
  const verified = `https://archive.org/download/mbid-${RG}/front_thumb250.jpg`;
  const guessed = `https://coverartarchive.org/release-group/${RG}/front-250`;

  test('keeps verified art already on the release', () => {
    const r = { id: RG, albumArt: verified };
    expect(hydrateReleaseArt(r, {})).toBe(r);
  });

  test('fills missing art from a verified cache entry', () => {
    expect(hydrateReleaseArt({ id: RG, albumArt: null }, { [RG]: { url: verified } })).toEqual({ id: RG, albumArt: verified });
  });

  test('treats a guessed URL on the release or in the cache as missing', () => {
    expect(hydrateReleaseArt({ id: RG, albumArt: guessed }, {})).toEqual({ id: RG, albumArt: null });
    expect(hydrateReleaseArt({ id: RG, albumArt: guessed }, { [RG]: { url: guessed } })).toEqual({ id: RG, albumArt: null });
    expect(hydrateReleaseArt({ id: RG, albumArt: guessed }, { [RG]: { url: verified } })).toEqual({ id: RG, albumArt: verified });
  });

  test('leaves a release with no art and no cache untouched', () => {
    const r = { id: RG };
    expect(hydrateReleaseArt(r, undefined)).toBe(r);
  });
});

describe('the app no longer writes guessed cover-art URLs', () => {
  test('no site assigns a release-group front URL into albumArtCache without a request', () => {
    // The old pattern: const coverUrl = `.../release-group/${x}/front-250`; albumArtCache.current[x] = { url: coverUrl
    const guessedAssignments = app.match(/albumArtCache\.current\[[^\]]+\] = \{ url: coverUrl, timestamp/g) || [];
    expect(guessedAssignments).toEqual([]);
  });

  test('the cache loader drops persisted guesses', () => {
    expect(app).toMatch(/liveEntries\.filter\(\(\[_, entry\]\) => !window\.isUnverifiedCoverArtUrl\(entry\.url\)\)/);
  });

  test('Fresh Drops hydrates from the cache only, at load and during the fetch', () => {
    expect((app.match(/window\.hydrateReleaseArt\((release|r), albumArtCache\.current\)/g) || []).length).toBe(2);
  });

  test('the Fresh Drops art pass verifies CAA with a request and falls back to the pipeline tail', () => {
    const s = app.indexOf('const resolveNewReleaseArt = async (release) => {');
    const body = app.slice(s, app.indexOf('\n  };', s));
    expect(body).toMatch(/fetch\(rgUrl, \{ method: 'HEAD', redirect: 'follow' \}\)/);
    expect(body).toMatch(/getAlbumArtFromResolvers\(release\.artist, release\.title\)/);
    expect(body).not.toMatch(/albumArtCache\.current\[release\.id\] = \{ url: rgUrl/);
  });

  test('the art pass batches state writes and bounds concurrency', () => {
    const s = app.indexOf('const fetchNewReleasesAlbumArt = (releases) => {');
    const body = app.slice(s, app.indexOf('\n  };', s));
    expect(body).toMatch(/newReleasesArtWriterRef\.current\.queue\(/);
    expect(body).not.toMatch(/setNewReleases\(/);
    expect(app).toMatch(/const NEW_RELEASES_ART_CONCURRENCY = 4;/);
  });
});

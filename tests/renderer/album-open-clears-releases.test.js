/**
 * Opening an album for an artist clears the discography loaded for the
 * previous one.
 *
 * The release page's Back (the breadcrumb, the artist name, the Music tab)
 * fetches the artist's releases only when none are loaded
 * (`artistReleases.length === 0`). An opener that switched the artist without
 * clearing them left the last artist's releases in place, so Back showed the
 * wrong discography: Collection > Albums > "Post-Pardon" by Quarantine Angst,
 * then Back, showed Dry Cleaning's releases (2026-11-14). handleAlbumClick
 * (search) always cleared them; the Collection opener and the shared
 * placeholder (the playbar's album click, Charts) did not.
 */
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

// The body of `const name = async (...) => {` / `const name = (...) => {`,
// up to the next top-level (2-space) `  };`.
function body(name) {
  const start = app.search(new RegExp(`\\n  const ${name} = (?:async )?\\(`));
  expect(start).toBeGreaterThan(-1);
  const end = app.indexOf('\n  };', start);
  return app.slice(start, end);
}

describe('album openers clear the previous artist\'s releases', () => {
  test.each(['handleAlbumClick', 'handleCollectionAlbumClick', 'showReleasePlaceholder'])('%s', (name) => {
    const fn = body(name);
    expect(fn).toContain('setCurrentArtist(');
    expect(fn).toContain('setArtistReleases([]);');
  });
});

// #1651: Back from an album opened from Home's Charts or Critical Darlings
// rows (showReleasePlaceholder, via openChartsAlbum) landed on a blank page,
// and only a second Back left it. navigateBack closes an album and leaves the
// artist view in one step only when no artist history is loaded; the
// placeholder cleared the releases but kept the artist history, which
// leaving an artist page from the sidebar doesn't clear. Radiohead, then
// Muse (one entry), then Home, then an album: Back closed the album onto an
// artist page with no discography, and the next Back opened Radiohead.
describe('album openers start a fresh artist history', () => {
  test.each(['handleAlbumClick', 'handleCollectionAlbumClick', 'showReleasePlaceholder', 'openAlbumForTrack'])('%s', (name) => {
    expect(body(name)).toContain('setArtistHistory([]);');
  });

  test('every place that opens a release clears the history (the deep link too)', () => {
    // Each `openingReleaseRef.current = true;` marks an album being opened;
    // the history is cleared within a few lines of it. openChartsAlbum's is
    // the one exception: it fills in the page showReleasePlaceholder opened.
    const lines = app.split('\n');
    const marks = lines.map((l, i) => (l.includes('openingReleaseRef.current = true;') ? i : -1)).filter((i) => i >= 0);
    expect(marks.length).toBeGreaterThanOrEqual(6);
    const fillsInPlaceholder = (i) => /fetchReleaseData\(releaseObj, artist\)/.test(lines.slice(i, i + 3).join('\n'));
    for (const i of marks) {
      if (fillsInPlaceholder(i)) continue;
      const near = lines.slice(Math.max(0, i - 12), i + 12).join('\n');
      expect([i + 1, near.includes('setArtistHistory([]);')]).toEqual([i + 1, true]);
    }
  });
});

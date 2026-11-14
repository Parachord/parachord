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

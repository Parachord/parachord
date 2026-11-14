// A list's React key is unique among its siblings. Two cards with one key
// leave React unable to tell them apart, and after a search or filter stale
// cards stay on screen (Fresh Drops, Concerts, Search playlists, 2026-11).
// These pin the list keys and the filter resets that came out of that audit;
// the pure de-duplications have their own behaviour tests
// (concert-events, recommendation-model, fresh-drops-releases).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'renderer', ...p), 'utf8');
const app = read('app.js');
const searchPage = read('components', 'search-page.js');

describe('Search: Playlists', () => {
  test('playlist cards are keyed by playlist id, never by title', () => {
    // "Starred" from Spotify sync and from ListenBrainz sync are two playlists
    // with one title.
    expect(searchPage).not.toMatch(/key: playlist\.title/);
    const keys = searchPage.match(/key: playlist\.id \|\| `\$\{playlist\.title\}-\$\{index\}`/g) || [];
    expect(keys).toHaveLength(2); // the preview row and the Show more grid
  });
});

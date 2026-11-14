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

describe('History: Recent', () => {
  test('each listen row is keyed by track id plus when it was played', () => {
    // Two listens of one song share the ListenBrainz recording_msid.
    const at = app.indexOf("'data-track-id': track.id,\n                        ref: (el) => {\n                          if (el) {\n                            historyTrackRowRefs");
    expect(at).toBeGreaterThan(-1);
    const block = app.slice(at - 200, at);
    expect(block).toMatch(/key: `\$\{track\.id\}\|\$\{track\.playedAt \?\? index\}`,/);
  });
});

describe('Collection: Albums', () => {
  const collectionPage = read('components', 'collection-page.js');
  const cards = read('components', 'cards.js');

  test('album cards are keyed by album id, never by position', () => {
    expect(collectionPage).not.toMatch(/key: `\$\{album\.title\}-\$\{album\.artist\}-\$\{index\}`/);
    const at = collectionPage.indexOf('React.createElement(CollectionAlbumCard, {');
    expect(collectionPage.slice(at, at + 120)).toMatch(/key: albumKey\(album\),/);
    expect(collectionPage).toMatch(/const base = album\.id \|\| `\$\{album\.artist\}\|\$\{album\.title\}`;/);
    // a repeated id still gets a key of its own
    expect(collectionPage).toMatch(/return n === 1 \? base : `\$\{base\}#\$\{n\}`;/);
  });

  test('a late broken-art answer only paints the album the card still shows', () => {
    const at = cards.indexOf('const CollectionAlbumCard = (');
    const card = cards.slice(at, cards.indexOf('\n};\n', at));
    expect(card).toMatch(/shownAlbumRef\.current = `\$\{album\.artist\}\|\$\{album\.title\}`;/);
    expect(card).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
    expect(card).toMatch(/const forAlbum = shownAlbumRef\.current;/);
    expect(card).toMatch(/if \(url && mountedRef\.current && shownAlbumRef\.current === forAlbum\) setImageUrl\(url\);/);
  });
});

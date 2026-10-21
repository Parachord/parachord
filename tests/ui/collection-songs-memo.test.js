/**
 * Collection → Songs list cost. The list is the local library merged with
 * collection tracks, deduplicated, filtered and sorted. It used to be built
 * inline in the render, and every state change in the app re-renders the
 * whole tree, so it was rebuilt (every track object copied, the full list
 * re-sorted) on every render while the tab was open: about 60 ms per render
 * on a 150k-track library, well past a 16 ms frame. It is now a useMemo on
 * its real inputs. This pins that it stays out of the render path.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
// The Songs tab now lives in the Collection page module (Track 2b split).
const page = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'collection-page.js'), 'utf8');

describe('Collection songs list is memoized', () => {
  test('built once per input change, at component scope', () => {
    expect(app).toMatch(/const collectionSongsSorted = useMemo\(\(\) => \{/);
    expect(app).toMatch(/\}, \[library, collectionData\.tracks, filterCollectionItems, sortCollectionItems\]\);/);
  });

  test('tracks with an id are reused, not copied (in-place enrichment must show through)', () => {
    expect(app).toMatch(/trackMap\.set\(trackId, track\.id \? track : \{ \.\.\.track, id: trackId \}\);/);
  });

  test('the Songs tab reads the memo instead of rebuilding the list', () => {
    const start = page.indexOf("collectionTab === 'tracks' && (() => {");
    expect(start).toBeGreaterThan(-1);
    const body = page.slice(start, page.indexOf('React.createElement(VirtualizedTrackList', start));
    expect(body).toMatch(/const sorted = collectionSongsSorted;/);
    expect(body).not.toMatch(/\[\.\.\.library, \.\.\.collectionData\.tracks\]/);
    expect(body).not.toMatch(/sortCollectionItems\(/);
  });

  test('the memo is declared after everything its dependency list reads', () => {
    // A useMemo's deps are evaluated during render, so a dep declared later
    // in the component is a TDZ crash (see CLAUDE.md "useEffect dep array TDZ").
    const memoAt = app.indexOf('const collectionSongsSorted = useMemo(');
    for (const decl of [
      'const [library, setLibrary] = useState(',
      'const [collectionData, setCollectionData] = useState(',
      'const filterCollectionItems = useCallback(',
      'const sortCollectionItems = useCallback(',
    ]) {
      const at = app.indexOf(decl);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(memoAt);
    }
  });
});

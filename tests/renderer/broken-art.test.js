/**
 * Recovering from a dead cached cover. A Bandcamp cover URL carries an image
 * id that changes when the artist replaces the art, so a 90-day album-art
 * cache entry can 404 within days (Quarantine Angst "Cavalcade of
 * Indignities", 2026-10). The cards showed the placeholder and the dead URL
 * kept winning; now the entry is dropped and the pipeline retried once.
 */

const fs = require('fs');
const path = require('path');
const { createBrokenArtRetry } = require('../../src/renderer/lib/broken-art');

const DEAD = 'https://f4.bcbits.com/img/4225965079_10.jpg';
const FRESH = 'https://f4.bcbits.com/img/9999999999_10.jpg';
const INFO = { artist: 'Quarantine Angst', album: 'Cavalcade of Indignities', releaseId: 'rg-1' };

const setup = ({ refetch = async () => FRESH } = {}) => {
  const cache = {
    'resolver:quarantine angst-cavalcade of indignities': { url: DEAD, timestamp: 1 },
    'rg-1': { url: DEAD, timestamp: 1 },
    'other-release': { url: 'https://example.org/ok.jpg', timestamp: 1 },
  };
  const session = { 'quarantine angst-cavalcade of indignities': DEAD, 'x-y': 'https://example.org/ok.jpg' };
  const calls = [];
  const retry = createBrokenArtRetry({
    getCache: () => cache,
    getSessionCache: () => session,
    refetch: async (artist, album) => { calls.push([artist, album]); return refetch(artist, album); },
    now: () => 42,
  });
  return { retry, cache, session, calls };
};

describe('createBrokenArtRetry', () => {
  test('drops every entry holding the dead URL, refetches, and records the fresh one', async () => {
    const { retry, cache, session, calls } = setup();
    await expect(retry.report(DEAD, INFO)).resolves.toBe(FRESH);
    expect(calls).toEqual([['Quarantine Angst', 'Cavalcade of Indignities']]);
    expect(cache['resolver:quarantine angst-cavalcade of indignities']).toBeUndefined();
    expect(cache['rg-1']).toEqual({ url: FRESH, timestamp: 42 });
    expect(cache['other-release'].url).toBe('https://example.org/ok.jpg');
    expect(session['quarantine angst-cavalcade of indignities']).toBeUndefined();
    expect(session['x-y']).toBe('https://example.org/ok.jpg');
  });

  test('the cache entries are dropped before the refetch runs (so the pipeline cannot return them)', async () => {
    let seenDuringRefetch;
    const { retry, cache } = setup({
      refetch: async () => { seenDuringRefetch = JSON.stringify(cache); return FRESH; },
    });
    await retry.report(DEAD, INFO);
    expect(seenDuringRefetch).not.toContain(DEAD);
  });

  test('one attempt per album per session, shared by concurrent callers', async () => {
    const { retry, calls } = setup();
    const [a, b] = await Promise.all([retry.report(DEAD, INFO), retry.report(DEAD, INFO)]);
    expect(a).toBe(FRESH);
    expect(b).toBe(FRESH);
    // A replacement that also fails reports again: no second lookup, no loop.
    await retry.report(FRESH, INFO);
    expect(calls).toHaveLength(1);
  });

  test('nothing found, the same dead URL again, or a thrown lookup resolve to null', async () => {
    await expect(setup({ refetch: async () => null }).retry.report(DEAD, INFO)).resolves.toBeNull();
    await expect(setup({ refetch: async () => DEAD }).retry.report(DEAD, INFO)).resolves.toBeNull();
    await expect(setup({ refetch: async () => { throw new Error('offline'); } }).retry.report(DEAD, INFO)).resolves.toBeNull();
  });

  test('without a URL, artist or album there is nothing to retry', async () => {
    const { retry, calls } = setup();
    await expect(retry.report('', INFO)).resolves.toBeNull();
    await expect(retry.report(DEAD, { album: 'x' })).resolves.toBeNull();
    await expect(retry.report(DEAD, { artist: 'x' })).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('no release id: the fresh URL is returned but nothing is written under an id', async () => {
    const { retry, cache } = setup();
    await retry.report(DEAD, { artist: INFO.artist, album: INFO.album });
    expect(Object.values(cache).some((e) => e.url === FRESH)).toBe(false);
  });
});

describe('wiring', () => {
  const root = path.join(__dirname, '..', '..');
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const cards = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'cards.js'), 'utf8');

  test('app.js exposes the retry on window, built over the shared caches and getAlbumArt', () => {
    expect(app).toMatch(/getCache: \(\) => albumArtCache\.current,/);
    expect(app).toMatch(/getSessionCache: \(\) => resolverArtCache\.current,/);
    expect(app).toMatch(/refetch: \(artist, album\) => getAlbumArtLatestRef\.current\(artist, album\),/);
    expect(app).toMatch(/window\.reportBrokenAlbumArt = brokenArtRetryRef\.current\.report;/);
  });

  test('the album-cover surfaces report a failed <img> instead of only hiding it', () => {
    const slice = (name) => {
      const start = cards.indexOf(`const ${name} = (`);
      return cards.slice(start, cards.indexOf('\n};\n', start));
    };
    for (const name of ['ReleaseCard', 'ReleasePage']) {
      expect(slice(name)).toContain('globalThis.reportBrokenAlbumArt');
    }
    // The artist page's cards are the shared AlbumCard, handed the retry.
    expect(slice('ReleaseCard')).toMatch(/React\.createElement\(AlbumCard, \{[\s\S]*\bonArtError,/);
    // Every album grid's card (the old CollectionAlbumCard among them) is
    // components/album-card.js's AlbumCard: a cover it looked up itself
    // (getAlbumArt) is reported to the pipeline, and its img (card-art.js's
    // ArtBox) hands a failed load to that report.
    const albumCard = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'album-card.js'), 'utf8');
    expect(albumCard).toContain('globalThis.reportBrokenAlbumArt');
    expect(albumCard).toMatch(/e\(ArtBox, \{ imageUrl: coverUrl, item: album, onArtError: reportArt,/);
    const cardArt = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'card-art.js'), 'utf8');
    expect(cardArt).toMatch(/onError: \(\) => \{ setDeadCoverUrl\(imageUrl\); fail\(\); \},/);
  });

  // Fresh Drops, Pop of the Tops and Critical Darlings draw their covers from
  // their own list state in app.js (Fresh Drops' copy is persisted in
  // cache_new_releases), so the retry has to patch that list. A hidden img is
  // never reused for the fresh URL: onError hides the element, and React
  // would otherwise reuse it. Critical Darlings keys its img on the URL;
  // Fresh Drops and Pop of the Tops hand the list's URL to the shared
  // AlbumCard, whose ArtBox drops a dead cover and shows a new URL afresh
  // (see the ArtBox test below and album-card-behaviour.test.js).
  test.each([
    // Fresh Drops is its own module (components/fresh-drops-page.js, #1451).
    ['new-releases', /retryBrokenListArt\(release\.albumArt, \{ artist: release\.artist, album: release\.title, id: release\.id, cacheId: release\.id \}/, /e\(AlbumCard, Object\.assign\(\{[\s\S]{0,200}?imageUrl: release\.albumArt \}/],
    ['discover', /retryBrokenListArt\(item\.albumArt, \{ artist: item\.artist, album: item\.title, id: item\.id \}, patchListArt\(setCharts\)\)/, /React\.createElement\(AlbumCard, Object\.assign\(\{[\s\S]{0,200}?imageUrl: item\.albumArt \|\| null \}/],
    ['critics-picks', /retryBrokenListArt\(album\.albumArt, \{ artist: album\.artist, album: album\.title, id: album\.id \}, patchListArt\(setCriticsPicks\)\)/, /key: album\.albumArt,/],
  ])('the %s grid retries a dead cover and never reuses a hidden img for the fresh URL', (view, call, img) => {
    const fresh = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'fresh-drops-page.js'), 'utf8');
    const start = app.indexOf(`activeView === '${view}' && React.createElement`);
    // Fresh Drops, Charts and Critical Darlings are their own modules (#1451).
    if (!['new-releases', 'discover', 'critics-picks'].includes(view)) expect(start).toBeGreaterThan(-1);
    const charts = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'charts-page.js'), 'utf8');
    const critics = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'critics-picks-page.js'), 'utf8');
    const body = { 'new-releases': fresh, discover: charts, 'critics-picks': critics }[view] || app.slice(start, start + 60000);
    expect(body).toMatch(call);
    expect(body).toMatch(img);
  });

  test("the shared card's ArtBox forgets a dead cover when the URL changes (replaces the per-grid img key)", () => {
    const cardArt = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'card-art.js'), 'utf8');
    expect(cardArt).toContain('React.useEffect(() => { setDeadCoverUrl(null); }, [imageUrl]);');
    expect(cardArt).toContain('const cover = imageUrl && deadCoverUrl !== imageUrl ? imageUrl : null;');
  });

  test('Fresh Drops patches through its art writer, so the persisted copy is fixed too', () => {
    const fresh = fs.readFileSync(path.join(root, 'src', 'renderer', 'components', 'fresh-drops-page.js'), 'utf8');
    const at = fresh.indexOf('retryBrokenListArt(release.albumArt');
    expect(fresh.slice(at, at + 400)).toMatch(/newReleasesArtWriterRef\.current\.queue\(id, fresh\);\s*newReleasesArtWriterRef\.current\.flush\(\);/);
  });
});

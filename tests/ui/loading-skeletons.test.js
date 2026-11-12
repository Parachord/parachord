/**
 * Loading skeletons that must match the content they stand in for.
 *
 * - Recommendations → Artists (the default tab) rendered nothing while the
 *   recommendations were fetched: 86dd867 removed its skeleton as a "double
 *   skeleton", but the cards that shimmer their own images only exist once
 *   the fetch returns. The sectioned page (#1309) has its skeletons in
 *   src/renderer/components/recommendation-skeletons.js: cards, song rows,
 *   whole sections, a provider still loading, a page still being fetched.
 * - Critical Darlings' skeleton was a different box from the album cards
 *   (112px cover vs 180px, 16px vs 12px padding, bordered white box vs the
 *   card background), so the list jumped when the picks arrived.
 *
 * The checks read the real cards' dimensions out of the source and require the
 * skeleton to use the same ones, so a restyle of either fails here.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

describe('Recommendations skeletons match the sectioned page', () => {
  const skel = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'recommendation-skeletons.js'), 'utf8');
  const view = app.slice(app.indexOf("activeView === 'recommendations' && React.createElement"));
  const loading = view.slice(view.indexOf('recommendations.loading && sections.length === 0 ?'), view.indexOf(": recommendations.error === 'not_configured' ?"));
  const renderSection = view.slice(view.indexOf('const renderSection = (section) => {'));
  const songRow = view.slice(view.indexOf('const songRow = (item, index, allSongs, section) => {'), view.indexOf('// ── One section'));
  const artistCard = view.slice(view.indexOf('const artistCard = (item, index) => {'), view.indexOf('const albumCard = (item, index) => {'));

  test('the empty page renders the page skeleton', () => {
    expect(loading).toMatch(/React\.createElement\(RecommendationsPageSkeleton\)/);
  });

  test('same grid as the section cards', () => {
    const grid = "gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))'";
    expect(renderSection).toContain(grid);
    expect(skel).toContain(grid);
  });

  test('same card box', () => {
    expect(artistCard).toMatch(/backgroundColor: 'var\(--card-bg\)', boxShadow: 'var\(--card-shadow\)'/);
    expect(skel).toMatch(/backgroundColor: 'var\(--card-bg\)', boxShadow: 'var\(--card-shadow\)'/);
    expect(artistCard).toMatch(/className: 'aspect-square relative group\/art'/);
    expect(skel).toMatch(/className: 'aspect-square shimmer-strong animate-shimmer'/);
    expect(artistCard).toMatch(/React\.createElement\('div', \{ className: 'p-3' \}/);
    expect(skel).toMatch(/React\.createElement\('div', \{ className: 'p-3' \}/);
  });

  test('same song row padding and columns', () => {
    expect(songRow).toMatch(/flex items-center gap-4 py-3 px-4/);
    expect(skel).toMatch(/className: 'flex items-center gap-4 py-3 px-4'/);
    expect(songRow).toMatch(/style: \{ borderRadius: '8px', marginBottom: '2px' \}/);
    expect(skel).toMatch(/style: \{ borderRadius: '8px', marginBottom: '2px' \}/);
    for (const col of ["width: '32px'", "flex: '1 1 0', minWidth: 0", "flex: '0.7 1 0', minWidth: 0", "width: '50px'", "width: '140px', flexShrink: 0, minHeight: '24px'"]) {
      expect(songRow).toContain(col);
      expect(skel).toContain(col);
    }
  });

  test('a skeleton section holds what a collapsed section shows', () => {
    const preview = view.match(/const SECTION_PREVIEW = (\d+);/)[1];
    const songs = view.match(/const SONG_PREVIEW = (\d+);/)[1];
    expect(skel).toContain(`const CARD_PREVIEW = ${preview};`);
    expect(skel).toContain(`const SONG_PREVIEW = ${songs};`);
  });

  test('providers still loading and Shuffleupagus thinking get section skeletons', () => {
    // One unlabeled skeleton: a provider can answer "not ready" (Amazon Music
    // active without a subscription), so naming one promised sections that
    // never came (#1328 review).
    expect(view).toMatch(/recommendationsPending\.length > 0 && React\.createElement\(RecommendationSectionSkeleton, \{\s*key: 'rec-pending'\s*\}\)/);
    expect(view).not.toMatch(/badge: p\.name/);
    // Where the providers' rows land: after the type sections on screen
    // (Shuffleupagus no longer has a section of its own; its picks blend into
    // the For you rows), with the LLM's thinking skeleton after it.
    const list = view.slice(view.indexOf('...typeSection.rows.map(renderSection)'));
    expect(list.indexOf('recommendationsPending.length > 0 &&')).toBeGreaterThan(0);
    expect(list.indexOf('llmLoading && React.createElement(RecommendationSectionSkeleton, {'))
      .toBeGreaterThan(list.indexOf('recommendationsPending.length > 0 &&'));
  });

  test('an expanded section loading its next page shows placeholder cards and rows', () => {
    expect(renderSection).toMatch(/const showLoadingTail = loadingMore && expanded;/);
    expect(renderSection).toMatch(/showLoadingTail && songItems\.length === 0[\s\S]{0,120}RecommendationCardSkeleton/);
    expect(renderSection).toMatch(/showLoadingTail[\s\S]{0,120}RecommendationSongRowSkeleton/);
  });

  test('the pending list is set before the provider fetch and cleared once results apply', () => {
    const load = app.slice(app.indexOf('const providers = metaOnly'), app.indexOf('// "Load more" for a titled section'));
    const set = load.indexOf('setRecommendationsPending(toFetch');
    const fetch = load.indexOf('...toFetch.map(async (provider) => {');
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(fetch);
    // Each provider leaves the list as its answer lands; the round's end clears it.
    expect(load).toMatch(/applyFresh\(\);\s*if \(isLatest\(\)\) setRecommendationsPending\(prev => prev\.filter\(p => p\.id !== provider\.id\)\);/);
    expect(load.slice(load.indexOf('saveRecommendationsCache();'))).toMatch(/if \(!isLatest\(\)\) return;\s*setRecommendationsPending\(\[\]\);/);
    // Only providers with nothing on screen get one (a refresh updates in place).
    expect(load).toMatch(/\.filter\(p => !\(\(providerSectionsRef\.current\[p\.id\] \|\| \{\}\)\.sections \|\| \[\]\)\.length\)/);
    // ...and not a provider whose last answer had nothing (empty or not ready).
    expect(load).toMatch(/\.filter\(p => !recommendationsQuietRef\.current\.has\(p\.id\)\)/);
  });

  test('a provider is marked quiet by an empty or not-ready answer, and cleared by one with sections', () => {
    const load = app.slice(app.indexOf('const providers = metaOnly'), app.indexOf('// "Load more" for a titled section'));
    expect(load).toMatch(/if \(fresh\[provider\.id\]\.sections\.length > 0\) recommendationsQuietRef\.current\.delete\(provider\.id\);\s*else recommendationsQuietRef\.current\.add\(provider\.id\);/);
    expect(load).toMatch(/if \(error\?\.notReady\) \{[\s\S]{0,400}?recommendationsQuietRef\.current\.add\(provider\.id\);/);
  });
});

describe('Recommendations skeleton components render', () => {
  global.React = global.React || require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const {
    RecommendationsPageSkeleton,
    RecommendationSectionSkeleton
  } = require('../../src/renderer/components/recommendation-skeletons');
  const count = (html, needle) => html.split(needle).length - 1;

  test('the page skeleton is two card sections and a song section', () => {
    const html = renderToStaticMarkup(React.createElement(RecommendationsPageSkeleton));
    expect(count(html, 'aspect-square')).toBe(12);
    expect(count(html, 'flex items-center gap-4 py-3 px-4')).toBe(5);
  });

  test('a section skeleton shows a known title, badge and note as text', () => {
    const html = renderToStaticMarkup(React.createElement(RecommendationSectionSkeleton, { title: 'Shuffleupagus', badge: 'Amazon Music', note: 'thinking…', count: 3 }));
    expect(html).toContain('Shuffleupagus');
    expect(html).toContain('Amazon Music');
    expect(html).toContain('thinking…');
    expect(count(html, 'aspect-square')).toBe(3);
  });
});

describe('Critical Darlings skeleton matches the album cards', () => {
  const view = app.slice(app.indexOf("activeView === 'critics-picks' && React.createElement"));
  const skeleton = view.slice(view.indexOf('// Skeleton loading state'), view.indexOf('// Albums grid with filter/sort'));
  const cards = view.slice(view.indexOf('// Albums grid with filter/sort'));

  const cardStyle = cards.slice(cards.indexOf("className: 'group flex gap-4 cursor-grab"), cards.indexOf('draggable: true'));
  const coverStyle = cards.slice(cards.indexOf('album-art-container'), cards.indexOf('background: album.albumArt === null'));

  test('same list spacing and card gap', () => {
    expect(cards).toMatch(/return React\.createElement\('div', \{\s*className: 'space-y-3 pb-6'/);
    expect(skeleton).toMatch(/className: 'space-y-3 pb-6'/);
    expect(cardStyle).toMatch(/flex gap-4/);
    expect(skeleton).toMatch(/className: 'flex gap-4',/);
  });

  test('same card padding, radius, background and shadow', () => {
    for (const [prop, value] of [['padding', "'12px'"], ['borderRadius', "'10px'"], ['backgroundColor', "'var(--card-bg)'"], ['boxShadow', "'var(--card-shadow)'"]]) {
      expect(cardStyle).toContain(`${prop}: ${value}`);
      expect(skeleton).toContain(`${prop}: ${value}`);
    }
  });

  test('same cover size and radius', () => {
    expect(coverStyle).toMatch(/width: '180px',\s*height: '180px',/);
    expect(coverStyle).toMatch(/borderRadius: '8px'/);
    expect(skeleton).toMatch(/width: '180px', height: '180px', flexShrink: 0, borderRadius: '8px'/);
  });

  test('the old 112px box is gone', () => {
    expect(skeleton).not.toMatch(/w-28 h-28|bg-white rounded-xl border/);
  });
});

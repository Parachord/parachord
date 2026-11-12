/**
 * Loading skeletons that must match the content they stand in for.
 *
 * - Recommendations → Artists (the default tab) rendered nothing while the
 *   recommendations were fetched: 86dd867 removed its skeleton as a "double
 *   skeleton", but the cards that shimmer their own images only exist once
 *   the fetch returns. The sectioned page (#1309) has its skeletons in
 *   src/renderer/components/recommendation-skeletons.js: cards, song rows,
 *   friends, a subsection (header and row), the page (section headings then
 *   subsections), a provider still loading, a page still being fetched.
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
  const renderSubsection = view.slice(view.indexOf('const renderSubsection = (sub) => {'));
  const songRow = view.slice(view.indexOf('const songRow = (item, index, allSongs, section) => {'), view.indexOf('// ── Friends'));
  const friendCard = view.slice(view.indexOf('const friendCard = (item, index) => {'), view.indexOf('// ── One subsection'));
  const artistCard = view.slice(view.indexOf('const artistCard = (item, index) => {'), view.indexOf('const albumCard = (item, index) => {'));

  test('the empty page renders the page skeleton', () => {
    expect(loading).toMatch(/React\.createElement\(RecommendationsPageSkeleton\)/);
  });

  test('same grid as the section cards', () => {
    const grid = "gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))'";
    expect(renderSubsection).toContain(grid);
    expect(skel).toContain(grid);
  });

  test('same grid, card box and hexagon as the friend cards', () => {
    const grid = "gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))'";
    expect(renderSubsection).toContain(grid);
    expect(skel).toContain(grid);
    for (const part of ["padding: '14px 12px'", "borderRadius: '10px'", "width: '100px', height: '100px'"]) {
      expect(friendCard).toContain(part);
      expect(skel).toContain(part);
    }
    // The hexagon is Collection -> Friends' clip-path, verbatim.
    const collection = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'collection-page.js'), 'utf8');
    const hex = collection.match(/clipPath: '(polygon\([^']+\))'/)[1];
    expect(friendCard).toContain(hex);
    expect(skel).toContain(hex);
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

  test('providers still loading get one unlabeled skeleton after the content sections, before Friends', () => {
    // One unlabeled skeleton: a provider can answer "not ready" (Amazon Music
    // active without a subscription), so naming one promised sections that
    // never came (#1328 review).
    expect(view).toMatch(/recommendationsPending\.some\(p => !p\.friends\) && React\.createElement\(RecommendationSubsectionSkeleton, \{\s*key: 'rec-pending'/);
    expect(view).not.toMatch(/badge: p\.name/);
    // Friends is last, so a pending provider never pushes content down from above.
    const list = view.slice(view.indexOf('...contentBlocks,'));
    const pending = list.indexOf("key: 'rec-pending'");
    expect(pending).toBeGreaterThan(0);
    expect(list.indexOf('friendsSection && renderTypeSection(friendsSection)')).toBeGreaterThan(pending);
    // The old Shuffleupagus section skeleton is gone: its picks blend into the
    // For you rows, so its loading state is a tail on them.
    expect(view).not.toContain("title: 'Shuffleupagus'");
    expect(view).not.toContain('RecommendationSectionSkeleton');
  });

  test('Shuffleupagus thinking: a card tail on the Albums and Artists For you rows, or one subsection skeleton when neither exists', () => {
    // Only while there are no picks to show (a refresh keeps the cached batch as real cards).
    expect(view).toMatch(/const llmHasPicks = !!\(ai && \(\(ai\.albums \|\| \[\]\)\.length > 0 \|\| \(ai\.artists \|\| \[\]\)\.length > 0\)\);/);
    expect(view).toMatch(/const llmLoading = !!ai\?\.loading && !llmHasPicks;/);
    expect(view).toMatch(/const LLM_TAIL_ROWS = new Set\(\['foryou:album', 'foryou:artist'\]\);/);
    expect(renderSubsection).toMatch(/const llmTail = llmLoading && LLM_TAIL_ROWS\.has\(sub\.key\) \? LLM_TAIL : 0;/);
    expect(renderSubsection).toMatch(/Array\.from\(\{ length: llmTail \}[\s\S]{0,160}RecommendationCardSkeleton/);
    // The tail trails the row's real preview, never replaces it: a collapsed
    // row shows its full preview, and See all is measured against that.
    expect(renderSubsection).toMatch(/const visible = expanded \? items : items\.slice\(0, preview\);/);
    expect(renderSubsection).toMatch(/const canExpand = items\.length > preview;/);
    expect(renderSubsection).not.toMatch(/preview - llmTail/);
    const grid = renderSubsection.slice(renderSubsection.indexOf('...visible.map((item, index) => cardFor(item, index, sub))'));
    expect(grid.indexOf('...visible.map((item, index) => cardFor(item, index, sub))')).toBe(0);
    expect(grid.indexOf('Array.from({ length: llmTail }')).toBeGreaterThan(0);
    expect(view).toMatch(/const llmPlaceholder = llmLoading && !allSubsections\.some\(s => LLM_TAIL_ROWS\.has\(s\.key\)\);/);
    expect(view).toMatch(/llmPlaceholder && React\.createElement\(RecommendationSubsectionSkeleton, \{ key: 'rec-llm'/);
  });

  test('Friends shows hexagon skeletons while its answer is pending and nothing is cached', () => {
    expect(view).toMatch(/const friendsPending = recommendationsPending\.some\(p => p\.friends\);/);
    expect(view).toMatch(/!friendsSection && friendsPending && React\.createElement\(RecommendationSubsectionSkeleton, \{ key: 'rec-friends-pending', kind: 'friends'/);
    // The pending entry is added only for a lookup with nothing cached to
    // show, and leaves the list when that lookup settles.
    const load = app.slice(app.indexOf('const providers = metaOnly'), app.indexOf('// "Load more" for a titled section'));
    expect(load).toMatch(/\.concat\(similarToFetch\s*\.filter\(p => !similarStale\[p\.id\]\)\s*\.map\(p => \(\{ id: `friends:\$\{p\.id\}`, name: p\.name \|\| p\.id, friends: true \}\)\)\)/);
    const fetchBlock = load.slice(load.indexOf('const fetchSimilarUsers = async (provider) => {'), load.indexOf('await Promise.all(['));
    expect(fetchBlock).toMatch(/applyFresh\(\);\s*if \(isLatest\(\)\) setRecommendationsPending\(prev => prev\.filter\(p => p\.id !== `friends:\$\{provider\.id\}`\)\);/);
  });

  test('an expanded split loading its next page shows placeholders only while its pages bring it items', () => {
    // In flight per provider section (the splits share a cursor), shown per
    // split: a page that brought this split nothing of its type (the provider
    // section paging for its other splits) ends this split's tail.
    expect(renderSubsection).toMatch(/const loadingMore = !!recommendationsLoadingMore\[sub\.pagingKey\];/);
    expect(renderSubsection).toMatch(/const expansion = expandedSections\[sub\.pagingKey\];/);
    expect(renderSubsection).toMatch(/const lastPageHadMine = !expansion \|\| !Array\.isArray\(expansion\.lastPageTypes\) \|\| expansion\.lastPageTypes\.includes\(sub\.type\);/);
    expect(renderSubsection).toMatch(/const showLoadingTail = loadingMore && expanded && lastPageHadMine;/);
    expect(renderSubsection).toMatch(/showLoadingTail[\s\S]{0,200}RecommendationCardSkeleton/);
    expect(renderSubsection).toMatch(/showLoadingTail[\s\S]{0,200}RecommendationSongRowSkeleton/);
    // The page fetch records which types it brought.
    const more = app.slice(app.indexOf('const loadMoreRecommendationSection = async'), app.indexOf('// Re-merge when a "load more" answered'));
    expect(more).toMatch(/lastPageTypes: \[\.\.\.new Set\(result\.items\.map\(i => i && i\.type\)\.filter\(Boolean\)\)\]/);
    expect(more).toMatch(/exhausted: true, lastPageTypes: \[\]/);
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
  const skeletons = require('../../src/renderer/components/recommendation-skeletons');
  const {
    RecommendationsPageSkeleton,
    RecommendationSubsectionSkeleton,
    RecommendationFriendSkeleton
  } = skeletons;
  const count = (html, needle) => html.split(needle).length - 1;
  const render = (C, props) => renderToStaticMarkup(React.createElement(C, props));

  test('the page skeleton is a Songs section and an Albums section, each heading then a subsection header with a tag bar', () => {
    const html = render(RecommendationsPageSkeleton);
    // Albums: one collapsed card row; Songs: one collapsed song list.
    expect(count(html, 'aspect-square')).toBe(6);
    expect(count(html, 'flex items-center gap-4 py-3 px-4')).toBe(5);
    expect(count(html, 'data-skeleton="section-heading"')).toBe(2);
    expect(count(html, 'data-skeleton="tag"')).toBe(2);
    expect(html.indexOf('data-skeleton="section-heading"')).toBeLessThan(html.indexOf('data-skeleton="tag"'));
    // Songs first, as on the page.
    expect(html.indexOf('flex items-center gap-4 py-3 px-4')).toBeLessThan(html.indexOf('aspect-square'));
  });

  test('a subsection skeleton draws its header (title and tag bars) and the row its kind shows', () => {
    const songs = render(RecommendationSubsectionSkeleton, { kind: 'songs' });
    expect(count(songs, 'flex items-center gap-4 py-3 px-4')).toBe(5);
    expect(count(songs, 'data-skeleton="tag"')).toBe(1);
    const cards = render(RecommendationSubsectionSkeleton, { kind: 'cards', lines: 2 });
    expect(count(cards, 'aspect-square')).toBe(6);
    const friends = render(RecommendationSubsectionSkeleton, { kind: 'friends' });
    expect(count(friends, 'data-skeleton="friend"')).toBe(6);
  });

  test('a friend skeleton is a hexagon placeholder', () => {
    const html = render(RecommendationFriendSkeleton, { index: 2 });
    expect(html).toContain('data-skeleton="friend"');
    expect(html).toContain('clip-path:polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)');
  });

  test('every skeleton export renders aria-hidden', () => {
    for (const [name, C] of Object.entries(skeletons)) {
      expect([name, render(C)]).toEqual([name, expect.stringMatching(/^<div[^>]*aria-hidden="true"/)]);
    }
  });

  test('the titled section skeleton is gone (Shuffleupagus has no section any more)', () => {
    expect(skeletons.RecommendationSectionSkeleton).toBeUndefined();
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

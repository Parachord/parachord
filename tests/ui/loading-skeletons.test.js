/**
 * Loading skeletons that must match the content they stand in for.
 *
 * - Recommendations → Artists (the default tab) rendered nothing while the
 *   recommendations were fetched: 86dd867 removed its skeleton as a "double
 *   skeleton", but the cards that shimmer their own images only exist once
 *   the fetch returns. The sectioned page (#1309) has its skeletons in
 *   src/renderer/components/recommendation-skeletons.js: cards, song rows,
 *   friends, a section (heading and row), the page, a provider still
 *   loading, a page still being fetched.
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
  const loading = view.slice(view.indexOf('recommendations.loading && allSections.length === 0 ?'), view.indexOf(": recommendations.error === 'not_configured' ?"));
  const renderSubsection = view.slice(view.indexOf('const renderSubsection = (sub) => {'));
  const songRow = view.slice(view.indexOf('const songRow = (item, index, allSongs, section) => {'), view.indexOf('// ── Friends'));
  const friendCard = view.slice(view.indexOf('const friendCard = (item, index, row) => {'), view.indexOf("// ── One section's row"));
  const artistCard = view.slice(view.indexOf('const artistCard = (item, index) => {'), view.indexOf('const albumCard = (item, index) => {'));

  test('the empty page renders the page skeleton', () => {
    expect(loading).toMatch(/React\.createElement\(RecommendationsPageSkeleton, \{ cardCount: SECTION_PREVIEW \}\)/);
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
    // The text block: name (20px after a 10px gap), source (16px), artists (two 16px lines).
    expect(friendCard).toContain("style: { marginTop: '2px', height: '16px', color: 'var(--text-secondary)' }");
    expect(friendCard).toContain("marginTop: '2px', height: '32px', lineHeight: '16px'");
    expect(skel).toContain("height: '32px'");
    for (const part of ["padding: '14px 12px'", "borderRadius: '10px'", "width: '100px', height: '100px'", "marginTop: '10px', height: '20px'"]) {
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

  test('a collapsed section shows two full rows of cards (one of people), measured, and a skeleton section the same', () => {
    // The page measures how many cards fit across (the grids' minimums and
    // 16px gap inside the p-6 box); a collapsed card section shows two full
    // rows and Listeners one, so See all only adds rows.
    const effect = app.slice(app.indexOf('// Measure the Recommendations grids\' column count'), app.indexOf('}, [activeView, recommendationsScrollContainerReady]);'));
    expect(effect).toContain('const width = Math.max(0, el.clientWidth - 48);');
    expect(effect).toContain('const fit = (min) => Math.max(1, Math.floor((width + 16) / (min + 16)));');
    expect(effect).toContain('const next = { cards: fit(160), friends: fit(150) };');
    // Only a changed count is a state write (every setState is a full-app render).
    expect(effect).toContain('prev.cards === next.cards && prev.friends === next.friends ? prev : next');
    expect(effect).toContain('observer.disconnect()');
    expect(view).toContain('const CARD_ROWS = 2;');
    expect(view).toContain('const SECTION_PREVIEW = (recommendationsGridColumns.cards || 6) * CARD_ROWS;');
    expect(view).toContain('const FRIEND_PREVIEW = recommendationsGridColumns.friends || 6;');
    expect(renderSubsection).toContain("const preview = isSongs ? SONG_PREVIEW : sub.type === 'friend' ? FRIEND_PREVIEW : SECTION_PREVIEW;");
    expect(skel).toContain('const CARD_PREVIEW = 6;');
    const songs = view.match(/const SONG_PREVIEW = (\d+);/)[1];
    expect(skel).toContain(`const SONG_PREVIEW = ${songs};`);
  });

  test('providers still loading get one unlabeled skeleton after the content sections, before Friends', () => {
    // One unlabeled skeleton: a provider can answer "not ready" (Amazon Music
    // active without a subscription), so naming one promised sections that
    // never came (#1328 review). Only on All: a source pick shows what that
    // source sent.
    expect(view).toMatch(/!filteringOne && recommendationsPending\.some\(p => !p\.friends\) && React\.createElement\(RecommendationSectionSkeleton, \{\s*key: 'rec-pending', count: SECTION_PREVIEW\s*\}/);
    expect(view).not.toMatch(/badge: p\.name/);
    // Friends is last, so a pending provider never pushes content down from above.
    const list = view.slice(view.indexOf('...contentBlocks,'));
    const pending = list.indexOf("key: 'rec-pending'");
    expect(pending).toBeGreaterThan(0);
    expect(list.indexOf('friendsSection && renderTypeSection(friendsSection)')).toBeGreaterThan(pending);
    expect(view).not.toContain("title: 'Shuffleupagus'");
  });

  test('Shuffleupagus thinking: a card tail on the Albums and Artists rows, or one Albums section skeleton when neither exists', () => {
    // Only while there are no picks to show (a refresh keeps the cached batch as real cards).
    expect(view).toMatch(/const llmHasPicks = !!\(ai && \(\(ai\.albums \|\| \[\]\)\.length > 0 \|\| \(ai\.artists \|\| \[\]\)\.length > 0\)\);/);
    expect(view).toMatch(/const llmLoading = !!ai\?\.loading && !llmHasPicks;/);
    expect(view).toMatch(/const LLM_TAIL_ROWS = new Set\(\['type:album', 'type:artist'\]\);/);
    expect(renderSubsection).toMatch(/const llmTail = llmLoading && LLM_TAIL_ROWS\.has\(sub\.key\) && \(!filteringOne \|\| activeSourceFilter === 'shuffleupagus'\) \? LLM_TAIL : 0;/);
    expect(renderSubsection).toMatch(/Array\.from\(\{ length: llmTail \}[\s\S]{0,160}RecommendationCardSkeleton/);
    // The tail trails the row's real preview, never replaces it.
    expect(renderSubsection).toMatch(/const visible = expanded \? items : items\.slice\(0, preview\);/);
    expect(renderSubsection).toMatch(/const canExpand = items\.length > preview;/);
    expect(renderSubsection).not.toMatch(/preview - llmTail/);
    const grid = renderSubsection.slice(renderSubsection.indexOf('...visible.map((item, index) => cardFor(item, index, sub))'));
    expect(grid.indexOf('...visible.map((item, index) => cardFor(item, index, sub))')).toBe(0);
    expect(grid.indexOf('Array.from({ length: llmTail }')).toBeGreaterThan(0);
    expect(view).toMatch(/const llmPlaceholder = llmLoading && !filteringOne && !allSubsections\.some\(s => LLM_TAIL_ROWS\.has\(s\.key\)\);/);
    // The slot is a whole section under the Albums heading its picks will
    // bring, placed after Songs.
    expect(view).toMatch(/llmPlaceholder && React\.createElement\(RecommendationSectionSkeleton, \{ key: 'type:album-pending', kind: 'cards', lines: 2, title: 'Albums', count: SECTION_PREVIEW \}\)/);
    expect(view.match(/contentBlocks\.push\(llmSlot\)/g) || []).toHaveLength(2);
  });

  test('Friends shows hexagon skeletons while its answer is pending and nothing is cached', () => {
    expect(view).toMatch(/const friendsPending = !filteringOne && recommendationsPending\.some\(p => p\.friends\);/);
    // Under the Friends heading the real section brings, so the page does
    // not reflow a heading in when the answer lands.
    expect(view).toMatch(/!friendsSection && friendsPending && React\.createElement\(RecommendationSectionSkeleton, \{ key: 'type:friend-pending', kind: 'friends', title: 'Listeners', count: FRIEND_PREVIEW \}\)/);
    // The pending entry is added only for a lookup with nothing cached to
    // show (and not for a provider whose last answer was empty: quiet), and
    // leaves the list when that lookup settles.
    const load = app.slice(app.indexOf('const providers = metaOnly'), app.indexOf('// "Load more" for a titled section'));
    expect(load).toMatch(/\.concat\(similarToFetch\s*\.filter\(p => !similarStale\[p\.id\] && !recommendationsQuietRef\.current\.has\(`friends:\$\{p\.id\}`\)\)\s*\.map\(p => \(\{ id: `friends:\$\{p\.id\}`, name: p\.name \|\| p\.id, friends: true \}\)\)\)/);
    const fetchBlock = load.slice(load.indexOf('const fetchSimilarUsers = async (provider) => {'), load.indexOf('await Promise.all(['));
    expect(fetchBlock).toMatch(/applyFresh\(\);\s*if \(isLatest\(\)\) setRecommendationsPending\(prev => prev\.filter\(p => p\.id !== `friends:\$\{provider\.id\}`\)\);/);
  });

  test('an open section loading its next page shows placeholders only while its pages bring it items', () => {
    // In flight per provider section (two types' rows can share one), shown
    // per row: a page that brought this row nothing of its type ends its tail.
    expect(renderSubsection).toMatch(/const showLoadingTail = expanded && \(sub\.pageable \|\| \[\]\)\.some\(p => \{/);
    expect(renderSubsection).toMatch(/if \(!recommendationsLoadingMore\[p\.pagingKey\]\) return false;/);
    expect(renderSubsection).toMatch(/return !expansion \|\| !Array\.isArray\(expansion\.lastPageTypes\) \|\| expansion\.lastPageTypes\.includes\(sub\.type\);/);
    expect(renderSubsection).toMatch(/showLoadingTail[\s\S]{0,200}RecommendationCardSkeleton/);
    expect(renderSubsection).toMatch(/showLoadingTail[\s\S]{0,200}RecommendationSongRowSkeleton/);
    // The page fetch records which types it brought.
    const more = app.slice(app.indexOf('const loadMoreRecommendationSection = async'), app.indexOf('// Re-merge when a "load more" answered'));
    expect(more).toMatch(/lastPageTypes: \[\.\.\.new Set\(result\.items\.map\(i => i && i\.type\)\.filter\(Boolean\)\)\]/);
    expect(more).toMatch(/exhausted: true, lastPageTypes: \[\]/);
  });

  test('the real section header and the skeleton header share the heading line', () => {
    const header = view.slice(view.indexOf('const subsectionHeader = (sub, { expanded, showToggle }) =>'), view.indexOf('const renderSubsection = (sub) => {'));
    for (const part of ["className: 'flex items-center justify-between gap-4 mb-4'", "minHeight: '28px'", "className: 'text-lg font-semibold truncate'"]) {
      expect(header).toContain(part);
      expect(skel).toContain(part);
    }
    expect(view).toMatch(/const renderTypeSection = \(section\) => React\.createElement\('div', \{ key: `type:\$\{section\.type\}`, className: 'mb-10' \}/);
    expect(skel).toContain("React.createElement('div', { className: 'mb-10', 'aria-hidden': 'true' }");
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
    RecommendationSectionSkeleton,
    RecommendationFriendSkeleton
  } = skeletons;
  const count = (html, needle) => html.split(needle).length - 1;
  const render = (C, props) => renderToStaticMarkup(React.createElement(C, props));

  test('the page skeleton is a Songs section then an Albums section, each with a heading', () => {
    const html = render(RecommendationsPageSkeleton);
    // Albums: one collapsed card row; Songs: one collapsed song list.
    expect(count(html, 'aspect-square')).toBe(6);
    expect(count(html, 'flex items-center gap-4 py-3 px-4')).toBe(5);
    expect(count(html, 'data-skeleton="section-heading"')).toBe(2);
    expect(count(html, 'data-skeleton="tag"')).toBe(0);
    // The page passes its measured cards-per-row.
    expect(count(render(RecommendationsPageSkeleton, { cardCount: 4 }), 'aspect-square')).toBe(4);
    // Songs first, as on the page.
    expect(html.indexOf('flex items-center gap-4 py-3 px-4')).toBeLessThan(html.indexOf('aspect-square'));
  });

  test('a section skeleton draws its heading (a bar, or the known title) and the row its kind shows', () => {
    const songs = render(RecommendationSectionSkeleton, { kind: 'songs' });
    expect(count(songs, 'flex items-center gap-4 py-3 px-4')).toBe(5);
    expect(songs).not.toContain('<h2');
    const cards = render(RecommendationSectionSkeleton, { kind: 'cards', lines: 2, title: 'Albums' });
    expect(count(cards, 'aspect-square')).toBe(6);
    expect(cards).toMatch(/<h2[^>]*>Albums<\/h2>/);
    const friends = render(RecommendationSectionSkeleton, { kind: 'friends', title: 'Listeners' });
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

  test('the subsection skeleton is gone (each section is one row)', () => {
    expect(skeletons.RecommendationSubsectionSkeleton).toBeUndefined();
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

describe('Home skeletons match the Home rows', () => {
  const dir = path.join(__dirname, '..', '..', 'src', 'renderer', 'components');
  const sections = fs.readFileSync(path.join(dir, 'home-sections.js'), 'utf8');
  const skeletons = fs.readFileSync(path.join(dir, 'home-skeletons.js'), 'utf8');
  const sk = require('../../src/renderer/components/home-skeletons');

  test('the row sizes are the spec values', () => {
    expect(sk.HOME_TILE_HEIGHT).toBe(72);
    expect(sk.HOME_ROW_CARDS).toBe(6);
    expect(sk.HOME_HALF_ROW_CARDS).toBe(3);
    expect(sk.HOME_CONCERT_CARDS).toBe(4);
  });

  test('card rows and their skeletons share one gap', () => {
    expect(sk.HOME_ROW_GAP).toBe(24);
    expect(sk.HOME_CARD_TEXT_GAP).toBe(10);
    expect(sections).toContain('${HOME_ROW_GAP}px');
    expect(skeletons).toContain('${HOME_ROW_GAP}px');
    expect(sections).toContain('${HOME_CARD_TEXT_GAP}px');
    expect(skeletons).toContain('${HOME_CARD_TEXT_GAP}px');
    expect(sections).not.toMatch(/minmax\(0, 1fr\)\)`, '16px'\)/);
  });

  test('both files use the same HOME_* constants', () => {
    for (const name of ['HOME_TILE_HEIGHT', 'HOME_ROW_CARDS', 'HOME_HALF_ROW_CARDS', 'HOME_CONCERT_CARDS']) {
      expect(sections).toContain(name);
      expect(skeletons).toContain(name);
    }
  });

  test('both files use the same grid strings', () => {
    const grids = (src) => new Set(src.match(/repeat\([^)]*, minmax\(0, 1fr\)\)/g));
    const inSections = grids(sections);
    expect(inSections.size).toBeGreaterThan(0);
    // The tiles and the concert cards are fixed grids in both files; the
    // card rows pass their count to CardRowSkeleton, which builds the same string.
    for (const g of ['repeat(4, minmax(0, 1fr))', 'repeat(${HOME_CONCERT_CARDS}, minmax(0, 1fr))']) {
      expect(inSections.has(g)).toBe(true);
      expect(grids(skeletons).has(g)).toBe(true);
    }
    expect(sections).toContain('repeat(${HOME_ROW_CARDS}, minmax(0, 1fr))');
    expect(sections).toContain('repeat(${HOME_HALF_ROW_CARDS}, minmax(0, 1fr))');
    expect(skeletons).toContain('repeat(${cols}, minmax(0, 1fr))');
  });

  test('the tile and card box match the real ones', () => {
    expect(sections).toContain('height: `${HOME_TILE_HEIGHT}px`');
    expect(skeletons).toContain('height: `${HOME_TILE_HEIGHT}px`');
    expect(sections).toMatch(/aspectRatio: '1'/);
    expect(skeletons).toContain('aspect-square');
  });

  test('skeletons render', () => {
    global.React = global.React || require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    expect(renderToStaticMarkup(React.createElement(sk.JumpBackInSkeleton))).toContain('shimmer');
    expect((renderToStaticMarkup(React.createElement(sk.CardRowSkeleton, { count: 6 })).match(/aspect-square/g) || []).length).toBe(6);
    expect((renderToStaticMarkup(React.createElement(sk.CardRowSkeleton, { count: 3, columns: 3 })).match(/aspect-square/g) || []).length).toBe(3);
    expect(renderToStaticMarkup(React.createElement(sk.ConcertRowSkeleton))).toContain('shimmer');
  });
});

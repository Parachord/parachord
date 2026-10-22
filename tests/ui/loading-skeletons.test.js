/**
 * Loading skeletons that must match the content they stand in for.
 *
 * - Recommendations → Artists (the default tab) rendered nothing while the
 *   recommendations were fetched: 86dd867 removed its skeleton as a "double
 *   skeleton", but the cards that shimmer their own images only exist once
 *   the fetch returns.
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

describe('Recommendations artists skeleton', () => {
  const view = app.slice(app.indexOf("activeView === 'recommendations' && React.createElement"));
  const loading = view.slice(view.indexOf('recommendations.loading ?'), view.indexOf(": recommendations.error === 'not_configured' ?"));
  const results = view.slice(view.indexOf("recommendationsTab === 'artists' && filteredArtists.length > 0"));

  test('the Artists tab renders a skeleton grid while loading', () => {
    expect(loading).not.toMatch(/recommendationsTab === 'artists' && null/);
    expect(loading).toMatch(/recommendationsTab === 'artists' && React\.createElement\('div', \{/);
    expect(loading).toMatch(/key: `rec-artist-skeleton-\$\{i\}`/);
  });

  test('it uses the cards\' grid and card box', () => {
    const grid = "gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))'";
    expect(results).toContain(grid);
    expect(loading).toContain(grid);
    expect(loading).toMatch(/className: 'aspect-square shimmer-strong animate-shimmer'/);
    expect(loading).toMatch(/backgroundColor: 'var\(--card-bg\)', boxShadow: 'var\(--card-shadow\)'/);
    expect(loading).toMatch(/React\.createElement\('div', \{ className: 'p-3' \}/);
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

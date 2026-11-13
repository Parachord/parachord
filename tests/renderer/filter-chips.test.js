/**
 * The app's filter buttons (src/renderer/components/filter-chips.js): Home's
 * source filter style, shared by every page's filter chips. Pins the style,
 * the neutral and coloured chip rules, and that the pages draw FilterChips
 * rather than their own pills.
 */
const fs = require('fs');
const path = require('path');

global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const ROOT = path.join(__dirname, '..', '..', 'src', 'renderer');
const F = require('../../src/renderer/components/filter-chips');
const h = (props) => renderToStaticMarkup(React.createElement(F.FilterChips, props));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('filter chip style', () => {
  test('is Home\'s source filter', () => {
    expect(F.FILTER_CHIPS_ROW_STYLE).toEqual({ display: 'flex', flexWrap: 'wrap', gap: '8px' });
    expect(F.FILTER_CHIP_STYLE).toEqual({
      font: 'inherit', fontSize: '12px', fontWeight: 600, border: 'none', borderRadius: '999px', cursor: 'pointer',
      padding: '8px 12px', minHeight: '36px', display: 'inline-flex', alignItems: 'center', gap: '8px',
    });
    expect(F.FILTER_CHIP_DOT_STYLE).toEqual({ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 });
    expect(F.CHIP_NEUTRAL_FILL).toBe('#7c3aed');
  });
});

describe('FilterChips', () => {
  const chips = [{ id: 'all', label: 'All' }, { id: 'ep', label: 'EPs (3)', color: '#25D1DA' }];

  test('a group of pressed / unpressed buttons', () => {
    const html = h({ chips, value: 'all', label: 'Filter releases by type' });
    expect(html).toMatch(/^<div role="group" aria-label="Filter releases by type"/);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
    expect(html).toContain('EPs (3)');
  });

  test('a chip with no colour is neutral: grey idle, the accent picked, no dot', () => {
    const idle = h({ chips, value: 'ep' });
    expect(idle).toMatch(/aria-pressed="false"[^>]*background-color:var\(--bg-secondary\);color:var\(--text-primary\)"[^>]*>All</);
    const picked = h({ chips, value: 'all' });
    expect(picked).toMatch(/aria-pressed="true"[^>]*background-color:#7c3aed;color:#fff"[^>]*>All</);
    expect(picked.match(/data-chip-dot/g)).toHaveLength(1); // the idle EPs chip's
  });

  test('a coloured chip shows a dot idle and fills picked, its text readable on the fill', () => {
    expect(h({ chips, value: 'all' })).toMatch(/data-chip-dot[^>]*background-color:#25D1DA/);
    const picked = h({ chips, value: 'ep' });
    expect(picked).toMatch(/aria-pressed="true"[^>]*background-color:#25D1DA;color:#111827/);
    expect(picked).not.toContain('data-chip-dot');
  });

  test('a gradient paints over the fill and the dot', () => {
    const g = 'linear-gradient(to right, #f97316, #dc2626)';
    const both = [{ id: 'all', label: 'All' }, { id: 'both', label: 'Both', color: '#dc2626', gradient: g }];
    expect(h({ chips: both, value: 'all' })).toMatch(/data-chip-dot[^>]*background-image:linear-gradient/);
    expect(h({ chips: both, value: 'both' })).toMatch(/aria-pressed="true"[^>]*background-color:#dc2626;background-image:linear-gradient\(to right, #f97316, #dc2626\);color:#fff/);
  });

  test('clicking a chip picks it', () => {
    const picked = [];
    const el = F.FilterChips({ chips, value: 'all', onChange: (id) => picked.push(id) });
    el.props.children[1].props.onClick();
    expect(picked).toEqual(['ep']);
  });
});

describe('every page draws the shared chips', () => {
  test('Home\'s source filter is FilterChips', () => {
    const src = read('components/home-sections.js');
    expect(src).toContain("require('./filter-chips')");
    expect(src).toMatch(/return e\(FilterChips, \{ chips, value, onChange, label: label \|\| 'Filter by source' \}\);/);
  });

  test('Fresh Drops, Recommendations, the plugin marketplace and the artist page use it', () => {
    const app = read('app.js');
    expect(app).toContain("const { FilterChips } = require('./components/filter-chips');");
    for (const call of ['onChange: setNewReleasesFilter', 'onChange: setRecommendationSourceFilter', 'onChange: setMarketplaceCategory']) {
      expect(app).toContain(call);
    }
    const artist = read('components/artist-page.js');
    expect(artist).toContain("onChange: setReleaseTypeFilter, label: 'Filter releases by type'");
    expect(artist).toContain('onChange: setRelatedArtistsSourceFilter');
  });

  test('no page keeps its own filter pill classes', () => {
    const pill = /px-3 py-1\.5 rounded-full text-sm transition-all/;
    expect(read('app.js')).not.toMatch(pill);
    expect(read('components/artist-page.js')).not.toMatch(pill);
  });
});

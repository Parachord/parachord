/**
 * The app's section title (src/renderer/components/section-header.js):
 * Home's style, shared by every page's section headers. Pins the style, the
 * two kinds of link, and that the pages draw this component rather than a
 * copy of its style.
 */
const fs = require('fs');
const path = require('path');

global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const ROOT = path.join(__dirname, '..', '..', 'src', 'renderer');
const COMP = path.join(ROOT, 'components');
const H = require('../../src/renderer/components/section-header');
const h = (props) => renderToStaticMarkup(React.createElement(H.SectionHeader, props));
const read = (f) => fs.readFileSync(path.join(COMP, f), 'utf8');

describe('section header style', () => {
  test('the title, subtitle and link are Home\'s', () => {
    expect(H.SECTION_TITLE_STYLE).toEqual({ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' });
    expect(H.SECTION_SUB_STYLE).toEqual({ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' });
    expect(H.SECTION_LINK_STYLE).toMatchObject({ fontSize: '13px', fontWeight: 600, textDecoration: 'none', background: 'none', border: 'none' });
    expect(H.SECTION_HEADER_GAP).toEqual({ marginBottom: '16px' });
    expect(H.SECTION_HEADER_ROW_STYLE).toEqual({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' });
  });

  test('links take the destination page\'s sidebar colour, else the accent', () => {
    expect(H.PAGE_COLOR).toEqual({ playlists: '#ec4899', recommendations: '#f59e0b', concerts: '#10c9b4' });
    expect(H.sectionLinkColor('#ec4899')).toBe('#ec4899');
    expect(H.sectionLinkColor()).toBe('var(--accent-primary)');
  });
});

describe('SectionHeader size', () => {
  test('a subsection title is a 15px semibold h3; the default is the 20px h2', () => {
    expect(H.SUBSECTION_TITLE_STYLE).toEqual({ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' });
    expect(h({ title: 'Made for you', size: 'sub' }))
      .toContain('<h3 style="margin:0;font-size:15px;font-weight:600;color:var(--text-primary)">Made for you</h3>');
    expect(h({ title: 'Made for you', size: 'sub', as: 'h4' })).toContain('<h4 style="margin:0;font-size:15px');
    expect(h({ title: 'Playlists' })).toContain('<h2 style="margin:0;font-size:20px;font-weight:700;color:var(--text-primary)">Playlists</h2>');
  });
});

describe('SectionHeader', () => {
  test('title and subtitle on the left', () => {
    const html = h({ id: 'x', title: 'Concerts near you', sub: 'Playing soon' });
    expect(html).toMatch(/<h2 id="x" style="margin:0;font-size:20px;font-weight:700;color:var\(--text-primary\)">Concerts near you<\/h2>/);
    expect(html).toContain('<div style="font-size:12px;color:var(--text-secondary);margin-top:2px">Playing soon</div>');
    expect(html).not.toContain('<button');
  });

  test('a link to another page says "See all in <Page>" in that page\'s colour and opens it', () => {
    const opened = [];
    const el = H.SectionHeader({ title: 'Your playlists', page: 'Playlists', view: 'playlists', navigateTo: (v) => opened.push(v), pageColor: H.PAGE_COLOR.playlists });
    const html = renderToStaticMarkup(el);
    expect(html).toMatch(/aria-label="See all in Playlists"[^>]*style="[^"]*font-size:13px;font-weight:600[^"]*color:#ec4899"[^>]*>See all in Playlists</);
    // The button is the last child of the right-hand group.
    const button = el.props.children[1].props.children[1];
    button.props.onClick();
    expect(opened).toEqual(['playlists']);
  });

  test('an in-place link keeps its own label, takes the accent and reports its state', () => {
    let clicks = 0;
    const el = H.SectionHeader({ title: 'Albums', action: { label: 'Show less', expanded: true, onClick: () => { clicks++; } } });
    const html = renderToStaticMarkup(el);
    expect(html).toMatch(/aria-expanded="true"[^>]*style="[^"]*color:var\(--accent-primary\)"[^>]*>Show less</);
    expect(html).not.toContain('See all in');
    el.props.children[1].props.children[1].props.onClick();
    expect(clicks).toBe(1);
  });

  test('the heading level, row spacing and extras are the caller\'s', () => {
    const html = h({ as: 'h3', title: 'Songs', style: { marginBottom: '16px' }, extra: React.createElement('i', null, 'r') });
    expect(html).toMatch(/^<div style="display:flex;align-items:baseline;[^"]*margin-bottom:16px">/);
    expect(html).toContain('<h3 style="margin:0;font-size:20px;font-weight:700;color:var(--text-primary)">Songs</h3>');
    expect(html).toContain('<i>r</i>');
  });
});

describe('every page draws the shared header', () => {
  test('Home has no copy of the style', () => {
    for (const f of ['home-sections.js', 'home-page.js']) {
      const src = read(f);
      expect(src).toContain("require('./section-header')");
      expect(src).not.toMatch(/const (H2_STYLE|SUB_STYLE|PAGE_COLOR) = /);
      expect(src).not.toMatch(/function SectionHeader\(/);
    }
  });

  test('Recommendations rows and their skeleton, search results and the artist\'s concerts use SectionHeader', () => {
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    expect(app).toContain("const { SectionHeader, SECTION_HEADER_GAP } = require('./components/section-header');");
    expect(app).toMatch(/const subsectionHeader = \(sub, \{ expanded, showToggle \}\) => React\.createElement\(SectionHeader, \{/);
    expect(read('recommendation-skeletons.js')).toMatch(/React\.createElement\(SectionHeader, \{/);

    const search = read('search-page.js');
    for (const title of ['Artists', 'Songs', 'Albums', 'Playlists']) {
      expect(search).toContain(`as: 'h3', title: '${title}', style: SECTION_HEADER_GAP`);
    }
    // The old small uppercase result headings are gone (the history and
    // suggestion labels above the results keep theirs).
    expect(search).not.toMatch(/uppercase tracking-wider[^']*' \}, '(ARTISTS|SONGS|ALBUMS|PLAYLISTS)'/);

    expect(read('artist-page.js')).toMatch(/React\.createElement\(SectionHeader, \{\s*title: React\.createElement\(React\.Fragment, null,\s*`\$\{events\.length\} Upcoming Concert/);
  });

  test('the old Recommendations title and link classes are gone', () => {
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const header = app.slice(app.indexOf('const subsectionHeader = '), app.indexOf("// ── One section's row"));
    expect(header).not.toMatch(/text-lg font-semibold|text-purple-600/);
    expect(read('recommendation-skeletons.js')).not.toMatch(/text-lg font-semibold/);
  });
});

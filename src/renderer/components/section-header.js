// src/renderer/components/section-header.js: the app's section title, the
// heading over a row or grid of content (Home's rows, the Recommendations
// rows, the search results, an artist's concerts). Home's style (#1361),
// shared so every page's sections read alike; change it here, never in a
// copy. Page heroes, dialog titles, settings headings and the small
// uppercase group labels (text-xs ... uppercase tracking-wider) are other
// elements and keep their own styles.
//
// Props-driven; no hooks, and React is read at render, so the module loads
// under plain Node.

// Each page's sidebar colour (app.js), which a link to that page takes.
const PAGE_COLOR = { playlists: '#ec4899', recommendations: '#f59e0b', concerts: '#10c9b4' };

// 20px bold, in the page's 1.5 line height: a 30px line. A skeleton that
// stands in for a header draws its bar inside a SectionHeader (or an element
// with this style), so the two are the same height.
const SECTION_TITLE_STYLE = { margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' };
const SECTION_SUB_STYLE = { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' };
// The link's look; its colour is the destination page's sidebar colour, else
// the accent (sectionLinkColor).
const SECTION_LINK_STYLE = {
  font: 'inherit', fontSize: '13px', fontWeight: 600, background: 'none', border: 'none',
  cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none',
};
const SECTION_HEADER_ROW_STYLE = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' };

// The gap under a header over content in normal flow (a page that lays its
// sections out as a flex column, like Home, uses the column's gap instead).
// A skeleton standing in for the header uses it too.
const SECTION_HEADER_GAP = { marginBottom: '16px' };

const sectionLinkColor = (color) => color || 'var(--accent-primary)';

/**
 * Title (and an optional grey subtitle) on the left; on the right `extra`,
 * then the link.
 *
 * The link goes to another page (`page` names it, `view` is its view,
 * `navigateTo` opens it; labelled "See all in <page>") or acts in place
 * (`action: { label, onClick, ariaLabel, expanded }`, e.g. a row's See all /
 * Show less). `pageColor` colours either one; omitted, the link is the accent.
 *
 * `as` is the heading level (h2 by default); `className` and `style` go on
 * the row, for the page's own spacing around it.
 */
function SectionHeader({ id, title, sub, page, view, navigateTo, action, extra, pageColor, as = 'h2', className, style }) {
  const e = React.createElement;
  const linkStyle = Object.assign({}, SECTION_LINK_STYLE, { color: sectionLinkColor(pageColor) });
  let link = null;
  if (page) {
    link = e('button', {
      type: 'button', 'aria-label': `See all in ${page}`, onClick: () => navigateTo && navigateTo(view), style: linkStyle,
    }, `See all in ${page}`);
  } else if (action) {
    link = e('button', {
      type: 'button', 'aria-label': action.ariaLabel, 'aria-expanded': action.expanded,
      onClick: action.onClick, className: 'no-drag', style: linkStyle,
    }, action.label);
  }
  return e('div', { className, style: Object.assign({}, SECTION_HEADER_ROW_STYLE, style) },
    e('div', { style: { minWidth: 0 } },
      e(as, { id, style: SECTION_TITLE_STYLE }, title),
      sub && e('div', { style: SECTION_SUB_STYLE }, sub)),
    e('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, extra, link));
}

module.exports = {
  SectionHeader, sectionLinkColor, PAGE_COLOR, SECTION_HEADER_GAP,
  SECTION_TITLE_STYLE, SECTION_SUB_STYLE, SECTION_LINK_STYLE, SECTION_HEADER_ROW_STYLE,
};

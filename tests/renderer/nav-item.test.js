/**
 * The sidebar's page links and Settings' sections are one NavItem
 * (components/nav-item.js): the page's colour and tint when current
 * (aria-current), a hover tint otherwise, an unread dot and a count badge.
 */
global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NavItem } = require('../../src/renderer/components/nav-item');
const Icons = require('../../src/renderer/components/icons');
const h = (p) => renderToStaticMarkup(React.createElement(NavItem, p));

test('the current page: its colour and tint, aria-current', () => {
  const html = h({ page: 'concerts', label: 'Concerts', icon: Icons.Ticket, active: true });
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('color:var(--page-concerts)');
  expect(html).toContain('background-color:color-mix(in srgb, var(--page-concerts) 10%, transparent)');
  expect(html).not.toContain('hover:bg-surface-hover');
});

test('another page: the inactive colour and a hover tint', () => {
  const html = h({ page: 'concerts', label: 'Concerts', icon: Icons.Ticket });
  expect(html).toContain('color:var(--nav-inactive)');
  expect(html).toContain('hover:bg-surface-hover');
  expect(html).not.toContain('aria-current');
});

test('an unread dot and a count badge in the page colour', () => {
  const html = h({ page: 'library', label: 'Collection', icon: Icons.Library, unread: true, count: 3 });
  expect(html).toContain('aria-label="New"');
  expect(html).toContain('>+3<');
  expect(html).toContain('background-color:var(--page-library-fill)');
});

test('NavSearch: the sidebar Search box, aria-current and a ring when open', () => {
  const { NavSearch } = require('../../src/renderer/components/nav-item');
  const open = renderToStaticMarkup(React.createElement(NavSearch, { active: true }));
  expect(open).toContain('aria-current="page"');
  expect(open).toContain('box-shadow:inset 0 0 0 1.5px var(--accent-primary-alpha-30)');
  expect(open).toContain('>Search<');
  const closed = renderToStaticMarkup(React.createElement(NavSearch, {}));
  expect(closed).not.toContain('aria-current');
  expect(closed).toContain('color:var(--text-tertiary)');
});

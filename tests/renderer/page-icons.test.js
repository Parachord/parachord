// lib/page-icons.js: one icon per page, shared by the sidebar and What's New.
const fs = require('fs');
const path = require('path');
const Icons = require('../../src/renderer/components/icons');
const { PAGE_ICONS } = require('../../src/renderer/lib/page-icons');
const { PAGE_COLORS } = require('../../src/renderer/lib/page-colors');
const { whatsNewIcon } = require('../../src/renderer/components/whats-new-dialog');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer', f), 'utf8');

test('every page icon is in the shared set', () => {
  for (const [page, name] of Object.entries(PAGE_ICONS)) expect([page, typeof Icons[name]]).toEqual([page, 'function']);
});

test('every page with a colour has an icon', () => {
  for (const page of Object.keys(PAGE_COLORS)) expect(PAGE_ICONS[page]).toBeTruthy();
});

test("the sidebar's page links take their icon from the map, never their own", () => {
  const src = read('components/sidebar.js');
  expect(src).not.toMatch(/React\.createElement\(NavItem, \{[^}]*icon: Icons\.\w+/);
  for (const m of src.matchAll(/page: '([\w-]+)'[^}]*?icon: Icons\[PAGE_ICONS\['([\w-]+)'\]\]/g)) expect(m[2]).toBe(m[1]);
  expect(read('components/nav-item.js')).toContain('Icons[PAGE_ICONS.search]');
});

test("What's New draws a page's notes with the page's icon", () => {
  expect(whatsNewIcon('Listening history')).toBe(PAGE_ICONS.history);
  expect(whatsNewIcon('Playlists')).toBe(PAGE_ICONS.playlists);
  expect(whatsNewIcon('Collection')).toBe(PAGE_ICONS.library);
  expect(whatsNewIcon('Fresh Drops')).toBe(PAGE_ICONS['new-releases']);
  expect(whatsNewIcon('Better recommendations')).toBe(PAGE_ICONS.recommendations);
  expect(whatsNewIcon('Concerts near you')).toBe(PAGE_ICONS.concerts);
});

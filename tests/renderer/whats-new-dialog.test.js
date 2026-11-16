/**
 * The What's New dialog: on the shared Modal, an icon chosen by each
 * highlight's heading (not handed out in turn), and a count of the
 * highlights that don't fit.
 */
global.React = require('react');
global.ReactDOM = require('react-dom');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const Icons = require('../../src/renderer/components/icons');
const { WhatsNewDialog, whatsNewIcon, MAX_HIGHLIGHTS } = require('../../src/renderer/components/whats-new-dialog');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

test('icons follow the heading, specific nouns first', () => {
  expect(whatsNewIcon('Faster search')).toBe('Search');
  expect(whatsNewIcon('Album art')).toBe('Music');
  expect(whatsNewIcon('Faster artist and album pages')).toBe('Music');
  expect(whatsNewIcon('Sync')).toBe('RefreshCw');
  expect(whatsNewIcon('Playlist sync')).toBe('RefreshCw');
  expect(whatsNewIcon('Amazon Music')).toBe('Music');
  expect(whatsNewIcon('Home')).toBe('Home');
  expect(whatsNewIcon('Playback')).toBe('Play');
  expect(whatsNewIcon('AI DJ')).toBe('Zap');
  expect(whatsNewIcon('Faster startup')).toBe('Zap');
  expect(whatsNewIcon('Settings')).toBe('Settings');
  expect(whatsNewIcon('Something else')).toBe('Star');
});

test('every icon it can pick exists in the shared set', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/whats-new-dialog.js'), 'utf8');
  // Literal names; a page's icon comes from lib/page-icons.js (tests/renderer/page-icons.test.js).
  const names = [...src.matchAll(/, '([A-Z][A-Za-z0-9]+)'\]/g)].map((m) => m[1]).concat('Star');
  for (const n of names) expect(typeof Icons[n]).toBe('function');
});

test('shows the first highlights and counts the rest', () => {
  const highlights = Array.from({ length: MAX_HIGHLIGHTS + 3 }, (_, i) => ({ title: `Note ${i}`, text: `Body ${i}` }));
  const html = renderToStaticMarkup(React.createElement(WhatsNewDialog, { open: true, onClose() {}, version: '1.2.3', highlights }));
  expect(html).toContain('What’s new');
  expect(html).toContain('Version 1.2.3');
  expect(html).toContain(`Note ${MAX_HIGHLIGHTS - 1}`);
  expect(html).not.toContain(`Note ${MAX_HIGHLIGHTS}<`);
  expect(html).toContain('And 3 more in the full release notes.');
  expect(html).toContain('role="dialog"');
});

test('with no highlights it points at the full notes, with no stale copy', () => {
  const html = renderToStaticMarkup(React.createElement(WhatsNewDialog, { open: true, onClose() {}, highlights: [] }));
  expect(html).toContain('full release notes');
  expect(html).not.toMatch(/Latest Release|Full Release Notes/);
});

test('app.js renders it, with no hand-built shell left', () => {
  expect(app).toMatch(/React\.createElement\(WhatsNewDialog, \{\s*open: whatsNewOpen,/);
  expect(app).not.toContain("\"What's New\"");
  expect(app).not.toContain('#f59e0b 0%, #f97316 100%');
});

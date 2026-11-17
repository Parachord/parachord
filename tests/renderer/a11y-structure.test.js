/**
 * #1386 accessibility: reduced motion, announcements, focus on dark
 * surfaces, a play/pause key, and landmarks and headings.
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
const html = read('index.html');

test('one reduced-motion block covers the whole app, spinners excepted', () => {
  const m = html.match(/\/\* Reduced motion \(#1386\)[\s\S]*?@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n    \}\n/);
  expect(m).toBeTruthy();
  expect(m[1]).toContain('*:not(.animate-spin):not([data-icon="Spinner"])');
  expect(m[1]).toContain('animation-duration: 0.01ms !important;');
  expect(m[1]).toContain('.card-fade-up, .now-playing-pending { opacity: 1 !important;');
  expect(m[1]).toContain('.card-button:hover .card-zoom');
});

test('seek and volume say their value in words', () => {
  const { PlaybackProgress } = require('../../src/renderer/components/ui-atoms');
  const out = renderToStaticMarkup(React.createElement(PlaybackProgress, {
    subscribe: () => () => {}, initialProgress: 83, hasTrack: true, duration: 296, onSeek: () => {},
    formatTime: (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`,
  }));
  expect(out).toContain('aria-label="Seek"');
  expect(out).toContain('aria-valuetext="1:23 of 4:56"');
  expect(app).toContain("'aria-valuetext': isMuted ? 'Muted' : `${Math.round(effectiveVolume)}%`,");
});

test('the playing row is aria-current', () => {
  const { CardButton } = require('../../src/renderer/components/card-button');
  expect(renderToStaticMarkup(React.createElement(CardButton, { label: 'x', current: true }))).toContain('aria-current="true"');
  expect(renderToStaticMarkup(React.createElement(CardButton, { label: 'x' }))).not.toContain('aria-current');
  // The page lists are the shared TrackRow, which marks the playing row.
  expect(read('src/renderer/components/track-lists.js')).toContain('current: isNowPlaying,');
  for (const f of ['src/renderer/components/collection-page.js', 'src/renderer/components/playlist-view-page.js', 'src/renderer/components/search-page.js', 'src/renderer/components/cards.js']) {
    expect([f, /React\.createElement\(TrackRow, \{[\s\S]{0,400}isNowPlaying/.test(read(f))]).toEqual([f, true]);
  }
  expect(read('src/renderer/components/track-lists.js')).toContain('current: isCurrentTrack,');
});

test('the always-dark surfaces get a light focus ring', () => {
  expect(html).toContain('.on-dark :focus-visible,');
  expect((app.match(/className: 'on-dark /g) || []).length).toBeGreaterThanOrEqual(3); // 4 until the prompt panel went (#1020)
});

test('Space plays and pauses, but not on a control or with an overlay open', () => {
  const i = app.indexOf('// Space plays and pauses (#1386)');
  const block = app.slice(i, i + 1200);
  expect(block).toMatch(/el\.closest\('button, a\[href\], input, select, textarea/);
  expect(block).toContain("document.querySelector('[role=\"dialog\"], [role=\"alertdialog\"], [role=\"menu\"], [role=\"listbox\"]')");
  expect(block).toContain('handlePlayPauseRef.current();');
});

test('landmarks and headings', () => {
  expect(app).toMatch(/React\.createElement\('nav', \{\n\s*'aria-label': 'Main',/);
  expect(app).toMatch(/React\.createElement\('main', \{\n\s*ref: mainContentRef,/);
  expect(app).toContain("role: 'region', 'aria-label': 'Player',");
  expect(app).toMatch(/React\.createElement\('h1', \{\n\s*\/\/ The page's heading \(#1386\)[\s\S]{0,400}\}, 'Settings'\)/);
  expect(read('src/renderer/components/search-page.js')).toMatch(/React\.createElement\('h1', \{\n\s*\/\/ The page's heading \(#1386\)[\s\S]{0,400}\}, 'Search'\)/);
  expect(read('src/renderer/components/artist-page.js')).toMatch(/React\.createElement\('h2', \{[^}]*\}, className: 'uppercase' \},\n\s*currentRelease\?\.title/);
});

test('the playbar source line is a fixed 20px, so the picker turning into a menu never grows the bar', () => {
  const i = app.indexOf('// A fixed 20px line: the picker turning from a label into a');
  expect(i).toBeGreaterThan(-1);
  expect(app.slice(i, i + 400)).toContain("React.createElement('div', { className: 'flex items-center gap-1.5', style: { height: '20px' } },");
  expect(app).toContain("return React.createElement('div', { className: 'no-drag flex items-center' },\n                        React.createElement(Menu, {\n                          label: 'Play from',");
});

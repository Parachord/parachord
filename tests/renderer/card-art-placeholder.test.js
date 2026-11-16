/**
 * An empty cover box is the neutral placeholder grey (the skeletons'
 * family), not the accent: every album grid shares AlbumCard's ArtBox, so a
 * pale purple box showed on all of them. A cover still being looked up
 * shimmers; Fresh Drops says which (undefined = not looked up yet).
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { AlbumCard } = require('../../src/renderer/components/album-card');

test('the art box is --placeholder-bg, never an accent token', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/card-art.js'), 'utf8');
  expect(src).toContain("backgroundColor: 'var(--placeholder-bg)'");
  expect(src).not.toContain("backgroundColor: 'var(--accent-surface)'");
  const html = renderToStaticMarkup(React.createElement(AlbumCard, { album: { title: 'T', artist: 'A', imageUrl: null } }));
  expect(html).toContain('background-color:var(--placeholder-bg)');
});

test('a cover being looked up shimmers grey', () => {
  const html = renderToStaticMarkup(React.createElement(AlbumCard, { album: { title: 'T', artist: 'A' }, imageLoading: true }));
  expect(html).toContain('shimmer-strong animate-shimmer');
});

test('Fresh Drops tells the card when its cover is still being looked up', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/fresh-drops-page.js'), 'utf8');
  expect(page).toContain('imageLoading: release.albumArt === undefined,');
});

/**
 * Collection Radio's button is one shared component (Home's), used on Home
 * and on the Collection page's hero and collapsed header (2026-11-15).
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { CollectionRadioButton } = require('../../src/renderer/components/collection-radio-button');

test('the full button and the compact one', () => {
  const full = renderToStaticMarkup(React.createElement(CollectionRadioButton, { onClick: () => {} }));
  expect(full).toContain('background-color:var(--accent-fill)');
  expect(full).toMatch(/>Play Collection Radio<\/button>$/);
  const compact = renderToStaticMarkup(React.createElement(CollectionRadioButton, { onClick: () => {}, compact: true }));
  expect(compact).toMatch(/>Play Radio<\/button>$/);
});

test('Home and both Collection headers use it; no hand-built copy is left', () => {
  const dir = path.join(__dirname, '../../src/renderer/components');
  const home = fs.readFileSync(path.join(dir, 'home-page.js'), 'utf8');
  const coll = fs.readFileSync(path.join(dir, 'collection-page.js'), 'utf8');
  expect(home).toContain('React.createElement(CollectionRadioButton, { onClick: handleStartCollectionStation })');
  expect(coll).toContain('React.createElement(CollectionRadioButton, { onClick: handleStartCollectionStation })');
  expect(coll).toContain('React.createElement(CollectionRadioButton, { onClick: handleStartCollectionStation, compact: true })');
  expect(coll).not.toMatch(/'Start (Collection )?Radio'/);
});

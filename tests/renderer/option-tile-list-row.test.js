/**
 * A choice drawn as a bordered tile is OptionTile (components/option-tile.js:
 * stop syncing's choices, the browser extension's store links, the album
 * page's edition card); a row in a list you pick from is ListRow
 * (components/list-row.js: location suggestions, Add to playlist, the setup
 * list). Each list used to build its own.
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { OptionTile } = require('../../src/renderer/components/option-tile');
const { ListRow } = require('../../src/renderer/components/list-row');
const tile = (p, ...kids) => renderToStaticMarkup(React.createElement(OptionTile, p, ...kids));
const row = (p) => renderToStaticMarkup(React.createElement(ListRow, p, 'Row'));
const src = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer', f), 'utf8');

test('OptionTile: a button with the title, the line under it and the icon', () => {
  const html = tile({ title: 'Keep imported items', description: 'Items stay', icon: React.createElement('svg') });
  expect(html).toMatch(/^<button type="button"/);
  expect(html).toContain('Keep imported items');
  expect(html).toContain('Items stay');
  expect(html).toContain('bg-surface-inset border-line hover:bg-surface-hover');
  expect(html).toContain('focus-visible:ring-2');
  expect(html).toContain('<svg');
});

test('OptionTile: the danger tone, and compact with its own lines', () => {
  expect(tile({ title: 'Remove', tone: 'danger' })).toContain('bg-tint-danger border-line-danger');
  expect(tile({ title: 'Remove', tone: 'danger' })).toContain('text-ink-danger');
  const compact = tile({ compact: true, 'aria-expanded': true }, React.createElement('span', null, 'Own line'));
  expect(compact).toContain('rounded-lg px-2.5 py-2');
  expect(compact).toContain('aria-expanded="true"');
  expect(compact).toContain('Own line');
});

test('ListRow: a full-width row with a hover tint, a divider and its states', () => {
  const plain = row({ size: 'sm', divider: true, onClick: () => {} });
  expect(plain).toMatch(/^<button type="button"/);
  expect(plain).toContain('px-3 py-2');
  expect(plain).toContain('border-b border-line-light last:border-b-0');
  expect(plain).toContain('hover:bg-surface-hover');
  expect(plain).toContain('focus-visible:ring-inset');
  expect(row({ state: 'added' })).toContain('bg-tint-success');
  expect(row({ state: 'added' })).not.toContain('hover:bg-surface-hover');
  expect(row({ state: 'drop' })).toContain('border-l-accent');
  expect(row({ state: 'current' })).toContain('bg-[var(--accent-surface)]');
});

test('the lists and tiles use them', () => {
  const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
  expect(app).toMatch(/React\.createElement\(OptionTile, \{\s*key, onClick, title, description: sub, tone: danger \? 'danger' : undefined/);
  expect(app).toContain("title: 'Chrome Web Store'");
  expect(app).toContain("title: 'Firefox Add-ons'");
  expect(app).toMatch(/React\.createElement\(ListRow, \{\s*key: i,\s*size: 'sm',\s*divider: true/);
  expect(app).toMatch(/React\.createElement\(ListRow, \{ 'aria-pressed': selectedPlaylistsForAdd\.includes\(playlist\.id\),\s*divider: true,\s*state: isAdded \? 'added' : isDropTarget \? 'drop' : undefined/);
  expect(src('components/cards.js')).toMatch(/React\.createElement\(OptionTile, \{\s*compact: true,\s*onClick: toggleSourceOpen/);
  expect(src('components/home-setup.js')).toMatch(/React\.createElement\(ListRow, \{\s*size: 'sm',\s*state: 'current'/);
});

test('the queue bar reopens an album by its title (not a tooltip)', () => {
  expect(src('app.js')).toMatch(/handleCollectionAlbumClick\(\{\s*title: playbackContext\.name,\s*artist: playbackContext\.artist/);
});

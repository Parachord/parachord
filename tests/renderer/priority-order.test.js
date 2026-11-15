/**
 * Raise / Lower Priority on a plug-in tile (#1386).
 */
const fs = require('fs');
const path = require('path');
global.React = require('react');
const { movePriority, priorityMoves } = require('../../src/renderer/lib/priority-order');

const numbered = new Set(['spotify', 'bandcamp', 'soundcloud', 'localfiles']);
const isNumbered = (id) => numbered.has(id);
// amazonmusic is plan-blocked: in the order, but not numbered.
const order = ['spotify', 'amazonmusic', 'bandcamp', 'soundcloud', 'localfiles'];

test('moves one numbered place, stepping over unnumbered ids', () => {
  expect(movePriority(order, 'bandcamp', -1, isNumbered)).toEqual(['bandcamp', 'amazonmusic', 'spotify', 'soundcloud', 'localfiles']);
  expect(movePriority(order, 'spotify', 1, isNumbered)).toEqual(['bandcamp', 'amazonmusic', 'spotify', 'soundcloud', 'localfiles']);
  expect(movePriority(order, 'soundcloud', 1, isNumbered)).toEqual(['spotify', 'amazonmusic', 'bandcamp', 'localfiles', 'soundcloud']);
});

test('the ends, and unnumbered ids, do not move', () => {
  expect(movePriority(order, 'spotify', -1, isNumbered)).toBe(order);
  expect(movePriority(order, 'localfiles', 1, isNumbered)).toBe(order);
  expect(movePriority(order, 'amazonmusic', 1, isNumbered)).toBe(order);
});

test('priorityMoves says which way a tile can go', () => {
  expect(priorityMoves(order, 'spotify', isNumbered)).toEqual({ canRaise: false, canLower: true });
  expect(priorityMoves(order, 'bandcamp', isNumbered)).toEqual({ canRaise: true, canLower: true });
  expect(priorityMoves(order, 'localfiles', isNumbered)).toEqual({ canRaise: true, canLower: false });
  expect(priorityMoves(order, 'amazonmusic', isNumbered)).toEqual({ canRaise: false, canLower: false });
});

describe('wiring', () => {
  const root = path.join(__dirname, '../..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const tl = fs.readFileSync(path.join(root, 'src/renderer/components/track-lists.js'), 'utf8');
  const pv = fs.readFileSync(path.join(root, 'src/renderer/components/playlist-view-page.js'), 'utf8');

  test('plug-in tiles: Raise / Lower Priority in the tile menu', () => {
    expect(main).toMatch(/label: 'Raise Priority',\s*enabled: !!\(opts && opts\.canRaise\)/);
    expect(main).toMatch(/label: 'Lower Priority',\s*enabled: !!\(opts && opts\.canLower\)/);
    expect(app).toMatch(/data\.action === 'raise-priority' \|\| data\.action === 'lower-priority'/);
  });

  test('queue rows: Play Sooner / Play Later', () => {
    expect(main).toMatch(/label: 'Play Sooner',\s*enabled: i > 0/);
    expect(main).toMatch(/label: 'Play Later',\s*enabled: i < data\.queueLength - 1/);
    expect(tl).toContain('queueLength: queue.length');
    expect(app).toMatch(/data\.action === 'move-in-queue'[^\n]*\n[^\n]*\n\s*moveInQueueRef\.current\(data\.from, data\.to\)/);
  });

  test('playlist edit mode: Move up / Move down buttons on each row', () => {
    expect(pv).toMatch(/'aria-label': `Move \$\{track\.title\} up`[\s\S]{0,200}moveInEditedPlaylist\(index, index - 1\)/);
    expect(pv).toMatch(/'aria-label': `Move \$\{track\.title\} down`[\s\S]{0,200}moveInEditedPlaylist\(index, index \+ 1\)/);
  });
});

test('a plug-in tile opens its menu from the keyboard (Shift+F10 / Menu key)', () => {
  const sc = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/settings-cards.js'), 'utf8');
  expect(sc).toMatch(/onKeyDown: onContextMenu \? menuKeyHandler\(onContextMenu\) : undefined/);
  const { menuKeyHandler } = require('../../src/renderer/components/card-button');
  const calls = [];
  const h = menuKeyHandler((ev) => calls.push(ev.key));
  const ev = (key, shiftKey = false) => ({ key, shiftKey, preventDefault() {} });
  h(ev('F10', true)); h(ev('ContextMenu')); h(ev('F10')); h(ev('Enter'));
  expect(calls).toEqual(['F10', 'ContextMenu']);
});

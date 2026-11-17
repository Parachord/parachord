// lib/resolver-order.js: a plug-in turned off and on again goes back where
// the user ranked it, not to the canonical default (2026-11-17). The memory
// is the whole ranking, disabled plug-ins included.
const { rememberOrder, insertRemembered } = require('../../src/renderer/lib/resolver-order');

describe('rememberOrder', () => {
  test('a disabled plug-in keeps its place after the one it followed', () => {
    expect(rememberOrder(['a', 'b', 'c', 'd'], ['a', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });
  test('the active order wins; disabled ones ride along with their neighbour', () => {
    expect(rememberOrder(['a', 'b', 'c', 'd'], ['d', 'a', 'c'])).toEqual(['d', 'a', 'b', 'c']);
  });
  test('a disabled plug-in that led the list stays first', () => {
    expect(rememberOrder(['b', 'a', 'c'], ['a', 'c'])).toEqual(['b', 'a', 'c']);
  });
  test('no memory yet: the order itself', () => {
    expect(rememberOrder(null, ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('insertRemembered', () => {
  test('re-enabled: back in its remembered place, not the canonical one', () => {
    // The user ranked SoundCloud above Spotify, then turned it off and on.
    const memory = ['soundcloud', 'spotify', 'applemusic'];
    expect(insertRemembered(['spotify', 'applemusic'], 'soundcloud', memory)).toEqual(['soundcloud', 'spotify', 'applemusic']);
  });
  test('after a drag while it was off, it follows the plug-in it followed', () => {
    const memory = rememberOrder(['a', 'b', 'c', 'd'], ['d', 'a', 'c']);
    expect(insertRemembered(['d', 'a', 'c'], 'b', memory)).toEqual(['d', 'a', 'b', 'c']);
  });
  test('never ranked: the canonical place', () => {
    expect(insertRemembered(['spotify', 'youtube'], 'soundcloud', ['spotify', 'youtube'])).toEqual(['spotify', 'soundcloud', 'youtube']);
  });
  test('already in the order: unchanged', () => {
    const order = ['a', 'b'];
    expect(insertRemembered(order, 'a', ['b', 'a'])).toBe(order);
  });
});

test('app.js never inserts a plug-in by the canonical order alone', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(src).not.toMatch(/insertInCanonicalOrder\(/);
});

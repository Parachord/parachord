/**
 * CardButton (components/card-button.js): a card whose main action is a real
 * button stretched over it, with its own actions above.
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { CardButton } = require('../../src/renderer/components/card-button');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('a container with a labelled button, its content before the button', () => {
  const html = renderToStaticMarkup(React.createElement(CardButton, { label: 'Far In by Helado Negro', draggable: true },
    React.createElement('div', { className: 'card-actions' }, React.createElement('button', { type: 'button' }, 'Play'))));
  expect(html).toMatch(/^<div draggable="true" class="card-button" style="position:relative">/);
  expect(html).toMatch(/<\/div><button type="button" class="card-button-hit no-drag" aria-label="Far In by Helado Negro"><\/button><\/div>$/);
});

test('Shift+F10 and the Menu key open the right-click menu; other keys do not', () => {
  const onContextMenu = jest.fn();
  const el = CardButton({ label: 'x', onContextMenu });
  const hit = el.props.children[1];
  const key = (k, shiftKey = false) => hit.props.onKeyDown({ key: k, shiftKey, preventDefault() {} });
  key('Enter'); key('F10');
  expect(onContextMenu).not.toHaveBeenCalled();
  key('F10', true); key('ContextMenu');
  expect(onContextMenu).toHaveBeenCalledTimes(2);
  expect(el.props.onContextMenu).toBe(onContextMenu);
});

test('index.html: actions show on hover or keyboard focus, and pass clicks through when hidden', () => {
  const html = read('index.html');
  expect(html).toContain('.card-button:has(:focus-visible) .card-actions { opacity: 1; }');
  expect(html).toContain('.card-button .card-actions button { pointer-events: none; }');
});

test('the card family uses it, and no card is a button holding buttons', () => {
  const cards = read('src/renderer/components/cards.js');
  for (const name of ['RelatedArtistCard', 'SearchArtistCard', 'CollectionArtistCard', 'CollectionAlbumCard']) {
    const start = cards.indexOf(`const ${name} = `);
    const body = cards.slice(start, cards.indexOf('\n};\n', start));
    expect([name, body.includes('React.createElement(CardButton, {')]).toEqual([name, true]);
    expect([name, /return React\.createElement\('button'/.test(body)]).toEqual([name, false]);
  }
});

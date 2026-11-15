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
  expect(html).toMatch(/<\/div><button type="button" draggable="true" class="card-button-hit no-drag" aria-label="Far In by Helado Negro"><\/button><\/div>$/);
});

test('Shift+F10 and the Menu key open the right-click menu; other keys do not', () => {
  const onContextMenu = jest.fn();
  const el = CardButton.render({ label: 'x', onContextMenu }, null);
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
  // Artist cards are components/artist-card.js's ArtistCard, a CardButton too.
  const artistCard = read('src/renderer/components/artist-card.js');
  expect(artistCard).toContain('return e(CardButton, {');
  // Every album grid's card is components/album-card.js's AlbumCard (the
  // old CollectionAlbumCard in cards.js merged into it), a CardButton too.
  expect(cards).not.toContain('const CollectionAlbumCard = ');
  const albumCard = read('src/renderer/components/album-card.js');
  const start = albumCard.indexOf('function AlbumCard(');
  const body = albumCard.slice(start, albumCard.indexOf('\n}\n', start));
  expect(body).toContain('return e(CardButton, ');
  expect(body).not.toMatch(/return e\('button'/);
});

// A row hands CardButton a ref (the resolution scheduler's visibility
// observer, the queue's virtualizer). Dropping it left every track row
// unobserved, so nothing resolved.
test('a ref reaches the root element', () => {
  const ref = () => {};
  const el = CardButton.render({ label: 'x' }, ref);
  expect(el.type).toBe('div');
  expect(el.ref).toBe(ref);
});

test('every row that passes a ref passes it to CardButton, which forwards it', () => {
  const src = read('src/renderer/components/card-button.js');
  expect(src).toContain('const CardButton = React.forwardRef(renderCardButton);');
});


// Under the stretched button nothing inside a card gets the pointer unless
// index.html lifts it (buttons, links, form fields, [data-tooltip],
// .card-above). An inner drag source, mouse-down handler or a Tooltip around
// plain text there is dead: the playlists grid couldn't be dragged, the
// queue drawer couldn't be resized, and reason tooltips never showed.
describe('nothing inside a card depends on the pointer unless it is lifted', () => {
  const { parse } = require('@babel/parser');
  const LIFTED = new Set(['button', 'a', 'input', 'select', 'textarea', 'label']);
  const files = ['src/renderer/app.js', ...fs.readdirSync(path.join(root, 'src/renderer/components')).filter((f) => f.endsWith('.js')).map((f) => `src/renderer/components/${f}`)];
  test.each(files)('%s', (file) => {
    const src = read(file);
    const ast = parse(src, { sourceType: 'script', errorRecovery: true });
    const bad = [];
    (function walk(n, inCard) {
      if (!n || typeof n.type !== 'string') return;
      let card = inCard;
      const isCE = n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'createElement' && n.arguments[0];
      if (isCE && n.arguments[0].type === 'Identifier' && n.arguments[0].name === 'CardButton') card = true;
      else if (isCE && inCard) {
        const tag = n.arguments[0].type === 'StringLiteral' ? n.arguments[0].value : n.arguments[0].name;
        const props = n.arguments[1] && n.arguments[1].type === 'ObjectExpression' ? n.arguments[1].properties.filter((p) => p.key) : [];
        const keys = props.map((p) => p.key.name || p.key.value);
        const cls = (props.find((p) => (p.key.name || p.key.value) === 'className') || {}).value;
        const lifted = LIFTED.has(tag) || keys.includes('data-tooltip') || (cls && /card-above|card-actions/.test(src.slice(cls.start, cls.end)));
        if (!lifted && keys.some((k) => /^(draggable|onDragStart|onMouseDown|onPointerDown)$/.test(k))) bad.push(`${n.loc.start.line} ${tag} ${keys.join(',')}`);
        if ((tag === 'Tooltip' || tag === 'FixedTooltip') && n.arguments[2]) {
          const child = n.arguments[2];
          const childTag = child.type === 'CallExpression' && child.arguments[0] ? (child.arguments[0].value || child.arguments[0].name) : '';
          if (!LIFTED.has(childTag)) bad.push(`${n.loc.start.line} ${tag} around ${childTag || child.type}`);
        }
      }
      for (const k in n) {
        if (k === 'loc') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach((c) => walk(c, card));
        else if (v && typeof v.type === 'string') walk(v, card);
      }
    })(ast, false);
    expect(bad).toEqual([]);
  });
});

test('a draggable card drags from its stretched button too', () => {
  const el = CardButton.render({ label: 'x', draggable: true, onDragStart: () => {} }, null);
  expect(el.props.draggable).toBe(true);
  expect(el.props.children[1].props.draggable).toBe(true);
  expect(CardButton.render({ label: 'x' }, null).props.children[1].props.draggable).toBeUndefined();
});


describe('the visible More button (#1386)', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const { CardButton } = require('../../src/renderer/components/card-button');
  test('opt-in: a labelled button that opens the row menu, after the stretched button', () => {
    const calls = [];
    const el = CardButton.render({ label: 'Song by A', more: 'More actions for Song', onContextMenu: (ev) => calls.push(ev), children: 'x' }, null);
    const more = el.props.children[2];
    expect(more.props.className).toMatch(/card-actions/);
    const btn = more.props.children;
    expect(btn.props['aria-label']).toBe('More actions for Song');
    btn.props.onClick({ stopPropagation() {} });
    expect(calls).toHaveLength(1);
    expect(renderToStaticMarkup(React.createElement(CardButton, { label: 'Song', more: 'More', onContextMenu() {} }, 'x'))).toMatch(/aria-label="More"/);
  });
  test('no more prop, or no menu, no button', () => {
    expect(CardButton.render({ label: 'A', onContextMenu() {}, children: 'x' }, null).props.children[2]).toBeNull();
    expect(CardButton.render({ label: 'A', more: 'More', children: 'x' }, null).props.children[2]).toBeNull();
  });
  test('every track list opts in', () => {
    const fs = require('fs'); const path = require('path');
    const src = ['src/renderer/app.js', 'src/renderer/components/playlist-view-page.js', 'src/renderer/components/search-page.js', 'src/renderer/components/collection-page.js', 'src/renderer/components/track-lists.js', 'src/renderer/components/cards.js']
      .map((f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8')).join('\n');
    expect((src.match(/more: `More actions for \$\{track\.title\}`/g) || []).length).toBe(11);
  });
});

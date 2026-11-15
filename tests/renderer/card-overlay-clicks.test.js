/**
 * A card's click must reach CardButton's stretched button (z-index 1).
 *
 * Home and Recommendations cards stopped opening (2026-11-15): a hover
 * overlay over the cover sat ABOVE the stretched button (zIndex 2 or 20)
 * and took the pointer on hover (group-hover:pointer-events-auto). On main
 * the click on its background bubbled to the card's own onClick; with
 * CardButton the opener is the stretched button below, so the click went
 * nowhere and only the overlay's Play / Queue buttons worked.
 *
 * Rule: inside a CardButton, a full-cover layer (absolute inset-0) with a
 * z-index of its own is a `card-actions` layer (it never takes the pointer;
 * its buttons do, on hover or keyboard focus), and nothing switches
 * pointer-events back on with group-hover.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const ROOT = path.join(__dirname, '../..');
const files = ['src/renderer/app.js', ...fs.readdirSync(path.join(ROOT, 'src/renderer/components')).map((f) => `src/renderer/components/${f}`)];
const isCE = (n) => n && n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'createElement';
const prop = (obj, k) => obj && obj.type === 'ObjectExpression' && obj.properties.find((p) => p.type === 'ObjectProperty' && !p.computed && (p.key.name || p.key.value) === k);

function offenders(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const ast = parse(src, { sourceType: 'script', errorRecovery: true });
  const out = [];
  (function walk(n, inCard) {
    if (!n || typeof n.type !== 'string') return;
    let here = inCard;
    if (isCE(n)) {
      const t = n.arguments[0];
      if (t && t.type === 'Identifier' && t.name === 'CardButton') here = true;
      else if (inCard && n.arguments[1] && n.arguments[1].type === 'ObjectExpression') {
        const cls = prop(n.arguments[1], 'className');
        const style = prop(n.arguments[1], 'style');
        const z = style && style.value.type === 'ObjectExpression' && prop(style.value, 'zIndex');
        const clsText = cls && cls.value.type === 'StringLiteral' ? cls.value.value : '';
        if (/\babsolute inset-0\b/.test(clsText) && z && !/\bcard-actions\b/.test(clsText) && !/\bpointer-events-none\b/.test(clsText)) out.push(`${file}:${n.loc.start.line}`);
      }
    }
    for (const k in n) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((x) => walk(x, here)); else if (v && typeof v.type === 'string') walk(v, here);
    }
  })(ast, false);
  return out;
}

test('no full-cover overlay inside a CardButton sits above its button and takes the pointer', () => {
  expect(files.flatMap(offenders)).toEqual([]);
});

test('nothing turns pointer-events back on with group-hover', () => {
  for (const f of files) expect([f, /group-hover:pointer-events-auto/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))]).toEqual([f, false]);
});

test("Home's art overlay opens the card once (stops the click)", () => {
  const home = fs.readFileSync(path.join(ROOT, 'src/renderer/components/home-sections.js'), 'utf8');
  expect(home).toMatch(/onClick: onClick && \(\(ev\) => \{ ev\.stopPropagation\(\); onClick\(ev\); \}\)/);
});

describe("Home's album and playlist cards open from anywhere on the card", () => {
  global.React = global.React || require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const H = require('../../src/renderer/components/home-sections');
  test('they are CardButtons: the stretched button carries "Open <title>", and the title is text', () => {
    for (const [C, props] of [[H.AlbumCard, { album: { title: 'Alb', artist: 'Art' } }], [H.PlaylistCard, { playlist: { title: 'Pl' }, subtitle: 'Refreshed 2m ago' }]]) {
      const html = renderToStaticMarkup(React.createElement(C, Object.assign({ onOpen() {} }, props)));
      expect(html).toMatch(/class="card-button-hit no-drag" aria-label="Open (Alb|Pl)"/);
      expect(html).not.toMatch(/<button[^>]*>(Alb|Pl)<\/button>/);
    }
  });
  test("the art overlay sits above the stretched button while shown (zIndex 2), under the reason badge (3)", () => {
    const home = fs.readFileSync(path.join(ROOT, 'src/renderer/components/home-sections.js'), 'utf8');
    expect(home).toMatch(/pointerEvents: shown \? 'auto' : 'none', zIndex: 2,/);
  });
});

test("Collection's artist cards open the artist menu, like Search's", () => {
  const fs = require('fs');
  const path = require('path');
  const cards = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/cards.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/collection-page.js'), 'utf8');
  const card = cards.slice(cards.indexOf('const CollectionArtistCard'), cards.indexOf('const CollectionAlbumCard'));
  expect(card).toMatch(/onContextMenu: onContextMenu \? \(e\) => \{ e\.preventDefault\(\); onContextMenu\(e, artist\); \}/);
  expect(page).toMatch(/CollectionArtistCard, \{[\s\S]{0,400}onContextMenu: \(\) => window\.showItemMenu\(artistMenu\(/);
});

test("an artist's top tracks queue from its menu; Collection's cards hover with Play only", () => {
  const fs = require('fs');
  const path = require('path');
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/collection-page.js'), 'utf8');
  expect(main).toMatch(/label: 'Add Top 10 to Queue',[\s\S]{0,200}action: 'queue-artist-top-tracks'/);
  expect(app).toMatch(/data\.action === 'queue-artist-top-tracks' && data\.artist\?\.name/);
  const card = page.slice(page.indexOf('React.createElement(CollectionArtistCard, {'), page.indexOf("collectionTab === 'albums'"));
  expect(card).not.toContain('onAddToQueue');
  expect(card).toContain('onPlayTopTracks');
});

test('Listener cards are CardButtons with Play for their recent top 10', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const card = app.slice(app.indexOf('const friendCard = '), app.indexOf('// ── The section header'));
  expect(card).toMatch(/return React\.createElement\(CardButton, \{/);
  expect(card).toMatch(/className: 'card-actions [^']*'[\s\S]{0,300}playListenerTopTracks\(item\)/);
  expect(app).toMatch(/const playListenerTopTracks = async[\s\S]{0,400}fetchFriendTopTracksList\(friend, '7day', 10\)/);
});

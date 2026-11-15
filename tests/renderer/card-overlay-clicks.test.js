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

test('every artist grid uses ArtistCard: Play on hover, queue in the artist menu', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  const main = read('main.js');
  const app = read('src/renderer/app.js');
  expect(main).toMatch(/label: 'Add Top 10 to Queue',[\s\S]{0,200}action: 'queue-artist-top-tracks'/);
  expect(app).toMatch(/data\.action === 'queue-artist-top-tracks' && data\.artist\?\.name/);
  const uses = { 'src/renderer/app.js': 3, 'src/renderer/components/search-page.js': 2, 'src/renderer/components/collection-page.js': 1, 'src/renderer/components/artist-page.js': 1 };
  for (const [file, n] of Object.entries(uses)) {
    const src = read(file);
    expect([file, (src.match(/React\.createElement\(ArtistCard, \{/g) || []).length]).toEqual([file, n]);
    expect([file, src.includes("'aria-label': 'Add top 10 to queue'")]).toEqual([file, false]);
    expect([file, /ArtistCard, \{[\s\S]{0,900}?onContextMenu: \(\) => window\.showItemMenu\(artistMenu\(/.test(src)]).toEqual([file, true]);
  }
  const card = read('src/renderer/components/artist-card.js');
  expect(card).toMatch(/className: 'card-actions [^']*'/);
  expect(card).not.toMatch(/onAddToQueue|QueueTop10/);
  expect(read('src/renderer/components/cards.js')).not.toMatch(/const (Search|Collection|Related)ArtistCard/);
});

test("Listeners and Collection's friends share ListenerCard, with Play for their recent top 10", () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  const app = read('src/renderer/app.js');
  const page = read('src/renderer/components/collection-page.js');
  const card = read('src/renderer/components/listener-card.js');
  expect(app).toMatch(/return React\.createElement\(ListenerCard, \{[\s\S]{0,800}onPlay: \(\) => playListenerTopTracks\(item\)/);
  expect(page).toMatch(/return React\.createElement\(ListenerCard, \{[\s\S]{0,900}onPlay: \(\) => playListenerTopTracks\(friend\)[\s\S]{0,200}type: 'friend'/);
  expect(card).toMatch(/return e\(CardButton, /);
  expect(card).toMatch(/className: 'card-actions [^']*'/);
  expect(app).toMatch(/const playListenerTopTracks = async[\s\S]{0,600}fetchFriendTopTracksList\(friend, '7day', 10\)/);
  expect(page).toContain("'playListenerTopTracks',");
});

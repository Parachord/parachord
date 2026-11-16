/**
 * An artist card whose photo fails to load shows the artist's initials, as a
 * card with no photo does, not an empty box (Search's artists, 2026-11-15).
 */
global.React = require('react');
global.ReactVirtual = global.ReactVirtual || {};
const { renderToStaticMarkup } = require('react-dom/server');
const { ArtistCard } = require('../../src/renderer/components/artist-card');

// One instance with real state, so the img's onError can be fired.
function harness(props) {
  const slots = [];
  let i = 0;
  const real = global.React;
  const fake = {
    ...real,
    useState: (init) => { const k = i++; if (!slots[k]) slots[k] = [init, (v) => { slots[k][0] = v; }]; return [slots[k][0], slots[k][1]]; },
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (v) => ({ current: v }),
  };
  return () => { global.React = fake; try { i = 0; return ArtistCard(props); } finally { global.React = real; } };
}
const walk = (n, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => walk(c, out)); return out; }
  if (n.props) { out.push(n); walk(n.props.children, out); }
  return out;
};

test('a failed photo leaves the initials', () => {
  const render = harness({ artist: { name: 'Fugazi Live Series' }, image: 'https://x/dead.jpg', imageLoaded: true });
  const img = walk(render()).find((n) => n.type === 'img');
  expect(img).toBeTruthy();
  img.props.onError();
  const after = render();
  expect(walk(after).some((n) => n.type === 'img')).toBe(false);
  expect(renderToStaticMarkup(after)).toContain('>FL<');
});

test('a photo that loads is shown', () => {
  const html = renderToStaticMarkup(React.createElement(ArtistCard, { artist: { name: 'Fugazi' }, image: 'https://x/ok.jpg', imageLoaded: true }));
  expect(html).toContain('src="https://x/ok.jpg"');
});

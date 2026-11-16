/**
 * The sync UI's service colour and logo come from the plug-in (its
 * manifest's color, the shared logo kit), never a hard-coded copy
 * (CLAUDE.md "a service's from its plugin's resolver.color"). And the
 * artist stand-in art lives in lib/artist-pattern.js.
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

test('syncProviderConfig reads colours from the loaded plug-ins and logos from ResolverIcon', () => {
  const at = app.indexOf('const syncProviderConfig = useMemo(');
  const block = app.slice(at, app.indexOf('}, [allResolvers]);', at));
  expect(block).toContain('resolverLoaderRef.current?.getAllResolvers?.() || allResolvers');
  expect(block).toContain('plugins.find(x => x.id === id)');
  expect(block).toContain('React.createElement(ResolverIcon, { resolverId: id');
  expect(block).not.toMatch(/#[0-9a-fA-F]{6}/);
  expect(block).not.toContain("'svg'");
  // Declared after allResolvers, so its dependency isn't read in the TDZ.
  expect(at).toBeGreaterThan(app.indexOf('const allResolvers = loadedResolvers;'));
});

test('the logo kit draws ListenBrainz', () => {
  const { ResolverIcon } = require('../../src/renderer/components/ui-atoms');
  const html = renderToStaticMarkup(React.createElement(ResolverIcon, { resolverId: 'listenbrainz', size: 24 }));
  expect(html).toContain('viewBox="0 0 146 160"');
});

test('generateArtistPattern: one pattern per name, and cards.js still exports it', () => {
  const { generateArtistPattern } = require('../../src/renderer/lib/artist-pattern');
  const a = generateArtistPattern('The Milk Carton Kids');
  expect(a).toEqual(generateArtistPattern('the milk carton kids'));
  expect(a.initials).toBe('TM');
  expect(a.gradient).toMatch(/gradient\(/);
  expect(require('../../src/renderer/components/cards').generateArtistPattern).toBe(generateArtistPattern);
});

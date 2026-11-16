/**
 * An artist's On Tour tab never shows when they have no upcoming concerts
 * (2026-11-15). Before, an open On Tour kept its tab and showed "No upcoming
 * concerts", and a restored artist page asked for concerts before any concert
 * plug-in had loaded, so a touring artist read as having none.
 */
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '../../src/renderer');
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const artist = fs.readFileSync(path.join(R, 'components/artist-page.js'), 'utf8');

test('the tab shows only with concerts, or while an open On Tour is still loading', () => {
  const rule = "artistConcerts.length > 0 || (artistPageTab === 'on-tour' && !artistConcertsLoaded)";
  expect(artist.split(rule).length - 1).toBe(3); // two hero tab rows and the compact header
  expect(artist).not.toContain("|| artistPageTab === 'on-tour';");
});

test('no empty state: none means back to Music', () => {
  expect(artist).not.toContain("title: 'No upcoming concerts'");
  expect(app).toMatch(/if \(artistPageTab === 'on-tour' && artistConcertsLoaded && !artistConcertsLoading && artistConcerts\.length === 0\) \{\s*setArtistPageTab\('music'\);/);
});

test('asked before a concert plug-in was ready: asked again once one is', () => {
  expect(app).toMatch(/if \(concertServices\.length === 0\) \{[\s\S]{0,600}artistConcertsAskedEarlyRef\.current = normalizedName;\s*setArtistConcerts\(\[\]\);\s*return;/);
  expect(app).toContain('const concertServiceCount = useMemo(() => getConcertServices().length, [loadedResolvers, metaServiceConfigs]);');
  expect(app).toMatch(/if \(artistConcertsAskedEarlyRef\.current === name\.trim\(\)\.toLowerCase\(\)\) \{\s*artistConcertsAskedEarlyRef\.current = null;\s*loadArtistConcerts\(name\);/);
  // The hook reads functions declared above it (the TDZ trap).
  expect(app.indexOf('const getConcertServices = () =>')).toBeLessThan(app.indexOf('const concertServiceCount = useMemo('));
});

test('Clear cache asks first: it removes every cache and cannot be undone', () => {
  expect(app).toMatch(/variant: 'destructive', size: 'sm', onClick: \(\) => showConfirmDialog\(\{[\s\S]{0,200}title: 'Clear cache\?',[\s\S]{0,300}confirmLabel: 'Clear cache',\s*destructive: true,\s*onConfirm: async \(\) => \{/);
});

test("the artist hero is PageHero with the artist's photo", () => {
  global.React = global.React || require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PageHero } = require('../../src/renderer/components/page-hero');
  const html = renderToStaticMarkup(React.createElement(PageHero, { collapsed: true, photo: { url: 'https://x/a.jpg', position: 'center 20%' }, onExpand: () => {}, collapsedContent: 'bar' }));
  expect(html).toContain('background-image:url(https://x/a.jpg)');
  expect(html).toContain('aria-label="Expand header"');
  expect(html).toContain('rgba(17,17,17,0.95)');
  expect(html).not.toContain('bg-gradient');
  expect(artist).not.toMatch(/height: isHeaderCollapsed \? '80px' : '320px'/);
});

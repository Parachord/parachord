const fs = require('fs');
const path = require('path');
const T = require('../../src/renderer/lib/ticket-sellers');

test("a seller's colour comes from the plug-in registry, never a copied table", () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/lib/ticket-sellers.js'), 'utf8');
  expect(src).not.toMatch(/#[0-9a-fA-F]{6}/);
  const manifests = Object.fromEntries(['bandsintown', 'songkick', 'seatgeek', 'ticketmaster'].map((id) => {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins-src/${id}/manifest.json`), 'utf8'));
    return [id, (m.manifest || m).color];
  }));
  T.setSellerColorLookup((id) => manifests[id] || null);
  expect(T.sellerColor('seatgeek')).toBe(manifests.seatgeek);
  expect(T.sellerColor('nope')).toBe('var(--page-concerts)'); // the Concerts colour
  // app.js hands over its registry lookup.
  expect(fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8')).toContain('setSellerColorLookup(getServiceColor)');
});

test('text and badge colours mix with theme tokens, so one value works in both themes', () => {
  T.setSellerColorLookup((id) => (id === 'songkick' ? '#F80046' : null));
  expect(T.sellerTextColor('songkick')).toBe('color-mix(in srgb, #F80046 70%, var(--text-primary))');
  expect(T.sellerBadgeBg('songkick')).toBe('color-mix(in srgb, #F80046 15%, transparent)');
  expect(T.sellerColor('ai')).toBe('var(--page-concerts)');
  expect(T.sellerShortName({ source: 'ticketmaster' })).toBe('TM');
  expect(T.sellerName({ source: 'x', label: 'Venue site' })).toBe('Venue site');
});

test('Concerts and On Tour keep no per-theme seller tables', () => {
  for (const f of ['src/renderer/components/concerts-page.js', 'src/renderer/components/artist-page.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    expect(src).not.toMatch(/isD(?:ark|kFlyout) \? '#/);
    // Their seller pills come from the shared SellerBadges (on Badge), never a hand-built span.
    expect(src).toContain('...SellerBadges({ sources: event.ticketSources');
    expect(src).not.toMatch(/sellerShortName/);
  }
});

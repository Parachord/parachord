const fs = require('fs');
const path = require('path');
const T = require('../../src/renderer/lib/ticket-sellers');

test("each seller's colour is its plugin's manifest colour", () => {
  for (const [id, hex] of Object.entries(T.SELLER_COLORS)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins-src/${id}/manifest.json`), 'utf8'));
    expect((manifest.manifest || manifest).color.toLowerCase()).toBe(hex.toLowerCase());
  }
});

test('text and badge colours mix with theme tokens, so one value works in both themes', () => {
  expect(T.sellerTextColor('songkick')).toBe('color-mix(in srgb, #F80046 70%, var(--text-primary))');
  expect(T.sellerBadgeBg('songkick')).toBe('color-mix(in srgb, #F80046 15%, transparent)');
  expect(T.sellerColor('ai')).toBe('#10c9b4');
  expect(T.sellerShortName({ source: 'ticketmaster' })).toBe('TM');
  expect(T.sellerName({ source: 'x', label: 'Venue site' })).toBe('Venue site');
});

test('Concerts and On Tour keep no per-theme seller tables', () => {
  for (const f of ['src/renderer/app.js', 'src/renderer/components/artist-page.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    expect(src).not.toMatch(/isD(?:ark|kFlyout) \? '#/);
    expect(src).toMatch(/sellerTextColor\(src\.source\)/);
  }
});

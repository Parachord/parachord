/**
 * The playbar and the sidebar take every colour from a token (2026-11-15).
 * The playbar is dark in both themes, so its controls use the --on-dark-*
 * tokens (index.html), the same in both; the sidebar's new-item dots and
 * count badges take their page's colour (lib/page-colors.js).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
const atoms = fs.readFileSync(path.join(ROOT, 'src/renderer/components/ui-atoms.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const PALETTE = /\b(?:text|bg|border|from|to|via)-(?:gray|red|orange|amber|green|emerald|teal|cyan|blue|purple|pink)-\d{2,3}\b/g;
const slice = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));

test('the playbar has no hard-coded colour (but the "no plug-in colour" sentinel)', () => {
  const bar = slice("className: 'on-dark backdrop-blur-xl py-3 no-drag flex-shrink-0 relative z-50'", '// AI Prompt Input Panel');
  expect(bar.length).toBeGreaterThan(10000);
  const code = bar.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  expect((code.match(HEX) || []).filter((h) => h !== '#888888')).toEqual([]);
  expect(code.match(PALETTE) || []).toEqual([]);
});

test("the scrubber's labels and track, and both sliders' CSS, are tokens", () => {
  expect(atoms).not.toMatch(/text-gray-400|bg-gray-600/);
  const css = html.slice(html.indexOf('/* Progress slider styling */'), html.indexOf('/* Release card hover lift animation'));
  expect(css.match(HEX) || []).toEqual([]);
  expect(css).toContain('background: var(--on-dark-track);');
});

test('the on-dark tokens are defined in both themes', () => {
  for (const t of ['--on-dark-disabled', '--on-dark-track', '--on-dark-track-disabled', '--surface-dark-placeholder', '--on-dark-fill-muted', '--on-dark-love', '--on-dark-success', '--on-dark-info']) {
    expect([t, html.split(`${t}:`).length - 1]).toEqual([t, 2]);
  }
});

test("the sidebar's dots and badges are their page's colour", () => {
  const side = slice("'Fresh Drops',", "'Concerts',");
  expect(side).not.toMatch(PALETTE);
  for (const key of ['new-releases', 'recommendations', 'discover', 'critics-picks']) {
    expect(app).toContain(`style: { backgroundColor: PAGE_COLORS['${key}'].color }`);
  }
  expect(app).toContain('backgroundColor: PAGE_COLORS.library.fill,');
  expect(app).toContain('backgroundColor: PAGE_COLORS.playlists.fill,');
  expect(app).not.toContain("backgroundColor: '#06b6d4'");
});

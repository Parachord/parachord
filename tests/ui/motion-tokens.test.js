// #1450: motion runs on tokens. Durations and easings are CSS variables in
// index.html (reduced motion zeroes them); Tailwind's transition defaults
// and inline transitions (lib/motion.js) read them; no transition-all.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages / panels moved out of it (#1451)
const { transition } = require('../../src/renderer/lib/motion');

test('the tokens, and reduced motion zeroes the durations', () => {
  for (const t of ['--motion-fast: 150ms', '--motion-base: 200ms', '--motion-slow: 300ms', '--motion-deliberate: 400ms', '--ease-standard:', '--ease-out:', '--ease-in:']) {
    expect(html).toContain(t);
  }
  expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{ --motion-fast: 0\.01ms; --motion-base: 0\.01ms; --motion-slow: 0\.01ms; --motion-deliberate: 0\.01ms; \}/);
});

test("index.html's transitions use the tokens", () => {
  const decls = html.match(/transition:[^;{}]*;/g) || [];
  expect(decls.length).toBeGreaterThan(5);
  expect(decls.filter((d) => /\d(?:\.\d+)?m?s\b/.test(d))).toEqual([]);
});

test("Tailwind's transition defaults point at the tokens", () => {
  const cfg = require('../../tailwind.config.js');
  expect(cfg.theme.extend.transitionDuration.DEFAULT).toBe('var(--motion-fast)');
  expect(cfg.theme.extend.transitionDuration.slow).toBe('var(--motion-slow)');
  expect(cfg.theme.extend.transitionTimingFunction.out).toBe('var(--ease-out)');
});

test('transition() builds token strings and refuses `all` and off-scale names', () => {
  expect(transition('opacity')).toBe('opacity var(--motion-base) var(--ease-standard)');
  expect(transition('opacity transform', 'slow', 'out')).toBe('opacity var(--motion-slow) var(--ease-out), transform var(--motion-slow) var(--ease-out)');
  expect(transition([['opacity', 'slow', 'out'], ['transform', 'fast']])).toBe('opacity var(--motion-slow) var(--ease-out), transform var(--motion-fast) var(--ease-standard)');
  expect(() => transition('all')).toThrow();
  expect(() => transition('opacity', 'glacial')).toThrow();
});

test('no transition-all anywhere in the renderer', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]));
  const hits = walk(path.join(root, 'src/renderer')).filter((f) => f.endsWith('.js') && /\btransition-all\b/.test(fs.readFileSync(f, 'utf8')));
  expect(hits).toEqual([]);
});

test('the queue drawer slides on transform, so its resize follows the cursor', () => {
  const at = app.indexOf("className: 'on-dark fixed left-0 right-0 backdrop-blur-md shadow-2xl transition-transform duration-slow ease-out z-40'");
  expect(at).toBeGreaterThan(0);
  const drawer = app.slice(at, at + 1200);
  expect(drawer).toContain("bottom: '85px'");
  expect(drawer).toContain("transform: queueDrawerOpen ? 'translateY(0)' : 'translateY(calc(100% + 85px))'");
});

test('menus, pick lists, the side panel and the hero content animate in, and not under reduced motion', () => {
  expect(html).toContain('[role="menu"], [role="listbox"] { animation: menuIn var(--motion-base) var(--ease-out); }');
  expect(html).toContain('[role="dialog"][aria-modal="true"]:not(.modal-panel) { animation: sidePanelIn var(--motion-slow) var(--ease-out); }');
  expect(html).toMatch(/\.motion-fade-in \{ animation: motionFadeIn/);
  expect(html).toMatch(/\[role="menu"\], \[role="listbox"\], \[role="dialog"\]\[aria-modal="true"\]:not\(\.modal-panel\), \.motion-fade-in, \.motion-rise-in \{ animation: none; \}/);
  const hero = fs.readFileSync(path.join(root, 'src/renderer/components/page-hero.js'), 'utf8');
  expect((hero.match(/motion-fade-in/g) || []).length).toBeGreaterThanOrEqual(2);
});

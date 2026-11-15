/**
 * #1389: grid columns come from the content area (.card-grid's auto-fill),
 * never from Tailwind's window breakpoints.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const files = ['src/renderer/app.js', ...fs.readdirSync(path.join(ROOT, 'src/renderer/components')).map((f) => `src/renderer/components/${f}`)];

test('no window-breakpoint grid columns in the renderer', () => {
  const hits = files.filter((f) => /\b(sm|md|lg|xl|2xl):grid-cols-/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  expect(hits).toEqual([]);
});

test('.card-grid is defined once, as auto-fill over the content width', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect(html.match(/\.card-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(180px, 1fr\)\); \}/g)).toHaveLength(1);
  const uses = files.map((f) => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/'card-grid /g) || []).length).reduce((a, b) => a + b, 0);
  expect(uses).toBe(20);
});

test('page hero titles scale with the content area (.hero-title), not a fixed text-5xl', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect(html).toMatch(/\.hero-title \{ font-size: clamp\(28px, calc\(\(100vw - 256px\) \* 0\.055\), 48px\); line-height: 1; \}/);
  const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  expect(src).not.toMatch(/className: 'text-5xl font-light text-white'/);
  expect((src.match(/className: 'hero-title font-light text-white'/g) || []).length).toBe(9);
});

/**
 * #1384: one icon size per context (docs/DESIGN_SYSTEM.md "Icons"):
 * w-4 in rows, chips and small buttons; w-5 in buttons and dialog titles;
 * w-3 only in badges; 32px and up only for empty-state illustrations.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const files = ['src/renderer/app.js', ...fs.readdirSync(path.join(ROOT, 'src/renderer/components')).map((f) => `src/renderer/components/${f}`)];
const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

test('no in-between icon sizes', () => {
  const sizes = [...src.matchAll(/Icons\.[A-Za-z0-9]+, \{[^}]*className: '[^']*\b(w-[0-9.]+) h-[0-9.]+/g)].map((m) => m[1]);
  const allowed = new Set(['w-2.5', 'w-3', 'w-4', 'w-5', 'w-6', 'w-8', 'w-10', 'w-12']);
  expect(sizes.filter((s) => !allowed.has(s))).toEqual([]);
  expect(sizes.filter((s) => s === 'w-3.5')).toEqual([]);
});

test('dialog title icons are w-5', () => {
  expect(src).not.toMatch(/icon: React\.createElement\(Icons\.[A-Za-z0-9]+, \{ className: 'w-6 h-6'/);
});

test('no fixed heavier strokes (only a state, like the active sidebar item, changes it)', () => {
  expect(src).not.toMatch(/Icons\.[A-Za-z0-9]+, \{[^}]*strokeWidth: 2\.5 \}/);
});

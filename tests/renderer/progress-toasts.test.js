/**
 * A toast that says something is under way ("Loading Album…", "Adding 12
 * tracks…") is plain: no info icon. The "i" read as a notice about a
 * problem. (A success that goes on, "Apple Music connected — finishing
 * setup…", keeps its tick.)
 */
const fs = require('fs');
const path = require('path');

const files = ['src/renderer/app.js', ...fs.readdirSync(path.join(__dirname, '../../src/renderer/components')).map((f) => `src/renderer/components/${f}`)];

test('no progress toast carries a severity', () => {
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    for (const m of src.matchAll(/showToast\((`[^`]*…`|'[^']*…')\s*,\s*'info'/g)) bad.push(`${f}: ${m[1]}`);
  }
  expect(bad).toEqual([]);
});

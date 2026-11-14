// The stopgap role="button" divs (lib/activate-on-key.js, removed) are all
// gone: plain controls are <button>s and cards and rows are CardButton
// (design-drift's roleButtonDivs is 0 and can only stay there).

// #1386: every text field, select and textarea has a name (aria-label, a
// wrapping <label>, or an id a <label htmlFor> points at).
test('no unlabelled form field in the renderer', () => {
  const fs = require('fs');
  const path = require('path');
  const parser = require('@babel/parser');
  const dir = path.join(__dirname, '../../src/renderer');
  const files = ['app.js', ...fs.readdirSync(path.join(dir, 'components')).map((f) => `components/${f}`)];
  const missing = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const ast = parser.parse(src, { sourceType: 'script', errorRecovery: true });
    const key = (p) => p.key && (p.key.name || p.key.value);
    (function walk(n, inLabel) {
      if (!n || typeof n.type !== 'string') return;
      let lab = inLabel;
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'createElement' && n.arguments[0]) {
        const tag = n.arguments[0].value;
        if (tag === 'label') lab = true;
        if (['input', 'select', 'textarea'].includes(tag) && !inLabel && n.arguments[1] && n.arguments[1].type === 'ObjectExpression') {
          const props = n.arguments[1].properties;
          const type = props.find((p) => key(p) === 'type');
          const t = type && type.value.type === 'StringLiteral' ? type.value.value : 'text';
          const named = props.some((p) => ['aria-label', 'aria-labelledby', 'id'].includes(key(p)));
          if (!named && !['hidden', 'file', 'checkbox', 'radio', 'range'].includes(t)) missing.push(`${f}:${n.loc.start.line}`);
        }
      }
      for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach((x) => walk(x, lab)); else if (v && typeof v.type === 'string') walk(v, lab); }
    })(ast.program, false);
  }
  expect(missing).toEqual([]);
});

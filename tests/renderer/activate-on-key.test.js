const { activateOnKey } = require('../../src/renderer/lib/activate-on-key');

const evt = (key, same = true) => {
  const el = { click: jest.fn() };
  return { key, target: same ? el : {}, currentTarget: el, preventDefault: jest.fn(), el };
};

test.each(['Enter', ' '])('%j on the element clicks it', (key) => {
  const e = evt(key);
  activateOnKey(e);
  expect(e.el.click).toHaveBeenCalledTimes(1);
  expect(e.preventDefault).toHaveBeenCalled();
});

test('other keys, and keys from a control inside it, pass through', () => {
  const a = evt('Tab'); activateOnKey(a); expect(a.el.click).not.toHaveBeenCalled();
  const b = evt('Enter', false); activateOnKey(b); expect(b.el.click).not.toHaveBeenCalled();
});

// The role="button" divs are a stopgap: they move to <button> and
// CardButton, and design-drift's roleButtonDivs count only falls. While any
// remain, they keep the focus ring.
test('the remaining role=button divs keep a focus ring', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  expect(html).toMatch(/\[role="button"\]:focus-visible \{ outline: 2px solid var\(--accent-primary\)/);
});

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

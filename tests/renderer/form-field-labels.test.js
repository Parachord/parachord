// The stopgap role="button" divs (lib/activate-on-key.js, removed) are all
// gone: plain controls are <button>s and cards and rows are CardButton
// (design-drift's roleButtonDivs is 0 and can only stay there).

// #1386: every text field, select, textarea, slider and checkbox has a name
// (aria-label, a wrapping <label>, or an id a <label htmlFor> points at),
// raw or through the shared fields (#1448).
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
      const isCe = n.type === 'CallExpression' && n.arguments[0]
        && ((n.callee.type === 'MemberExpression' && n.callee.property.name === 'createElement')
          || (n.callee.type === 'Identifier' && (n.callee.name === 'e' || n.callee.name === 'h')));
      if (isCe) {
        const a0 = n.arguments[0];
        const tag = a0.type === 'StringLiteral' ? a0.value : a0.type === 'Identifier' ? a0.name : null;
        // A SettingRow names its control by the row's label (aria-labelledby).
        if (tag === 'label' || tag === 'SettingRow') lab = true;
        // Raw fields, and the shared ones (components/fields.js) that take
        // their name from the caller. A checkbox in a <label> is named by it.
        const field = ['input', 'select', 'textarea', 'TextField', 'SecretField', 'Select', 'Slider', 'Checkbox'].includes(tag);
        if (field && !inLabel && n.arguments[1] && n.arguments[1].type === 'ObjectExpression' && f !== 'components/fields.js') {
          const props = n.arguments[1].properties;
          if (props.some((p) => p.type === 'SpreadElement')) { /* named by the spread */ } else {
            const type = props.find((p) => key(p) === 'type');
            const t = tag === 'Slider' ? 'range' : tag === 'Checkbox' ? 'checkbox' : type && type.value.type === 'StringLiteral' ? type.value.value : 'text';
            const named = props.some((p) => ['aria-label', 'aria-labelledby', 'id'].includes(key(p)));
            // A range or checkbox outside a <label> needs a name too.
            if (!named && !['hidden', 'file', 'radio'].includes(t)) missing.push(`${f}:${n.loc.start.line} ${tag}`);
          }
        }
      }
      for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach((x) => walk(x, lab)); else if (v && typeof v.type === 'string') walk(v, lab); }
    })(ast.program, false);
  }
  expect(missing).toEqual([]);
});

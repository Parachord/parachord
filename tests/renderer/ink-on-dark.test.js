/**
 * The always-dark surfaces (the playbar, the sidebar's on-air pill, the AI
 * panels, the queue drawer, anything on --surface-dark* or --tooltip-bg) take
 * the fixed on-dark text colours (--on-dark-secondary / --on-dark-tertiary),
 * never the theme's ink (text-ink-*, --text-primary/secondary/tertiary).
 * Those are for light pages in light mode: the on-air pill's artist was
 * 2.6:1, the AI panels' labels 2.2:1.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const ROOT = path.join(__dirname, '../..');
const files = ['src/renderer/app.js'].concat(
  fs.readdirSync(path.join(ROOT, 'src/renderer/components')).filter((f) => f.endsWith('.js')).map((f) => `src/renderer/components/${f}`),
);
const INK = /\btext-ink-\w+|var\(--text-(primary|secondary|tertiary)\)/;
const isCE = (n) => n && n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'createElement';

function inkOnDark(src) {
  const ast = parse(src, { sourceType: 'script', errorRecovery: true });
  const hits = [];
  const darkStyle = (n) => {
    const props = n.arguments[1];
    if (!props || props.type !== 'ObjectExpression') return false;
    const st = props.properties.find((p) => p.key && (p.key.name === 'style' || p.key.value === 'style'));
    if (!st) return false;
    const txt = src.slice(st.value.start, st.value.end);
    return /background(Color)?\s*:[^,}]*?(surface-dark|tooltip-bg)/.test(txt);
  };
  (function walk(n, inDark) {
    if (!n || typeof n.type !== 'string') return;
    if (isCE(n) && darkStyle(n)) inDark = true;
    if (inDark && (n.type === 'StringLiteral' || n.type === 'TemplateElement')) {
      const v = n.type === 'StringLiteral' ? n.value : n.value.raw;
      if (INK.test(v)) hits.push(`${n.loc.start.line}: ${v.match(INK)[0]}`);
    }
    for (const k in n) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c, inDark));
      else if (v && typeof v.type === 'string') walk(v, inDark);
    }
  })(ast, false);
  return hits;
}

test.each(files)('%s: no theme ink inside an always-dark surface', (file) => {
  expect(inkOnDark(fs.readFileSync(path.join(ROOT, file), 'utf8'))).toEqual([]);
});

test('the guard catches the on-air pill as it was', () => {
  const was = "React.createElement('div', { style: { backgroundColor: 'var(--surface-dark)' } }, React.createElement('span', { className: 'text-ink-tertiary' }, 'x'))";
  expect(inkOnDark(was)).toHaveLength(1);
});

test('both themes define the on-dark text tokens', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect(html.match(/--on-dark-secondary:/g)).toHaveLength(2);
  expect(html.match(/--on-dark-tertiary:/g)).toHaveLength(2);
});

// The playing row in a track list is the accent tint everywhere (a token
// with a dark value). Collection's was bg-cyan-50, a light-only palette
// class: a pale cyan bar with light text on it in dark mode.
test('no track list marks the playing row with a light-only palette class', () => {
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(src.match(/(isNowPlaying|isCurrentTrack)[^?\n]*\? 'bg-(?!accent-tint|purple-900)[a-z]+-\d{2,3}'/g)).toBeNull();
  }
});

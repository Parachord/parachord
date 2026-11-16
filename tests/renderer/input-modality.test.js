// Focus rings show after keyboard use only (lib/input-modality.js + the
// html[data-input="pointer"] rule in index.html). A click that opens a menu,
// dialog or panel moves focus in code, and Chromium then matched
// :focus-visible anyway: a purple ring for a mouse user (2026-11-16).
const fs = require('fs');
const path = require('path');
const { installInputModality, modalityFor } = require('../../src/renderer/lib/input-modality');

function fakeDoc() {
  const attrs = {};
  const listeners = {};
  return {
    documentElement: { getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } },
    addEventListener: (t, fn) => { listeners[t] = fn; },
    removeEventListener: (t) => { delete listeners[t]; },
    fire: (type, extra) => listeners[type] && listeners[type](Object.assign({ type }, extra)),
    attrs, listeners,
  };
}

test('pointer down marks pointer, a key marks keyboard, a modifier alone changes nothing', () => {
  const doc = fakeDoc();
  installInputModality(doc);
  expect(doc.attrs['data-input']).toBe('pointer');
  doc.fire('keydown', { key: 'Tab' });
  expect(doc.attrs['data-input']).toBe('keyboard');
  doc.fire('pointerdown');
  expect(doc.attrs['data-input']).toBe('pointer');
  doc.fire('keydown', { key: 'Meta' });
  expect(doc.attrs['data-input']).toBe('pointer');
});

test('modalityFor', () => {
  expect(modalityFor({ type: 'keydown', key: 'ArrowDown' })).toBe('keyboard');
  expect(modalityFor({ type: 'keydown', key: 'Shift' })).toBeNull();
  expect(modalityFor({ type: 'pointerdown' })).toBe('pointer');
  expect(modalityFor(null)).toBeNull();
});

test('installs without a document (plain Node)', () => {
  expect(() => installInputModality(null)()).not.toThrow();
});

test('index.html hides every ring while the pointer was last; app.js installs it', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  const rule = html.slice(html.indexOf('html[data-input="pointer"] :focus-visible {'));
  expect(rule).toMatch(/^html\[data-input="pointer"\] :focus-visible \{\s*outline: none !important;\s*--tw-ring-offset-shadow: 0 0 #0000 !important;\s*--tw-ring-shadow: 0 0 #0000 !important;/);
  expect(html).toContain('html[data-input="pointer"] .menu-item:focus-visible { box-shadow: none; }');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app).toMatch(/require\('\.\/lib\/input-modality'\);\ninstallInputModality\(\);/);
});

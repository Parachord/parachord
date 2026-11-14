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

test('clickable divs in the renderer are keyboard buttons', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect((app.match(/role: 'button', tabIndex: 0, onKeyDown: activateOnKey/g) || []).length).toBeGreaterThanOrEqual(50);
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  expect(html).toMatch(/\[role="button"\]:focus-visible \{ outline: 2px solid var\(--accent-primary\)/);
});

// components/disclosure.js: Advanced sections, and required keys shown open.
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { Disclosure } = require('../../src/renderer/components/disclosure');
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);

test('closed: only the toggle, with aria-expanded false', () => {
  const out = html(h(Disclosure, { label: 'Advanced', open: false, onToggle() {} }, h('p', null, 'inside')));
  expect(out).toContain('aria-expanded="false"');
  expect(out).not.toContain('inside');
});

test('open: the toggle and the panel it controls', () => {
  const out = html(h(Disclosure, { open: true, onToggle() {} }, h('p', null, 'inside')));
  expect(out).toContain('aria-expanded="true"');
  expect(out).toContain('inside');
});

test('alwaysOpen (keys a sign-in needs, not saved yet): the panel, no toggle', () => {
  const out = html(h(Disclosure, { label: 'Client ID and secret', alwaysOpen: true, open: false, onToggle() {} }, h('p', null, 'inside')));
  expect(out).toContain('inside');
  expect(out).not.toContain('aria-expanded');
  expect(out).not.toContain('Client ID and secret');
});

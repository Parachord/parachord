const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { EmptyState, ErrorState } = require('../../src/renderer/components/states');
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);

test('EmptyState is a status with an icon, title, body and actions', () => {
  const out = html(h(EmptyState, { title: 'No albums yet', body: 'Drag albums here.', actions: [{ label: 'Add friend', onClick() {} }] }));
  expect(out).toContain('role="status"');
  expect(out).toContain('data-icon="Music"');
  expect(out).toContain('No albums yet');
  expect(out).toMatch(/bg-accent-fill[^"]*">Add friend<\/button>/);
});

test('ErrorState is an alert with a warning icon and Try again', () => {
  const out = html(h(ErrorState, { title: 'Couldn’t load concerts', body: 'Timed out', onRetry() {} }));
  expect(out).toContain('role="alert"');
  expect(out).toContain('data-icon="AlertTriangle"');
  expect(out).toContain('text-ink-danger');
  expect(out).toMatch(/>Try again<\/button>/);
});

test('a fix action leads, Try again follows as secondary', () => {
  const out = html(h(ErrorState, { title: 'x', onRetry() {}, actions: [{ label: 'Connect Last.fm', onClick() {} }] }));
  expect(out.indexOf('Connect Last.fm')).toBeLessThan(out.indexOf('Try again'));
  expect(out).toMatch(/border-line-strong[^"]*">Try again/);
});

test('no page keeps a hand-built Retry / Try Again button', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '../../src/renderer');
  const files = ['app.js', ...fs.readdirSync(path.join(dir, 'components')).map((f) => `components/${f}`)];
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/\}, '(Retry|Try Again)'\)/.test(src)) hits.push(f);
  }
  expect(hits).toEqual([]);
});

test('tone dark: on-dark text, a faint circle and dark buttons (the AI panels, the edition menu)', () => {
  const { EmptyState: Empty } = require('../../src/renderer/components/states');
  const { renderToStaticMarkup: render } = require('react-dom/server');
  const html = render(React.createElement(Empty, { tone: 'dark', title: 'No tracks left', body: 'Ask again.', actions: [{ label: 'Ask', onClick: () => {} }] }));
  expect(html).toContain('text-on-dark-primary');
  expect(html).toContain('text-on-dark-secondary');
  expect(html).toContain('bg-white/5');
  expect(html).not.toContain('text-ink-primary');
  expect(html).not.toContain('bg-surface-inset');
  const noIcon = render(React.createElement(Empty, { icon: null, title: 'Nothing' }));
  expect(noIcon).not.toContain('rounded-full');
});

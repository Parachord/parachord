const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { ToastRegion, NowPlayingAnnouncer } = require('../../src/renderer/components/toast');
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);

test('the live region is there even with no toast', () => {
  const out = html(h(ToastRegion, { toast: null }));
  expect(out).toContain('role="status"');
  expect(out).toContain('aria-live="polite"');
  expect(out).toContain('z-index:var(--z-toast)');
});

test('an error toast is an alert with an icon', () => {
  const out = html(h(ToastRegion, { toast: { message: 'Failed', type: 'error' } }));
  expect(out).toContain('role="alert"');
  expect(out).toContain('data-icon="AlertTriangle"');
  expect(out).toContain('Failed');
});

test('a persistent toast can be dismissed; a routine one has no X', () => {
  expect(html(h(ToastRegion, { toast: { message: 'x', persistent: true } }))).toContain('aria-label="Dismiss"');
  expect(html(h(ToastRegion, { toast: { message: 'x' } }))).not.toContain('aria-label="Dismiss"');
});

test('an action renders as a button', () => {
  expect(html(h(ToastRegion, { toast: { message: 'Removed', action: { label: 'Undo', onClick() {} } } }))).toMatch(/<button[^>]*>Undo<\/button>/);
});

test('now playing is announced', () => {
  expect(html(h(NowPlayingAnnouncer, { track: { title: 'Fences', artist: 'Katy Kirby' } }))).toContain('Now playing: Fences by Katy Kirby');
  expect(html(h(NowPlayingAnnouncer, { track: null }))).toContain('aria-live="polite"');
});

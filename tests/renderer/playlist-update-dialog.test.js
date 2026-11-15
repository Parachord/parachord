/**
 * components/playlist-update-dialog.js: the question asked when a playlist is
 * imported from a link: keep it updated, or a snapshot. Built on the shared
 * Modal, RadioGroup and Button.
 */
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const {
  PlaylistUpdateDialog,
  UpdateModeChoice,
  updateModeOptions,
} = require('../../src/renderer/components/playlist-update-dialog');

const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
// The value of the checked radio (React writes checked before value).
const checkedValue = (out) => (out.match(/<input type="radio"[^>]*checked=""[^>]*value="([^"]+)"/) || [])[1];

describe('updateModeOptions', () => {
  test('a service link is checked hourly, a hosted link every 5 minutes', () => {
    const [auto, snap] = updateModeOptions({ isService: true, sourceLabel: 'Spotify' });
    expect(auto.value).toBe('auto');
    expect(auto.hint).toContain('Spotify');
    expect(auto.hint).toContain('every hour');
    expect(snap.value).toBe('snapshot');
    expect(updateModeOptions({ isService: false })[0].hint).toContain('every 5 minutes');
  });

  test('the copy is sentence case and says what happens to the copy here', () => {
    for (const o of updateModeOptions({ isService: true, sourceLabel: 'Apple Music' })) {
      expect(o.label).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
      expect(o.hint).not.toMatch(/resolver|\.\.\./i);
    }
    // The link wins, edits made here included, and the question says so.
    expect(updateModeOptions({ isService: true, sourceLabel: 'Spotify' })[0].hint)
      .toBe('Checks Spotify every hour. Changes there replace this copy, including edits you make here.');
    expect(updateModeOptions({ isService: false })[0].hint)
      .toBe('Checks the link every 5 minutes. Changes there replace this copy, including edits you make here.');
  });
});

describe('PlaylistUpdateDialog', () => {
  const render = (props) => html(h(PlaylistUpdateDialog, { sourceLabel: 'Spotify', isService: true, onChoose() {}, onCancel() {}, ...props }));

  test('is a labelled modal dialog with sentence-case title', () => {
    const out = render();
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('>Import playlist<');
  });

  test('offers both choices as a radio group, keep updated picked by default', () => {
    const out = render();
    expect(out).toContain('role="radiogroup"');
    expect(checkedValue(out)).toBe('auto');
  });

  test('a default of snapshot picks snapshot', () => {
    expect(checkedValue(render({ defaultMode: 'snapshot' }))).toBe('snapshot');
  });

  test('has Cancel next to an Import button, no palette or hex colours', () => {
    const out = render();
    expect(out).toContain('>Cancel<');
    expect(out).toContain('>Import<');
    expect(out).not.toMatch(/#[0-9a-f]{3,6}\b|(?:bg|text|border)-(?:gray|purple|red|green|blue)-\d/i);
  });

  test('shows the description it is given (the deep link names the site)', () => {
    expect(render({ description: 'An external link wants to import a playlist from example.com/list' })).toContain('example.com/list');
  });

  test('renders nothing when closed', () => {
    expect(render({ open: false })).toBe('');
  });
});

describe('UpdateModeChoice', () => {
  test('is the same choice, for the import dialog to show inline', () => {
    const out = html(h(UpdateModeChoice, { value: 'snapshot', onChange() {}, isService: false, name: 'x' }));
    expect(out).toContain('role="radiogroup"');
    expect(checkedValue(out)).toBe('snapshot');
  });
});

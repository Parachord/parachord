/**
 * Shared Button and Modal (#1385 steps 1 and 2).
 */
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { Button, buttonClassName, BUTTON_VARIANTS } = require('../../src/renderer/components/button');
const { Modal, ConfirmModal } = require('../../src/renderer/components/modal');

const html = (el) => renderToStaticMarkup(el);
const h = React.createElement;

describe('Button', () => {
  test.each(BUTTON_VARIANTS)('%s renders a type="button" with token classes only', (variant) => {
    const out = html(h(Button, { variant, 'aria-label': 'x' }, 'Go'));
    expect(out).toMatch(/^<button [^>]*type="button"/);
    expect(out).toContain('focus-visible:ring-2');
    expect(out).not.toMatch(/(?:bg|text|border)-(?:gray|purple|red|green)-\d/);
  });

  test('primary is the fill accent; destructive the error fill', () => {
    expect(buttonClassName({ variant: 'primary' })).toContain('bg-accent-fill text-ink-on-accent');
    expect(buttonClassName({ variant: 'destructive' })).toContain('bg-status-error');
  });

  test('busy disables, sets aria-busy and shows the spinner', () => {
    const out = html(h(Button, { busy: true }, 'Save'));
    expect(out).toContain('disabled=""');
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('data-icon="Spinner"');
    expect(out).toContain('Save');
  });

  test('a page colour fills a primary button', () => {
    expect(html(h(Button, { pageColor: '#0f766e' }, 'Apply'))).toContain('background-color:#0f766e');
  });

  test('an icon button without an aria-label complains', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    html(h(Button, { variant: 'icon' }, 'x'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('aria-label'));
    spy.mockRestore();
  });
});

describe('Modal', () => {
  const render = (props) => html(h(Modal, Object.assign({ open: true, onClose: () => {}, title: 'Add friend', description: 'Paste a link' }, props), 'body'));

  test('is a labelled, described, modal dialog', () => {
    const out = render();
    expect(out).toMatch(/role="dialog"/);
    expect(out).toContain('aria-modal="true"');
    const titleId = out.match(/<h2 id="([^"]+)"/)[1];
    expect(out).toContain(`aria-labelledby="${titleId}"`);
    expect(out).toMatch(/aria-describedby="[^"]+-desc"/);
  });

  test('has one labelled close button, unless hidden', () => {
    expect(render().match(/aria-label="Close"/g)).toHaveLength(1);
    expect(render({ hideClose: true })).not.toContain('aria-label="Close"');
  });

  test('renders nothing when closed', () => {
    expect(render({ open: false })).toBe('');
  });

  test('one title size and the token surface', () => {
    const out = render();
    expect(out).toContain('font-size:20px');
    expect(out).toContain('bg-surface-card');
  });
});

describe('ConfirmModal', () => {
  const render = (dialog) => html(h(ConfirmModal, { dialog: Object.assign({ show: true }, dialog), onClose: () => {} }));
  const buttons = (out) => [...out.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/button>/g)]
    .map((m) => [m[2], m[1].includes('bg-status-error') ? 'destructive' : m[1].includes('bg-accent-fill') ? 'primary' : 'secondary'])
    .filter(([label]) => label);

  test('a plain notice has one primary OK', () => {
    expect(buttons(render({ title: 'Done', message: 'Saved' }))).toEqual([['OK', 'primary']]);
  });

  test('a destructive confirm names its action and offers Cancel', () => {
    expect(buttons(render({ title: 'Remove?', confirmLabel: 'Remove', destructive: true })))
      .toEqual([['Cancel', 'secondary'], ['Remove', 'destructive']]);
  });

  test('an error with a fix makes the fix primary and OK neutral', () => {
    const out = render({ type: 'error', title: 'No Source Found', actionButton: { label: 'Open Settings' } });
    expect(buttons(out)).toEqual([['OK', 'secondary'], ['Open Settings', 'primary']]);
    expect(out).toContain('role="alertdialog"');
  });

  test('an error without a fix is not a red OK', () => {
    expect(buttons(render({ type: 'error', title: 'Failed' }))).toEqual([['OK', 'primary']]);
  });
});

test('app.js renders the confirm dialog through ConfirmModal', () => {
  const app = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app).toContain('confirmDialog.show && React.createElement(ConfirmModal, { dialog: confirmDialog, onClose: closeConfirmDialog })');
  expect(app).not.toMatch(/actionButton: \{ label: 'Cancel' \}/);
});

test('every dialog shell in app.js is a Modal (bare until it is redone)', () => {
  const app = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect((app.match(/React\.createElement\(Modal, \{ bare: true, label: "/g) || []).length).toBeGreaterThanOrEqual(20);
  // What's left with "fixed inset-0" is the Add-to-Playlist side panel and the
  // parachord-link menu's click catcher, which aren't dialogs.
  expect((app.match(/className: 'fixed inset-0/g) || []).length).toBeLessThanOrEqual(2);
});

test('bare mode keeps the panel and adds the dialog semantics', () => {
  const out = html(h(Modal, { bare: true, label: 'Add friend', onClose: () => {}, panelProps: { className: 'max-w-md', style: { borderRadius: '16px' } } }, 'x'));
  expect(out).toContain('role="dialog"');
  expect(out).toContain('aria-modal="true"');
  expect(out).toContain('aria-label="Add friend"');
  expect(out).toContain('class="modal-panel focus:outline-none max-w-md"');
  expect(out).not.toContain('aria-label="Close"');
});

test('confirmAsync resolves false on any way out but the confirm button', () => {
  const calls = [];
  const dialog = { show: true, title: 'Delete?', destructive: true, confirmLabel: 'Delete', onConfirm: () => calls.push('yes'), onCancel: () => calls.push('no') };
  const tree = ConfirmModal({ dialog, onClose: () => calls.push('close') });
  // Modal element's onClose is the cancel path (X, Escape, backdrop)
  tree.props.onClose();
  expect(calls).toEqual(['no', 'close']);
  const cancelBtn = tree.props.footer.find((b) => b.key === 'cancel');
  cancelBtn.props.onClick();
  const confirmBtn = tree.props.footer.find((b) => b.key === 'confirm');
  confirmBtn.props.onClick();
  expect(calls).toEqual(['no', 'close', 'no', 'close', 'yes', 'close']);
});

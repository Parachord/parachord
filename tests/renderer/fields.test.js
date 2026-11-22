const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const F = require('../../src/renderer/components/fields');
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);

test('SettingRow names its control by the row label and describes it by the hint', () => {
  const out = html(h(F.SettingRow, { label: 'Remember queue', hint: 'Restore it on reopen', id: 'rq' }, h(F.Switch, { checked: true })));
  expect(out).toContain('id="rq-label"');
  expect(out).toContain('aria-labelledby="rq-label"');
  expect(out).toContain('aria-describedby="rq-hint"');
  expect(out).toContain('role="switch"');
  expect(out).toContain('aria-checked="true"');
});

test('a control with its own aria-label keeps it', () => {
  const out = html(h(F.SettingRow, { label: 'Port', id: 'p' }, h(F.TextField, { 'aria-label': 'Local server port', value: '8888' })));
  expect(out).toContain('aria-label="Local server port"');
  expect(out).not.toContain('aria-labelledby');
});

test('Select renders its options with the field look and a chevron', () => {
  const out = html(h(F.Select, { value: 'on', onChange() {}, options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] }));
  expect(out).toMatch(/<option value="on" selected="">On<\/option>/);
  expect(out).toContain('bg-surface-card');
  expect(out).toContain('data-icon="ChevronDown"');
});

test('TextField shows an inline error, invalid and described', () => {
  const out = html(h(F.TextField, { value: '1', error: 'Use a port from 1024 to 65535', id: 'port' }));
  expect(out).toContain('aria-invalid="true"');
  expect(out).toContain('aria-describedby="port-error"');
  expect(out).toMatch(/role="alert"[^>]*>Use a port/);
});

test('SecretField hides by default and has a Show button', () => {
  const out = html(h(F.SecretField, { value: 'sk-123', 'aria-label': 'API key' }));
  expect(out).toContain('type="password"');
  expect(out).toMatch(/aria-pressed="false"[^>]*>Show</);
});

test('SecretField offers Show only once there is something to show', () => {
  expect(html(h(F.SecretField, { value: '', 'aria-label': 'API key' }))).not.toContain('>Show<');
  expect(html(h(F.SecretField, { defaultValue: '', 'aria-label': 'API key' }))).not.toContain('>Show<');
  expect(html(h(F.SecretField, { defaultValue: 'saved', 'aria-label': 'API key' }))).toContain('>Show<');
});

test('RadioGroup marks the picked option', () => {
  const out = html(h(F.RadioGroup, { name: 'k', value: 'b', label: 'Keys', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', hint: 'bee' }] }));
  expect(out).toContain('role="radiogroup" aria-label="Keys"');
  expect(out).toMatch(/name="k" checked="" value="b"/);
  expect(out).toContain('bg-accent-tint border-accent');
});

test('Settings > General uses the field set', () => {
  const app = require('../helpers/renderer-source').appWithPages();
  const a = app.indexOf("settingsTab === 'general' && ");
  const general = app.slice(a, app.indexOf("settingsTab === 'about' && ", a));
  expect((general.match(/React\.createElement\(SettingRow, \{/g) || []).length).toBeGreaterThanOrEqual(10);
  // Playback quality, and the window's Size (#1452).
  expect((general.match(/React\.createElement\(Select, \{/g) || []).length).toBe(2);
  expect(general).toContain("React.createElement(RadioGroup, {");
  expect(general).toContain("React.createElement('form', {");
  expect(general).not.toMatch(/React\.createElement\('select', \{/);
});

test('plugin panels say "Use <service>", toggles use the chevron icon, installs are toasts', () => {
  const app = require('../helpers/renderer-source').appWithPages();
  expect(app).not.toContain("'Enable Resolver'");
  // The one on/off switch, in a SettingRow named "Use <service>" (#1498 step 2).
  expect(app).toContain('label: `Enable ${selectedResolver.name}`,');
  expect(app).not.toMatch(/\? 'rotate-90' : ''\}`\n\s*\}, '▶'\)/);
  expect(app).not.toMatch(/title: 'Resolver (Updated|Installed)'/);
  expect(app).toContain("showToast(`${resolverName} installed`, 'success');");
});

// UI text says "plug-in", never "resolver" (2026-11-14). Code identifiers,
// logs and thrown errors may keep the word.
test('no user-facing "resolver" in labels, toasts, dialogs or native menus', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../..');
  const files = ['src/renderer/app.js', 'src/renderer/hooks/use-playback-engine.js', 'main.js'];
  // the word as text: not a ${resolver...} variable or a resolverX identifier
  const word = '(?<![${.\\w])[Rr]esolvers?(?![\\w.(])';
  const ui = new RegExp(`(?:label|title|message|confirmLabel|name)\\s*:\\s*['\`][^'\`\\n]*${word}|\\}, '[^'\\n]*${word}[^'\\n]*'\\)|showToast\\(['\`][^'\`\\n]*${word}`, 'g');
  const hits = files.flatMap((f) => (fs.readFileSync(path.join(root, f), 'utf8').match(ui) || []).map((m) => `${f}: ${m}`));
  expect(hits).toEqual([]);
});

test('Playback Quality names the services it applies to, and on/off is a switch', () => {
  const app = require('../helpers/renderer-source').appWithPages();
  // The services come from the plug-in rule (#1608, tests/renderer/playback-quality-line.test.js).
  expect(app).toContain('description: qualityCopy.description');
  expect(app).toMatch(/label: 'Adjust to your connection'[^\n]*\n\s*React\.createElement\(Switch, \{ checked: playbackAbr === true/);
});

describe('#1448: one set of form controls', () => {
  test('TextField: dark tone, sizes, pill, no JS focus styling', () => {
    const dark = html(h(F.TextField, { tone: 'dark', value: '', 'aria-label': 'Ask' }));
    expect(dark).toContain('bg-[var(--on-dark-faint)]');
    expect(dark).toContain('focus-visible:ring-[var(--playbar-accent)]');
    expect(dark).not.toMatch(/onfocus|onblur/i);
    expect(html(h(F.TextField, { size: 'lg', value: '', 'aria-label': 'x' }))).toMatch(/h-12[^"]*rounded-xl/);
    expect(html(h(F.TextField, { pill: true, value: '', 'aria-label': 'x' }))).toContain('rounded-full');
  });

  test('TextField with an icon and a trailing button wraps them around the input', () => {
    const out = html(h(F.TextField, { value: '', 'aria-label': 'Search', icon: h('i', null), trailing: h('button', null, 'Go'), wrapClassName: 'w-64' }));
    expect(out).toMatch(/^<div class="relative flex items-center w-64">/);
    expect(out).toMatch(/<span aria-hidden="true"[^>]*><i><\/i><\/span><input[^>]*class="[^"]*pl-9[^"]*pr-12/);
    expect(out).toMatch(/<button>Go<\/button><\/span><\/div>$/);
  });

  test('TextField muted reads as a placeholder; bare drops the box', () => {
    expect(html(h(F.TextField, { muted: true, value: 'x', 'aria-label': 'x' }))).toContain('!text-ink-tertiary');
    const bare = html(h(F.TextField, { bare: true, value: 'x', 'aria-label': 'x' }));
    expect(bare).toContain('border-none');
    expect(bare).not.toContain('rounded-lg');
  });

  test('Checkbox: a native checkbox in the accent or a service colour, with the focus ring', () => {
    const out = html(h(F.Checkbox, { checked: true, color: 'var(--x)' }));
    expect(out).toMatch(/<input[^>]*type="checkbox"/);
    expect(out).toContain('checked=""');
    expect(out).toContain('accent-color:var(--x)');
    expect(out).toContain('focus-visible:ring-accent');
    expect(html(h(F.Checkbox, { checked: false }))).toContain('accent-color:var(--accent-fill)');
  });

  test('Slider: the one .slider look; dark tone; a colour sets the thumb', () => {
    const out = html(h(F.Slider, { value: 5, min: 0, max: 10, 'aria-label': 'Radius' }));
    expect(out).toMatch(/<input[^>]*type="range"/);
    expect(out).toMatch(/class="slider"/);
    expect(html(h(F.Slider, { value: 5, tone: 'dark', 'aria-label': 'Volume' }))).toContain('slider slider-dark');
    expect(html(h(F.Slider, { value: 5, color: 'var(--page-concerts)', 'aria-label': 'Radius' }))).toContain('--slider-fill:var(--page-concerts)');
  });

  test('Slider hands onChange a number', () => {
    let got;
    const el = F.Slider({ value: 1, onChange: (v) => { got = v; } });
    el.props.onChange({ target: { value: '7' } });
    expect(got).toBe(7);
  });

  test('Switch has a dark tone', () => {
    const out = html(h(F.Switch, { checked: false, tone: 'dark', 'aria-label': 'Share' }));
    expect(out).toContain('bg-[var(--on-dark-fill)]');
  });

  test('the slider CSS is one class, not a copy per slider', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '../../index.html'), 'utf8');
    expect(css).toContain('.slider::-webkit-slider-thumb');
    expect(css).not.toMatch(/\.(progress|volume)-slider\s*\{/);
  });
});

test('a nested SettingRow is indented under a line, for a setting that depends on the row above', () => {
  const out = html(h(F.SettingRow, { label: 'Play from Spotify', nested: true, id: 'pf' }, h(F.Switch, { size: 'sm', checked: true })));
  expect(out).toContain('border-l-2 border-line');
  expect(out).toContain('padding-left:16px');
  expect(html(h(F.SettingRow, { label: 'Use Spotify', id: 'u' }, h(F.Switch, { checked: true })))).not.toContain('border-l-2');
});

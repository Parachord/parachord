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
  const app = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const a = app.indexOf("settingsTab === 'general' && ");
  const general = app.slice(a, app.indexOf("settingsTab === 'about' && ", a));
  expect((general.match(/React\.createElement\(SettingRow, \{/g) || []).length).toBeGreaterThanOrEqual(10);
  expect((general.match(/React\.createElement\(Select, \{/g) || []).length).toBe(2);
  expect(general).toContain("React.createElement(RadioGroup, {");
  expect(general).toContain("React.createElement('form', {");
  expect(general).not.toMatch(/React\.createElement\('select', \{/);
});

test('plugin panels say "Use <service>", toggles use the chevron icon, installs are toasts', () => {
  const app = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app).not.toContain("'Enable Resolver'");
  expect(app).toContain('}, `Use ${selectedResolver.name}`),');
  expect(app).not.toMatch(/\? 'rotate-90' : ''\}`\n\s*\}, '▶'\)/);
  expect(app).not.toMatch(/title: 'Resolver (Updated|Installed)'/);
  expect(app).toContain("showToast(`${resolverName} installed`, 'success');");
});

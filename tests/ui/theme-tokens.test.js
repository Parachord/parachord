/**
 * Theme tokens in index.html (#1383 step 1): every semantic token has a
 * light and a dark value, native controls follow the theme, and status
 * text meets 4.5:1 on the page background in both themes.
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const block = (selector) => {
  const i = html.indexOf(`    ${selector} {`);
  return html.slice(i, html.indexOf('\n    }', i));
};
const root = block(':root');
const dark = block('.dark');
const value = (css, name) => (css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

describe('theme tokens', () => {
  test('native controls follow the theme', () => {
    expect(root).toContain('color-scheme: light;');
    expect(dark).toContain('color-scheme: dark;');
  });

  test.each(['--success', '--warning', '--error', '--info', '--text-success', '--text-warning', '--text-danger', '--text-info', '--accent-secondary-fg'])(
    '%s has a light and a dark value', (name) => {
      expect(value(root, name)).toBeDefined();
      expect(value(dark, name)).toBeDefined();
    });

  test.each(['--text-success', '--text-warning', '--text-danger', '--text-info'])(
    '%s reads at 4.5:1 on the page background in both themes', (name) => {
      expect(contrast(value(root, name), value(root, '--bg-primary'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(value(dark, name), value(dark, '--bg-primary'))).toBeGreaterThanOrEqual(4.5);
    });

  test('the fill accent takes white text at 4.5:1 and is the same in both themes', () => {
    expect(contrast(value(root, '--accent-fill'), value(root, '--on-accent'))).toBeGreaterThanOrEqual(4.5);
    expect(value(dark, '--accent-fill')).toBeUndefined();
  });

  test('SHARED badge text reads on --accent-secondary in both themes', () => {
    expect(contrast(value(root, '--accent-secondary-fg'), value(root, '--accent-secondary'))).toBeGreaterThanOrEqual(3);
    expect(contrast(value(dark, '--accent-secondary-fg'), value(dark, '--accent-secondary'))).toBeGreaterThanOrEqual(4.5);
  });
});

// #1383 step 3: semantic colours and the accent.
describe('status fills and the accent (#1383 step 3)', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const app = fs2.readFileSync(path2.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const html2 = fs2.readFileSync(path2.join(__dirname, '../../index.html'), 'utf8');

  test('the confirm dialog uses the status tokens, one red', () => {
    const dlg = app.slice(app.indexOf("confirmDialog.type === 'success' ? 'var(--text-success)'"));
    expect(dlg.slice(0, 3000)).toMatch(/'var\(--fill-error\)'/);
    expect(dlg.slice(0, 3000)).not.toMatch(/#dc2626|#22c55e/);
  });

  test('white text never sits on --accent-primary (light purple in dark mode)', () => {
    expect(app).not.toMatch(/color: '#ffffff', backgroundColor: 'var\(--accent-primary\)'/);
    expect(app).not.toMatch(/backgroundColor: 'var\(--accent-primary\)', color: 'var\(--bg-primary\)'/);
  });

  test('no hard-coded accent hex outside the source-colour map', () => {
    const hits = app.match(/'#7c3aed'/g) || [];
    expect(hits.length).toBeLessThanOrEqual(1); // shuffleupagus's source colour
  });

  test('the playbar sliders use the accent, not blue', () => {
    const sliders = html2.slice(html2.indexOf('.progress-slider::-webkit-slider-thumb'), html2.indexOf('.volume-slider.disabled::-webkit-slider-thumb'));
    expect(sliders).not.toMatch(/#3b82f6|#60a5fa/);
    expect(sliders).toMatch(/var\(--playbar-accent\)/);
  });
});

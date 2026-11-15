/**
 * Settings › General's sections are one shared SettingsSection
 * (components/settings-cards.js): the card, the small-capitals heading and
 * an optional line under it. Playback Quality had drifted to a grey card
 * with a large heading (2026-11-15 page pass).
 */
global.React = require('react');
global.ReactVirtual = global.ReactVirtual || {};
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { SettingsSection } = require('../../src/renderer/components/settings-cards');

test('a section is the card with its heading and description', () => {
  const html = renderToStaticMarkup(React.createElement(SettingsSection, { title: 'Cache Management', description: 'Clear cached data' }, 'body'));
  expect(html).toContain('background-color:var(--card-bg);border:1px solid var(--border-subtle);border-radius:12px;padding:24px;box-shadow:var(--card-shadow)');
  expect(html).toMatch(/<h3 style="font-size:11px;font-weight:600;color:var\(--text-tertiary\);text-transform:uppercase;letter-spacing:0\.08em;margin:0">Cache Management<\/h3>/);
  expect(html).toContain('Clear cached data');
  expect(html).toContain('body');
});

test('every Settings › General section uses it, Playback Quality included', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  for (const title of ['Appearance', 'Cache Management', 'Playback Quality', 'Volume Normalization', 'Playback Behavior', 'Media Keys', 'Discord Presence', 'Local Server Port', 'Library Sync']) {
    expect([title, app.includes(`title: '${title}'`)]).toEqual([title, true]);
  }
  expect(app).not.toMatch(/backgroundColor: 'var\(--hover-bg-default\)',\s*borderRadius: '12px'\s*\}\s*\},\s*React\.createElement\('div', \{ style: \{ marginBottom: '16px' \} \},\s*React\.createElement\('h3', \{\s*style: \{ fontSize: '15px'/);
});

test('Escape closes the queue drawer (it had no way but its ✕)', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app).toMatch(/if \(e\.key === 'Escape' && !e\.defaultPrevented && queueDrawerOpen &&[\s\S]{0,200}setQueueDrawerOpen\(false\);\s*return;/);
  expect(app).toContain('}, [activeView, queueDrawerOpen]);');
});

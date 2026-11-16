// #1448: the AI provider is one control on both Shuffleupagus panels.
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { ProviderMenu } = require('../../src/renderer/components/provider-menu');

test('the trigger names the menu and the current provider', () => {
  const out = renderToStaticMarkup(React.createElement(ProviderMenu, {
    label: 'AI provider', value: 'claude',
    services: [{ id: 'chatgpt', name: 'ChatGPT' }, { id: 'claude', name: 'Claude' }],
  }));
  expect(out).toContain('aria-label="AI provider: Claude"');
  expect(out).toContain('aria-haspopup="menu"');
});

test('both panels use it, and neither has a native select', () => {
  const app = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect((app.match(/React\.createElement\(ProviderMenu, \{/g) || []).length).toBe(2);
  expect(app).not.toMatch(/createElement\('select'/);
});

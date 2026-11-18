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

test('the chat panel uses it, and nothing has a native select (the prompt panel went in #1020)', () => {
  const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
  expect((app.match(/React\.createElement\(ProviderMenu, \{/g) || []).length).toBe(1);
  expect(app).not.toMatch(/createElement\('select'/);
});

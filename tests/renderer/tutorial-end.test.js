/**
 * The welcome tour ends on "Get started" (#1493: Home's getting-started
 * layout does the setup). It opens from About, not Developer Settings.
 */
const fs = require('fs');
const path = require('path');
const app = require('../helpers/renderer-source').appWithPages();

test('the tour ends by handing over to Home: the setup is there, not in the tour (#1493)', () => {
  expect(app).toContain("e(Button, { variant: 'primary', onClick: () => close(true) }, 'Get started')");
  expect(app).toMatch(/if \(setup\) startGettingStarted\(\);\s*else navigateTo\('home'\);/);
});

test('the tour opens from About, and Developer Settings no longer has it', () => {
  expect(app).toContain("}, 'Show welcome tour')");
  expect(app).not.toContain("'Show Tutorial Now'");
  expect(app).not.toContain("'Reset Tutorial'");
});

test('the AI chat toast names every AI plug-in and opens Plug-Ins', () => {
  expect(app).not.toContain('Enable Ollama or Claude in Settings');
  expect(app).toContain("new Intl.ListFormat('en', { type: 'disjunction' }).format(names)");
  expect(app).toMatch(/showToast\(`Shuffleupagus needs an AI plug-in\. Enable \$\{list\} in Plug-Ins\.`, 'error', \{\s*label: 'Open Plug-Ins',/);
});

test('an empty Playlists page offers Import', () => {
  expect(app).not.toContain('No playlists yet. Import a playlist to get started!');
  expect(app).toContain("actions: [{ label: 'Import playlist', variant: 'primary', onClick: () => setShowUrlImportDialog(true) }]");
});

test("Home's Ask box says what Shuffleupagus is, in both layouts", () => {
  global.React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const S = require('../../src/renderer/components/home-sections');
  for (const chatAvailable of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(S.AskShuffleupagus, { initialPrompt: 'x', chatAvailable }));
    expect(html).toContain('aria-describedby="home-ask-what"');
    expect(html).toContain('Shuffleupagus is Parachord’s AI DJ.');
  }
});

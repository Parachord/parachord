/**
 * #1387: the welcome tour ends on "Start listening" (Home), with "Open
 * Plug-Ins" beside it; with nothing playable on it says "Almost there" and
 * Open Plug-Ins is the main button. It opens from About, not Developer
 * Settings.
 */
const fs = require('fs');
const path = require('path');
const app = require('../helpers/renderer-source').appWithPages();

test('the last step offers Start listening and Open Plug-Ins', () => {
  expect(app).toContain("tutorialPlayable && React.createElement(Button, { variant: 'primary', onClick: () => finishTutorial('home') }, 'Start listening')");
  expect(app).toContain("React.createElement(Button, { variant: tutorialPlayable ? 'secondary' : 'primary', onClick: () => finishTutorial('plugins') }, 'Open Plug-Ins')");
  expect(app).toContain("tutorialPlayable ? 'You’re all set' : 'Almost there'");
  expect(app).toContain("const tutorialPlayable = loadedResolvers.some(r => r.capabilities?.resolve && playbackResolvers.includes(r.id));");
  expect(app).toMatch(/if \(where === 'plugins'\) \{ setSettingsTab\('plugins'\); navigateTo\('settings'\); \}\s*else navigateTo\('home'\);/);
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

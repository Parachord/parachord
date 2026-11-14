/**
 * Loved-tracks IMPORT (parachord#1071): the settings card's import button.
 * Plan Task 5: render ScrobblerSettingsCard under Node (same React as the
 * vendor bundle) and pin the button's labels and states.
 */

global.React = require('react');
global.ReactDOM = require('react-dom');
global.ReactVirtual = require('@tanstack/react-virtual');

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { ScrobblerSettingsCard } = require('../../src/renderer/components/settings-cards');

const connected = { enabled: true, sessionKey: 'sk', username: 'u' };

const render = (props) => renderToStaticMarkup(
  React.createElement(ScrobblerSettingsCard, {
    scrobbler: { id: 'lastfm', name: 'Last.fm' },
    config: connected,
    ...(props || {}),
  })
);

const importButton = (markup) => {
  const m = markup.match(/<button[^>]*>(?:<[^>]*>)*\s*((?:Import|Looking|Waiting)[^<]*(?:<[^>]*>[^<]*)*)/);
  return m ? m[0] : null;
};

describe('the import button on the scrobbler card', () => {
  test('reads "Import loved tracks", and "Import new loves" once loves were imported', () => {
    expect(importButton(render({ onRunLoveImport: () => {} }))).toContain('Import loved tracks');
    expect(importButton(render({ onRunLoveImport: () => {}, hasImportedLoves: true }))).toContain('Import new loves');
  });

  test('shows progress while running, and is disabled', () => {
    const markup = render({ onRunLoveImport: () => {}, loveImportRunning: true, loveImportProgress: { done: 120, total: 840 } });
    expect(importButton(markup)).toContain('Importing… 120/840');
    expect(importButton(markup)).toContain('disabled');
    const lookup = render({ onRunLoveImport: () => {}, loveImportRunning: true, loveImportProgress: { done: 3, total: 41, phase: 'lookup' } });
    expect(importButton(lookup)).toContain('Looking up names… 3/41');
    const confirm = render({ onRunLoveImport: () => {}, loveImportRunning: true, loveImportProgress: { done: 0, total: 0, phase: 'confirm' } });
    expect(importButton(confirm)).toContain('Waiting for confirmation…');
  });

  test('no button without the handler (Libre.fm)', () => {
    expect(importButton(render())).toBeNull();
  });

  test('both cards are wired (a reverted card wiring fails this)', () => {
    const fs = require('fs');
    const path = require('path');
    const app = fs.readFileSync(path.join(__dirname, '../..', 'src/renderer/app.js'), 'utf8');
    expect(app).toContain("onRunLoveImport: () => runLoveImport('lastfm')");
    expect(app).toContain("onRunLoveImport: () => runLoveImport('listenbrainz')");
    expect(app).toContain('loveImportRunning: !!loveImportRunning.listenbrainz');
    expect(app).toContain('hasImportedLoves: !!loveImportCursorRef.current?.listenbrainz');
  });

  test('the tint token, not a palette class (design-drift ratchet #1380)', () => {
    const markup = render({ onRunLoveImport: () => {} });
    expect(markup).toContain('var(--accent-surface)');
    expect(markup).not.toContain('purple-50');
  });
});

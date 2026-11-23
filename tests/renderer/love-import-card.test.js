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
    lovedTracks: true, // the plug-in declares the lovedTracks capability
    ...(props || {}),
  })
);

// The loved-tracks rows (one layout for every plug-in that declares
// lovedTracks, signed in or not; 2026-11-23): the import needs only a
// username (both services publish a user's loves), so it shows signed out
// too; pushing loves needs the scrobbling sign-in, so its switch is off and
// locked signed out (the signed-out rule, #1614).
const signedOut = { enabled: false, username: undefined, authError: 'Session expired' };
const row = (markup, label) => {
  const i = markup.indexOf(label);
  return i < 0 ? null : markup.slice(Math.max(0, i - 400), i + 900);
};

describe('the loved-tracks rows on the scrobbler card', () => {
  test('Import: a row with an Import button, "Import new" once loves were imported', () => {
    const r = row(render({ onRunLoveImport: () => {}, loveImportUsername: 'u' }), 'Import loved tracks');
    expect(r).toMatch(/>Import<\/button>/);
    expect(row(render({ onRunLoveImport: () => {}, loveImportUsername: 'u', hasImportedLoves: true }), 'Import loved tracks')).toMatch(/>Import new<\/button>/);
  });

  test('Import shows its progress in the row, the button busy', () => {
    const r = row(render({ onRunLoveImport: () => {}, loveImportUsername: 'u', loveImportRunning: true, loveImportProgress: { done: 120, total: 840 } }), 'Import loved tracks');
    expect(r).toContain('Importing… 120 of 840');
    expect(r).toContain('aria-busy="true"');
    expect(row(render({ onRunLoveImport: () => {}, loveImportUsername: 'u', loveImportRunning: true, loveImportProgress: { done: 3, total: 41, phase: 'lookup' } }), 'Import loved tracks')).toContain('Looking up names… 3 of 41');
    expect(row(render({ onRunLoveImport: () => {}, loveImportUsername: 'u', loveImportRunning: true, loveImportProgress: { done: 0, total: 0, phase: 'confirm' } }), 'Import loved tracks')).toContain('Waiting for confirmation…');
  });

  test('signed out of scrobbling, Import still works from the account\'s username', () => {
    const markup = render({ config: signedOut, onRunLoveImport: () => {}, loveImportUsername: 'jh', onSetLovePushEnabled: () => {}, lovePushEnabled: true });
    const r = row(markup, 'Import loved tracks');
    expect(r).toMatch(/<button[^>]*>Import<\/button>/);
    expect(r).not.toMatch(/<button[^>]* disabled=""[^>]*>Import<\/button>/);
    // Push needs the sign-in: off and locked, and it says why.
    const push = row(markup, 'Push loves to Last.fm');
    expect(push).toContain('role="switch"');
    expect(push).toContain('aria-checked="false"');
    expect(push).toMatch(/role="switch"[^>]* disabled=""|disabled=""[^>]*role="switch"/);
    expect(push).toContain('Sign in to scrobble first');
    // Nothing to send while signed out.
    expect(markup).not.toContain('loved tracks to Last.fm</');
  });

  test('without any username, Import says to add one and is disabled', () => {
    const r = row(render({ config: signedOut, onRunLoveImport: () => {} }), 'Import loved tracks');
    expect(r).toContain('Add your Last.fm username first');
    expect(r).toMatch(/<button[^>]* disabled=""[^>]*>Import<\/button>/);
  });

  test('signed in: Push is a working switch, and Send offers the loves not yet sent', () => {
    const markup = render({ onRunLoveImport: () => {}, loveImportUsername: 'u', onSetLovePushEnabled: () => {}, lovePushEnabled: true, onRunBackfill: () => {}, unpushedCount: 1946 });
    const push = row(markup, 'Push loves to Last.fm');
    expect(push).toContain('aria-checked="true"');
    expect(push).not.toMatch(/role="switch"[^>]* disabled=""|disabled=""[^>]*role="switch"/);
    expect(markup).toContain('Send 1,946 loved tracks to Last.fm');
    expect(row(markup, 'Send 1,946 loved tracks to Last.fm')).toMatch(/>Send<\/button>/);
  });

  test('one control per job: a switch, never a checkbox or a text-link button', () => {
    const markup = render({ onRunLoveImport: () => {}, loveImportUsername: 'u', onSetLovePushEnabled: () => {}, onRunBackfill: () => {}, unpushedCount: 3 });
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain('Backfill');
  });

  test('no rows without the handler (Libre.fm), or for a plug-in that does not declare lovedTracks', () => {
    expect(render()).not.toContain('Import loved tracks');
    expect(render({ onRunLoveImport: () => {}, lovedTracks: false })).not.toContain('Import loved tracks');
  });

  test('the card is wired once, for whichever plug-in is open (a reverted wiring fails this)', () => {
    const app = require('../helpers/renderer-source').appWithPages();
    expect(app).toContain('onRunLoveImport: () => runLoveImport(id)');
    expect(app).toContain('loveImportRunning: !!loveImportRunning[id]');
    expect(app).toContain('hasImportedLoves: !!loveImportCursorRef.current?.[id]');
  });

  test('the dialog passes the username the import can use: the scrobbling sign-in\'s, else the account\'s', () => {
    const app = require('../helpers/renderer-source').appWithPages();
    expect(app).toMatch(/loveImportUsername: scrobblerConfigs\[id\]\?\.username \|\| metaServiceConfigs\[id\]\?\.username \|\| null/);
  });

});

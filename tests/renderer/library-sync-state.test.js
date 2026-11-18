const { librarySyncState } = require('../../src/renderer/lib/library-sync-state');

test('never set up, or stopped: set up', () => {
  expect(librarySyncState(undefined, false)).toBe('setup');
  expect(librarySyncState({ enabled: false }, false)).toBe('setup');
  expect(librarySyncState({ enabled: false, stopped: true, syncTracks: true }, false)).toBe('setup');
});

test('switched off from the Sync menu with its choices kept: paused, not "set up"', () => {
  expect(librarySyncState({ enabled: false, syncTracks: true, lastSyncAt: '2026-11-16T00:45:00Z' }, false)).toBe('paused');
});

test('on and signed in: active; on with a lapsed sign-in: signed out', () => {
  expect(librarySyncState({ enabled: true, syncTracks: true }, false)).toBe('active');
  expect(librarySyncState({ enabled: true, syncTracks: true }, true)).toBe('signed-out');
});

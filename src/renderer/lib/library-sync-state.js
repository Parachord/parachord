// src/renderer/lib/library-sync-state.js: what a service's Library Sync is
// doing, for its plug-in settings dialog.
//
// The dialog used to read only `enabled`, so two different states looked
// wrong (2026-11-17, testing #1498):
//   - a sync paused from the Collection's Sync menu (enabled: false, every
//     choice kept) showed "Set up library sync", as if never set up;
//   - a sync whose sign-in had lapsed (Apple Music's token expired, the
//     background check got a 401) showed "Active" under a "Sign in" button.
// Stop syncing writes `stopped: true` (the setup is gone, start over); the
// Sync menu's switch only flips `enabled` (a pause).
//
// librarySyncState(settings, signedOut) →
//   'setup'       never set up, or stopped: offer setup
//   'signed-out'  set up and on, but the service refused the sign-in
//   'paused'      set up, switched off; choices kept
//   'active'      syncing
// Pure; loads under plain Node.

'use strict';

function librarySyncState(settings, signedOut) {
  if (!settings || settings.stopped) return 'setup';
  if (settings.enabled === false || !settings.enabled) {
    // A record with no choices was never set up (an old "stop" left only
    // enabled: false behind with nothing else).
    const hasChoices = Object.keys(settings).some((k) => k !== 'enabled' && k !== 'stopped');
    return hasChoices ? 'paused' : 'setup';
  }
  return signedOut ? 'signed-out' : 'active';
}

module.exports = { librarySyncState };

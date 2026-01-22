// scrobblers/index.js
// Exports all scrobbler plugins and initialization helper

import scrobbleManager from '../scrobble-manager.js';
import ListenBrainzScrobbler from './listenbrainz-scrobbler.js';
import LastFmScrobbler from './lastfm-scrobbler.js';
import LibreFmScrobbler from './librefm-scrobbler.js';

// Create singleton instances
export const listenbrainzScrobbler = new ListenBrainzScrobbler();
export const lastfmScrobbler = new LastFmScrobbler();
export const librefmScrobbler = new LibreFmScrobbler();

// All available scrobblers
export const scrobblers = [
  listenbrainzScrobbler,
  lastfmScrobbler,
  librefmScrobbler
];

// Initialize all scrobblers and register with manager
export async function initializeScrobblers(config = {}) {
  // Set Last.fm API credentials if provided
  if (config.lastfmApiKey && config.lastfmApiSecret) {
    lastfmScrobbler.setApiCredentials(config.lastfmApiKey, config.lastfmApiSecret);
  }

  // Register all scrobblers with the manager
  for (const scrobbler of scrobblers) {
    scrobbleManager.registerPlugin(scrobbler);
  }

  // Retry any failed scrobbles from previous session
  await scrobbleManager.retryFailedScrobbles();

  console.log('[Scrobblers] Initialized', scrobblers.length, 'scrobbler plugins');
  return scrobblers;
}

// Get scrobbler by ID
export function getScrobbler(id) {
  return scrobblers.find(s => s.id === id);
}

export { scrobbleManager };
export default scrobbleManager;

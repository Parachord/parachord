// src/renderer/lib/playlist-update-mode.js: a playlist imported from a link
// (dropped, pasted in the import dialog, or a parachord://import link) is
// either a snapshot or kept updated from that link. The person picks when
// they import (components/playlist-update-dialog.js); the choice is the
// record's `autoUpdate`.
//
//   kept updated + XSPF URL:     the hosted machinery: on the hosted_playlists
//                                startup list, polled every 5 minutes.
//   kept updated + service link: re-looked-up once an hour (app.js, the
//                                service-link poller). Never on the hosted
//                                list: that would fetch the service's page
//                                as an XSPF (docs/architecture/sync.md).
//   snapshot:                    never re-fetched; saved like any playlist.
//
// A playlist imported before the choice existed has no `autoUpdate` and keeps
// what it did: a hosted XSPF kept updating, a service link was a snapshot.
//
// `providerImported` is window.isProviderImportedPlaylist(playlist, loader)
// (protocol-url.js), passed in so this stays pure. Loads under plain Node.

const SERVICE_REFRESH_MS = 60 * 60 * 1000;

// 'auto' | 'snapshot', or null for a playlist not imported from a link.
function playlistUpdateMode(playlist, { providerImported } = {}) {
  if (!playlist || !playlist.sourceUrl) return null;
  if (typeof playlist.autoUpdate === 'boolean') return playlist.autoUpdate ? 'auto' : 'snapshot';
  return providerImported ? 'snapshot' : 'auto';
}

// The 5-minute XSPF poller, the startup reload and the hosted save path.
function isPolledHostedXspf(playlist, { providerImported } = {}) {
  return !providerImported && playlistUpdateMode(playlist, { providerImported }) === 'auto';
}

// A kept-updated service link whose last update is an hour old.
function serviceRefreshDue(playlist, { providerImported, now = Date.now() } = {}) {
  if (!providerImported || playlistUpdateMode(playlist, { providerImported }) !== 'auto') return false;
  const last = playlist.lastUpdated || playlist.addedAt || 0;
  return now - last >= SERVICE_REFRESH_MS;
}

// The hosted_playlists startup list after a playlist's mode changes: a kept-
// updated XSPF is on it once, a snapshot XSPF is not, a service link never.
function hostedListForMode(list, playlist, mode, { providerImported } = {}) {
  const current = Array.isArray(list) ? list : [];
  if (providerImported || !playlist || !playlist.sourceUrl) return current;
  const url = playlist.sourceUrl;
  if (mode === 'snapshot') return current.filter((item) => item && item.url !== url);
  if (current.some((item) => item && item.url === url)) return current;
  return [...current, {
    url,
    id: playlist.id,
    addedAt: playlist.addedAt || Date.now(),
    ...(playlist.title ? { title: playlist.title } : {}),
    ...(playlist.creator ? { creator: playlist.creator } : {}),
  }];
}

module.exports = {
  SERVICE_REFRESH_MS,
  playlistUpdateMode,
  isPolledHostedXspf,
  serviceRefreshDue,
  hostedListForMode,
};

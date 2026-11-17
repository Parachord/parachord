// main-process/achordion-submit-memo.js: send a playlist's mirror links to
// Achordion only when they changed.
//
// pushPlaylistLinksToAchordion (main.js) ran after every ListenBrainz push,
// including the ones the provider skipped because the remote already
// matched, so each sync cycle re-sent the same links for every playlist.
// Achordion rate-limits the endpoint per IP, and the bursts came back as
// HTTP 429 for most of them (2026-11-17). It also fetched Apple Music's
// public URL each time before sending.
//
// The fingerprint is built from what the links are made of (the mirror ids,
// the name, the track count), before any network call, so an unchanged
// playlist costs nothing. A fingerprint is remembered only once Achordion
// accepted the submit, so a refused one (429, a network error) is sent again
// next time; it's saved, so a restart doesn't re-send everything.
//
// Achordion keeps an entry for 90 days, and a submit renews it
// (lib/playlist-links-store.ts there), so an unchanged playlist is still sent
// again once its last send is older than REFRESH_MS: never sending it would
// let it expire, and a re-send also restores an entry deleted or edited on
// Achordion's side, which desktop never reads back.
//
// Pure apart from the store it's given; loads under plain Node.

'use strict';

const STORE_KEY = 'achordion_playlist_links_sent';
// Well inside Achordion's 90-day TTL.
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

// The parts of a localPlaylist-shaped context that make up its submit, as a
// string, or null when there's nothing to send (no ListenBrainz anchor).
function playlistLinksFingerprint(localPlaylist) {
  if (!localPlaylist) return null;
  const syncedTo = localPlaylist.syncedTo || {};
  const lbMbid = syncedTo.listenbrainz?.externalId
    || (localPlaylist.syncedFrom?.resolver === 'listenbrainz' && localPlaylist.syncedFrom.externalId);
  if (!lbMbid) return null;
  return JSON.stringify([
    lbMbid,
    syncedTo.spotify?.externalId || null,
    syncedTo.applemusic?.externalId || null,
    syncedTo.listenbrainz?.externalId || null,
    typeof localPlaylist.title === 'string' ? localPlaylist.title.trim() : null,
    typeof localPlaylist.creator === 'string' ? localPlaylist.creator.trim() : null,
    Array.isArray(localPlaylist.tracks) ? localPlaylist.tracks.length : null,
  ]);
}

// createSubmitMemo(store, now?) → { unchanged(mbid, fingerprint), remember(mbid, fingerprint) }
// `store` has get(key) / set(key, value) (electron-store's shape). Each entry
// is { fp, at }; `now` is for tests.
function createSubmitMemo(store, now = () => Date.now()) {
  let sent = null;
  const load = () => {
    if (sent) return sent;
    try {
      const saved = store && store.get(STORE_KEY);
      sent = saved && typeof saved === 'object' ? { ...saved } : {};
    } catch (e) {
      sent = {};
    }
    return sent;
  };
  return {
    // Same as last accepted, and sent recently enough that Achordion still
    // has it.
    unchanged(mbid, fingerprint) {
      if (!mbid || !fingerprint) return false;
      const entry = load()[mbid];
      return !!entry && entry.fp === fingerprint && typeof entry.at === 'number' && now() - entry.at < REFRESH_MS;
    },
    remember(mbid, fingerprint) {
      if (!mbid || !fingerprint) return;
      load()[mbid] = { fp: fingerprint, at: now() };
      try { if (store) store.set(STORE_KEY, sent); } catch (e) { /* in memory still skips this session */ }
    },
  };
}

module.exports = { playlistLinksFingerprint, createSubmitMemo, STORE_KEY, REFRESH_MS };

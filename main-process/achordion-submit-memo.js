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
// Pure apart from the store it's given; loads under plain Node.

'use strict';

const STORE_KEY = 'achordion_playlist_links_sent';

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

// createSubmitMemo(store) → { unchanged(mbid, fingerprint), remember(mbid, fingerprint) }
// `store` has get(key) / set(key, value) (electron-store's shape).
function createSubmitMemo(store) {
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
    unchanged(mbid, fingerprint) {
      return !!mbid && !!fingerprint && load()[mbid] === fingerprint;
    },
    remember(mbid, fingerprint) {
      if (!mbid || !fingerprint) return;
      load()[mbid] = fingerprint;
      try { if (store) store.set(STORE_KEY, sent); } catch (e) { /* in memory still skips this session */ }
    },
  };
}

module.exports = { playlistLinksFingerprint, createSubmitMemo, STORE_KEY };

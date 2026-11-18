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
// A submit that left out a mirror's link (Apple Music has no public URL until
// the playlist is shared in the Music app, and the lookup can also 404 for a
// while) is remembered as partial and re-checked after PARTIAL_REFRESH_MS,
// not REFRESH_MS: tapping Share changes nothing the fingerprint sees, so the
// full window would hold the new link back for a month.
//
// Pure apart from the store it's given; loads under plain Node.

'use strict';

const STORE_KEY = 'achordion_playlist_links_sent';
// Well inside Achordion's 90-day TTL.
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
// A submit that left a mirror's link out: look again daily.
const PARTIAL_REFRESH_MS = 24 * 60 * 60 * 1000;

// The ListenBrainz playlist id Achordion keys the entry by: pushed there
// (syncedTo) or imported from there (syncedFrom). null when neither.
function playlistLinksAnchor(localPlaylist) {
  if (!localPlaylist) return null;
  return localPlaylist.syncedTo?.listenbrainz?.externalId
    || (localPlaylist.syncedFrom?.resolver === 'listenbrainz' && localPlaylist.syncedFrom.externalId)
    || null;
}

// The parts of a localPlaylist-shaped context that make up its submit, as a
// string, or null when there's nothing to send (no ListenBrainz anchor).
function playlistLinksFingerprint(localPlaylist) {
  const lbMbid = playlistLinksAnchor(localPlaylist);
  if (!lbMbid) return null;
  const syncedTo = localPlaylist.syncedTo || {};
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

// createSubmitMemo(store, now?) → { unchanged(mbid, fingerprint), remember(mbid, fingerprint, { partial }) }
// `store` has get(key) / set(key, value) (electron-store's shape). Each entry
// is { fp, at } plus `partial: true` when a mirror's link was left out; `now`
// is for tests.
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
    // has it (or, for a partial send, recently enough to look again).
    unchanged(mbid, fingerprint) {
      if (!mbid || !fingerprint) return false;
      const entry = load()[mbid];
      if (!entry || entry.fp !== fingerprint || typeof entry.at !== 'number') return false;
      return now() - entry.at < (entry.partial ? PARTIAL_REFRESH_MS : REFRESH_MS);
    },
    remember(mbid, fingerprint, { partial = false } = {}) {
      if (!mbid || !fingerprint) return;
      load()[mbid] = partial ? { fp: fingerprint, at: now(), partial: true } : { fp: fingerprint, at: now() };
      try { if (store) store.set(STORE_KEY, sent); } catch (e) { /* in memory still skips this session */ }
    },
  };
}

module.exports = { playlistLinksAnchor, playlistLinksFingerprint, createSubmitMemo, STORE_KEY, REFRESH_MS, PARTIAL_REFRESH_MS };

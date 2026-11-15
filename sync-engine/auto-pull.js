/**
 * Auto-pull for imported playlists.
 *
 * A playlist imported from a service (`syncedFrom`) takes that service's new
 * version on the next sync, the way the Android app does. Nobody is asked to
 * "pull changes". Two cases never pull:
 *
 *   - The person edited the playlist here since the last sync from its source.
 *     Pulling would throw those edits away, so the playlist is flagged
 *     (`hasUpdates: true`) and the playlist page shows the conflict, where the
 *     person picks which version to keep. Mobile settles this case by last
 *     write wins; desktop asks, because either answer loses someone's edits.
 *   - A hosted XSPF. The XSPF is the upstream and the 5-minute poller would
 *     revert a pull; the push loop sends the XSPF's tracks to the service.
 *
 * "Edited here" is read from `syncedFrom.tracksFingerprint`: the tracklist
 * the playlist last agreed with its source on (import, pull, push to the
 * source). Timestamps and `locallyModified` can't answer it: sync:start moves
 * `syncSources[provider].syncedAt` on every sync, unchanged ones included, and
 * the push loop clears `locallyModified` once the other mirrors catch up, so
 * both forget an edit within a sync or two.
 *
 * Pure: no store, no IPC. `main-process/ipc/sync-start.js` applies it and the
 * playlist page's sync banner reads it. See "Auto-pull" in
 * docs/architecture/sync.md.
 */

const { trackKey } = require('../playlist-freshness');

// The seed for an import whose edits can't be ruled out (see
// seedTracksFingerprint). Never the `count:hash` shape, so it never matches.
const UNKNOWN_FINGERPRINT = 'unknown';

/**
 * A short, order-aware fingerprint of a tracklist: the track count and an
 * FNV-1a hash of each track's artist and title, folded like trackSlug
 * (playlist-freshness.js `trackKey`). Ids, sources and albums don't count, so
 * resolving or enriching a track doesn't read as an edit.
 */
function tracksFingerprint(tracks) {
  const list = Array.isArray(tracks) ? tracks : [];
  let hash = 0x811c9dc5;
  for (const track of list) {
    const key = `${trackKey(track)}\u0001`;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `${list.length}:${hash.toString(16)}`;
}

/**
 * Real local edits: the tracks differ from the ones last agreed with the
 * source. A playlist saved before the fingerprint existed falls back to the
 * old reading, an edit since the last sync from the source: `locallyModified`
 * alone isn't enough, because a pull sets it to pass new tracks on to the
 * playlist's other mirrors, and a pull stamps `lastModified` and the source's
 * `syncedAt` with the same time, so only a later edit counts.
 */
function hasRealLocalEdits(playlist, providerId) {
  if (!playlist) return false;
  const agreed = playlist.syncedFrom && playlist.syncedFrom.tracksFingerprint;
  if (typeof agreed === 'string') return tracksFingerprint(playlist.tracks) !== agreed;
  if (!playlist.locallyModified) return false;
  const syncedAt = (playlist.syncSources && playlist.syncSources[providerId] && playlist.syncSources[providerId].syncedAt) || 0;
  return (playlist.lastModified || 0) > syncedAt;
}

/**
 * A hosted XSPF is polled from its `sourceUrl`. A provider URL import also
 * carries `sourceUrl` but is a one-time snapshot (`source` ends in `-import`);
 * same rule as the playlist page's sync banner.
 */
function isHostedXspf(playlist) {
  if (!playlist || !playlist.sourceUrl) return false;
  // Imported from its link as a snapshot: nothing polls it
  // (src/renderer/lib/playlist-update-mode.js).
  if (playlist.autoUpdate === false) return false;
  const isProviderSnapshot = typeof playlist.source === 'string' && playlist.source.endsWith('-import');
  return !isProviderSnapshot;
}

/**
 * What to do with an imported playlist whose remote changed.
 * @param {object} playlist   the stored local playlist
 * @param {string} providerId the provider it was imported from
 * @param {object} [opts]
 * @param {boolean} [opts.sourceOnly] the source is the only authority and local
 *   edits can't reach it (Spotify's own algorithmic playlists): always pull.
 * @returns {'pull'|'conflict'|'hosted'}
 */
function remoteUpdateAction(playlist, providerId, { sourceOnly = false } = {}) {
  if (isHostedXspf(playlist)) return 'hosted';
  if (sourceOnly) return 'pull';
  return hasRealLocalEdits(playlist, providerId) ? 'conflict' : 'pull';
}

/**
 * The playlist after a pull: the remote's tracks and snapshot, every other
 * field kept. When the playlist is also mirrored to other providers it is
 * flagged `locallyModified` so the push loop passes the new tracks on.
 *
 * An empty answer for a playlist that has tracks is treated as a bad response
 * (Apple Music returns no tracks for some shared playlists; rate limits return
 * empty pages): the tracks stay and only the snapshot advances. Mobile does
 * the same (`pullPlaylist`'s empty-remote safety net).
 */
function applyPulledTracks(playlist, { providerId, remotePlaylist, tracks, now }) {
  const incoming = Array.isArray(tracks) ? tracks : [];
  const existing = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  const keepExisting = incoming.length === 0 && existing.length > 0;
  const syncedTo = playlist.syncedTo || {};
  const hasOtherMirrors = Object.keys(syncedTo).some(
    (pid) => pid !== providerId && syncedTo[pid] && syncedTo[pid].externalId
  );
  const nextTracks = keepExisting ? existing : incoming;
  return {
    ...playlist,
    tracks: nextTracks,
    syncedFrom: {
      ...playlist.syncedFrom,
      snapshotId: remotePlaylist.snapshotId,
      tracksFingerprint: tracksFingerprint(nextTracks),
    },
    hasUpdates: false,
    locallyModified: hasOtherMirrors,
    lastModified: now,
    syncSources: {
      ...playlist.syncSources,
      [providerId]: { ...(playlist.syncSources && playlist.syncSources[providerId]), syncedAt: now },
    },
  };
}

/**
 * A playlist imported before the fingerprint has none, and the timestamp rule
 * it falls back to forgets an edit after one more sync. So `sync:start` seeds
 * one the first time it sees such an import from its source, and the old rule
 * is never asked again:
 *   - not flagged `locallyModified`: its tracks, taken as agreeing with the
 *     source (the best we know);
 *   - flagged: UNKNOWN_FINGERPRINT, which never matches, so it reads as
 *     edited until the banner's Push or "Use <service>" records a real one.
 *     A pull-induced flag can't be told from an edit here, so it reads as
 *     edited too; asking once is the safe side.
 */
function seedTracksFingerprint(playlist, providerId) {
  const from = playlist && playlist.syncedFrom;
  if (!from || from.resolver !== providerId || typeof from.tracksFingerprint === 'string') return playlist;
  return {
    ...playlist,
    syncedFrom: {
      ...from,
      tracksFingerprint: playlist.locallyModified ? UNKNOWN_FINGERPRINT : tracksFingerprint(playlist.tracks),
    },
  };
}

/**
 * `sync:start` reads `local_playlists`, works through every playlist (awaiting
 * each fetch), then saves the whole list. A save in between would be saved
 * over by the pulled copy. `base` is what the pull read:
 * `{ lastModified, tracksFingerprint }`.
 *   - Nothing saved since: the pull.
 *   - Saved, tracks unchanged (the resolved-sources flush, a rename): the pull
 *     on top of the stored record, which keeps its other changes.
 *   - Saved with other tracks (an edit): the stored record, flagged as a
 *     conflict, its snapshot left where it was.
 */
function keepEditsMadeDuringPull(pulled, latest, base = {}) {
  if (!latest) return pulled;
  if ((latest.lastModified || 0) === (base.lastModified || 0)) return pulled;
  if (typeof base.tracksFingerprint === 'string' && tracksFingerprint(latest.tracks) === base.tracksFingerprint) {
    return {
      ...latest,
      tracks: pulled.tracks,
      syncedFrom: pulled.syncedFrom,
      syncSources: pulled.syncSources,
      hasUpdates: pulled.hasUpdates,
      locallyModified: !!(pulled.locallyModified || latest.locallyModified),
      lastModified: Math.max(pulled.lastModified || 0, latest.lastModified || 0),
      ...('coverArt' in pulled ? { coverArt: pulled.coverArt } : {}),
    };
  }
  return { ...latest, hasUpdates: true };
}

module.exports = {
  UNKNOWN_FINGERPRINT,
  seedTracksFingerprint,
  tracksFingerprint,
  hasRealLocalEdits,
  isHostedXspf,
  remoteUpdateAction,
  applyPulledTracks,
  keepEditsMadeDuringPull,
};

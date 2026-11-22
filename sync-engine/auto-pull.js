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

/**
 * The renderer push loops send a playlist's edits back to its own source (the
 * collaborative case: a ListenBrainz playlist with collaborators, an owned
 * playlist linked by the create gateway). Push when the tracks really differ
 * from what the source last agreed on, whatever the flags and timestamps say,
 * and never while a conflict is pending (`hasUpdates`): the source changed
 * too, and the person picks on the playlist page. A seed of
 * UNKNOWN_FINGERPRINT proves nothing, so it (and a record with no
 * fingerprint) keeps the old rule: flagged and edited since the last sync.
 */
function shouldPushToSource(playlist, providerId) {
  const from = playlist && playlist.syncedFrom;
  if (!from || from.resolver !== providerId) return false;
  if (playlist.hasUpdates) return false;
  if (typeof from.tracksFingerprint === 'string' && from.tracksFingerprint !== UNKNOWN_FINGERPRINT) {
    return tracksFingerprint(playlist.tracks) !== from.tracksFingerprint;
  }
  const syncedAt = (playlist.syncSources && playlist.syncSources[providerId] && playlist.syncSources[providerId].syncedAt) || 0;
  return !!playlist.locallyModified && (playlist.lastModified || 0) > syncedAt;
}

/**
 * After a successful push to the playlist's own source: the source now has
 * these tracks, so record them as agreed and take the push's snapshot, or the
 * next sync reads our own push as a remote change plus local edits (a false
 * conflict). Same fields the playlist page's Push writes. A push to any other
 * provider is a mirror push and changes nothing here.
 */
function recordPushToSource(playlist, providerId, { externalId, snapshotId, tracks, now }) {
  const from = playlist && playlist.syncedFrom;
  if (!from || from.resolver !== providerId) return playlist;
  // Pushed to another remote on the same service (an owned copy), not the source.
  if (externalId && from.externalId && externalId !== from.externalId) return playlist;
  return {
    ...playlist,
    syncedFrom: {
      ...from,
      snapshotId: snapshotId || from.snapshotId,
      tracksFingerprint: tracksFingerprint(tracks),
    },
    syncSources: {
      ...playlist.syncSources,
      [providerId]: { ...(playlist.syncSources && playlist.syncSources[providerId]), syncedAt: now },
    },
  };
}

/**
 * A playlist the service it syncs from owns itself (Spotify's own: Daily
 * Brew, Discover Weekly, Daily Mix): its stored owner is the service's id.
 * A local edit can never reach it (the service refuses writes to playlists
 * the user doesn't own), so a refresh always takes the service's tracks, the
 * `sourceOnly` rule sync-start applies by the same owner.
 */
function sourceOwnsPlaylist(playlist) {
  const from = playlist && playlist.syncedFrom;
  return !!(from && from.ownerId && from.resolver && from.ownerId === from.resolver);
}

/**
 * Refresh one synced playlist from its service now (the playlist page's
 * Refresh), by the background sync's rules. `fetched` is what the service
 * answered: { tracks, snapshotId }. Answers { outcome, playlist }, where
 * `playlist` is the record to save, or null when there's nothing to save:
 *   'unchanged'  the service has what we have, or hasn't changed since the
 *                last sync (edits made here stand: the push banner offers
 *                them), or answered nothing for a playlist with tracks (a bad
 *                response, as applyPulledTracks reads it)
 *   'pulled'     the service's tracks, applied (applyPulledTracks)
 *   'conflict'   changed on the service and edited here: the tracks stay,
 *                flagged hasUpdates so the playlist page asks which to keep
 *   'not-synced' not imported from a service, or a hosted XSPF (its link is
 *                its upstream and has its own refresh)
 */
function refreshFromSource(playlist, fetched, { now = Date.now() } = {}) {
  const from = playlist && playlist.syncedFrom;
  if (!from || !from.resolver || !from.externalId || isHostedXspf(playlist)) return { outcome: 'not-synced', playlist: null };
  const providerId = from.resolver;
  const incoming = Array.isArray(fetched && fetched.tracks) ? fetched.tracks : [];
  const existing = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  if (incoming.length === 0 && existing.length > 0) return { outcome: 'unchanged', playlist: null };
  const remote = tracksFingerprint(incoming);
  if (remote === tracksFingerprint(existing)) return { outcome: 'unchanged', playlist: null };
  const sourceOnly = sourceOwnsPlaylist(playlist);
  // The service is where it was at the last sync: what differs is an edit
  // made here, which the push banner already offers.
  if (!sourceOnly && typeof from.tracksFingerprint === 'string' && remote === from.tracksFingerprint) {
    return { outcome: 'unchanged', playlist: null };
  }
  const action = remoteUpdateAction(playlist, providerId, { sourceOnly });
  if (action === 'conflict') return { outcome: 'conflict', playlist: { ...playlist, hasUpdates: true } };
  return {
    outcome: 'pulled',
    playlist: applyPulledTracks(playlist, { providerId, remotePlaylist: { snapshotId: (fetched && fetched.snapshotId) || from.snapshotId }, tracks: incoming, now }),
  };
}

module.exports = {
  shouldPushToSource,
  recordPushToSource,
  UNKNOWN_FINGERPRINT,
  seedTracksFingerprint,
  tracksFingerprint,
  hasRealLocalEdits,
  isHostedXspf,
  remoteUpdateAction,
  applyPulledTracks,
  keepEditsMadeDuringPull,
  sourceOwnsPlaylist,
  refreshFromSource,
};

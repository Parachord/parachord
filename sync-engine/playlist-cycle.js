// sync-engine/playlist-cycle.js: which selected playlists a sync cycle works
// on, and which it can mark as checked without touching.
//
// Every provider's playlist list (Spotify's /me/playlists, Apple Music's
// library playlists, ListenBrainz's playlists) carries each playlist's change
// marker, its snapshot (`snapshotId`), and sync:start downloads that list in
// full on every cycle. Comparing a snapshot with the one we stored is a
// string compare in memory; only a playlist whose snapshot moved needs its
// tracks downloaded. The stagger (staggerPlaylistsForCycle, parachord#800)
// used to cap BOTH: it took the 15 longest-unchecked playlists and compared
// only those, so with 177 selected a full round took ~8 hours, and Daily
// Brew's 5:18 am rebuild wasn't noticed until a manual Sync Now at 11:07
// (2026-11-20), though every cycle's list had shown the new snapshot.
//
// Now every selected playlist's snapshot is compared on every cycle:
//   - unchanged (canShortCircuitPlaylistUpdate): marked checked, nothing
//     fetched, not counted against the batch;
//   - the rest go through the full per-playlist branch, capped by the batch:
//     first the playlists whose source snapshot moved (real news: an import
//     whose service changed it, not already flagged as a conflict), oldest
//     check first, then everything else in the stagger's own order (new
//     imports first, then oldest check first).
// A conflict or hosted playlist keeps hasUpdates set and its snapshot pinned,
// so it would differ on every cycle; it goes in the second group, never the
// first, or a few unresolved ones would hold every batch (parachord#835).
//
// Pure: the short-circuit and stagger come in as arguments (sync:start passes
// SyncEngine's), as does the lookup from a remote playlist to its local one.
// Loads under plain Node.

'use strict';

const { seedTracksFingerprint } = require('./auto-pull');

// The default batch: what staggerPlaylistsForCycle has always taken per cycle
// (DEFAULT_STAGGER_BATCH_SIZE in sync-engine/index.js).
const DEFAULT_BATCH_SIZE = 15;

// Whether the source changed this playlist and nothing has flagged it yet.
function sourceMoved(local, remote, providerId) {
  const from = local && local.syncedFrom;
  return !!(from
    && from.resolver === providerId
    && from.snapshotId
    && remote.snapshotId
    && from.snapshotId !== remote.snapshotId
    && !local.hasUpdates);
}

/**
 * @param {object} args
 * @param {object[]} args.selectedRemote - the provider's selected playlists, each with its snapshotId
 * @param {(remote) => object|undefined} args.localFor - the local playlist a remote one belongs to, as fresh as the caller can read it
 * @param {object[]} args.localPlaylists - what the stagger sorts by
 * @param {string} args.providerId
 * @param {boolean} [args.fullSync] - process every playlist that isn't unchanged
 * @param {number} [args.batchSize]
 * @param {Function} args.canShortCircuit - SyncEngine.canShortCircuitPlaylistUpdate
 * @param {Function} args.stagger - SyncEngine.staggerPlaylistsForCycle
 * @returns {{ unchanged: { remote, playlist }[], toProcess: object[], waiting: number }}
 *   unchanged: each with its local playlist (fingerprint seeded) to mark as
 *   checked; toProcess: this cycle's full-branch work, in order; waiting: how
 *   many others need work and defer to a later cycle.
 */
function planPlaylistCycle({
  selectedRemote,
  localFor,
  localPlaylists,
  providerId,
  fullSync = false,
  batchSize = DEFAULT_BATCH_SIZE,
  canShortCircuit,
  stagger,
}) {
  const unchanged = [];
  const moved = [];
  const rest = [];
  for (const remote of Array.isArray(selectedRemote) ? selectedRemote : []) {
    if (!remote) continue;
    const local = typeof localFor === 'function' ? localFor(remote) : undefined;
    if (local) {
      // An import from before the fingerprint gets one before its first
      // check (seedTracksFingerprint), as the full branch does.
      const seeded = seedTracksFingerprint(local, providerId);
      if (canShortCircuit({ localPlaylist: seeded, remotePlaylist: remote, providerId })) {
        unchanged.push({ remote, playlist: seeded });
        continue;
      }
      if (sourceMoved(seeded, remote, providerId)) {
        moved.push(remote);
        continue;
      }
    }
    rest.push(remote);
  }
  const order = (list) => (list.length
    ? stagger({ selectedRemote: list, localPlaylists, providerId, batchSize: Infinity })
    : []);
  const work = [...order(moved), ...order(rest)];
  const toProcess = fullSync ? work : work.slice(0, batchSize);
  return { unchanged, toProcess, waiting: work.length - toProcess.length };
}

module.exports = { planPlaylistCycle, DEFAULT_BATCH_SIZE };

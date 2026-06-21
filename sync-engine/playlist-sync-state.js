// N-way multimaster playlist sync — state model + provider derivations
// (Phase 1). Design:
// docs/plans/2026-06-21-nway-multimaster-playlist-sync-design.md
// (parachord-mobile). Tracker: Parachord/parachord#911.
//
// Pure functions only — no electron-store, no provider API calls. This is
// the "state model alongside the canonical-source fields" piece: it defines
// how a baseline + per-(playlist, provider) sync record is DERIVED from
// tracklists and provider responses. The electron-store persistence of
// these records lives in main.js (`sync_playlist_state`); nothing reads it
// until Phase 2 (migration) populates it and Phase 3 (shadow mode) consumes
// it. No reconciliation behavior changes in this phase.
//
// Unlike the merge (Phase 0), this module is desktop-internal — the storage
// shape need not match mobile byte-for-byte (mobile uses SQLite/Room). Only
// the merge has a cross-engine parity contract.

const { canonicalTrackKey } = require('./playlist-merge');

// ─────────────────────────────────────────────────────────────────────
// Baseline
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a baseline (the 3-way merge ancestor) from a tracklist: the ordered
 * list of canonical keys, deduped first-occurrence (so it's directly
 * comparable to a merge result, which is also deduped).
 * @param {Array<object>} tracks
 * @returns {string[]}
 */
function buildBaseline(tracks) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(tracks) ? tracks : []) {
    const k = canonicalTrackKey(t);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Timestamp helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Normalize a timestamp to epoch ms. Accepts a number (passed through) or an
 * ISO-8601 / parseable date string. Returns 0 for anything unparseable.
 */
function toEpochMs(value) {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const t = Date.parse(value);
    if (!isNaN(t)) return t;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────
// Per-provider derivations
// ─────────────────────────────────────────────────────────────────────
//
// changeToken — the opaque "did it change since last sync" anchor, compared
// against the stored token to DETECT a change. Per design:
//   - Spotify:      snapshot_id
//   - Apple Music / ListenBrainz: last_modified (the extension's
//                   last_modified_at for LB; the library playlist's
//                   lastModified for AM) — a real timestamp doubling as the
//                   change anchor.
//   - local:        n/a (detection is locallyModified || lastModified >
//                   baselineSyncedAt; handled by the caller, no token here).
//
// `payload` is the provider's normalized playlist response — the caller
// extracts the relevant field name per provider; this just reads the
// already-normalized props (`snapshotId`, `lastModified`).
function deriveChangeToken(providerId, payload) {
  const p = payload || {};
  if (providerId === 'spotify') {
    return typeof p.snapshotId === 'string' && p.snapshotId ? p.snapshotId : null;
  }
  if (providerId === 'applemusic' || providerId === 'listenbrainz') {
    return typeof p.lastModified === 'string' && p.lastModified ? p.lastModified : null;
  }
  return null;
}

/**
 * Derive `editedAt` (epoch ms) — the order-LWW timestamp, NEVER used for
 * presence. The Spotify-timestamp resolution from the design lives here.
 *
 * @param {string} providerId
 * @param {object} payload
 *   - Apple Music / ListenBrainz / local: { lastModified } (ISO or epoch).
 *   - Spotify: { addedAts: (string|number)[] } — each track's added_at; the
 *     edit time is MAX(added_at) (accurate when the last edit ADDED a track,
 *     the common case).
 * @param {object} [opts]
 *   - detectionTime {number}: floor used for the Spotify reorder/delete gap —
 *     a pure reorder/delete bumps snapshot_id but not MAX(added_at), so when
 *     MAX(added_at) hasn't advanced past `previousEditedAt` we fall back to
 *     detection time (we know it changed since last sync, so it's "now").
 *   - previousEditedAt {number}: the stored editedAt, to detect the no-newer-
 *     add case. Defaults to 0.
 * @returns {number} epoch ms
 */
function deriveEditedAt(providerId, payload, opts = {}) {
  const p = payload || {};
  const detectionTime = typeof opts.detectionTime === 'number' ? opts.detectionTime : 0;
  const previousEditedAt = typeof opts.previousEditedAt === 'number' ? opts.previousEditedAt : 0;

  if (providerId === 'spotify') {
    const addedAts = Array.isArray(p.addedAts) ? p.addedAts : [];
    let max = 0;
    for (const a of addedAts) {
      const t = toEpochMs(a);
      if (t > max) max = t;
    }
    // Reorder/delete-only edit: snapshot changed (caller already detected it)
    // but no track was added since we last looked, so MAX(added_at) didn't
    // advance. Floor to detection time so the edit still orders as recent.
    if (max <= previousEditedAt) return detectionTime || max;
    return max;
  }

  // Apple Music / ListenBrainz / local: a real last-modified timestamp.
  return toEpochMs(p.lastModified);
}

// ─────────────────────────────────────────────────────────────────────
// Record shape factories (light — keep storage shape consistent)
// ─────────────────────────────────────────────────────────────────────

function makeProviderSyncState({ changeToken = null, editedAt = 0, lastSyncedAt = 0 } = {}) {
  return { changeToken: changeToken || null, editedAt: editedAt || 0, lastSyncedAt: lastSyncedAt || 0 };
}

function makePlaylistSyncState({ baseline = [], baselineSyncedAt = 0, providers = {} } = {}) {
  return {
    baseline: Array.isArray(baseline) ? baseline.slice() : [],
    baselineSyncedAt: baselineSyncedAt || 0,
    providers: providers && typeof providers === 'object' ? { ...providers } : {},
  };
}

module.exports = {
  buildBaseline,
  toEpochMs,
  deriveChangeToken,
  deriveEditedAt,
  makeProviderSyncState,
  makePlaylistSyncState,
};

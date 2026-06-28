// Per-client sync-engine selection (parachord#911 — legacy → N-way migration).
//
// Stored as electron-store key `sync_engine_mode`. LOCAL and authoritative for
// THIS client only — Parachord has no user account, so there is no cross-client
// coordinator; each client's mode is its own. Fresh-install default is a
// build-time constant ('legacy' for existing clients; new mobile builds ship
// 'new'). See docs/plans/2026-06-28-legacy-to-nway-sync-migration.md.
//
//   'legacy' (default) — legacy sync drives; N-way dormant.
//   'shadow'           — legacy drives; N-way computes + logs a dry-run plan, no writes.
//   'new'              — N-way drives; legacy PLAYLIST push/create/import stands down.
//
// Mutual exclusion is scoped to PLAYLIST sync. Library / collection sync
// (tracks / albums / artists) is unaffected by the mode — N-way is playlist-only.

const SYNC_ENGINE_MODES = ['legacy', 'shadow', 'new'];

function normalizeEngineMode(raw) {
  return SYNC_ENGINE_MODES.includes(raw) ? raw : 'legacy';
}

// Legacy playlist sync (outbound create/push AND inbound import) runs in every
// mode EXCEPT 'new'. In 'new' the N-way reconcile is the sole playlist
// authority, so the legacy paths must stand down to avoid double-writing the
// shared remotes and the local playlist state.
function legacyPlaylistSyncEnabled(modeOrRaw) {
  return normalizeEngineMode(modeOrRaw) !== 'new';
}

// N-way performs REAL writes only in 'new'. In 'shadow' it computes a dry-run
// plan (compute + log, zero writes).
function nwayWritesEnabled(modeOrRaw) {
  return normalizeEngineMode(modeOrRaw) === 'new';
}

module.exports = {
  SYNC_ENGINE_MODES,
  normalizeEngineMode,
  legacyPlaylistSyncEnabled,
  nwayWritesEnabled,
};

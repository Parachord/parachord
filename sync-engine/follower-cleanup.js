// One-shot cleanup for the followed-playlist duplicate bug (parachord#937).
// Before the mirror-only guard landed, a FOLLOWED (read-only) playlist could
// auto-mirror to other providers — creating owned remote copies, which then
// round-tripped (follow → LB → re-export to Spotify as owned). This finds the
// wreckage so the user can remove it. PURE — no electron, no fetch.
//
// Two tiers, by safety:
//   tier1 (auto-fixable) — a read-only follower that carries syncedTo mirror
//     entries it should never have had. Those remotes are unambiguously the
//     bug's output: owned copies of a playlist the user only follows. Safe to
//     detach + delete. Mirrors the user EXPLICITLY opted into (channel override)
//     are excluded — those are intentional.
//   tier2 (report-only) — an OWNED local playlist whose name matches a follower.
//     Likely a re-export dupe, but now indistinguishable from a real owned
//     playlist, so we only surface it for manual review — never auto-delete.

const { isReadOnlyFollower } = require('./playlist-push-candidate');

function normName(p) {
  const n = (p && (p.title || p.name)) || '';
  return String(n).trim().toLowerCase();
}

function findFollowerSyncCleanup(localPlaylists, channelOverrides = {}) {
  const playlists = Array.isArray(localPlaylists) ? localPlaylists : [];
  const overrides = channelOverrides || {};

  const tier1 = [];
  const followerNameToId = new Map();

  for (const pl of playlists) {
    if (!pl || !isReadOnlyFollower(pl)) continue;
    const nm = normName(pl);
    if (nm && !followerNameToId.has(nm)) followerNameToId.set(nm, pl.id);

    const override = overrides[pl.id];
    const mirrors = [];
    for (const [pid, st] of Object.entries(pl.syncedTo || {})) {
      if (!st || !st.externalId) continue;
      // Respect an explicit opt-in — the user deliberately routed this follower
      // to this provider via the Sync menu.
      if (Array.isArray(override) && override.includes(pid)) continue;
      mirrors.push({ providerId: pid, externalId: st.externalId });
    }
    if (mirrors.length) {
      tier1.push({ localId: pl.id, displayName: (pl.title || pl.name || pl.id), mirrors });
    }
  }

  const tier2 = [];
  for (const pl of playlists) {
    if (!pl || isReadOnlyFollower(pl) || pl.localOnly) continue;
    const nm = normName(pl);
    if (nm && followerNameToId.has(nm) && followerNameToId.get(nm) !== pl.id) {
      tier2.push({ localId: pl.id, displayName: (pl.title || pl.name || pl.id) });
    }
  }

  return {
    tier1,
    tier2,
    mirrorCount: tier1.reduce((n, t) => n + t.mirrors.length, 0),
  };
}

module.exports = { findFollowerSyncCleanup };

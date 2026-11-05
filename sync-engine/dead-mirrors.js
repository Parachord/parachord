// Finding mirrors deleted on the provider. PURE apart from the injected provider
// call: no electron, no store.
//
// A push is the only other thing that notices a deleted playlist, and an
// unedited playlist never pushes, so a dead mirror could sit unnoticed for months
// (parachord#1269). Each sync compares the mirrors against the provider's full
// playlist list, then asks about each one that's missing. Being missing is only
// a suspicion, since a fetch can be partial: only a definite "gone" flags a mirror.
//
// The flag is the same one a failed push sets. The playlist page shows a banner
// for it, and the push loops skip the mirror. Nothing here recreates or removes
// anything, because the person may have deleted the playlist on purpose.
//
// The rules follow mobile's DeadMirrorReconcile.kt, including the floor. Mobile
// detaches a confirmed mirror where desktop flags it.

// More than this many missing at once looks like a bad fetch, not deletions.
const DEAD_MIRROR_MASS_FLOOR = 30;
const CHECK_DELAY_MS = 250;

function suspectedDeadMirrors(playlists, providerId, remotePlaylists) {
  const remoteIds = new Set((remotePlaylists || []).map((p) => p.externalId));
  const suspects = [];
  (playlists || []).forEach((playlist, index) => {
    const mirror = playlist?.syncedTo?.[providerId];
    if (!mirror?.externalId || mirror.pendingAction) return;
    if (!remoteIds.has(mirror.externalId)) suspects.push({ index, externalId: mirror.externalId });
  });
  return suspects;
}

// Returns { playlists, flagged, suspects }. `playlists` is the same array when
// nothing was flagged.
async function flagDeadMirrors(playlists, remotePlaylists, provider, {
  providerId,
  token,
  isCancelled = () => false,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console,
}) {
  if (!provider?.playlistStatus) return { playlists, flagged: 0, suspects: 0 };
  const suspects = suspectedDeadMirrors(playlists, providerId, remotePlaylists);
  if (suspects.length > DEAD_MIRROR_MASS_FLOOR) {
    log.warn(`[Sync] ${suspects.length} ${providerId} mirrors missing at once; treating the fetch as partial and checking none`);
    return { playlists, flagged: 0, suspects: suspects.length };
  }
  let next = playlists;
  let flagged = 0;
  for (let i = 0; i < suspects.length; i++) {
    if (isCancelled()) break;
    if (i > 0) await sleep(CHECK_DELAY_MS);
    const { index, externalId } = suspects[i];
    let status = null;
    try {
      status = await provider.playlistStatus(externalId, token);
    } catch (error) {
      log.warn(`[Sync] Could not check ${providerId} playlist ${externalId}: ${error.message}`);
    }
    if (status?.exists !== false) continue;
    if (next === playlists) next = [...playlists];
    const playlist = next[index];
    next[index] = {
      ...playlist,
      syncedTo: {
        ...playlist.syncedTo,
        [providerId]: { ...playlist.syncedTo[providerId], pendingAction: 'remote-deleted' },
      },
    };
    flagged += 1;
    log.log(`[Sync] "${playlist.title}" was deleted on ${providerId}; flagged its mirror`);
  }
  return { playlists: next, flagged, suspects: suspects.length };
}

module.exports = { suspectedDeadMirrors, flagDeadMirrors, DEAD_MIRROR_MASS_FLOOR };

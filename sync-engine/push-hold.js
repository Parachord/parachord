// sync-engine/push-hold.js: whether a sync push to a mirror waits (#1637).
//
// A push replaces the mirror with the tracks its resolveTracks found. A track
// whose lookup went UNANSWERED (a rate limit or cooldown, an auth failure, a
// 5xx, the network, an MBID mapper that can't be reached, a lookup budget
// spent for this sync) is not a track the service lacks: pushing without it
// removes it from the mirror. During a Spotify rate-limit pause every track
// that needed a search dropped out that way, and a 26-track playlist became
// 1 (parachord-mobile#807; mobile's fix is #809). So a push holds while any
// track is unanswered, or when the lookup itself failed, and the playlist
// stays marked for the next sync. A track the service answered for and
// doesn't have (`unresolved`) is still left out, as before.
//
// Pure; mirrors mobile's SyncEngine.unconfirmedMissingIds / heldPushes.

/**
 * @param {{success?:boolean, resolved?:object[], unresolved?:object[], unreachable?:object[]}|undefined} resolveResult
 *   resolveTracks' answer (through the IPC, with success), or undefined when it threw.
 * @returns {null | {reason:'lookup-failed'} | {reason:'unanswered', count:number}}
 */
function pushHold(resolveResult) {
  if (!resolveResult || resolveResult.success === false) return { reason: 'lookup-failed' };
  const unreachable = Array.isArray(resolveResult.unreachable) ? resolveResult.unreachable : [];
  return unreachable.length > 0 ? { reason: 'unanswered', count: unreachable.length } : null;
}

module.exports = { pushHold };

// src/renderer/lib/playback-limits.js — resolvers that are set up but can't
// play on the account's plan (#1220, Amazon Prime). Spotify isn't here: the
// Development Mode app every Parachord Spotify sign-in uses only works while
// its owner has Premium (February 2026), so a connected Spotify is in
// practice a Premium one.
//
// Such a resolver stays enabled for what it still does (search, metadata,
// links, playlist sync), but it is left out of playback: source selection,
// source icons and the priority numbers. Each service reports its own limit;
// everything that acts on one reads this module, so a new service is one
// more entry in the map, not more special cases in the app.
//
// A limit entry: { blocked, planKey, label, message, searchesHeldBack }
//   blocked  — true when the account's plan can't play here
//   planKey  — the plan as the service names it ('prime', 'free', ...), or
//              null when unknown; for logs and the remembered state
//   label    — a short tile label ('Prime: no playback')
//   message  — the full sentence for the tile tooltip, the settings panel
//              and the play refusal
//   searchesHeldBack — the service's own track searches answer not-ready
//              while blocked (Amazon), so an upgrade must search again
// A service with nothing to say has no entry (or null).

const AMAZON_TILE_LABELS = {
  prime: 'Prime: no playback',
  unknown: 'Plan not confirmed'
};

// Amazon's limit from its getStatus reply. Only Music Unlimited plays, and an
// unknown plan blocks too (amazon-dmls decides; the message comes from main).
function amazonPlaybackLimit(status) {
  if (!status || !status.web || !status.web.signedIn || !status.plan) return null;
  if (status.plan === 'unlimited') return { blocked: false, planKey: 'unlimited', label: null, message: null, searchesHeldBack: true };
  return {
    blocked: true,
    planKey: status.plan,
    label: AMAZON_TILE_LABELS[status.plan] || AMAZON_TILE_LABELS.unknown,
    message: status.planMessage || null,
    searchesHeldBack: true
  };
}

// Apple Music's limit: a resolver that isn't signed in can't play (MusicKit JS
// would only play 30-second previews), so it leaves playback and the
// priority order until it connects, then returns to its saved slot. Not a
// plan, but the same "set up, can't play" state. `checked` is false until the
// startup sign-in check has finished; until then there's no verdict (null),
// so a launch doesn't drop Apple Music for the moment the check takes.
function appleMusicPlaybackLimit({ checked, connected }) {
  if (!checked) return null;
  if (connected) return { blocked: false, planKey: 'connected', label: null, message: null, searchesHeldBack: false };
  return {
    blocked: true,
    planKey: 'signed-out',
    label: 'Not connected',
    message: "Apple Music isn't signed in, so Parachord won't play from it. Connect it in Settings → Apple Music.",
    searchesHeldBack: false
  };
}

// The ids whose plan can't play, in a stable order.
function planBlockedIds(limits) {
  return Object.keys(limits || {}).filter((id) => limits[id] && limits[id].blocked).sort();
}

// activeResolvers minus the blocked ones. Returns the same array when nothing
// is blocked, so a memo keyed on it stays stable.
function playbackResolverIds(activeIds, blockedIds) {
  if (!blockedIds || blockedIds.length === 0) return activeIds;
  return activeIds.filter((id) => !blockedIds.includes(id));
}

// ResolverCard's statusLabel/statusTitle for a resolver, or nulls.
function tileStatus(limits, id) {
  const limit = limits && limits[id];
  if (!limit || !limit.blocked) return { statusLabel: null, statusTitle: null };
  return { statusLabel: limit.label || 'No playback', statusTitle: limit.message || null };
}

// The settings panel's explanation for a resolver, or null.
function limitMessage(limits, id) {
  const limit = limits && limits[id];
  return limit && limit.blocked ? limit.message || null : null;
}

// After an upgrade, a resolver whose searches were held back while blocked
// (searchesHeldBack) should search again: they answered not-ready and left
// fresh timestamps with no result. `lastStored` is what was remembered for this resolver ('1' was
// blocked, '0' playable, null never seen); returns whether to re-resolve and
// what to remember now. An unknown limit (null) changes nothing.
function limitTransition(lastStored, limit) {
  if (!limit) return { reresolve: false, store: null };
  const now = limit.blocked ? '1' : '0';
  return { reresolve: lastStored === '1' && now === '0' && !!limit.searchesHeldBack, store: now };
}

// The localStorage key that remembers a resolver's last state, kept across
// restarts because an upgrade can happen while the app is closed.
function limitStorageKey(id) {
  return `playback_limit_blocked:${id}`;
}

module.exports = {
  amazonPlaybackLimit,
  appleMusicPlaybackLimit,
  planBlockedIds,
  playbackResolverIds,
  tileStatus,
  limitMessage,
  limitTransition,
  limitStorageKey
};

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
// more entry in the map, not more special cases in the app. A plugin can
// also report its own limit (capabilities.status + getStatus; the mapper
// below) — the service decides, the plugin is the authority — and Amazon
// moves onto that surface when its logic migrates into the plugin (#1356).
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
    message: "Apple Music isn't signed in, so Parachord won't play from it. Connect it in Settings › Plug-Ins › Apple Music.",
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

// A plugin's limit, from its getStatus reply (capabilities.status,
// docs/architecture/plugins.md "Status and playback limits", #1356). The
// plugin is the authority for its service: it answers the limit entry
// itself, and this mapper only validates the shape — a reply without a
// playbackLimit, or one that isn't shaped like an entry, is NO verdict
// (null), never a guess. That is the no-throw contract's other half: a
// plugin whose status call failed (resolver-loader.js getStatus answers
// null) must never end up unplugged from playback by a malformed answer.
function pluginStatusLimit(status) {
  const limit = status && typeof status === 'object' ? status.playbackLimit : null;
  if (!limit || typeof limit !== 'object' || typeof limit.blocked !== 'boolean') return null;
  return {
    blocked: limit.blocked,
    planKey: typeof limit.planKey === 'string' && limit.planKey ? limit.planKey : null,
    label: typeof limit.label === 'string' && limit.label ? limit.label : null,
    message: typeof limit.message === 'string' && limit.message ? limit.message : null,
    searchesHeldBack: limit.searchesHeldBack === true
  };
}

// The settings panel's explanation for a resolver, or null.
function limitMessage(limits, id) {
  const limit = limits && limits[id];
  return limit && limit.blocked ? limit.message || null : null;
}

// The plugin entries for the limit map: every status reply mapped through
// pluginStatusLimit, with the no-verdict ones (null) DROPPED. app.js spreads
// this after the per-service mappers, and the drop is the point: a plugin
// wins only when it actually gives a verdict. A plugin whose read failed (the
// loader's failed marker, resolver-loader.js STATUS_READ_FAILED) or whose
// reply carries no playbackLimit never overrides the host's own verdict for
// its service — while Amazon's status still comes from its own IPC path
// (amazonPlaybackLimit), an amazonmusic plugin that can't answer must not
// remove the host's block (a Prime account would go back into playback).
// A status outage must not read as a blocked resolver, and it must not
// remove the host's block either.
function pluginStatusLimits(pluginStatuses) {
  return Object.fromEntries(Object.entries(pluginStatuses || {})
    .map(([id, status]) => [id, pluginStatusLimit(status)])
    .filter(([, limit]) => limit !== null));
}

// The Settings sign-in row for a status-capable plugin (capabilities.status,
// #1356): its getStatus reply's own two lines. statusLabel is the row's
// primary line; without one, signedIn carries it (a plugin that reports
// only sign-in needs no label of its own). No reply yet — still loading —
// is "Checking…", the Amazon row's own loading line. A FAILED read is the
// loader's marker (resolver-loader.js STATUS_READ_FAILED — the plugin threw
// or ran past the read budget), and the row says what happened and what to
// do, not "Checking…" forever. statusMessage is the second line, or ''
// when the plugin has none. Pure: the row's rendering stays in app.js.
function pluginStatusRow(status) {
  const reply = status && typeof status === 'object' ? status : null;
  if (reply && reply.failed === true) {
    return {
      label: "Couldn't check",
      message: "Parachord couldn't check this plug-in's status. Try opening this panel again."
    };
  }
  const label = reply && typeof reply.statusLabel === 'string' && reply.statusLabel ? reply.statusLabel
    : reply && reply.signedIn === true ? 'Signed in'
    : reply && reply.signedIn === false ? 'Not signed in'
    : 'Checking…';
  const message = reply && typeof reply.statusMessage === 'string' ? reply.statusMessage : '';
  return { label, message };
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
  pluginStatusLimit,
  pluginStatusLimits,
  pluginStatusRow,
  planBlockedIds,
  playbackResolverIds,
  tileStatus,
  limitMessage,
  limitTransition,
  limitStorageKey
};

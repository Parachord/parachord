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
// below) — the service decides, the plugin is the authority. Amazon moved
// onto that surface with its plugin (#1356 M10): the plugin's getStatus
// reply carries its playbackLimit, and amazonPlaybackLimit (the per-service
// mapper the host's IPC status fed) died with the host status.
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
//   ownedOnly — (optional, unblocked entries) the resolver plays, but only
//              what the account owns: Amazon on Prime plays the tracks
//              bought from Amazon (#1494). The plugin enforces it itself
//              (its search answers only owned tracks and its stream request
//              refuses the rest as plan-ineligible), so the resolver stays in
//              playbackResolvers like any playable one; the host shows the
//              label on its tile and, on entering this state, drops the
//              resolver's saved sources (limitTransition's purge), which may
//              be tracks the account doesn't own.
// A service with nothing to say has no entry (or null).

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

// A plug-in that needs a sign-in and is signed out (#1624): the same
// "set up, can't play" entry as a signed-out Apple Music, for any plug-in on
// the status surface. It leaves playback (selection, source icons, the
// priority numbers) until it signs in, and its saved sources stay saved, so
// a source found while it was signed in is never picked only to be refused.
// `name` is the plug-in's name for the sentence.
function signedOutPlaybackLimit(name) {
  const who = typeof name === 'string' && name.trim() ? name.trim() : 'This plug-in';
  return {
    blocked: true,
    planKey: 'signed-out',
    label: 'Not signed in',
    message: `${who} isn’t signed in, so Parachord won’t play from it. Sign in to it in Settings › Plug-Ins › ${who}.`,
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

// The ids that are on but don't play: the plan's (planBlockedIds) and the
// user's own choice, the plug-in's "Play from" switch (#1505). One list, so
// playback, source icons and the priority numbers have one rule.
function notPlayingIds(blockedIds, playbackOffIds) {
  const off = Array.isArray(playbackOffIds) ? playbackOffIds : [];
  if (off.length === 0) return blockedIds || [];
  return [...new Set([...(blockedIds || []), ...off])].sort();
}

// ResolverCard's statusLabel/statusTitle for a resolver, or nulls. A plan
// limit says what the plan stops (an ownedOnly one, what still plays); a
// "Play from" switched off says what's left.
function tileStatus(limits, id, playbackOffIds) {
  const limit = limits && limits[id];
  if (limit && limit.blocked) return { statusLabel: limit.label || 'No playback', statusTitle: limit.message || null };
  if (limit && limit.ownedOnly) return { statusLabel: limit.label || 'Purchases only', statusTitle: limit.message || null };
  if (Array.isArray(playbackOffIds) && playbackOffIds.includes(id)) {
    return { statusLabel: 'Search and links only', statusTitle: 'Playing from it is off in its settings' };
  }
  return { statusLabel: null, statusTitle: null };
}

// A plugin's limit, from its getStatus reply (capabilities.status,
// docs/architecture/plugins.md "Status and playback limits", #1356). The
// plugin is the authority for its service: it answers the limit entry
// itself, and this mapper only validates the shape — a reply without a
// playbackLimit, or one that isn't shaped like an entry, is NO verdict
// (null), never a guess. That is the no-throw contract's other half: a
// plugin whose status call failed (resolver-loader.js getStatus answers its
// failed marker, STATUS_READ_FAILED — the marker carries no playbackLimit)
// must never end up unplugged from playback by a malformed answer.
//
// The plugin's own playbackLimit wins. Without one, a reply that says
// signedIn: false is the signed-out entry (signedOutPlaybackLimit): a
// signed-out plug-in plays nothing, whatever its plan (#1624). A failed read
// (the loader's marker) is never read as signed out.
function pluginStatusLimit(status, name) {
  const reply = status && typeof status === 'object' ? status : null;
  const limit = reply ? reply.playbackLimit : null;
  if (!limit || typeof limit !== 'object' || typeof limit.blocked !== 'boolean') {
    return reply && reply.failed !== true && reply.signedIn === false ? signedOutPlaybackLimit(name) : null;
  }
  return {
    blocked: limit.blocked,
    planKey: typeof limit.planKey === 'string' && limit.planKey ? limit.planKey : null,
    label: typeof limit.label === 'string' && limit.label ? limit.label : null,
    message: typeof limit.message === 'string' && limit.message ? limit.message : null,
    searchesHeldBack: limit.searchesHeldBack === true,
    // Only an unblocked entry can be ownedOnly (a blocked resolver plays
    // nothing at all), and only when it says so.
    ...(limit.ownedOnly === true && !limit.blocked ? { ownedOnly: true } : {})
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
//
// nameOf(id) names each plug-in for the signed-out sentence. signedOutIds
// are the plug-ins whose play was refused as signed out although their
// status still reads signed in (a session Amazon ended while its cookies
// stayed, #1624): the refusal is the newer verdict, so they get the
// signed-out entry too, until they sign in.
function pluginStatusLimits(pluginStatuses, nameOf, signedOutIds) {
  const named = (id) => (typeof nameOf === 'function' ? nameOf(id) : id);
  const out = Object.fromEntries(Object.entries(pluginStatuses || {})
    .map(([id, status]) => [id, pluginStatusLimit(status, named(id))])
    .filter(([, limit]) => limit !== null));
  for (const id of signedOutIds || []) out[id] = signedOutPlaybackLimit(named(id));
  return out;
}

// A plug-in out of playback because it's signed out (either entry above, or
// Apple Music's), not because of its plan.
function isSignedOutLimit(limit) {
  return !!(limit && limit.blocked && limit.planKey === 'signed-out');
}

// The Settings sign-in row for a status-capable plugin (capabilities.status,
// #1356): its getStatus reply's own two lines. statusLabel is the row's
// primary line; without one, signedIn carries it (a plugin that reports
// only sign-in needs no label of its own). No reply yet — still loading —
// is "Checking…", the Amazon row's own loading line. A FAILED read is the
// loader's marker (resolver-loader.js STATUS_READ_FAILED — the plugin threw
// or ran past the read budget), and the row says what happened and what to
// do, not "Checking…" forever. statusMessage is the second line, or ''
// when the plugin has none. Pure: the row renders in components/plugin-settings-dialog.js.
function pluginStatusRow(status) {
  const reply = status && typeof status === 'object' ? status : null;
  if (reply && reply.failed === true) {
    return {
      label: "Couldn’t check",
      message: "Parachord couldn’t check this plug-in’s status. Try opening this panel again."
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
// fresh timestamps with no result. `lastStored` is what was remembered for
// this resolver ('1' was blocked, 'owned' played only owned tracks, '0'
// playable, null never seen); returns whether to re-resolve, whether to
// purge, and what to remember now. An unknown limit (null) changes nothing.
//   - into '0' from '1' or 'owned' (an upgrade): re-resolve, the searches
//     were held back or answered only owned tracks;
//   - into 'owned' from anything else (a Prime reading, #1494): purge — drop
//     every saved source of the resolver, found or not, since one found on
//     another plan may be a track the account doesn't own — and so
//     re-resolve; its search now answers only owned tracks;
//   - into '1': nothing; the resolver leaves playback whole.
// A signed-out entry is no plan reading: it changes nothing and remembers
// nothing, so signing back in finds the plan it left (an 'owned' account
// isn't purged again, #1624). Its sign-in clears its misses itself.
function limitTransition(lastStored, limit) {
  if (!limit || isSignedOutLimit(limit)) return { reresolve: false, purge: false, store: null };
  const now = limit.blocked ? '1' : (limit.ownedOnly ? 'owned' : '0');
  const purge = now === 'owned' && lastStored !== 'owned';
  const upgraded = now === '0' && (lastStored === '1' || lastStored === 'owned') && !!limit.searchesHeldBack;
  return { reresolve: purge || upgraded, purge, store: now };
}

// The localStorage key that remembers a resolver's last state, kept across
// restarts because an upgrade can happen while the app is closed.
function limitStorageKey(id) {
  return `playback_limit_blocked:${id}`;
}

module.exports = {
  appleMusicPlaybackLimit,
  pluginStatusLimit,
  pluginStatusLimits,
  signedOutPlaybackLimit,
  isSignedOutLimit,
  pluginStatusRow,
  planBlockedIds,
  notPlayingIds,
  playbackResolverIds,
  tileStatus,
  limitMessage,
  limitTransition,
  limitStorageKey
};

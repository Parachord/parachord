// Playlist push-candidate eligibility + the opt-in gate for re-exporting a
// ListenBrainz-originated playlist to streaming services (parachord#911,
// parity with mobile ec526bb). PURE — no electron, no fetch.
//
// Desktop's background + post-wizard push loops decide per-(playlist, provider)
// eligibility with INLINE skip-guards rather than calling an accept-list, so
// these functions are the SOURCE-OF-TRUTH parity anchor + test target; the
// renderer applies the same rules inline (a SYNC marker sits at the call sites
// in app.js). The opt-in gate (autoMirrorsByDefault / isReexportOptInRequired)
// is the LOAD-BEARING flood guard and MUST be applied at every renderer site
// that can auto-create a remote mirror — otherwise enabling Spotify/AM sync
// would push a user's entire pulled ListenBrainz library at once (the
// duplicate-flood class).

// Streaming providers a ListenBrainz playlist can RE-EXPORT to — opt-in only.
const REEXPORT_PROVIDERS = ['spotify', 'applemusic'];

// The providers offered as Sync CHANNELS in the per-playlist Sync menu.
const SYNC_CHANNEL_PROVIDERS = ['spotify', 'applemusic', 'listenbrainz'];

function playlistId(playlist) {
  return playlist && typeof playlist.id === 'string' ? playlist.id : '';
}

function hasSpotifyId(playlist) {
  if (!playlist) return false;
  return !!(playlist.spotifyId || (playlist.sources && playlist.sources.spotify && playlist.sources.spotify.spotifyId));
}

/**
 * Mobile-parity push-candidate accept-list — whether `playlist` is ELIGIBLE to
 * push to `providerId` at all (independent of opt-in + already-linked state):
 *   local-* / hosted (sourceUrl)  -> any provider
 *   spotify-*                     -> applemusic, listenbrainz
 *   applemusic-*                  -> listenbrainz
 *   listenbrainz-*                -> spotify (unless it already has a Spotify id),
 *                                    applemusic                  ← NEW (ec526bb)
 * Spotify keeps the don't-write-back guard: a playlist that already carries a
 * Spotify id is not re-pushed to Spotify.
 * @param {{id?:string, sourceUrl?:string, spotifyId?:string, sources?:object}} playlist
 * @param {string} providerId
 * @returns {boolean}
 */
function isPlaylistPushCandidate(playlist, providerId) {
  const id = playlistId(playlist);
  const base = id.startsWith('local-') || !!(playlist && playlist.sourceUrl);
  switch (providerId) {
    case 'spotify':
      return !hasSpotifyId(playlist) && (base || id.startsWith('listenbrainz-'));
    case 'applemusic':
      return base || id.startsWith('spotify-') || id.startsWith('listenbrainz-');
    case 'listenbrainz':
      return base || id.startsWith('spotify-') || id.startsWith('applemusic-');
    default:
      return base;
  }
}

/**
 * Whether `playlist` AUTO-mirrors via a provider's DEFAULT push selection
 * (desktop: the background/post-wizard loop reaching the create branch), vs.
 * only when the user explicitly opts in. A ListenBrainz-imported playlist
 * (`listenbrainz-*`) is OPT-IN ONLY — eligible to re-export but never
 * auto-mirrored, so a pulled LB library can't flood Spotify / Apple Music.
 * @param {{id?:string}} playlist
 * @returns {boolean}
 */
function autoMirrorsByDefault(playlist) {
  return !playlistId(playlist).startsWith('listenbrainz-');
}

/**
 * Whether re-exporting `playlist` to `providerId` requires EXPLICIT opt-in —
 * i.e. the auto-push loops must NOT create the remote unless the user opted
 * this playlist into this provider. True only for a `listenbrainz-*` playlist
 * targeting a streaming provider; false for everything else (including a
 * listenbrainz-* pushing back to listenbrainz, which the id-prefix guard owns).
 * @param {{id?:string}} playlist
 * @param {string} providerId
 * @returns {boolean}
 */
function isReexportOptInRequired(playlist, providerId) {
  return !autoMirrorsByDefault(playlist) && REEXPORT_PROVIDERS.includes(providerId);
}

/**
 * The per-playlist Sync menu's "where does this sync" decision (parity with
 * mobile's PlaylistSyncChannelManager.getChannels). For each sync-channel
 * provider, report whether the service is `connected` (set up in Settings),
 * whether this playlist is currently `enabled` (syncing) to it, and whether it's
 * an `available` target at all. `effective` = the channel override when the user
 * has set one (authoritative), else the playlist's current mirrors.
 * @param {{id?:string, sourceUrl?:string, spotifyId?:string, sources?:object}} playlist
 * @param {{enabledProviders?:string[], override?:string[]|null, currentMirrors?:string[]}} ctx
 * @returns {Array<{providerId:string, connected:boolean, enabled:boolean, available:boolean}>}
 */
function computeSyncChannels(playlist, { enabledProviders = [], override = null, currentMirrors = [] } = {}) {
  const effective = Array.isArray(override) ? override : (Array.isArray(currentMirrors) ? currentMirrors : []);
  const id = playlistId(playlist);
  return SYNC_CHANNEL_PROVIDERS.map((pid) => {
    const pushTarget = isPlaylistPushCandidate(playlist, pid);
    const isSource = id.startsWith(`${pid}-`); // imported FROM this provider
    return {
      providerId: pid,
      connected: enabledProviders.includes(pid),
      enabled: effective.includes(pid),
      // `available` = show the row at all. `pushTarget` = a togglable PUSH
      // destination; a source-only channel is shown (checked) but locked, since
      // detaching a pull source fights the imported-playlist `syncedFrom` heal.
      available: pushTarget || isSource,
      pushTarget,
      isSource,
    };
  });
}

/**
 * Whether the auto-push loops must NOT create a mirror of `playlist` on
 * `providerId` this cycle — the unified channel gate (parity with mobile's
 * `if (override != null) providerId in override else autoMirrorsByDefault && …`):
 *   - a per-playlist channel OVERRIDE is AUTHORITATIVE: block any provider not
 *     in it (the user manually chose where this playlist syncs);
 *   - with NO override, fall to the default — only a listenbrainz-* playlist
 *     targeting a streaming provider is blocked (the no-auto-flood opt-in).
 * Already-linked mirrors are gated by the caller (this is the CREATE gate only).
 * @param {{id?:string}} playlist
 * @param {string} providerId
 * @param {string[]|null|undefined} channelOverride - the playlist's override, or null/undefined for none
 * @returns {boolean}
 */
function channelGateBlocksCreate(playlist, providerId, channelOverride) {
  if (Array.isArray(channelOverride)) return !channelOverride.includes(providerId);
  // A hosted-XSPF playlist is read-only external content mirrored from a URL. It
  // auto-mirrors to streaming, but NOT to ListenBrainz by default: LB needs a
  // recording MBID per track, which hosted-XSPF tracks rarely carry, so the
  // create lands EMPTY — and the user never asked for it (parachord#937 sibling).
  // Require explicit opt-in (a channel override that includes listenbrainz).
  if (playlistId(playlist).startsWith('hosted-') && providerId === 'listenbrainz') return true;
  return isReexportOptInRequired(playlist, providerId);
}

/**
 * Whether a channel OVERRIDE, if present, EXCLUDES a provider — the gate for the
 * EDIT/update push branch (and sync:push-playlist). Distinct from the CREATE
 * gate: an ALREADY-LINKED mirror keeps receiving edits unless the user has set
 * an override that explicitly drops its provider (so a previously-opted-in
 * listenbrainz-* → Spotify mirror with NO override keeps syncing). This closes
 * the cross-snapshot race where a push cycle's stale snapshot still holds
 * syncedTo[X] after the user just disabled X (detach hadn't landed yet).
 * @param {string[]|null|undefined} channelOverride
 * @param {string} providerId
 * @returns {boolean}
 */
function channelOverrideExcludes(channelOverride, providerId) {
  return Array.isArray(channelOverride) && !channelOverride.includes(providerId);
}

module.exports = {
  REEXPORT_PROVIDERS,
  SYNC_CHANNEL_PROVIDERS,
  isPlaylistPushCandidate,
  autoMirrorsByDefault,
  isReexportOptInRequired,
  computeSyncChannels,
  channelGateBlocksCreate,
  channelOverrideExcludes,
};

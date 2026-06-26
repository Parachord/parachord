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

module.exports = {
  REEXPORT_PROVIDERS,
  isPlaylistPushCandidate,
  autoMirrorsByDefault,
  isReexportOptInRequired,
};

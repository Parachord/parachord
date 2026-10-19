/**
 * Discord Rich Presence — pure logic (no Discord, no Electron).
 *
 * Everything that decides WHAT the presence says and WHETHER we should be
 * connected lives here so it is unit-testable without a running Discord
 * client. The connection state machine is in `discord-presence.js`; the
 * renderer never talks to Discord directly (it pushes now-playing state over
 * ordinary Electron IPC, exactly like the MPRIS feed).
 *
 * Discord side of the contract (docs: developers/docs/topics/rpc):
 *   - The presence headline ("Listening to Parachord") comes from the
 *     registered Discord APPLICATION tied to the client id we connect with —
 *     it is not text we send. Without a real, registered Application id the
 *     handshake is refused (close code 4000) and nothing shows.
 *   - `details` / `state` are 2-128 characters each, `type` for SET_ACTIVITY
 *     may only be Playing (0), Listening (2), Watching (3) or Competing (5).
 *   - `assets.large_image` accepts either an art-asset key uploaded to the
 *     application or a plain https URL, which Discord fetches and re-hosts.
 *     file://, data:, blob: and Parachord's custom protocols are not URLs
 *     Discord can fetch, so they must never be sent — and neither may a URL
 *     that carries credentials in its query (see
 *     `looksLikeCredentialBearingUrl`): the whole activity is visible to
 *     everyone who can see the user's profile.
 *   - `timestamps.start` is a unix timestamp in seconds (the documented IPC
 *     example uses `time(nullptr)`); elapsed = now - start, computed by
 *     Discord's client. `timestamps: {}` is the explicit "no timestamps"
 *     instruction — what a paused track must send so the counter stops.
 */

'use strict';

/**
 * The Parachord Discord Application id, shipped so users only ever touch a
 * checkbox. Registered at https://discord.com/developers/applications as
 * "Parachord" — Discord renders the presence headline ("Listening to
 * Parachord") from this application, so it is not text we send. It is public,
 * not a secret: the id is in the binary either way, and local RPC needs no
 * client secret, OAuth, redirect or interactions endpoint.
 *
 * A fork or a dev build overrides it with the `DISCORD_CLIENT_ID` environment
 * variable — there is deliberately no in-app field: this identifies the
 * application, not the user, and a text box would only let a user break their
 * own presence.
 */
const DEFAULT_DISCORD_CLIENT_ID = '1561699064683167862';

/**
 * The application's one Rich Presence art asset (the 1024x1024 Parachord
 * logo). Sent as `assets.large_image` whenever a track has no cover Discord
 * is allowed to fetch, so the fallback is the logo rather than whatever the
 * client decides to draw. There are no small-image assets registered, so
 * nothing may reference one (see PAUSED_BADGE_ASSET_KEY).
 */
const PRESENCE_ART_ASSET_KEY = 'parachord';

/** Store key for the on/off toggle. */
const DISCORD_PRESENCE_ENABLED_STORE_KEY = 'discord_presence_enabled';

/** SET_ACTIVITY activity types we are allowed to use. */
const ACTIVITY_TYPES = {
  playing: 0,
  listening: 2,
  watching: 3,
  competing: 5,
};

/** Discord's own limits on the two text lines. */
const PRESENCE_TEXT_MIN = 2;
const PRESENCE_TEXT_MAX = 128;

/**
 * The paused badge overlay. `assets.small_image` must be an art-asset **key**
 * uploaded to the application (unlike `large_image`, which also takes an https
 * URL), and the shipped Parachord application registers **no small images** —
 * so this is null and no badge is sent. A paused presence is then marked only
 * by the stopped clock. If a `paused` asset is ever uploaded, set this to
 * 'paused' and the overlay comes on for free (key + hover text are sent
 * together, and only while paused).
 */
const PAUSED_BADGE_ASSET_KEY = null;
const PAUSED_BADGE_TEXT = 'Paused';

/** Separator between artist and album on the `state` line. */
const LINE_SEPARATOR = ' \u2014 '; // " — "

// ── Application id resolution ─────────────────────────────────────

/**
 * Discord application ids are snowflakes: a run of digits. Anything else
 * (a name, a stray space, a token) is rejected before we waste a handshake
 * that Discord would answer with close code 4000.
 */
function isValidDiscordClientId(clientId) {
  return typeof clientId === 'string' && /^\d{15,20}$/.test(clientId.trim());
}

/**
 * Precedence: DISCORD_CLIENT_ID (forks, dev builds, testing before the
 * Parachord application exists), then the shipped id. First *valid* value
 * wins, so a half-typed env var falls back to the shipped id instead of
 * silently killing the presence.
 * Returns '' when nothing usable is configured.
 */
function resolveDiscordClientId({ env, fallback = DEFAULT_DISCORD_CLIENT_ID } = {}) {
  const candidates = [env, fallback];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      const trimmed = candidate.trim();
      if (isValidDiscordClientId(trimmed)) return trimmed;
    }
  }
  return '';
}

// ── Text + art sanitising ─────────────────────────────────────────

/**
 * Trim, collapse internal whitespace, and clamp to Discord's 2-128 window.
 * Returns null for anything too short to send — a 1-character line is
 * rejected by the payload validator and would take the whole activity down
 * with it. Code-point aware so an emoji in a title cannot be cut in half.
 */
function clampPresenceText(text, max = PRESENCE_TEXT_MAX) {
  if (typeof text !== 'string') return null;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length < PRESENCE_TEXT_MIN) return null;
  const chars = Array.from(collapsed);
  if (chars.length <= max) return collapsed;
  // Leave room for the ellipsis inside the limit.
  return `${chars.slice(0, max - 1).join('')}\u2026`;
}

/**
 * Only an https URL is a cover Discord can fetch and re-host. Local files,
 * embedded-art cache files, data: URIs and Parachord's custom protocols all
 * resolve to nothing on Discord's side, and sending them makes the presence
 * render as a broken image where "no image" would have looked fine.
 */
function isFetchablePresenceImageUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_err) {
    return false;
  }
  if (!parsed.hostname) return false;
  // `https://user:pw@host/` — the credentials go into the activity verbatim.
  if (parsed.username || parsed.password) return false;
  return !looksLikeCredentialBearingUrl(parsed);
}

/**
 * Music-server cover URLs carry the session in the query string, and the
 * activity is public: everyone who can see the user's Discord profile sees
 * these characters. Plex uses `X-Plex-Token`, Subsonic/OpenSubsonic uses the
 * `u` + `t` (token) + `s` (salt) tuple with `sig` as the hex digest, and any
 * other self-hosted server has its own spelling. Rather than guess per host,
 * a URL with a credential-shaped parameter is refused outright — the cost is
 * only that the cover falls back to the Parachord logo.
 *
 * The short single letters are refused on exact name match (a cache-buster
 * `?t=` is common enough that substring matching would be silly, but Subsonic
 * uses exactly these names for its auth tuple).
 */
const CREDENTIAL_PARAM_SUBSTRING = /(token|secret|passwd|password|pwd|apikey|api_key|key|signature|sig|auth|cred|session|sid|cert|nonce|jwt)/i;
const CREDENTIAL_PARAM_EXACT = new Set(['t', 's', 'u', 'p']);

function looksLikeCredentialBearingUrl(parsed) {
  for (const [name] of parsed.searchParams.entries()) {
    if (CREDENTIAL_PARAM_EXACT.has(name.toLowerCase())) return true;
    if (CREDENTIAL_PARAM_SUBSTRING.test(name)) return true;
  }
  return false;
}

/**
 * First https cover on the track, checking the same fields the MPRIS feed
 * checks. Order matters: the resolved/playing art first, then per-source art.
 */
function pickPresenceArtUrl(track) {
  if (!track) return null;
  const candidates = [
    track.albumArt,
    track.albumArtUrl,
    track.sources?.spotify?.albumArt,
    track.sources?.applemusic?.albumArt,
    track.sources?.bandcamp?.albumArt,
    track.sources?.localfiles?.albumArt,
  ];
  for (const candidate of candidates) {
    if (isFetchablePresenceImageUrl(candidate)) return candidate.trim();
  }
  return null;
}

/**
 * The two lines under "Listening to Parachord":
 *   details = title            (the thing you are listening to)
 *   state   = artist — album   (who/where)
 * Falls back rather than sending a near-empty activity, and never repeats
 * the same text on both lines.
 */
function formatPresenceLines(track) {
  if (!track) return null;
  const title = clampPresenceText(track.title);
  const artist = clampPresenceText(track.artist);
  const album = clampPresenceText(track.album);

  const artistAlbum = artist && album
    ? clampPresenceText(`${artist}${LINE_SEPARATOR}${album}`)
    : (artist || album);

  const details = title || artist;
  let state = artistAlbum;
  if (state && state === details) state = album && album !== details ? album : null;
  if (!details && !state) return null;
  return { details: details || null, state: state || null };
}

// ── Activity payload ──────────────────────────────────────────────

/**
 * Build the `setActivity` payload for the current now-playing state.
 *
 * Options:
 *   isPlaying         playing → `timestamps.start` is sent. Paused → the
 *                     payload carries `timestamps: {}`, an explicit *clear*.
 *                     Omitting the key is not enough: the previous SET_ACTIVITY
 *                     put a start on the activity, and an omitted field is not
 *                     a reliable instruction to drop it, so the "listening for"
 *                     counter keeps ticking and reads as actively playing.
 *                     A paused track still produces an activity — stopping is
 *                     the caller's business (it passes no track).
 *   positionSeconds   current position, used only to back-compute start.
 *   nowSeconds        unix seconds; injected so the test is deterministic.
 *   includeAlbumArt   false → never send a large image; Discord falls back to
 *                     the application artwork.
 *   includePausedBadge false → never send the small "paused" overlay (the
 *                     default is to send it while paused).
 *   type              'listening' (default) | 'playing' | ... ; null omits
 *                     the field entirely (the retry path for clients that
 *                     reject type 2).
 *
 * The return value is the **RPC activity object** — the shape that goes
 * verbatim into `SET_ACTIVITY`'s `args.activity`, with nested `timestamps`
 * and `assets`. It is deliberately not a flat `largeImageKey` object: the flat
 * form is what high-level SDKs take, and handing it to the IPC frame gets the
 * images and timestamps silently ignored.
 *
 * Returns null only when there is nothing worth showing: no track, or no
 * text that survives sanitising. Callers then clear the presence.
 */
function buildDiscordActivity(track, options = {}) {
  if (!track) return null;
  const {
    isPlaying = false,
    positionSeconds = 0,
    nowSeconds = Math.floor(Date.now() / 1000),
    includeAlbumArt = true,
    includePausedBadge = true,
    type = 'listening',
  } = options;

  const lines = formatPresenceLines(track);
  if (!lines) return null;

  const activity = { ...lines, instance: false };
  if (type && ACTIVITY_TYPES[type] !== undefined) activity.type = ACTIVITY_TYPES[type];

  // Discord computes elapsed client-side from `timestamps.start`, so a paused
  // presence must actively clear it: `{}` is the "no timestamps" instruction.
  if (isPlaying) {
    const position = Number.isFinite(positionSeconds) && positionSeconds > 0 ? positionSeconds : 0;
    activity.timestamps = { start: Math.max(0, Math.floor(nowSeconds - position)) };
  } else {
    activity.timestamps = {};
  }

  const assets = {};
  if (includeAlbumArt) {
    const art = pickPresenceArtUrl(track);
    if (art) {
      assets.large_image = art;
      const hover = clampPresenceText(track.album || track.artist);
      if (hover) assets.large_text = hover;
    } else {
      // No cover Discord may fetch (local file, credentialed music server,
      // custom protocol): show the registered logo instead of leaving the
      // image to Discord's discretion.
      assets.large_image = PRESENCE_ART_ASSET_KEY;
    }
  }
  // The badge is what tells a viewer "paused" once the clock stops, and it
  // rides along whether or not the cover was fetchable (it overlays the
  // application fallback artwork the same way).
  if (includePausedBadge && PAUSED_BADGE_ASSET_KEY && !isPlaying) {
    assets.small_image = PAUSED_BADGE_ASSET_KEY;
    assets.small_text = PAUSED_BADGE_TEXT;
  }
  if (Object.keys(assets).length > 0) activity.assets = assets;

  return activity;
}

/** Cheap equality check so we do not re-send an identical SET_ACTIVITY. */
function sameActivityPayload(a, b) {
  if (a === b) return true;
  if (!a || !b || (a === null) !== (b === null)) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Connection status / diagnostics ───────────────────────────────

/**
 * Map the RPC close codes onto something a settings row can say. Codes are
 * from RPC_CLOSE_CODE in @xmcl/discord-rpc / Discord's RPC docs.
 */
function describePresenceClose(code) {
  switch (Number(code)) {
    case 4000: return 'invalid-client-id';
    case 4001: return 'invalid-origin';
    case 4002: return 'rate-limited';
    case 4003: return 'token-revoked';
    case 4004: return 'invalid-version';
    case 4005: return 'invalid-encoding';
    default: return 'disconnected';
  }
}

/**
 * The single status string the settings UI renders. Order is deliberate:
 * configuration problems outrank "Discord is not running", because telling a
 * user to start Discord when their Application id is wrong sends them in a
 * useless direction.
 */
function presenceStatus({ enabled, clientId, connected, lastError, connecting } = {}) {
  if (!enabled) return 'off';
  if (!clientId) return 'not-configured';
  if (!isValidDiscordClientId(clientId)) return 'invalid-client-id';
  if (connected) return 'connected';
  if (lastError) {
    const described = describePresenceClose(lastError.code);
    if (described !== 'disconnected') return described;
    return lastError.kind || 'error';
  }
  if (connecting) return 'connecting';
  return 'discord-not-running';
}

/**
 * Exponential backoff, deterministic on purpose so the reconnect schedule is
 * testable. A single install talking to a local socket does not need jitter;
 * it needs to stop hammering a closed socket.
 */
function nextReconnectDelay(attempt, { baseMs = 5000, maxMs = 300000 } = {}) {
  const exponent = Math.max(0, Math.min(10, Number(attempt) || 0));
  return Math.min(maxMs, baseMs * (2 ** exponent));
}

module.exports = {
  DEFAULT_DISCORD_CLIENT_ID,
  DISCORD_PRESENCE_ENABLED_STORE_KEY,
  ACTIVITY_TYPES,
  PRESENCE_TEXT_MAX,
  PRESENCE_ART_ASSET_KEY,
  PAUSED_BADGE_ASSET_KEY,
  PAUSED_BADGE_TEXT,
  LINE_SEPARATOR,
  isValidDiscordClientId,
  resolveDiscordClientId,
  clampPresenceText,
  isFetchablePresenceImageUrl,
  looksLikeCredentialBearingUrl,
  pickPresenceArtUrl,
  formatPresenceLines,
  buildDiscordActivity,
  sameActivityPayload,
  describePresenceClose,
  presenceStatus,
  nextReconnectDelay,
};

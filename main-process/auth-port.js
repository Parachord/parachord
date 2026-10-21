// main-process/auth-port.js — the local server port (parachord#958).
//
// One loopback Express server serves the OAuth redirect callbacks (Spotify
// `/callback`, SoundCloud `/callback/soundcloud`) AND the `parachord://` HTTP
// bridge (`/protocol`) that Raycast and curl-style integrations call. It used
// to be hardcoded to 8888, which collides with common dev tooling. The port
// is now a user setting (`oauth_callback_port`), read once at startup:
// stored value → `AUTH_SERVER_PORT` env → 8888.
//
// Why a user-chosen fixed port and not an auto-picked free one: Spotify and
// SoundCloud match the redirect URI exactly, port included, against what is
// registered in the developer dashboard. A port Parachord picked on its own
// would be one the user never registered, and sign-in would fail with no
// visible cause. Design: docs/plans/2026-07-01-configurable-oauth-callback-port-958.md.
//
// Pure (no electron, no store) so jest drives it directly
// (tests/main-process/auth-port.test.js).

const DEFAULT_AUTH_PORT = 8888;
const MIN_AUTH_PORT = 1024;
const MAX_AUTH_PORT = 65535;
// The browser-extension WebSocket server's fixed port (startExtensionServer).
// Binding the auth server there would collide with Parachord itself.
const RESERVED_PORTS = new Set([9876]);

// A usable port, or null. Accepts numbers and numeric strings ("8890");
// rejects non-integers, privileged ports, out-of-range and reserved ports.
function normalizeAuthPort(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) return null;
  if (n < MIN_AUTH_PORT || n > MAX_AUTH_PORT) return null;
  if (RESERVED_PORTS.has(n)) return null;
  return n;
}

// The port the server should bind: a valid stored setting wins, then a valid
// AUTH_SERVER_PORT env, then the default. Invalid values fall through rather
// than failing, so a bad store entry can never stop the server starting.
function resolveAuthPort({ stored, env } = {}) {
  return normalizeAuthPort(stored) ?? normalizeAuthPort(env) ?? DEFAULT_AUTH_PORT;
}

// The listener binds IPv4 loopback only, so the URI uses the 127.0.0.1
// literal (Spotify rejects `localhost` redirect URIs).
function loopbackRedirectUri(port, pathname) {
  return `http://127.0.0.1:${port}${pathname}`;
}

// Parachord's bundled SoundCloud app (and a developer's .env app) is
// registered at :8888, and SoundCloud has no loopback-port exception, so on
// any other port only the user's own SoundCloud app credentials can sign in.
// Refreshing an existing token sends no redirect URI and is unaffected.
function soundCloudSignInAllowed({ source, port }) {
  return source === 'user' || port === DEFAULT_AUTH_PORT;
}

module.exports = {
  DEFAULT_AUTH_PORT,
  MIN_AUTH_PORT,
  MAX_AUTH_PORT,
  RESERVED_PORTS,
  normalizeAuthPort,
  resolveAuthPort,
  loopbackRedirectUri,
  soundCloudSignInAllowed,
};

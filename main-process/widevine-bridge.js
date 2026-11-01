// widevine-bridge.js — the resolver-neutral bridge between the renderer's
// Widevine player (Shaka on the shared HTMLAudioElement) and main-process
// providers that know how to fetch a manifest and relay license bytes.
//
// Why main-side: the license proxy endpoints for stream services ride
// session cookies and CSRF state that live in per-resolver Electron
// partitions and net traffic the renderer cannot (and must not) touch.
// What per-resolver means shrinks to exactly two operations:
//
//   provider.getManifest(entity) → { manifest: <DASH MPD text>, ...extras }
//   provider.relayLicense(challengeB64) → <license bytes, base64>
//
// Everything else — decoding, variant selection by the global quality
// setting, transport, media session — is the shared renderer player.
// Amazon's provider is amazon-dmls.js; a future Tidal/Qobuz resolver is one
// provider registration away.
//
// Error contract: handlers return { success:false, reason?, error } — never
// throw over IPC. 'reason' is provider-defined ('not-signed-in',
// 'playback-failed', 'load-failed'…) and flows to the resolver unchanged.

'use strict';

const providers = new Map();

// ── relay gating (review: the license relay must not be a session oracle) ──
//
// The license relay runs the user's service session against the provider's
// license proxy. Exposed raw, any renderer script (plug-ins run unsandboxed)
// could feed arbitrary challenges through it — a CDM extracted elsewhere is
// exactly the key-extraction path the README says Parachord doesn't enable.
// The hornet design never exposed this: the exchange lived in the service's
// own page. Gates here, all in main, closing the same hole per PR review:
//
//   1. Sender: only the main window's top frame may call manifest/license
//      (injected isAllowedSender checks event.sender and event.senderFrame).
//   2. Session: a license relay is valid only inside a play session OPENED
//      by a widevine:manifest for that resolver, by sessionId. Stop/teardown
//      (player-event 'stopped'/'ended' — matched by sessionId), a new
//      manifest (supersession → rotation) and sign-out close it. Manifests
//      allocate their id BEFORE awaiting the provider, so resolve order
//      cannot let an older response steal the newer request's session.
//   3. Cap: relays per session are bounded (measured ~9 per play; 30 leaves
//      room for renewals and very long tracks), and manifests are
//      rate-limited per resolver (8/min).
//
// Honest scope note (review round 2): these gates are NOT plug-in isolation.
// Plug-ins run in the main window's top frame and pass the sender check
// exactly like app code, and they CAN open their own session via a real
// manifest. What the gates buy instead: a relay costs a real manifest fetch
// for a real ASIN (server-side verified), is capped per session, is
// per-resolver rate-limited, and ROTATES — so abuse is bounded and noisy
// (it steals the relay from the user's current play rather than being a
// free oracle). True plug-in sandboxing is separate, deliberate work.
//
// Deliberately NOT gated by challenge content-id — the bridge stays out of
// DRM wire formats by design, and the maintainer blessed that call.
const LICENSE_RELAY_CAP_PER_SESSION = 30;
const MANIFESTS_PER_MINUTE_PER_RESOLVER = 8; // human-finger-sized, bounds the oracle cost
const sessions = new Map(); // resolverId → { id, openedAt, relaysUsed, closed }
const manifestWindow = new Map(); // resolverId → number[] (timestamps in the last 60s)

function markManifestForRateLimit(resolverId) {
  const windowMs = 60000;
  const now = Date.now();
  const recent = (manifestWindow.get(resolverId) || []).filter((t) => now - t < windowMs);
  if (recent.length >= MANIFESTS_PER_MINUTE_PER_RESOLVER) {
    manifestWindow.set(resolverId, recent);
    return true;
  }
  recent.push(now);
  manifestWindow.set(resolverId, recent);
  return false;
}

function openSession(resolverId) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  sessions.set(resolverId, { id, openedAt: Date.now(), relaysUsed: 0, closed: false });
  return id;
}

function closeSession(resolverId, sessionId) {
  const session = sessions.get(resolverId);
  // Only the session it names closes — a late 'stopped'/'ended' from an older
  // track must not tear down the newer play's license window (review round 2).
  if (!session) return;
  if (sessionId !== undefined && session.id !== sessionId) return;
  session.closed = true;
}

function relayAllowed(resolverId, sessionId) {
  const session = sessions.get(resolverId);
  if (!session || session.closed || session.id !== sessionId) return false;
  if (session.relaysUsed >= LICENSE_RELAY_CAP_PER_SESSION) return false;
  session.relaysUsed += 1;
  return true;
}

// provider: { getManifest: async (entity) => ({ manifest: string, ...rest }),
//             relayLicense: async (challengeB64) => string }
function registerWidevineProvider(resolverId, provider) {
  if (!resolverId || !provider) return;
  if (typeof provider.getManifest !== 'function' || typeof provider.relayLicense !== 'function') {
    throw new Error(`widevine provider for ${resolverId} must implement getManifest + relayLicense`);
  }
  providers.set(resolverId, provider);
}

function registerWidevineBridgeIpc({ ipcMain, isAllowedSender }) {
  sessions.clear(); // registration is init-time: all license sessions die with it
  const senderOk = (event) => (typeof isAllowedSender === 'function' ? !!isAllowedSender(event) : true);

  ipcMain.handle('widevine:manifest', async (event, { resolverId, entity } = {}) => {
    if (!senderOk(event)) return { success: false, reason: 'denied', error: 'widevine calls are limited to the app window' };
    const provider = providers.get(resolverId);
    if (!provider) return { success: false, reason: 'not-ready', error: `no widevine provider registered for ${resolverId}` };
    try {
      if (markManifestForRateLimit(resolverId)) {
        return { success: false, reason: 'rate-limited', error: `${resolverId}: too many manifest requests` };
      }
      // Allocate the session id BEFORE the provider round-trip: the newest
      // request owns, not the newest resolution — an older manifest resolving
      // later must not rotate over the newer play (review round 2).
      const mySessionId = openSession(resolverId);
      let result;
      try {
        result = await provider.getManifest(entity || {});
      } catch (error) {
        if ((sessions.get(resolverId) || {}).id === mySessionId) closeSession(resolverId);
        throw error;
      }
      const live = sessions.get(resolverId);
      if (!live || live.id !== mySessionId || live.closed) {
        return { success: false, reason: 'superseded', error: 'a newer manifest already opened for this resolver' };
      }
      if (!result || typeof result.manifest !== 'string' || !result.manifest) {
        closeSession(resolverId, mySessionId);
        return { success: false, reason: 'playback-failed', error: `${resolverId}: manifest response carried no manifest` };
      }
      // Spread-then-sessionId: a provider payload carrying its own sessionId
      // key must never clobber the bridge-minted id (relay gating and
      // matched-close key off OURS; a provider-supplied one is inert).
      return { success: true, ...result, sessionId: mySessionId };
    } catch (error) {
      return { success: false, reason: (error && error.reason) || 'playback-failed', error: String((error && error.message) || error) };
    }
  });

  // Player lifecycle events (telemetry, provider-owned). Fire and forget.
  ipcMain.handle('widevine:player-event', async (event, { resolverId, event: playerEvent } = {}) => {
    if (!senderOk(event)) return { success: false };
    // Session teardown is bridge-owned: stop/end closes the license session
    // the manifest drew — MATCHED by sessionId, so a late event from an older
    // play can't close the newer play's window (review round 2).
    if (playerEvent && (playerEvent.type === 'stopped' || playerEvent.type === 'ended')) {
      closeSession(resolverId, playerEvent.sessionId);
    }
    const provider = providers.get(resolverId);
    if (!provider || typeof provider.handlePlayerEvent !== 'function') return { success: false };
    try {
      provider.handlePlayerEvent(playerEvent || {});
      return { success: true };
    } catch (error) {
      return { success: false, error: String((error && error.message) || error) };
    }
  });

  ipcMain.handle('widevine:license', async (event, { resolverId, challenge, sessionId } = {}) => {
    if (!senderOk(event)) return { success: false, reason: 'denied', error: 'widevine calls are limited to the app window' };
    const provider = providers.get(resolverId);
    if (!provider) return { success: false, reason: 'not-ready', error: `no widevine provider registered for ${resolverId}` };
    if (!challenge || typeof challenge !== 'string') return { success: false, reason: 'invalid', error: 'license relay needs a base64 challenge' };
    if (!relayAllowed(resolverId, sessionId)) {
      return { success: false, reason: 'invalid', error: 'no live widevine session for this resolver (stale play or cap reached)' };
    }
    try {
      const license = await provider.relayLicense(challenge);
      if (typeof license !== 'string' || !license) {
        return { success: false, reason: 'playback-failed', error: `${resolverId}: license relay answered empty` };
      }
      return { success: true, license };
    } catch (error) {
      return {
        success: false,
        reason: (error && error.reason) || 'playback-failed',
        licenseDenied: !!(error && error.licenseDenied),
        error: String((error && error.message) || error)
      };
    }
  });
}

module.exports = { registerWidevineProvider, registerWidevineBridgeIpc };

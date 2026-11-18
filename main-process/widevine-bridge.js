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
// The plugin-mediated path (#1356 M4) runs ALONGSIDE the provider: a
// resolver that implements getPlaybackManifest supplies the manifest
// RENDERER-side and declares it UP via widevine:open-session (its length —
// the rate window's gate; the text stays renderer-side), which mints the
// licence session under the same gates a provider manifest opens one
// (sender, per-resolver manifest rate window, supersession). Licence
// challenges for such a session flow main→renderer (widevine:plugin-license,
// answered on widevine:plugin-license-answer) — the challenge and its ids
// only; the plugin's context stays renderer-side — so the plugin's
// relayLicense runs renderer-side while the relay/session/cap gates stay
// HERE. Amazon's
// DRM pair has lived on it since #1356 M9; a future Tidal/Qobuz resolver is
// one provider registration away.
// Plugins run in the main window's top frame and pass the sender check like app
// code (the scope note below), so a plugin-supplied manifest changes no
// threat model — what it changes is where the service knowledge lives.
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
// A plugin-mediated relay waits on a renderer round trip (the plugin's own
// relayLicense, its own network) instead of a provider call — the renderer
// that never answers (window gone, plugin hung) must not wedge the invoke.
const PLUGIN_RELAY_TIMEOUT_MS = 30000;
const sessions = new Map(); // resolverId → { id, openedAt, relaysUsed, closed, pluginRelay? }
const manifestWindow = new Map(); // resolverId → number[] (timestamps in the last 60s)
const pluginRelayWaiters = new Map(); // requestId → { resolverId, finish } — the open plugin-relay forwards

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

// pluginRelay (#1356 M4), when the session was opened via
// widevine:open-session instead of a provider manifest: { type, drm } — the
// plugin's declared stream shape, carried inertly for the day a second
// stream system declares itself without main learning wire formats. The
// plugin's CONTEXT never crosses IPC: the renderer holds it from the
// plugin's own reply and hands it back to the plugin's relayLicense itself
// (review: no plugin data rides the widevine:plugin-license push). Null for
// provider sessions.
function openSession(resolverId, pluginRelay = null) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  sessions.set(resolverId, {
    id,
    openedAt: Date.now(),
    relaysUsed: 0,
    closed: false,
    ...(pluginRelay ? { pluginRelay } : {})
  });
  // Rotation supersedes whatever session this resolver had open (provider
  // or plugin): its in-flight plugin-relay forwards must not wait out the
  // timeout — the player that owned them has moved on. Same shape a plugin
  // rejection answers with; a late renderer answer for a woken request finds
  // no waiter, which is the invalid reply.
  failResolverWaiters(resolverId, 'session superseded');
  return id;
}

// Wake every in-flight plugin-relay forward for a resolver: its session is
// gone (closed by stop/ended/sign-out, or rotated out by a newer
// manifest/open-session) — settle the forwards now, bounded and harmless.
function failResolverWaiters(resolverId, why) {
  for (const waiter of [...pluginRelayWaiters.values()]) {
    if (waiter.resolverId !== resolverId) continue;
    waiter.finish({
      success: false,
      reason: 'playback-failed',
      licenseDenied: false,
      denialReason: null,
      error: `${resolverId}: plugin license relay aborted (${why})`
    });
  }
}

function closeSession(resolverId, sessionId) {
  const session = sessions.get(resolverId);
  // Only the session it names closes — a late 'stopped'/'ended' from an older
  // track must not tear down the newer play's license window (review round 2).
  if (!session) return;
  if (sessionId !== undefined && session.id !== sessionId) return;
  session.closed = true;
  // A session closed mid-relay (stop/ended, sign-out; rotation wakes them at
  // mint time in openSession) must not leave its in-flight plugin-relay
  // forwards waiting the full timeout: the player that owned them has moved
  // on.
  failResolverWaiters(resolverId, 'session closed');
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
  manifestWindow.clear(); // the rate window is session state — it dies with them
  pluginRelayWaiters.clear(); // and every in-flight plugin relay forward with them
  const senderOk = (event) => (typeof isAllowedSender === 'function' ? !!isAllowedSender(event) : true);

  // Plugin-mediated licence relay (#1356 M4): the session record says the
  // plugin's relayLicense runs in the renderer, so main pushes the challenge
  // to it and waits for the paired answer. Pairing is by requestId; a
  // renderer that never answers is bounded by PLUGIN_RELAY_TIMEOUT_MS, never
  // a hung invoke. The gates have already run (sender, session, cap) — this
  // forward is the renderer-side tail of the same relay, not a new surface.
  const forwardPluginLicense = (event, resolverId, sessionId, challenge) => {
    const sender = event && event.sender;
    if (!sender || typeof sender.send !== 'function') {
      return Promise.resolve({ success: false, reason: 'playback-failed', error: 'plugin license relay has no renderer to call' });
    }
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (out) => {
        if (settled) return;
        settled = true;
        pluginRelayWaiters.delete(requestId);
        if (timer) clearTimeout(timer);
        resolve(out);
      };
      timer = setTimeout(() => {
        finish({ success: false, reason: 'playback-failed', error: `${resolverId}: plugin license relay timed out` });
      }, PLUGIN_RELAY_TIMEOUT_MS);
      pluginRelayWaiters.set(requestId, { resolverId, finish });
      try {
        // Only the challenge and its ids ride the push (review): the
        // channel is one any renderer code can subscribe to, and the
        // plugin's context is renderer-side data — the router holds it.
        sender.send('widevine:plugin-license', { requestId, resolverId, sessionId, challenge });
      } catch (error) {
        finish({ success: false, reason: 'playback-failed', error: `plugin license relay could not reach the renderer: ${String((error && error.message) || error)}` });
      }
    });
  };

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

  // Plugin-mediated session open (#1356 M4): the renderer (a resolver that
  // implements getPlaybackManifest) declares its manifest UP. Same gates as
  // a provider manifest — sender, the per-resolver manifest rate window
  // (SHARED with the provider path: both are the manifest-shaped oracle cost
  // the window bounds), and supersession (the mint itself rotates whatever
  // session this resolver had open, provider or plugin). No provider needs
  // to be registered: the plugin IS the provider half. Only the manifest's
  // LENGTH crosses IPC (review): the rate window's gate needs non-empty,
  // nothing more — the manifest text stays renderer-side, where the only
  // consumer (the renderer player) already holds it. The session id
  // allocation rule (mint before any await) holds trivially — the channel
  // never awaits.
  ipcMain.handle('widevine:open-session', async (event, { resolverId, manifestLength, type, drm } = {}) => {
    if (!senderOk(event)) return { success: false, reason: 'denied', error: 'widevine calls are limited to the app window' };
    if (!resolverId || typeof resolverId !== 'string') {
      return { success: false, reason: 'invalid', error: 'open-session needs a resolverId' };
    }
    if (typeof manifestLength !== 'number' || !Number.isFinite(manifestLength) || manifestLength <= 0) {
      // A zero/missing manifest length is the plugin's fetch having failed
      // to produce one — the same playback-failed a provider manifest
      // response with no manifest maps to.
      return { success: false, reason: 'playback-failed', error: `${resolverId}: open-session needs a manifest` };
    }
    if (markManifestForRateLimit(resolverId)) {
      return { success: false, reason: 'rate-limited', error: `${resolverId}: too many manifest requests` };
    }
    // type/drm ride the session record inertly: the renderer player (the
    // only consumer that loads the manifest) validates them before opening.
    // The plugin's context never crosses IPC at all — the renderer holds it
    // and hands it back to the plugin's relayLicense itself.
    const id = openSession(resolverId, {
      type: typeof type === 'string' ? type : null,
      drm: typeof drm === 'string' ? drm : null
    });
    return { success: true, sessionId: id };
  });

  ipcMain.handle('widevine:license', async (event, { resolverId, challenge, sessionId } = {}) => {
    if (!senderOk(event)) return { success: false, reason: 'denied', error: 'widevine calls are limited to the app window' };
    // A plugin-mediated session relays to the PLUGIN's relayLicense in the
    // renderer instead of a provider; the gates before that choice are the
    // ones the provider path has always run. A plugin session with no
    // provider registered is the designed shape (the plugin is the whole
    // service half), so the not-ready check only applies to provider relays.
    const openEntry = sessions.get(resolverId);
    const pluginRelay = openEntry && openEntry.pluginRelay ? openEntry.pluginRelay : null;
    if (!pluginRelay && !providers.get(resolverId)) return { success: false, reason: 'not-ready', error: `no widevine provider registered for ${resolverId}` };
    if (!challenge || typeof challenge !== 'string') return { success: false, reason: 'invalid', error: 'license relay needs a base64 challenge' };
    if (!relayAllowed(resolverId, sessionId)) {
      return { success: false, reason: 'invalid', error: 'no live widevine session for this resolver (stale play or cap reached)' };
    }
    if (pluginRelay) {
      return forwardPluginLicense(event, resolverId, sessionId, challenge);
    }
    try {
      const license = await providers.get(resolverId).relayLicense(challenge);
      if (typeof license !== 'string' || !license) {
        return { success: false, reason: 'playback-failed', error: `${resolverId}: license relay answered empty` };
      }
      return { success: true, license };
    } catch (error) {
      return {
        success: false,
        reason: (error && error.reason) || 'playback-failed',
        licenseDenied: !!(error && error.licenseDenied),
        denialReason: (error && typeof error.denialReason === 'string') ? error.denialReason : null,
        error: String((error && error.message) || error)
      };
    }
  });

  // The paired answer to a widevine:plugin-license forward. The plugin's
  // thrown fields cross exactly as a provider relayLicense rejection's do:
  // reason/licenseDenied/denialReason are load-bearing contract (the engine's
  // refusal handlers and the #1262 family-failure latch key on them), and
  // the license reply below carries them into the same Shaka error path the
  // provider relays feed.
  ipcMain.handle('widevine:plugin-license-answer', async (event, { requestId, ok, license, error } = {}) => {
    if (!senderOk(event)) return { success: false };
    const waiter = requestId != null ? pluginRelayWaiters.get(requestId) : null;
    if (!waiter) {
      return { success: false, reason: 'invalid', error: `no pending plugin license relay for ${requestId}` };
    }
    if (ok) {
      if (typeof license !== 'string' || !license) {
        waiter.finish({ success: false, reason: 'playback-failed', error: `${waiter.resolverId}: plugin license relay answered empty` });
      } else {
        waiter.finish({ success: true, license });
      }
      return { success: true };
    }
    const err = error && typeof error === 'object' ? error : {};
    waiter.finish({
      success: false,
      reason: err.reason || 'playback-failed',
      licenseDenied: !!err.licenseDenied,
      denialReason: typeof err.denialReason === 'string' ? err.denialReason : null,
      error: String((err && err.message) || 'plugin license relay failed')
    });
    return { success: true };
  });
}

module.exports = { registerWidevineProvider, registerWidevineBridgeIpc };

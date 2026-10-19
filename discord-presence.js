/**
 * Discord Rich Presence — main-process connection owner (parachord#TODO).
 *
 * One owner for the Discord IPC connection, mirroring how `mpris-player.js`
 * owns the D-Bus one: the renderer pushes now-playing state over ordinary
 * Electron IPC and this module decides when to connect, what to send, and
 * when to back off. Nothing Discord-related is reachable from the renderer —
 * the socket, the Application id, and the reconnect schedule all live here.
 *
 * Lifecycle facts this exists to get right:
 *   - Discord may not be running, may restart, or may refuse our Application
 *     id. Every one of those is normal and must not throw, spam the log, or
 *     spin. Connection attempts back off (5s → 5min) and stop entirely when
 *     the presence is disabled or the Application id is unusable.
 *   - A reconnect (Discord restart) must re-publish whatever is playing
 *     right now, from the state we keep here — not from whatever the renderer
 *     happened to push before the drop.
 *   - `@xmcl/discord-rpc` has no auto-reconnect, and its `request()` rejects
 *     pending calls only when the socket closes. Every call here is
 *     fire-and-forget with a catch, so a wedged socket can never stall
 *     playback or accumulate unhandled rejections.
 *   - SET_ACTIVITY is sent at most once per distinct payload, so a seek
 *     storm or a re-render cannot flood the socket.
 */

'use strict';

const {
  resolveDiscordClientId,
  isValidDiscordClientId,
  buildDiscordActivity,
  sameActivityPayload,
  describePresenceClose,
  presenceStatus,
  nextReconnectDelay,
} = require('./discord-presence-logic');

// @xmcl/discord-rpc pulls undici + discord-api-types with it. If any of that
// fails to load, the presence is simply unavailable — startup must not care.
let discordRpcModule = null;
function loadRpc() {
  if (discordRpcModule !== null) return discordRpcModule;
  try {
    discordRpcModule = require('@xmcl/discord-rpc');
  } catch (err) {
    discordRpcModule = false;
  }
  return discordRpcModule;
}

// Custom (non-Discord) connection error codes from the transport.
const CONNECTION_ENDED = 0;
const CONNECTION_TIMEOUT = 1;
const COULD_NOT_CONNECT = 2;

/**
 * How long to wait for Discord's READY after the handshake is written. The
 * library never times this out itself: `connect()` resolves off the socket
 * being open, so without our own gate a half-open socket (Discord starting up,
 * a stale socket file) would sit "connected" forever and publish nothing.
 */
const HANDSHAKE_TIMEOUT_MS = 8000;

/** Discord's close code for a refused Application id. */
const INVALID_CLIENT_ID_CLOSE = 4000;

function connectionErrorKind(code) {
  if (code === COULD_NOT_CONNECT) return 'discord-not-running';
  if (code === CONNECTION_TIMEOUT) return 'discord-not-responding';
  if (code === CONNECTION_ENDED) return 'disconnected';
  return null;
}

/**
 * createDiscordPresence({
 *   getClientId,            () => string — read fresh each attempt so a
 *                           settings change lands on the next try
 *   clientId,               static alternative to getClientId
 *   Client,                 injected @xmcl/discord-rpc Client (tests)
 *   setTimeoutFn/clearTimeoutFn, injected timers (tests)
 *   logger
 * })
 *
 * Returns null only when the dependency is missing, so main.js can gate on
 * the return value the same way it gates on `createMprisPlayer`.
 */
function createDiscordPresence(options = {}) {
  const {
    clientId,
    getClientId,
    Client: ClientOverride,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    logger = console,
    backoff = {},
  } = options;

  const rpc = loadRpc();
  const ClientClass = ClientOverride || (rpc && rpc.Client);
  if (!ClientClass) return null;

  const resolveClientId = typeof getClientId === 'function'
    ? getClientId
    : () => resolveDiscordClientId({ env: process.env.DISCORD_CLIENT_ID, fallback: clientId });

  const state = {
    enabled: false,
    connected: false,
    connecting: false,
    attempt: 0,
    lastError: null,
    // Set when reconnecting is pointless until the setting changes (no or
    // invalid Application id). Flipping the toggle clears it.
    blocked: null,
    // Whether this Discord build accepted activity `type: listening`.
    // null = unproven (send the preferred type), 'fallback' = send without type.
    activityTypeMode: null,
    track: null,
    isPlaying: false,
    positionSeconds: 0,
  };

  let client = null;
  let retryTimer = null;
  let lastPayload = null;
  let pushInFlight = false;
  let pushAgain = false;
  let disposed = false;

  const log = (message, extra) => {
    if (!logger || !logger.warn) return;
    if (extra !== undefined) logger.warn(message, extra);
    else logger.warn(message);
  };

  const currentClientId = () => {
    try {
      const resolved = resolveClientId();
      return typeof resolved === 'string' ? resolved.trim() : '';
    } catch (err) {
      return '';
    }
  };

  const clearRetryTimer = () => {
    if (retryTimer) {
      try { clearTimeoutFn(retryTimer); } catch (_err) { /* already fired */ }
      retryTimer = null;
    }
  };

  const scheduleRetry = () => {
    if (disposed || !state.enabled || state.connected || state.connecting || state.blocked) return;
    if (retryTimer) return;
    const delay = nextReconnectDelay(state.attempt, backoff);
    state.attempt += 1;
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      connect();
    }, delay);
    // Never keep the process alive for a presence retry.
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
  };

  async function teardown({ clearPresence = true } = {}) {
    const dying = client;
    client = null;
    state.connected = false;
    state.connecting = false;
    lastPayload = null;
    if (!dying) return;
    if (clearPresence) {
      // Best effort: the socket may already be gone.
      try {
        if (typeof dying.request === 'function') await requestActivity(dying, null);
        else if (dying.user && typeof dying.user.clearActivity === 'function') await dying.user.clearActivity();
      } catch (_err) { /* socket already gone */ }
    }
    if (typeof dying.destroy === 'function') {
      try { await dying.destroy(); } catch (_err) { /* already closed */ }
    }
  }

  /**
   * Drop a client that never completed its handshake. The transport socket is
   * closed explicitly because the library's connect() timeout rejects without
   * closing it — with Discord running but unresponsive that is one leaked fd
   * per retry, and retries run for hours.
   */
  async function discard(candidate) {
    if (candidate.transport && typeof candidate.transport.close === 'function') {
      try { await candidate.transport.close(); } catch (_err) { /* never opened */ }
    }
    if (typeof candidate.destroy === 'function') {
      try { await candidate.destroy(); } catch (_err) { /* never opened */ }
    }
  }

  /**
   * SET_ACTIVITY over the raw request, not the library's `setActivity` helper.
   * Two things the helper cannot do: send our own RPC-shaped activity (it
   * rebuilds `timestamps`/`assets` from flat `startTimestamp`/`largeImageKey`
   * inputs and feeds a `Date` through `getTime()`, which is milliseconds where
   * the protocol wants seconds), and send the explicit clear — a paused or
   * stopped track must take the presence away, and the helper has no way to
   * say "no activity". Passing the frame through `request` keeps it exactly as
   * built.
   */
  function requestActivity(c, activity) {
    const pid = typeof process.pid === 'number' ? process.pid : 0;
    return c.request('SET_ACTIVITY', activity ? { pid, activity } : { pid, activity: null });
  }

  /**
   * Close the attempt out on Discord's READY, not on the socket opening.
   *
   * `@xmcl/discord-rpc`'s `connect()` resolves from `transport.connect()`,
   * which returns as soon as the socket is open and the handshake is written.
   * `client.user` only exists after the READY dispatch, and a refused
   * Application id produces no READY at all — Discord answers the handshake
   * with a CLOSE frame carrying code 4000. Resolving on the socket therefore
   * reports a healthy connection while every publish silently no-ops, which is
   * the "I ticked the box and nothing happened" bug.
   */
  function waitForReady(candidate) {
    return new Promise((resolve, reject) => {
      let settled = null;
      let handshakeTimer = null;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = fn;
        if (handshakeTimer) {
          try { clearTimeoutFn(handshakeTimer); } catch (_err) { /* already fired */ }
          handshakeTimer = null;
        }
        fn(arg);
      };

      const pending = candidate.connect();

      handshakeTimer = setTimeoutFn(() => {
        finish(reject, Object.assign(new Error('Discord did not complete the handshake'), {
          code: CONNECTION_TIMEOUT,
        }));
      }, HANDSHAKE_TIMEOUT_MS);
      if (handshakeTimer && typeof handshakeTimer.unref === 'function') handshakeTimer.unref();

      candidate.once('connected', () => finish(resolve));

      if (candidate.transport && typeof candidate.transport.once === 'function') {
        candidate.transport.once('close', (reason) => {
          const code = reason && typeof reason.code === 'number' ? reason.code : CONNECTION_ENDED;
          finish(reject, Object.assign(new Error(`Discord closed the connection (${code})`), { code }));
        });
      }

      if (pending && typeof pending.catch === 'function') {
        pending.catch((err) => finish(reject, err || new Error('connect failed')));
      }
    });
  }

  /**
   * A live connection ended. `reason` is the CLOSE frame payload when Discord
   * sent one — the only way to learn the id was refused mid-session, since the
   * library's own `disconnected` event is wired off READY and says nothing
   * about the code.
   */
  function onConnectionLost(c, reason) {
    if (disposed || client !== c) return;
    client = null;
    state.connected = false;
    lastPayload = null;
    const code = reason && typeof reason.code === 'number' ? reason.code : null;
    if (code === null) {
      state.lastError = null;
    } else {
      state.lastError = { code, kind: describePresenceClose(code) };
      if (code === INVALID_CLIENT_ID_CLOSE) {
        // Refused id: reconnecting is pure waste until a new build ships.
        state.blocked = 'invalid-client-id';
        return;
      }
    }
    if (!state.blocked) scheduleRetry();
  }

  async function connect() {
    if (disposed || !state.enabled || state.connected || state.connecting || state.blocked) return;
    const id = currentClientId();
    if (!id) {
      state.blocked = 'not-configured';
      state.lastError = null;
      return;
    }
    if (!isValidDiscordClientId(id)) {
      state.blocked = 'invalid-client-id';
      state.lastError = { code: 4000, kind: 'invalid-client-id' };
      return;
    }

    state.connecting = true;
    const candidate = new ClientClass({ clientId: id });
    try {
      await waitForReady(candidate);
    } catch (err) {
      state.connecting = false;
      const code = err && err.code;
      state.lastError = {
        code,
        kind: connectionErrorKind(code) || describePresenceClose(code),
        message: (err && err.message) || 'connect failed',
      };
      if (state.lastError.kind === 'invalid-client-id') {
        // Retrying a refused Application id is pure waste — it can only change
        // in a new build.
        state.blocked = 'invalid-client-id';
        await discard(candidate);
        return;
      }
      await discard(candidate);
      scheduleRetry();
      return;
    }

    client = candidate;
    state.connected = true;
    state.connecting = false;
    state.attempt = 0;
    state.blocked = null;
    state.lastError = null;

    // Watch the transport rather than the library's `disconnected` event: that
    // one is wired from READY, and the CLOSE frame is the only thing that
    // carries a code.
    if (candidate.transport && typeof candidate.transport.on === 'function') {
      candidate.transport.on('close', (reason) => onConnectionLost(candidate, reason));
    } else {
      candidate.on('disconnected', () => onConnectionLost(candidate, null));
    }

    // Re-publish whatever is playing now — the renderer will not re-push on a
    // Discord restart, and a stale/empty presence is what users notice.
    publish({ force: true });
  }

  function activityForCurrentState(typeMode) {
    return buildDiscordActivity(state.track, {
      isPlaying: state.isPlaying,
      positionSeconds: state.positionSeconds,
      type: typeMode === 'fallback' ? null : 'listening',
    });
  }

  function publish({ force = false } = {}) {
    // Track the intended state even while disconnected; the reconnect
    // publishes it. `state.connected` means READY landed, so the socket is
    // usable for requests.
    if (!state.connected || !client) return;

    const payload = activityForCurrentState(state.activityTypeMode);

    if (!force && sameActivityPayload(payload, lastPayload)) return;
    // Never send a clear that has nothing to clear: a fresh connection has no
    // activity, and a paused/stopped state has no payload. Without this, every
    // reconnect (and every connect while paused) spends a round trip telling
    // Discord to remove an activity it is not showing.
    if (!payload && !lastPayload) return;

    if (pushInFlight) {
      // Last write wins; the in-flight push will loop and send the newest.
      pushAgain = true;
      return;
    }
    pushInFlight = true;

    // One send path, used for the first attempt and for the type-fallback
    // retry: mixing the raw request with the library's helper would silently
    // drop the nested assets/timestamps on the retry.
    const sendTo = (target, activity) => {
      if (typeof target.request === 'function') return requestActivity(target, activity);
      // A client that only exposes the high-level helper (a different
      // transport, or a test double) still gets the state.
      const u = target.user;
      if (!u) return Promise.resolve();
      return activity && typeof u.setActivity === 'function'
        ? u.setActivity(activity)
        : (typeof u.clearActivity === 'function' ? u.clearActivity() : Promise.resolve());
    };

    const send = () => sendTo(client, payload);

    const run = async () => {
      try {
        await send();
        lastPayload = payload;
      } catch (err) {
        const code = err && err.code;
        // A client that rejects `type: listening` gets one retry without the
        // type, and remembers it for the rest of the session.
        if (payload && state.activityTypeMode !== 'fallback') {
          state.activityTypeMode = 'fallback';
          const fallbackPayload = activityForCurrentState('fallback');
          try {
            await sendTo(client, fallbackPayload);
            lastPayload = fallbackPayload;
          } catch (fallbackErr) {
            lastPayload = payload;
            state.lastError = {
              code,
              kind: 'set-activity-failed',
              message: (fallbackErr && fallbackErr.message) || 'setActivity failed',
            };
            log(`[Discord] SET_ACTIVITY rejected (${code})`, (fallbackErr && fallbackErr.message) || '');
          }
        } else {
          lastPayload = payload;
          state.lastError = { code, kind: 'set-activity-failed', message: (err && err.message) || 'setActivity failed' };
          log(`[Discord] presence update failed (${code})`, (err && err.message) || '');
        }
      } finally {
        pushInFlight = false;
        if (pushAgain) {
          pushAgain = false;
          publish();
        }
      }
    };

    run();
  }

  const api = {
    setEnabled(nextEnabled) {
      const value = Boolean(nextEnabled);
      if (value === state.enabled) return api.getStatus();
      state.enabled = value;
      state.blocked = null;
      state.attempt = 0;
      state.lastError = null;
      if (!value) {
        clearRetryTimer();
        teardown({ clearPresence: true });
        lastPayload = null;
      } else {
        connect();
      }
      return api.getStatus();
    },

    /**
     * Apply a whole now-playing snapshot and publish once. The renderer uses
     * this so a track change cannot publish an activity built from the new
     * track and the old position (a visibly wrong elapsed time for a frame).
     * Absent keys are left alone; explicit nulls clear them.
     */
    updateState(patch = {}) {
      let changed = false;
      if ('track' in patch) {
        state.track = patch.track || null;
        changed = true;
      }
      if ('status' in patch) {
        const normalized = patch.status === 'playing' ? 'playing' : (patch.status === 'paused' ? 'paused' : 'stopped');
        if (normalized === 'stopped') {
          state.track = null;
          state.isPlaying = false;
          state.positionSeconds = 0;
        } else {
          state.isPlaying = normalized === 'playing';
        }
        changed = true;
      }
      if ('positionSeconds' in patch) {
        const value = Number(patch.positionSeconds);
        state.positionSeconds = Number.isFinite(value) && value > 0 ? value : 0;
        changed = true;
      }
      if (changed) publish();
      return api.getStatus();
    },

    setTrack(track) {
      return api.updateState({ track });
    },

    setPlaybackStatus(nextStatus) {
      return api.updateState({ status: nextStatus });
    },

    setPosition(positionSeconds) {
      return api.updateState({ positionSeconds });
    },

    clear() {
      state.track = null;
      state.isPlaying = false;
      state.positionSeconds = 0;
      publish();
      return api.getStatus();
    },

    getStatus() {
      const clientIdResolved = currentClientId();
      return {
        enabled: state.enabled,
        connected: state.connected,
        connecting: state.connecting,
        attempt: state.attempt,
        status: presenceStatus({
          enabled: state.enabled,
          clientId: clientIdResolved,
          connected: state.connected,
          connecting: state.connecting,
          lastError: state.lastError,
        }),
        statusOverride: state.blocked || null,
        configured: Boolean(clientIdResolved),
        lastError: state.lastError,
      };
    },

    dispose() {
      disposed = true;
      state.enabled = false;
      clearRetryTimer();
      teardown({ clearPresence: true });
    },
  };

  return api;
}

module.exports = createDiscordPresence;
module.exports.createDiscordPresence = createDiscordPresence;
module.exports.loadRpc = loadRpc;

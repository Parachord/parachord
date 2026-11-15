// main-process/ipc/web-session-bridge.js — the IPC bridge over registered
// web-session hosts (#1356; docs/architecture/web-session.md, "The IPC
// bridge").
//
// The host module (main-process/web-session.js) keeps every session-bearing
// primitive main-side: the hidden view, the capture, the cookie jar, the
// sign-in window. A plugin (the flow logic — Amazon Music's, when it moves)
// drives its session through this bridge, naming the session by the id its
// host registered under (Amazon's is 'amazon-music'). What crosses the
// boundary is exactly the host's primitive payloads: capture bodies/headers
// (for the plugin's matchers), cookie NAMES never values.
//
// Error contract, same as widevine-bridge.js: handlers resolve
// { success: false, reason, error } — never throw over IPC. A host throw
// with .reason carries that reason verbatim ('load-failed', 'not-ready',
// 'invalid', 'superseded'); a reasonless throw maps to the channel's
// fallback reason. pageFetch and fetch are the never-throws exceptions in
// the host's contract, so their channel outcomes are always
// { success: true, ...outcome } — a caller distinguishes a response
// ({ status, text }) from a recoverable miss ({ error }) by the error key.
//
// Gating, mirroring widevine-bridge's relay gates (and its honest scope
// note: these are NOT plug-in isolation — plugins run in the main window's
// top frame and pass the sender check exactly like app code):
//   1. Sender: only the main window's top frame may call (isAllowedSender,
//      injected by main.js — the same predicate the widevine bridge uses).
//   2. URL scoping: fetch/pageFetch accept only URLs whose host is under
//      the SESSION's registered cookieDomains. The jar already scopes cookies
//      to those domains, so a session-bearing fetcher for any other host
//      would be a generic proxy surface with nothing to do with the session
//      (the #1356 review's rule: keep the contract simple, the jar is the
//      scope). load and signIn take any URL: the plugin navigates its own
//      service's pages, and a sign-in flow may legitimately start on the
//      service's identity host — scoping either would legislate against
//      flows the bridge can't foresee.
//
// signIn over IPC: the host's decide() verdict is plugin knowledge and
// cannot cross IPC as a function, so the bridge runs the host's ticker with
// its OWN decide() and shuttles the verdict across:
//   - 'webSession:signIn' { id, url, window? } → { success: true, callId }
//     immediately; the host promise settles later.
//   - every host tick is forwarded to the main window as
//     'webSession:sign-in-tick' { callId, url, cookieNames, stableTicks };
//   - the renderer wrapper runs the plugin's decide() and answers
//     'webSession:sign-in-decide' { callId, verdict };
//   - the bridge's decide() returns the LATCHED verdict — the latest answer
//     per callId, true when any joined call says true — so a true verdict
//     lands on the NEXT tick, up to one signInTickMs (1s) after the
//     host-side flow would have settled. That one-tick latency is the price
//     of reusing the host's ticker unduplicated: the bridge never runs its
//     own interval, so it can never double-tick or drift from the host's
//     trace logging.
//   - when the host promise settles (a true verdict closes the window, or
//     the person closes it first = NOT signed in), every callId gets
//     'webSession:sign-in-settled' { callId, signedIn, error? }.
//
// Dependency-injected ({ ipcMain, isAllowedSender, sendToRenderer }), so
// jest drives it with fakes (tests/main-process/web-session-bridge.test.js)
// — no electron mock needed: the hosts are injected too.

'use strict';

const sessions = new Map(); // session id → { host, cookieDomains }
const signInRuns = new Map(); // session id → { calls: Map(callId → { verdict }) }

function mintCallId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Whether a URL's host is under one of the session's declared cookie domains
// (cookie-domain semantics: 'music.amazon.com' is under 'amazon.com', and a
// leading dot on the declared domain — '.amazon.com' — means the same
// thing). Anything unparseable, or not http(s), is out.
function urlUnderDomains(url, domains) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:' && protocol !== 'http:') return false;
    const host = String(hostname).toLowerCase();
    return domains.some((domain) => {
      const d = String(domain).replace(/^\./, '').toLowerCase();
      return host === d || host.endsWith('.' + d);
    });
  } catch {
    return false;
  }
}

// One registered host = one session. The host itself is the authority on its
// cookie domains (it validated them at construction), so the bridge reads
// them off the host instead of taking a second copy at its own seam — a
// re-declared list would drift from the one the jar actually scopes.
function registerWebSession(id, host) {
  if (!id || typeof id !== 'string') {
    throw new Error('web-session bridge: registerWebSession needs a session id');
  }
  const primitives = ['load', 'pageFetch', 'fetch', 'state', 'clear', 'signIn'];
  if (!host || typeof host !== 'object' || primitives.some((name) => typeof host[name] !== 'function')) {
    throw new Error(`web-session bridge: host for ${id} must implement ${primitives.join(', ')}`);
  }
  const domains = Array.isArray(host.cookieDomains) ? host.cookieDomains : null;
  if (!domains || !domains.length || !domains.every((d) => typeof d === 'string' && d)) {
    throw new Error(`web-session bridge: host for ${id} must carry cookieDomains (a non-empty array of strings) — the bridge scopes fetch/pageFetch URLs by them`);
  }
  sessions.set(id, { host, cookieDomains: domains.slice() });
}

function registerWebSessionBridgeIpc({ ipcMain, isAllowedSender, sendToRenderer }) {
  signInRuns.clear(); // registration is init-time: pending sign-ins die with it
  const senderOk = (event) => (typeof isAllowedSender === 'function' ? !!isAllowedSender(event) : true);
  const send = (channel, payload) => {
    try { sendToRenderer(channel, payload); } catch { /* renderer gone */ }
  };

  const deny = () => ({ success: false, reason: 'denied', error: 'webSession calls are limited to the app window' });
  const fail = (reason, error) => ({ success: false, reason, error });
  const message = (error) => String((error && (error.message || error)) || error);
  const registered = (id) => sessions.get(id);

  // ── the sign-in verdict shuttle (see the header) ─────────────────────────

  // The bridge's decide(): forward the tick to every joined call, then answer
  // with the latched verdict.
  const decideFor = (run, tick) => {
    for (const [callId] of run.calls) {
      send('webSession:sign-in-tick', { callId, ...tick });
    }
    let verdict = false;
    for (const call of run.calls.values()) verdict = verdict || call.verdict;
    return verdict;
  };

  // Settle every joined callId once. Guarded on the run still being current:
  // a run whose promise settles after a newer run opened (only possible if a
  // settle already fired, which the delete makes idempotent) must not speak
  // for the newer window.
  const settle = (sessionId, run, out) => {
    if (signInRuns.get(sessionId) !== run) return;
    signInRuns.delete(sessionId);
    for (const [callId] of run.calls) {
      send('webSession:sign-in-settled', {
        callId,
        signedIn: !!(out && out.signedIn),
        ...(out && out.error ? { error: out.error } : {})
      });
    }
  };

  // Open a run: call the host's signIn once and let its promise settle in the
  // background (the invoke has already returned its callId). The host joins a
  // concurrent call itself (one window, one ticker); the bridge mirrors that
  // join in the handler below.
  const startSignIn = (host, sessionId, url, windowOpts, run) => {
    try {
      host.signIn(url, {
        decide: (tick) => decideFor(run, tick),
        ...(windowOpts && Number.isFinite(windowOpts.width) ? { width: windowOpts.width } : {}),
        ...(windowOpts && Number.isFinite(windowOpts.height) ? { height: windowOpts.height } : {}),
        ...(windowOpts && typeof windowOpts.title === 'string' && windowOpts.title ? { title: windowOpts.title } : {})
      }).then(
        (out) => settle(sessionId, run, out || {}),
        (error) => settle(sessionId, run, { signedIn: false, error: message(error) })
      );
    } catch (error) {
      settle(sessionId, run, { signedIn: false, error: message(error) });
    }
  };

  // ── the channels ─────────────────────────────────────────────────────────

  ipcMain.handle('webSession:load', async (event, { id, url, opts } = {}) => {
    if (!senderOk(event)) return deny();
    const entry = registered(id);
    if (!entry) return fail('not-ready', `no web session registered for ${id}`);
    if (!url || typeof url !== 'string') return fail('invalid', 'load needs a url');
    try {
      const result = await entry.host.load(url, opts);
      return { success: true, ...result };
    } catch (error) {
      return fail((error && error.reason) || 'load-failed', message(error));
    }
  });

  ipcMain.handle('webSession:pageFetch', async (event, { id, request } = {}) => {
    if (!senderOk(event)) return deny();
    const entry = registered(id);
    if (!entry) return fail('not-ready', `no web session registered for ${id}`);
    const req = request && typeof request === 'object' ? request : {};
    // Bridge-level scope gate (the host's pageFetch is a never-throws reader;
    // this is the one refusal the channel can make).
    if (!urlUnderDomains(req.url, entry.cookieDomains)) {
      return fail('invalid', `pageFetch URLs are limited to the session's cookie domains (${entry.cookieDomains.join(', ')})`);
    }
    const outcome = await entry.host.pageFetch(req);
    return { success: true, ...outcome };
  });

  ipcMain.handle('webSession:fetch', async (event, { id, request } = {}) => {
    if (!senderOk(event)) return deny();
    const entry = registered(id);
    if (!entry) return fail('not-ready', `no web session registered for ${id}`);
    const req = request && typeof request === 'object' ? request : {};
    if (!urlUnderDomains(req.url, entry.cookieDomains)) {
      return fail('invalid', `fetch URLs are limited to the session's cookie domains (${entry.cookieDomains.join(', ')})`);
    }
    try {
      const outcome = await entry.host.fetch(req);
      return { success: true, ...outcome };
    } catch (error) {
      return fail((error && error.reason) || 'fetch-failed', message(error));
    }
  });

  ipcMain.handle('webSession:state', async (event, { id } = {}) => {
    if (!senderOk(event)) return deny();
    const entry = registered(id);
    if (!entry) return fail('not-ready', `no web session registered for ${id}`);
    try {
      return { success: true, ...await entry.host.state() };
    } catch (error) {
      return fail((error && error.reason) || 'not-ready', message(error));
    }
  });

  ipcMain.handle('webSession:clear', async (event, { id } = {}) => {
    if (!senderOk(event)) return deny();
    const entry = registered(id);
    if (!entry) return fail('not-ready', `no web session registered for ${id}`);
    try {
      const out = await entry.host.clear();
      // The host's own failure shape carries no reason ({ success: false,
      // error } from a refused clearStorageData) — every other channel's
      // contract names its failure, so a host clear failure maps to
      // clear-failed here like the catch below does.
      if (out && out.success === false) return fail(out.reason || 'clear-failed', out.error);
      return out;
    } catch (error) {
      return fail((error && error.reason) || 'clear-failed', message(error));
    }
  });

  ipcMain.handle('webSession:signIn', async (event, { id, url, window } = {}) => {
    if (!senderOk(event)) return deny();
    const entry = registered(id);
    if (!entry) return fail('not-ready', `no web session registered for ${id}`);
    if (!url || typeof url !== 'string') return fail('invalid', 'signIn needs a url');
    const callId = mintCallId();
    const open = signInRuns.get(id);
    if (open) {
      // The host would only join this call onto the open window's run (one
      // window, one ticker — web-session.js's #1399 join); the bridge mirrors
      // it: a new callId on the SAME run, no second window, no second
      // decide() stream. The joined call's url/window are ignored — the open
      // window's flow is the one that runs.
      open.calls.set(callId, { verdict: false });
    } else {
      const run = { calls: new Map([[callId, { verdict: false }]]) };
      signInRuns.set(id, run);
      startSignIn(entry.host, id, url, window, run);
    }
    return { success: true, callId };
  });

  ipcMain.handle('webSession:sign-in-decide', async (event, { callId, verdict } = {}) => {
    if (!senderOk(event)) return deny();
    for (const run of signInRuns.values()) {
      const call = run.calls.get(callId);
      if (call) {
        call.verdict = !!verdict;
        return { success: true };
      }
    }
    return fail('invalid', `no pending webSession sign-in call ${callId}`);
  });
}

module.exports = { registerWebSession, registerWebSessionBridgeIpc, urlUnderDomains };

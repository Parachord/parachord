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
//      A missing isAllowedSender DENIES — a gate that defaulted to allow
//      would be one refactor away from an open bridge (#1432 review, note 5).
//   2. URL scoping (#1432 review, findings 1 and 3):
//        - fetch/pageFetch and load's capture.urlPrefixes accept only https
//          URLs on one of the session's ALLOWED hosts (host.allowedHosts, an
//          EXACT-host list declared at registration — for Amazon that's the
//          music + gql hosts, not the whole amazon.com retail account). The
//          host's fetch re-checks every redirect hop against the same list.
//        - load and signIn accept only https URLs on one of the session's
//          ALLOWED hosts (the same exact-host list as fetch/pageFetch and the
//          capture prefixes — #1432 review, finding 3's advisory follow-up:
//          Amazon's flows only ever navigate music.amazon.com, so the shared
//          list costs the service nothing and one list is one list; a service
//          whose sign-in starts on another host adds a navigation allowlist
//          in the host config when it arrives).
//   3. Budgets: load's timeoutMs and capture budgets are clamped to the
//      ceilings above (finding 2) — the host gets min(the caller's value,
//      the cap). capture.doneWhen — the data-only stop condition (rule 5 in
//      web-session.js) — is validated, not clamped: known keys
//      (bodyIncludes/urlIncludes), non-empty strings, rejected like a bad
//      prefix otherwise.
//   4. The sign-in window's TITLE is host config (cfg.signInTitle), never a
//      caller choice (finding 3): a caller-chosen title on a window with no
//      URL bar is a phishing surface. The window payload is { width, height }.
//
// signIn over IPC: the host's decide() verdict is plugin knowledge and
// cannot cross IPC as a function, so the bridge runs the host's ticker with
// its OWN decide() and shuttles the verdict across:
//   - 'webSession:signIn' { id, url, window? } ({width, height} — the
//     title is host config, never a caller choice) → { success: true, callId }
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

const { urlOnAllowedHost, captureDoneWhenProblem } = require('../web-session');

const sessions = new Map(); // session id → { host, allowedHosts }
const signInRuns = new Map(); // session id → { calls: Map(callId → { verdict }) }

// The bridge's ceilings on caller-supplied budgets (#1432 review, finding
// 2): the renderer picks load's navigation budget and capture window over
// IPC, and an unbounded one holds the session's chain hostage (a load's
// quiet window runs serialized). The host gets min(the caller's value, the
// cap); an absent or non-numeric value stays absent (the host's own
// defaults apply). Generous on purpose — every one of these is a real wait a
// flow may need (Amazon's capture window is quiet 1s / budget 8s); the caps
// are the anti-hostage bound, not a tuned default.
const LOAD_TIMEOUT_CAP_MS = 60000;    // the navigation budget (the host default is 30s)
const CAPTURE_BUDGET_CAP_MS = 30000;  // the capture window's hard end (host default 8s)
const CAPTURE_QUIET_CAP_MS = 10000;   // the capture window's quiet tail (host default 1s)

function mintCallId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// The load-opts sanitizer: the caller picks the capture prefixes and the
// budgets, so the bridge bounds what reaches the host (#1432 review,
// findings 1–2). Every capture prefix must be https on one of the session's
// ALLOWED hosts (the same list fetch/pageFetch scope by — a capture prefix
// is a choose-what-to-record power, and one that reaches the whole cookie
// domain would record pages the session's own flows never touch); every
// budget is clamped to its ceiling; capture.doneWhen (the data-only stop
// condition, rule 5) passes through after the host's shape check rejects a
// malformed one. Returns { opts } or { invalid } naming the refusal. A
// non-object opts (undefined, null, a primitive) passes as {}
// — the host defaults apply.
function sanitizeLoadOpts(opts, allowedHosts) {
  const src = opts && typeof opts === 'object' ? opts : {};
  const out = {};
  const clamp = (value, cap) => (Number.isFinite(value) ? Math.min(value, cap) : value);
  if (src.timeoutMs !== undefined) out.timeoutMs = clamp(src.timeoutMs, LOAD_TIMEOUT_CAP_MS);
  if (src.capture && typeof src.capture === 'object') {
    const prefixes = src.capture.urlPrefixes;
    if (!Array.isArray(prefixes) || !prefixes.every((p) => typeof p === 'string' && urlOnAllowedHost(p, allowedHosts))) {
      return { invalid: `capture.urlPrefixes must be https URL patterns on the session's allowed hosts (${allowedHosts.join(', ')})` };
    }
    out.capture = { urlPrefixes: [...prefixes] };
    if (src.capture.quietMs !== undefined) out.capture.quietMs = clamp(src.capture.quietMs, CAPTURE_QUIET_CAP_MS);
    if (src.capture.budgetMs !== undefined) out.capture.budgetMs = clamp(src.capture.budgetMs, CAPTURE_BUDGET_CAP_MS);
    // doneWhen is DATA, not a budget — nothing to clamp. The host's own
    // shape rule (one rule, both seams: the host re-checks it before any
    // state is touched), rejected here like a bad prefix: a stop condition
    // is a wait-ending power, so an unknown key or a non-string value must
    // not ride through on a typo.
    if (src.capture.doneWhen !== undefined && src.capture.doneWhen !== null) {
      const problem = captureDoneWhenProblem(src.capture.doneWhen);
      if (problem) return { invalid: problem };
      out.capture.doneWhen = { ...src.capture.doneWhen };
    }
    // returnOnTimeout is the OPT-IN to rule 5's budget escape, not a budget —
    // nothing to clamp, and the same one-rule-both-seams shape check: a
    // non-boolean must not ride through on a typo. Only `true` is carried:
    // the default (absent/false) keeps the old throws-load-failed contract.
    if (src.capture.returnOnTimeout !== undefined && src.capture.returnOnTimeout !== null) {
      if (typeof src.capture.returnOnTimeout !== 'boolean') {
        return { invalid: 'capture.returnOnTimeout must be a boolean (the opt-in to rule 5\'s budget escape)' };
      }
      if (src.capture.returnOnTimeout) out.capture.returnOnTimeout = true;
    }
  }
  return { opts: out };
}

// One registered host = one session. The host itself is the authority on its
// allowed hosts (it validated them at construction), so the bridge reads them
// off the host instead of taking a second copy at its own seam — a
// re-declared list would drift from the one the jar and the redirect checks
// actually scope by.
function registerWebSession(id, host) {
  if (!id || typeof id !== 'string') {
    throw new Error('web-session bridge: registerWebSession needs a session id');
  }
  const primitives = ['load', 'pageFetch', 'fetch', 'state', 'clear', 'signIn'];
  if (!host || typeof host !== 'object' || primitives.some((name) => typeof host[name] !== 'function')) {
    throw new Error(`web-session bridge: host for ${id} must implement ${primitives.join(', ')}`);
  }
  const hosts = Array.isArray(host.allowedHosts) ? host.allowedHosts : null;
  if (!hosts || !hosts.length || !hosts.every((h) => typeof h === 'string' && h)) {
    throw new Error(`web-session bridge: host for ${id} must carry allowedHosts (a non-empty array of exact host strings) — the bridge scopes fetch/pageFetch, load/signIn and capture-prefix URLs by them (the cookie domains are wider than the service)`);
  }
  sessions.set(id, { host, allowedHosts: hosts.slice() });
}

function registerWebSessionBridgeIpc({ ipcMain, isAllowedSender, sendToRenderer }) {
  signInRuns.clear(); // registration is init-time: pending sign-ins die with it
  // The gate FAILS CLOSED: a registration that forgot its predicate denies
  // every caller instead of allowing every caller (#1432 review, note 5).
  // main.js always passes one; a test that means to allow passes () => true.
  const senderOk = (event) => (typeof isAllowedSender === 'function' ? !!isAllowedSender(event) : false);
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
        ...(windowOpts && Number.isFinite(windowOpts.height) ? { height: windowOpts.height } : {})
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
    // The same exact-host allowlist fetch/pageFetch and the capture prefixes
    // scope by (#1432 review, finding 3's follow-up): one list, one predicate
    // — load navigates a page with the session's cookies attached.
    if (!urlOnAllowedHost(url, entry.allowedHosts)) {
      return fail('invalid', `load URLs must be https on one of the session's allowed hosts (${entry.allowedHosts.join(', ')})`);
    }
    // Finding 2: the caller picks the capture prefixes and the budgets, so
    // the bridge scopes and clamps them before the host sees them.
    const sanitized = sanitizeLoadOpts(opts, entry.allowedHosts);
    if (sanitized.invalid) return fail('invalid', sanitized.invalid);
    try {
      const result = await entry.host.load(url, sanitized.opts);
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
    // Finding 1: the exact-host allowlist, not the cookie domains — the jar
    // rides the request, so "under the cookie domain" would reach the whole
    // account (amazon.com is the retail account). https only.
    if (!urlOnAllowedHost(req.url, entry.allowedHosts)) {
      return fail('invalid', `pageFetch URLs must be https on one of the session's allowed hosts (${entry.allowedHosts.join(', ')})`);
    }
    const outcome = await entry.host.pageFetch(req);
    return { success: true, ...outcome };
  });

  ipcMain.handle('webSession:fetch', async (event, { id, request } = {}) => {
    if (!senderOk(event)) return deny();
    const entry = registered(id);
    if (!entry) return fail('not-ready', `no web session registered for ${id}`);
    const req = request && typeof request === 'object' ? request : {};
    if (!urlOnAllowedHost(req.url, entry.allowedHosts)) {
      return fail('invalid', `fetch URLs must be https on one of the session's allowed hosts (${entry.allowedHosts.join(', ')})`);
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

  ipcMain.handle('webSession:signIn', async (event, { id, url, window: windowOpts } = {}) => {
    if (!senderOk(event)) return deny();
    const entry = registered(id);
    if (!entry) return fail('not-ready', `no web session registered for ${id}`);
    if (!url || typeof url !== 'string') return fail('invalid', 'signIn needs a url');
    // Finding 3: https on one of the session's allowed hosts (the same list
    // every other URL gate scopes by); the window's title is host config —
    // a caller-chosen title on a window with no URL bar is a phishing
    // surface, so the window payload here is { width, height } only.
    if (!urlOnAllowedHost(url, entry.allowedHosts)) {
      return fail('invalid', `signIn URLs must be https on one of the session's allowed hosts (${entry.allowedHosts.join(', ')})`);
    }
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
      startSignIn(entry.host, id, url, windowOpts, run);
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

module.exports = { registerWebSession, registerWebSessionBridgeIpc };

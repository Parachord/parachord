/**
 * An Amazon "not signed in" while the auth cookies are live is usually
 * Amazon's periodic session-token refresh catching a page load. The sign-in
 * prompt opened on an app signed in for hours (session-token reissued at the
 * moment of the prompt, at-main / sess-at-main / x-main untouched), and the
 * very next search worked. It now retries quietly; only a streak lasting a
 * minute (most likely the profile picker) prompts.
 *
 * #1356 M10: the rule moved into the plugin's _lib (signInPromptDecision; the
 * renderer's src/renderer/lib/amazon-signin-prompt.js died with the host
 * session surfaces) — the pure cases drive the _lib copy in
 * tests/resolver/amazon-music-plugin-session.test.js; this file pins the
 * renderer's prompt-flow wiring around it.
 */

const src = require('../helpers/renderer-source').appWithPages();
const start = src.indexOf('const manageAmazonMusic = async');
const body = src.slice(start, src.indexOf('window.__parachordManageAmazonMusic = manageAmazonMusic', start));

describe('app.js wiring', () => {
  test('manageAmazonMusic checks for a hiccup before showing the prompt', () => {
    const gate = body.indexOf('signInPromptDecision(');
    const dialog = body.indexOf('setAmazonManageDialog({ show: true, onResolve: resolve');
    expect(gate).toBeGreaterThan(-1);
    expect(dialog).toBeGreaterThan(gate);
    expect(body).toMatch(/if \(!opts\.forcePrompt\)/);
    // The prompt rule is the plugin's (the loaded resolver's method); an old
    // .axe without it prompts at once.
    expect(body).toMatch(/typeof loaded\.signInPromptDecision === 'function'/);
    // The signed-in fact is the plugin's status reply.
    expect(body).toMatch(/cookiesSignedIn: !!\(status && status\.signedIn\)/);
  });

  test('a successful sign-in clears the streak', () => {
    const ok = body.indexOf('if (login && login.signedIn) {');
    expect(body.indexOf('amazonSignInHiccupRef.current = { firstAt: 0, lastAt: 0 };', ok)).toBeGreaterThan(ok);
  });

  test('the Settings Sign in button always opens the window', () => {
    expect(src).toMatch(/manageAmazonMusic\(\{ explicit: true, reason: 'not-signed-in', forcePrompt: true \}\)/);
  });

  test('the prompt flow runs on the plugin, not the IPC status: the CDM gate reads the plugin reply', () => {
    // The status read is the plugin's (refreshPluginStatus stores the reply
    // and hands it back); the CDM verdict is the reply's extra cdm field.
    expect(body).toMatch(/await refreshPluginStatus\('amazonmusic'\)/);
    expect(body).toMatch(/status\.cdm === false/);
    expect(body).not.toMatch(/window\.electron\.amazonMusic/);
    // The window opens through the plugin's signIn.
    expect(body).toMatch(/await loaded\.signIn\(\)/);
    expect(body).not.toMatch(/openLogin/);
  });
});

// ── the guards, driven ──────────────────────────────────────────────────────
// The wiring tests above read spelling; these run the flow itself: the body
// is evaluated against stub refs and setters (the harness pattern of
// tests/renderer/list-keys.test.js — app.js is not requirable in tests), so
// each guard's behavior is observed, not inferred.
describe('manageAmazonMusic guards (driven)', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    global.window = {}; // the success path's __parachordClearAmazonNoMatch read
  });

  afterEach(() => {
    logSpy.mockRestore();
    delete global.window;
    delete global.document;
    jest.useRealTimers();
  });

  // The stubbed seams: the plugin (signIn / signInPromptDecision — the
  // hiccup rule is the plugin's), the status read the CDM gate and the rule
  // feed on, the dialog and toast setters, and the refs the flow keeps.
  const harness = (over = {}) => {
    const resolver = over.resolver || {
      signIn: async () => ({ signedIn: true }),
      signInPromptDecision: over.decision
        || (({ cookiesSignedIn }) => ({ prompt: !cookiesSignedIn, streak: { firstAt: 0, lastAt: 0 } }))
    };
    const refs = {
      resolverLoaderRef: { current: { getResolver: (id) => (id === 'amazonmusic' ? resolver : null) } },
      amazonManageDeclinedUntilRef: { current: 0 },
      isAdvancingTrackRef: { current: !!over.advancing },
      spinoffModeRef: { current: !!over.spinoff },
      amazonManageInFlightRef: { current: null },
      amazonSignInHiccupRef: { current: { firstAt: 0, lastAt: 0 } }
    };
    const calls = { status: 0, dialog: [], toast: [] };
    const manage = new Function(
      'resolverLoaderRef', 'amazonManageDeclinedUntilRef', 'isAdvancingTrackRef', 'spinoffModeRef',
      'amazonManageInFlightRef', 'amazonSignInHiccupRef', 'refreshPluginStatus', 'setAmazonManageDialog', 'showToast',
      `${body}\nreturn manageAmazonMusic;`
    )(
      refs.resolverLoaderRef, refs.amazonManageDeclinedUntilRef, refs.isAdvancingTrackRef, refs.spinoffModeRef,
      refs.amazonManageInFlightRef, refs.amazonSignInHiccupRef,
      // The status read: counted (a guard that never reached the plugin reads
      // zero), with an injectable reply (and an injectable promise, for the
      // single-flight hang).
      async (id) => {
        calls.status += 1;
        if (over.status) return over.status(id);
        return 'statusReply' in over ? over.statusReply : { signedIn: true, cdm: true };
      },
      (dialog) => calls.dialog.push(dialog),
      (message, kind) => calls.toast.push({ message, kind })
    );
    return { manage, refs, calls };
  };

  test('a background prompt is skipped during radio auto-advance and spinoff; an explicit one is not', async () => {
    const advancing = harness({ advancing: true });
    await expect(advancing.manage({ explicit: false })).resolves.toBe(false);
    expect(advancing.calls.status).toBe(0); // the plugin was never asked
    const spinoff = harness({ spinoff: true });
    await expect(spinoff.manage({ explicit: false })).resolves.toBe(false);
    expect(spinoff.calls.status).toBe(0);
    // The Settings button passes explicit:true — radio must not swallow it.
    const explicit = harness({ advancing: true });
    const run = explicit.manage({ explicit: true, reason: 'not-signed-in', forcePrompt: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(explicit.calls.status).toBe(1); // it ran
    expect(explicit.calls.dialog).toHaveLength(1);
    explicit.calls.dialog[0].onResolve(true);
    await expect(run).resolves.toBe(true);
  });

  test('a background prompt is skipped while the window is hidden', async () => {
    global.document = { hidden: true };
    const hidden = harness();
    await expect(hidden.manage({ explicit: false })).resolves.toBe(false);
    expect(hidden.calls.status).toBe(0); // never reached the plugin
    expect(hidden.calls.dialog).toHaveLength(0);
  });

  test('a second call while one is in flight shares its promise — one run, one dialog', async () => {
    let releaseStatus;
    const status = new Promise((resolve) => { releaseStatus = resolve; });
    const h = harness({ status: () => status });
    const first = h.manage({ explicit: false });
    expect(h.refs.amazonManageInFlightRef.current).toBeTruthy(); // armed before the first await
    const second = h.manage({ explicit: false });
    releaseStatus({ signedIn: false, cdm: true }); // cookies dead → the rule says prompt
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.status).toBe(1); // one run, not two
    expect(h.calls.dialog).toHaveLength(1); // one onResolve slot, not two
    h.calls.dialog[0].onResolve(false); // declined
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false); // the second caller sees the same decline
    expect(h.refs.amazonManageInFlightRef.current).toBe(null); // the next prompt can start
  });

  test('a hiccup — cookies live — retries quietly after ~2s and answers true, without a prompt', async () => {
    jest.useFakeTimers();
    const h = harness({
      statusReply: { signedIn: true, cdm: true },
      decision: ({ cookiesSignedIn }) => (cookiesSignedIn
        ? { prompt: false, streak: { firstAt: 123, lastAt: 123 } }
        : { prompt: true, streak: { firstAt: 0, lastAt: 0 } })
    });
    const run = h.manage({ explicit: false, reason: 'not-signed-in' });
    await jest.advanceTimersByTimeAsync(0);
    expect(h.calls.dialog).toHaveLength(0); // no prompt
    expect(h.refs.amazonSignInHiccupRef.current).toEqual({ firstAt: 123, lastAt: 123 }); // the streak the plugin returned is kept
    await jest.advanceTimersByTimeAsync(1999);
    expect(h.calls.dialog).toHaveLength(0); // still quiet at 1.999s
    await jest.advanceTimersByTimeAsync(1);
    await expect(run).resolves.toBe(true); // the quiet retry answers success
    expect(h.calls.dialog).toHaveLength(0); // and never prompted
  });
});

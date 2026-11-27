/**
 * lib/plugin-sign-in-flow.js: the one sign-in prompt for every plug-in on the
 * status surface (#1624). It was Amazon's (manageAmazonMusic in app.js);
 * any other plug-in's sign-in window opened mid-play with no question first.
 * Mobile asks for every plug-in the same way (parachord-mobile#789,
 * PluginSignInPrompt), and so does this.
 *
 * The flow, for any plug-in:
 *   - a background prompt (explicit: false) is skipped while the queue
 *     advances on its own, in a Spinoff, while the window is hidden, and for
 *     10 minutes after a "Not now" or a sign-in window closed without
 *     signing in;
 *   - one prompt per plug-in at a time: a second caller shares the first's
 *     answer;
 *   - a build with no Widevine CDM (the plug-in's status says cdm: false)
 *     says so instead of asking;
 *   - the plug-in's own hiccup rule (signInPromptDecision), when it has one,
 *     runs first: a quiet retry instead of a prompt;
 *   - then the question, the plug-in's sign-in window, and on success a toast
 *     and its cached misses cleared.
 */
const {
  createPluginSignInFlow,
  newSignInState,
  DECLINE_QUIET_MS,
  HICCUP_RETRY_MS,
} = require('../../src/renderer/lib/plugin-sign-in-flow');

const plugin = (over = {}) => ({
  id: 'amazonmusic',
  name: 'Amazon Music',
  capabilities: { resolve: true, status: true },
  settings: { signInPromptHint: 'If Amazon asks, choose a profile.' },
  signIn: jest.fn(async () => ({ signedIn: true })),
  ...over,
});

// The flow over fakes: each seam records what it was asked.
function harness({ plugins = { amazonmusic: plugin() }, status = async () => ({ signedIn: false, cdm: true }), blocked = false, start = 1_000_000 } = {}) {
  const calls = { status: [], consent: [], signingIn: [], closed: 0, signedIn: [], signedOut: [], toast: [] };
  let now = start;
  const flow = createPluginSignInFlow({
    getPlugin: (id) => plugins[id] || null,
    readStatus: async (id) => { calls.status.push(id); return status(id); },
    askConsent: (request) => new Promise((resolve) => { calls.consent.push({ ...request, resolve }); }),
    showSigningIn: (id) => calls.signingIn.push(id),
    closeDialog: () => { calls.closed += 1; },
    backgroundBlocked: () => (typeof blocked === 'function' ? blocked() : blocked),
    onSignedIn: (id) => calls.signedIn.push(id),
    onSignedOut: (id) => calls.signedOut.push(id),
    showToast: (message, type) => calls.toast.push({ message, type }),
    now: () => now,
    sleep: () => Promise.resolve(),
  });
  const tick = () => new Promise((r) => setImmediate(r));
  return { flow, calls, plugins, tick, advance: (ms) => { now += ms; } };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('who can be prompted', () => {
  test('a plug-in on the status surface with a signIn', () => {
    const { flow } = harness({ plugins: { a: plugin({ id: 'a' }), b: plugin({ id: 'b', capabilities: { resolve: true } }), c: plugin({ id: 'c', signIn: undefined }) } });
    expect(flow.canPrompt('a')).toBe(true);
    expect(flow.canPrompt('b')).toBe(false);
    expect(flow.canPrompt('c')).toBe(false);
    expect(flow.canPrompt('missing')).toBe(false);
  });

  test('one that can\'t answers false without asking anything', async () => {
    const { flow, calls } = harness({ plugins: { b: plugin({ id: 'b', capabilities: {} }) } });
    await expect(flow.prompt('b', { explicit: true })).resolves.toBe(false);
    expect(calls.status).toEqual([]);
    expect(calls.consent).toEqual([]);
  });
});

describe('the question, for any plug-in', () => {
  test('asks with the plug-in\'s name and its own hint, then opens its sign-in', async () => {
    const { flow, calls, plugins, tick } = harness();
    const run = flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in' });
    await tick();
    expect(calls.consent).toHaveLength(1);
    expect(calls.consent[0]).toMatchObject({ pluginId: 'amazonmusic', name: 'Amazon Music', hint: 'If Amazon asks, choose a profile.', refused: true });
    expect(plugins.amazonmusic.signIn).not.toHaveBeenCalled(); // nothing opens before the answer
    calls.consent[0].resolve(true);
    await expect(run).resolves.toBe(true);
    expect(calls.signingIn).toEqual(['amazonmusic']);
    expect(plugins.amazonmusic.signIn).toHaveBeenCalledTimes(1);
    expect(calls.closed).toBe(1);
    expect(calls.signedIn).toEqual(['amazonmusic']);
    expect(calls.toast).toEqual([{ message: 'Signed in to Amazon Music', type: 'success' }]);
    // The status the tile and the settings row read is read again afterwards.
    expect(calls.status).toEqual(['amazonmusic', 'amazonmusic']);
  });

  test('a second web-session plug-in gets the same question, in its own words (the issue)', async () => {
    const other = plugin({ id: 'webplayer', name: 'Web Player', settings: {}, signInPromptDecision: undefined });
    const { flow, calls, tick } = harness({ plugins: { webplayer: other } });
    const run = flow.prompt('webplayer', { explicit: true, reason: 'not-signed-in' });
    await tick();
    expect(calls.consent[0]).toMatchObject({ pluginId: 'webplayer', name: 'Web Player', hint: null });
    expect(other.signIn).not.toHaveBeenCalled();
    calls.consent[0].resolve(true);
    await expect(run).resolves.toBe(true);
    expect(calls.toast[0].message).toBe('Signed in to Web Player');
  });

  test('Sign in from Settings is not a refusal: the dialog says so', async () => {
    const { flow, calls, tick } = harness();
    flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in', forcePrompt: true });
    await tick();
    expect(calls.consent[0].refused).toBe(false);
  });

  test('Not now opens nothing and quiets background prompts for 10 minutes, for that plug-in only', async () => {
    const other = plugin({ id: 'webplayer', name: 'Web Player' });
    const { flow, calls, plugins, tick, advance } = harness({ plugins: { amazonmusic: plugin(), webplayer: other } });
    const run = flow.prompt('amazonmusic', { explicit: true });
    await tick();
    calls.consent[0].resolve(false);
    await expect(run).resolves.toBe(false);
    expect(plugins.amazonmusic.signIn).not.toHaveBeenCalled();
    expect(calls.closed).toBe(1);

    await expect(flow.prompt('amazonmusic', { explicit: false })).resolves.toBe(false);
    expect(calls.consent).toHaveLength(1); // quiet
    // Another plug-in's background prompt isn't quieted by this one's Not now.
    flow.prompt('webplayer', { explicit: false });
    await tick();
    expect(calls.consent).toHaveLength(2);
    expect(calls.consent[1].pluginId).toBe('webplayer');
    calls.consent[1].resolve(false);
    await tick();
    // An explicit one (Play, Settings) always asks.
    flow.prompt('amazonmusic', { explicit: true });
    await tick();
    expect(calls.consent).toHaveLength(3);
    calls.consent[2].resolve(false);
    await tick();

    advance(DECLINE_QUIET_MS - 1);
    await expect(flow.prompt('amazonmusic', { explicit: false })).resolves.toBe(false);
    expect(calls.consent).toHaveLength(3);
    advance(DECLINE_QUIET_MS); // past the quiet the third Not now set
    flow.prompt('amazonmusic', { explicit: false });
    await tick();
    expect(calls.consent).toHaveLength(4);
  });

  test('a sign-in window closed without signing in is the same quiet', async () => {
    const closed = plugin({ signIn: jest.fn(async () => ({ signedIn: false })) });
    const { flow, calls, tick } = harness({ plugins: { amazonmusic: closed } });
    const run = flow.prompt('amazonmusic', { explicit: true });
    await tick();
    calls.consent[0].resolve(true);
    await expect(run).resolves.toBe(false);
    expect(calls.signedIn).toEqual([]);
    expect(calls.toast).toEqual([]);
    await expect(flow.prompt('amazonmusic', { explicit: false })).resolves.toBe(false);
    expect(calls.consent).toHaveLength(1);
  });

  test('a sign-in that throws closes the dialog and answers false', async () => {
    const broken = plugin({ signIn: jest.fn(async () => { throw new Error('window failed'); }) });
    const { flow, calls, tick } = harness({ plugins: { amazonmusic: broken } });
    const run = flow.prompt('amazonmusic', { explicit: true });
    await tick();
    calls.consent[0].resolve(true);
    await expect(run).resolves.toBe(false);
    expect(calls.closed).toBe(1);
  });
});

describe('the gates', () => {
  test('a background prompt is skipped while the queue advances, in a Spinoff or with the window hidden; an explicit one is not', async () => {
    const { flow, calls, tick } = harness({ blocked: true });
    await expect(flow.prompt('amazonmusic', { explicit: false })).resolves.toBe(false);
    expect(calls.status).toEqual([]); // never reached the plug-in
    flow.prompt('amazonmusic', { explicit: true });
    await tick();
    expect(calls.consent).toHaveLength(1);
  });

  test('one prompt per plug-in at a time: a second caller shares the answer', async () => {
    let release;
    const status = () => new Promise((resolve) => { release = resolve; });
    const { flow, calls, tick } = harness({ status });
    const first = flow.prompt('amazonmusic', { explicit: false });
    const second = flow.prompt('amazonmusic', { explicit: true });
    await tick();
    release({ signedIn: false, cdm: true });
    await tick();
    expect(calls.status).toHaveLength(1);
    expect(calls.consent).toHaveLength(1);
    calls.consent[0].resolve(false);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    // Done: the next one runs again.
    flow.prompt('amazonmusic', { explicit: true });
    await tick();
    release({ signedIn: false, cdm: true });
    await tick();
    expect(calls.status).toHaveLength(2);
    expect(calls.consent).toHaveLength(2);
  });

  test('a build with no Widevine CDM says so and asks nothing', async () => {
    const { flow, calls, plugins } = harness({ status: async () => ({ signedIn: false, cdm: false }) });
    await expect(flow.prompt('amazonmusic', { explicit: true })).resolves.toBe(false);
    expect(calls.consent).toEqual([]);
    expect(plugins.amazonmusic.signIn).not.toHaveBeenCalled();
    expect(calls.toast).toEqual([{ message: 'This Parachord build can’t play protected streams, so Amazon Music can’t play here.', type: 'error' }]);
  });

  test('a status read that fails is no verdict: it still asks', async () => {
    const { flow, calls, tick } = harness({ status: async () => { throw new Error('loader'); } });
    flow.prompt('amazonmusic', { explicit: true });
    await tick();
    expect(calls.consent).toHaveLength(1);
  });
});

describe('the plug-in\'s hiccup rule', () => {
  test('when it says not to prompt, the flow waits and answers true without asking', async () => {
    const decision = jest.fn(() => ({ prompt: false, streak: { firstAt: 5, lastAt: 6 } }));
    const p = plugin({ signInPromptDecision: decision });
    const sleeps = [];
    const calls = { consent: [] };
    const flow = createPluginSignInFlow({
      getPlugin: () => p,
      readStatus: async () => ({ signedIn: true, cdm: true }),
      askConsent: (r) => { calls.consent.push(r); return Promise.resolve(true); },
      showSigningIn: () => {}, closeDialog: () => {}, backgroundBlocked: () => false,
      onSignedIn: () => {}, showToast: () => {},
      now: () => 42,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await expect(flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in' })).resolves.toBe(true);
    expect(calls.consent).toEqual([]);
    expect(sleeps).toEqual([HICCUP_RETRY_MS]);
    expect(decision).toHaveBeenCalledWith({ reason: 'not-signed-in', cookiesSignedIn: true, streak: { firstAt: 0, lastAt: 0 }, now: 42 });
    // The streak the plug-in returned is kept for its next decision.
    await flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in' });
    expect(decision).toHaveBeenLastCalledWith(expect.objectContaining({ streak: { firstAt: 5, lastAt: 6 } }));
  });

  test('Settings\' Sign in (forcePrompt) skips it; a plug-in without one asks at once', async () => {
    const decision = jest.fn(() => ({ prompt: false, streak: { firstAt: 1, lastAt: 1 } }));
    const { flow, calls, tick } = harness({ plugins: { amazonmusic: plugin({ signInPromptDecision: decision }), webplayer: plugin({ id: 'webplayer', name: 'Web Player' }) } });
    flow.prompt('amazonmusic', { explicit: true, forcePrompt: true });
    await tick();
    expect(decision).not.toHaveBeenCalled();
    expect(calls.consent).toHaveLength(1);
    flow.prompt('webplayer', { explicit: true, reason: 'not-signed-in' });
    await tick();
    expect(calls.consent).toHaveLength(2);
  });

  test('a successful sign-in resets the streak', async () => {
    const decision = jest.fn(({ streak }) => ({ prompt: true, streak: { firstAt: streak.firstAt || 9, lastAt: 9 } }));
    const { flow, calls, tick } = harness({ plugins: { amazonmusic: plugin({ signInPromptDecision: decision }) } });
    const run = flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in' });
    await tick();
    calls.consent[0].resolve(true);
    await run;
    flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in' });
    await tick();
    expect(decision).toHaveBeenLastCalledWith(expect.objectContaining({ streak: { firstAt: 0, lastAt: 0 } }));
  });
});

describe('state outlives the flow (app.js builds it each render)', () => {
  test('two flows over one state share the quiet period and the prompt in flight', async () => {
    const state = newSignInState();
    const p = plugin();
    const consent = [];
    const seams = {
      getPlugin: () => p,
      readStatus: async () => ({ signedIn: false, cdm: true }),
      askConsent: () => new Promise((resolve) => consent.push(resolve)),
      showSigningIn: () => {}, closeDialog: () => {}, backgroundBlocked: () => false,
      onSignedIn: () => {}, showToast: () => {},
    };
    const tick = () => new Promise((r) => setImmediate(r));
    const first = createPluginSignInFlow(seams, state).prompt('amazonmusic', { explicit: true });
    const second = createPluginSignInFlow(seams, state).prompt('amazonmusic', { explicit: true });
    await tick();
    expect(consent).toHaveLength(1);
    consent[0](false);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    await expect(createPluginSignInFlow(seams, state).prompt('amazonmusic', { explicit: false })).resolves.toBe(false);
    expect(consent).toHaveLength(1); // the Not now's quiet carried over
  });
});

describe("the dialog's words (components/plugin-sign-in-dialog.js)", () => {
  const { signInDialogCopy } = require('../../src/renderer/lib/plugin-sign-in-flow');

  test('a refused play asks as mobile does (SignInPromptCopy)', () => {
    expect(signInDialogCopy({ name: 'Amazon Music', refused: true })).toEqual({
      title: 'Sign in to Amazon Music?',
      description: 'Amazon Music needs you to sign in to play this track.',
    });
  });

  test('a Sign in the person chose says what happens next', () => {
    expect(signInDialogCopy({ name: 'Web Player', refused: false })).toEqual({
      title: 'Sign in to Web Player?',
      description: 'Web Player’s sign-in page opens in a new window.',
    });
  });
});

// A refused play that ends signed out takes the plug-in out of playback
// (onSignedOut), so its saved sources are never picked only to be refused
// again; a play with another source asks nothing (ask: false) and moves on.
describe('a refusal that ends signed out', () => {
  test('ask: false asks nothing, answers false and reports the plug-in signed out', async () => {
    const { flow, calls } = harness();
    await expect(flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in', ask: false })).resolves.toBe(false);
    expect(calls.consent).toHaveLength(0);
    expect(calls.signedOut).toEqual(['amazonmusic']);
    expect(calls.status).toEqual(['amazonmusic']); // the status is read: the tile and the map update
  });

  test('ask: false starts no quiet period: a Play of a track only it has still asks', async () => {
    const { flow, calls, tick } = harness();
    await flow.prompt('amazonmusic', { explicit: false, reason: 'not-signed-in', ask: false });
    const run = flow.prompt('amazonmusic', { explicit: false, reason: 'not-signed-in' });
    await tick();
    expect(calls.consent).toHaveLength(1);
    calls.consent[0].resolve(false);
    await run;
  });

  test('ask: false still takes the hiccup rule\'s quiet retry', async () => {
    const amazon = plugin({ signInPromptDecision: () => ({ prompt: false, streak: { firstAt: 1, lastAt: 1 } }) });
    const { flow, calls } = harness({ plugins: { amazonmusic: amazon }, status: async () => ({ signedIn: true, cdm: true }) });
    await expect(flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in', ask: false })).resolves.toBe(true);
    expect(calls.signedOut).toEqual([]);
  });

  test('Not now, or a sign-in window closed early, after a refusal reports it signed out', async () => {
    const { flow, calls, tick } = harness();
    const run = flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in' });
    await tick();
    calls.consent[0].resolve(false);
    await run;
    expect(calls.signedOut).toEqual(['amazonmusic']);

    const closedEarly = harness({ plugins: { amazonmusic: plugin({ signIn: jest.fn(async () => ({ signedIn: false })) }) } });
    const run2 = closedEarly.flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in' });
    await closedEarly.tick();
    closedEarly.calls.consent[0].resolve(true);
    await run2;
    expect(closedEarly.calls.signedOut).toEqual(['amazonmusic']);
  });

  test('a Sign in the person chose and then put off says nothing new', async () => {
    const { flow, calls, tick } = harness();
    const run = flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in', forcePrompt: true });
    await tick();
    expect(calls.consent[0].refused).toBe(false);
    calls.consent[0].resolve(false);
    await run;
    expect(calls.signedOut).toEqual([]);
  });

  test('refused: true keeps the refused wording without the hiccup rule (a track only it has)', async () => {
    const decision = jest.fn(() => ({ prompt: false, streak: { firstAt: 1, lastAt: 1 } }));
    const { flow, calls, tick } = harness({ plugins: { amazonmusic: plugin({ signInPromptDecision: decision }) } });
    const run = flow.prompt('amazonmusic', { explicit: true, reason: 'not-signed-in', forcePrompt: true, refused: true });
    await tick();
    expect(decision).not.toHaveBeenCalled();
    expect(calls.consent[0]).toMatchObject({ refused: true });
    calls.consent[0].resolve(true);
    await expect(run).resolves.toBe(true);
    expect(calls.signedIn).toEqual(['amazonmusic']);
    expect(calls.signedOut).toEqual([]);
  });
});

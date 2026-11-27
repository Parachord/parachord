// src/renderer/lib/plugin-sign-in-flow.js — the one sign-in prompt for every
// plug-in on the status surface (#1624).
//
// A plug-in that needs a sign-in (capabilities.status, with a signIn method)
// is asked through this flow wherever its sign-in starts: a play it refused
// as not signed in (the playback engine), its own search or import when it
// finds it's signed out, the plug-in dialog's Sign in, Home's Connect. It was
// Amazon's alone (manageAmazonMusic in app.js), and any other plug-in's
// sign-in window opened mid-play with no question first. Mobile asks every
// plug-in the same way (parachord-mobile#789, PluginSignInPrompt).
//
// For any plug-in, in order:
//   1. A background prompt (explicit: false) is skipped while the queue
//      advances on its own, in a Spinoff, with the window hidden
//      (backgroundBlocked), and for DECLINE_QUIET_MS after a "Not now" or a
//      sign-in window closed without signing in. An explicit one (Play,
//      Settings, Connect) always asks.
//   2. One prompt per plug-in at a time: a second caller shares the first's
//      answer, so it can't take over the dialog's answer slot.
//   3. The plug-in's status: a build with no Widevine CDM (cdm: false in the
//      reply) says so and asks nothing. A read that fails is no verdict.
//   4. The plug-in's hiccup rule, when it has one (signInPromptDecision, and
//      not forcePrompt): a not-signed-in it reads as a passing blip retries
//      quietly after HICCUP_RETRY_MS instead of asking. Amazon's reads a live
//      session's token refresh this way (#1172).
//   5. The question (askConsent): "Sign in to X?", with the plug-in's own
//      tip from its manifest (settings.signInPromptHint). Then its signIn window,
//      a toast, its cached misses cleared (onSignedIn), its status read again.
//
// Pure: every effect is a seam the caller passes; loads under plain Node.
// What it remembers (each plug-in's quiet period, its prompt in flight, its
// hiccup streak) is `state`, so a caller that builds the flow each render
// (app.js, whose seams are that render's functions) keeps one state in a ref
// and passes it every time.

const DECLINE_QUIET_MS = 10 * 60 * 1000;
const HICCUP_RETRY_MS = 2000;
const EMPTY_STREAK = Object.freeze({ firstAt: 0, lastAt: 0 });

// What the question says (components/plugin-sign-in-dialog.js): a refused
// play asks as mobile does (SignInPromptCopy); a Sign in the person chose
// (Settings, Connect) says what happens next.
function signInDialogCopy({ name, refused }) {
  return {
    title: `Sign in to ${name}?`,
    description: refused
      ? `${name} needs you to sign in to play this track.`
      : `${name}’s sign-in page opens in a new window.`,
  };
}

// A plug-in this flow can ask: on the status surface, with a sign-in window.
function canPromptPlugin(plugin) {
  return !!(plugin && plugin.capabilities && plugin.capabilities.status && typeof plugin.signIn === 'function');
}

const nameOf = (plugin, id) => (plugin && typeof plugin.name === 'string' && plugin.name.trim()) || id;
const hintOf = (plugin) => {
  const hint = plugin && plugin.settings && plugin.settings.signInPromptHint;
  return typeof hint === 'string' && hint.trim() ? hint.trim() : null;
};

// What the flow remembers, per plug-in id.
function newSignInState() {
  return { declinedUntil: new Map(), inFlight: new Map(), streaks: new Map() };
}

function createPluginSignInFlow({
  getPlugin,
  readStatus,
  askConsent,
  showSigningIn,
  closeDialog,
  backgroundBlocked,
  onSignedIn,
  showToast,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}, state = newSignInState()) {
  // pluginId -> quiet until (ms); -> the prompt in flight; -> the hiccup streak.
  const { declinedUntil, inFlight, streaks } = state;

  const quiet = (id) => declinedUntil.set(id, now() + DECLINE_QUIET_MS);

  const run = async (id, plugin, opts) => {
    const name = nameOf(plugin, id);
    const status = await Promise.resolve().then(() => readStatus(id)).catch(() => null);
    if (status && status.cdm === false) {
      showToast(`This Parachord build can’t play protected streams, so ${name} can’t play here.`, 'error');
      return false;
    }
    if (!opts.forcePrompt && typeof plugin.signInPromptDecision === 'function') {
      const verdict = plugin.signInPromptDecision({
        reason: opts.reason,
        cookiesSignedIn: !!(status && status.signedIn),
        streak: streaks.get(id) || EMPTY_STREAK,
        now: now(),
      }) || {};
      streaks.set(id, verdict.streak || EMPTY_STREAK);
      if (verdict.prompt === false) {
        console.log(`[${name}] not signed in, but the plug-in reads it as a passing hiccup: retrying quietly instead of asking`);
        await sleep(HICCUP_RETRY_MS);
        return true;
      }
    }
    const granted = await askConsent({ pluginId: id, name, hint: hintOf(plugin), refused: !opts.forcePrompt });
    if (!granted) {
      closeDialog();
      quiet(id);
      return false;
    }
    showSigningIn(id);
    let login;
    try {
      login = await plugin.signIn();
    } finally {
      closeDialog();
      Promise.resolve().then(() => readStatus(id)).catch(() => {});
    }
    if (login && login.signedIn) {
      streaks.set(id, EMPTY_STREAK);
      showToast(`Signed in to ${name}`, 'success');
      onSignedIn(id);
      return true;
    }
    // The sign-in window closed without a session: the same quiet as Not now.
    // Without it the next background search's not-signed-in reopened the
    // prompt at once, and again after every close.
    quiet(id);
    return false;
  };

  const prompt = async (id, opts = {}) => {
    const plugin = getPlugin(id);
    if (!canPromptPlugin(plugin)) return false;
    const explicit = opts.explicit !== false;
    if (!explicit && now() < (declinedUntil.get(id) || 0)) return false;
    if (!explicit && backgroundBlocked()) return false;
    if (inFlight.has(id)) return inFlight.get(id);
    const answer = run(id, plugin, opts).catch((error) => {
      console.error(`${nameOf(plugin, id)} sign-in failed:`, error);
      return false;
    });
    inFlight.set(id, answer);
    try {
      return await answer;
    } finally {
      inFlight.delete(id);
    }
  };

  return { prompt, canPrompt: (id) => canPromptPlugin(getPlugin(id)) };
}

module.exports = { createPluginSignInFlow, newSignInState, canPromptPlugin, signInDialogCopy, DECLINE_QUIET_MS, HICCUP_RETRY_MS };

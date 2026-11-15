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

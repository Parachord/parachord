/**
 * An Amazon "not signed in" while the auth cookies are live is usually
 * Amazon's periodic session-token refresh catching a page load. The sign-in
 * prompt opened on an app signed in for hours (session-token reissued at the
 * moment of the prompt, at-main / sess-at-main / x-main untouched), and the
 * very next search worked. It now retries quietly; only a streak lasting a
 * minute (most likely the profile picker) prompts.
 */

const fs = require('fs');
const path = require('path');
const { amazonSignInPromptDecision, HICCUP_GRACE_MS, STREAK_GAP_MS } = require('../../src/renderer/lib/amazon-signin-prompt');

const none = { firstAt: 0, lastAt: 0 };
const T = 1_000_000;

describe('amazonSignInPromptDecision', () => {
  test('a not-signed-in with live cookies is a hiccup: no prompt, a streak starts', () => {
    expect(amazonSignInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak: none, now: T }))
      .toEqual({ prompt: false, streak: { firstAt: T, lastAt: T } });
  });

  test('no cookies, or another reason, prompts at once', () => {
    expect(amazonSignInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: false, streak: none, now: T }).prompt).toBe(true);
    expect(amazonSignInPromptDecision({ reason: 'not-ready', cookiesSignedIn: true, streak: none, now: T }).prompt).toBe(true);
    expect(amazonSignInPromptDecision({ reason: undefined, cookiesSignedIn: true, streak: none, now: T }).prompt).toBe(true);
  });

  test('a streak lasting the grace period prompts (the profile picker waiting)', () => {
    let streak = none;
    let prompt = false;
    for (let t = 0; t < HICCUP_GRACE_MS; t += 10_000) {
      ({ prompt, streak } = amazonSignInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak, now: T + t }));
      expect(prompt).toBe(false);
    }
    ({ prompt, streak } = amazonSignInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak, now: T + HICCUP_GRACE_MS }));
    expect(prompt).toBe(true);
    expect(streak).toEqual(none); // the prompt resets the streak
  });

  test('two separate hiccups minutes apart never add up to a prompt', () => {
    let { streak } = amazonSignInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak: none, now: T });
    const later = T + STREAK_GAP_MS + 1;
    const second = amazonSignInPromptDecision({ reason: 'not-signed-in', cookiesSignedIn: true, streak, now: later });
    expect(second.prompt).toBe(false);
    expect(second.streak).toEqual({ firstAt: later, lastAt: later }); // a fresh streak
  });
});

describe('app.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const start = src.indexOf('const manageAmazonMusic = async');
  const body = src.slice(start, src.indexOf('window.__parachordManageAmazonMusic = manageAmazonMusic', start));

  test('manageAmazonMusic checks for a hiccup before showing the prompt', () => {
    const gate = body.indexOf('amazonSignInPromptDecision(');
    const dialog = body.indexOf('setAmazonManageDialog({ show: true, onResolve: resolve');
    expect(gate).toBeGreaterThan(-1);
    expect(dialog).toBeGreaterThan(gate);
    expect(body).toMatch(/if \(!opts\.forcePrompt\)/);
    expect(body).toMatch(/cookiesSignedIn: !!\(status && status\.web && status\.web\.signedIn\)/);
  });

  test('a successful sign-in clears the streak', () => {
    const ok = body.indexOf('if (login && login.signedIn) {');
    expect(body.indexOf('amazonSignInHiccupRef.current = { firstAt: 0, lastAt: 0 };', ok)).toBeGreaterThan(ok);
  });

  test('the Settings Sign in button always opens the window', () => {
    expect(src).toMatch(/manageAmazonMusic\(\{ explicit: true, reason: 'not-signed-in', forcePrompt: true \}\)/);
  });
});

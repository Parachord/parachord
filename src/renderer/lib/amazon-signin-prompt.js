// src/renderer/lib/amazon-signin-prompt.js — should an Amazon "not signed in"
// open the sign-in prompt?
//
// Amazon refreshes its session token every so often (session-token reissued,
// the auth cookies untouched), and a page load caught in that refresh can be
// redirected to a sign-in or profile page. A background search hitting it
// threw not-signed-in and opened the sign-in prompt on an app that had been
// signed in for hours, while the very next search worked.
//
// So while the auth cookies say the session is live (getStatus web.signedIn,
// cookie-based since #1166), a not-signed-in is first treated as a hiccup: no
// prompt, the caller retries (a play/lookup retries once; background
// resolution tries the track again later). Only a streak of them lasting
// HICCUP_GRACE_MS (consecutive failures less than STREAK_GAP_MS apart) is
// real, most likely Amazon's profile picker waiting for a choice, and prompts.
// No cookies, or another reason, prompts at once as before.

const HICCUP_GRACE_MS = 60 * 1000;
const STREAK_GAP_MS = 2 * 60 * 1000;

// streak: { firstAt, lastAt } (0s when none). Returns { prompt, streak }.
function amazonSignInPromptDecision({ reason, cookiesSignedIn, streak, now }) {
  const none = { firstAt: 0, lastAt: 0 };
  if (reason !== 'not-signed-in' || !cookiesSignedIn) return { prompt: true, streak: none };
  const s = streak || none;
  const continuing = s.lastAt && now - s.lastAt <= STREAK_GAP_MS;
  const firstAt = continuing ? s.firstAt : now;
  if (now - firstAt >= HICCUP_GRACE_MS) return { prompt: true, streak: none };
  return { prompt: false, streak: { firstAt, lastAt: now } };
}

module.exports = { amazonSignInPromptDecision, HICCUP_GRACE_MS, STREAK_GAP_MS };

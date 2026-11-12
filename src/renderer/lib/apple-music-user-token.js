// src/renderer/lib/apple-music-user-token.js — which Apple Music user token
// (Music-User-Token) the app should use, and whether Apple still accepts it.
//
// A user token can sit in four places in the renderer's localStorage:
//   musickit_user_token                — the app's own copy; every sign-in
//                                        path writes it, and it is the one the
//                                        app means to use (electron-store's
//                                        applemusic_user_token mirrors it for
//                                        the main process)
//   music.ampwebplay.media-user-token  — the cookie harvested by the
//                                        beta.music.apple.com sign-in window
//   music.<id>.media-user-token        — MusicKit JS's own copy, which it
//                                        restores at configure() by itself
// Until 2026-11, MusicKit JS restored its own copy at configure, reported
// isAuthorized, and startup then wrote that copy over the app's: a token Apple
// had stopped accepting (403 on every /v1/me call) replaced every fresh
// sign-in, and the app still showed Apple Music as connected. The fix is to
// treat the app's copy as the one of record (configure gets it written into
// MusicKit's slot first) and to ask Apple whether a token works before
// trusting it. See docs/architecture/playback.md "Apple Music user token".
//
// Pure: storage and the network probe are passed in, so jest drives it.

const APP_TOKEN_KEY = 'musickit_user_token';
const HARVESTED_TOKEN_KEY = 'music.ampwebplay.media-user-token';
// MusicKit JS's own slot. The middle part is an id MusicKit derives itself
// (seen: "yr3xete537"); the harvested cookie's "ampwebplay" is not one.
const MUSICKIT_SLOT = /^music\.(?!ampwebplay\.)[^.]+\.media-user-token$/;

// The cheapest account call: needs a valid user token, but no subscription
// and no Sync Library, so its refusal means the token itself is dead (a 403
// on /me/library can also mean "no subscription").
const STOREFRONT_URL = 'https://api.music.apple.com/v1/me/storefront';
// A catalog call with no user token, to tell a dead developer token (which
// makes every user token look dead) from dead user tokens.
const CATALOG_PROBE_URL = 'https://api.music.apple.com/v1/catalog/us/genres?limit=1';

function storageKeys(storage) {
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
  } catch (_e) { /* storage unavailable */ }
  return keys.filter(Boolean);
}

function read(storage, key) {
  try { return storage.getItem(key) || null; } catch (_e) { return null; }
}

/** Keys of MusicKit JS's own stored user token(s). */
function musicKitTokenSlots(storage) {
  return storageKeys(storage).filter(k => MUSICKIT_SLOT.test(k));
}

/**
 * Write `token` into each MusicKit JS slot that holds a different one, so
 * MusicKit restores the app's token at configure instead of a stale one.
 * A fresh install has no slot; configure's injection covers that case.
 * @returns {number} slots rewritten
 */
function syncMusicKitTokenSlots(storage, token) {
  if (!token) return 0;
  let changed = 0;
  for (const key of musicKitTokenSlots(storage)) {
    if (read(storage, key) === token) continue;
    try { storage.setItem(key, token); changed++; } catch (_e) { /* ignore */ }
  }
  return changed;
}

/** Remove MusicKit JS's stored token(s), so it starts signed out. */
function clearMusicKitTokenSlots(storage) {
  let removed = 0;
  for (const key of musicKitTokenSlots(storage)) {
    try { storage.removeItem(key); removed++; } catch (_e) { /* ignore */ }
  }
  return removed;
}

/**
 * Every user token on hand, best first and without repeats: the app's copy,
 * then the harvested sign-in cookie, then MusicKit's copies, then `extra`
 * (for example a token fetched from the native helper).
 */
function userTokenCandidates(storage, extra = []) {
  const out = [];
  const add = (t) => { if (t && typeof t === 'string' && !out.includes(t)) out.push(t); };
  add(read(storage, APP_TOKEN_KEY));
  add(read(storage, HARVESTED_TOKEN_KEY));
  for (const key of musicKitTokenSlots(storage)) add(read(storage, key));
  for (const t of extra) add(t);
  return out;
}

/** 'ok' (2xx), 'rejected' (401/403: Apple refuses the token) or 'unknown'. */
function classifyStatus(status) {
  if (typeof status === 'number' && status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'rejected';
  return 'unknown';
}

/**
 * Find the first token Apple accepts.
 * @param {string[]} candidates
 * @param {(token: string) => Promise<number|null>} probeUserToken status of
 *   /v1/me/storefront with this token, or null for no answer
 * @param {() => Promise<number|null>} [probeDeveloperToken] status of a
 *   catalog call with no user token; asked only when every token was refused
 * @returns {Promise<{verdict: 'ok'|'rejected'|'unknown'|'none', token: string|null, status: number|null}>}
 *   ok: `token` works. rejected: Apple refused every token, and the developer
 *   token itself works, so signing in again is the fix. unknown: no verdict
 *   (offline, 5xx, 429, or the developer token was refused too); change
 *   nothing. none: no token to check.
 */
async function findWorkingUserToken(candidates, probeUserToken, probeDeveloperToken) {
  if (!candidates || candidates.length === 0) return { verdict: 'none', token: null, status: null };
  let lastStatus = null;
  let sawUnknown = false;
  for (const token of candidates) {
    let status = null;
    try { status = await probeUserToken(token); } catch (_e) { status = null; }
    lastStatus = status;
    const kind = classifyStatus(status);
    if (kind === 'ok') return { verdict: 'ok', token, status };
    if (kind === 'unknown') sawUnknown = true;
  }
  if (sawUnknown) return { verdict: 'unknown', token: null, status: lastStatus };
  if (typeof probeDeveloperToken === 'function') {
    let devStatus = null;
    try { devStatus = await probeDeveloperToken(); } catch (_e) { devStatus = null; }
    if (classifyStatus(devStatus) !== 'ok') return { verdict: 'unknown', token: null, status: devStatus };
  }
  return { verdict: 'rejected', token: null, status: lastStatus };
}

/** Status-only fetch probes for findWorkingUserToken. */
function makeAppleProbes(fetchImpl, developerToken) {
  const statusOf = async (url, headers) => {
    try {
      const res = await fetchImpl(url, { headers });
      return res && typeof res.status === 'number' ? res.status : null;
    } catch (_e) {
      return null;
    }
  };
  return {
    probeUserToken: (userToken) => statusOf(STOREFRONT_URL, {
      Authorization: `Bearer ${developerToken}`,
      'Music-User-Token': userToken
    }),
    probeDeveloperToken: () => statusOf(CATALOG_PROBE_URL, {
      Authorization: `Bearer ${developerToken}`
    })
  };
}

module.exports = {
  APP_TOKEN_KEY,
  HARVESTED_TOKEN_KEY,
  STOREFRONT_URL,
  CATALOG_PROBE_URL,
  musicKitTokenSlots,
  syncMusicKitTokenSlots,
  clearMusicKitTokenSlots,
  userTokenCandidates,
  classifyStatus,
  findWorkingUserToken,
  makeAppleProbes
};

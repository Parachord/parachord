// src/renderer/lib/apple-music-api.js: the Apple Music account calls the app
// makes for the Apple Music plug-in, with the developer token and the app's
// user token of record (musickit_user_token; lib/apple-music-user-token.js).
// Narrow on purpose: each call is one the plug-in needs, never a general
// proxy to the user's account.
//
// - appleMusicUserFetch: one user-scoped request. No developer token, no
//   user token, or a refusal Apple keeps after the app adopts another token
//   it still accepts, throws an error with notReady set (so a caller never
//   caches a refusal as "nothing there"); anything else is the response.
// - favoriteSong: favourite one catalog song, a personal rating of 1
//   (PUT /v1/me/ratings/songs/{id}; Apple's docs: "A rating indicates whether
//   a user likes (1) or dislikes (-1) the song"; the catalog and library
//   ratings of a song in the library stay in sync). Loves (#1559 step 5):
//   never a dislike, never a removal.
//
// Pure: fetch, the tokens and the token re-check are passed in (`deps`), so
// jest drives it. app.js supplies them (appleMusicApiDeps).

const notReady = (code, message) => Object.assign(new Error(message), { notReady: true, code });
const refused = (status) => status === 401 || status === 403;

// deps: { fetch, getDeveloperToken(): Promise<string|null>,
//         getUserToken(): string|null,
//         recheckUserToken(developerToken): Promise<{ verdict, token }> }
async function appleMusicUserFetch(deps, url, init = {}) {
  const developerToken = await deps.getDeveloperToken();
  if (!developerToken) throw notReady('no-developer-token', 'Apple Music developer token unavailable');
  let userToken = deps.getUserToken() || '';
  if (!userToken) throw notReady('not-signed-in', 'Not signed in to Apple Music');
  const ask = (token) => deps.fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${developerToken}`, 'Music-User-Token': token },
  });
  let res = await ask(userToken);
  if (refused(res.status)) {
    const check = await deps.recheckUserToken(developerToken);
    if (!check || check.verdict !== 'ok' || !check.token || check.token === userToken) {
      throw notReady('token-refused', `Apple Music refused the sign-in (HTTP ${res.status})`);
    }
    userToken = check.token;
    res = await ask(userToken);
    if (refused(res.status)) throw notReady('token-refused', `Apple Music refused the sign-in (HTTP ${res.status})`);
  }
  return res;
}

// A catalog song id: digits only (a library id, "i.…", can't be favourited
// through the catalog path).
const isCatalogSongId = (id) => /^\d+$/.test(String(id || ''));

// Favourite one catalog song. { ok: true } on Apple's yes; { ok: false,
// reason } for a song it can't take (not a catalog id, or one Apple doesn't
// have: 404), which the love push reads as no match; any other failure
// throws, so the push retries it.
async function favoriteSong(deps, catalogId) {
  if (!isCatalogSongId(catalogId)) return { ok: false, reason: 'not-catalog' };
  const res = await appleMusicUserFetch(deps, `https://api.music.apple.com/v1/me/ratings/songs/${catalogId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'rating', attributes: { value: 1 } }),
  });
  if (res.status === 404) return { ok: false, reason: 'not-found' };
  if (!res.ok) throw new Error(`Apple Music favorite failed: HTTP ${res.status}`);
  return { ok: true };
}

module.exports = { appleMusicUserFetch, favoriteSong, isCatalogSongId };

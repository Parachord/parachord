// SoundCloud token check + refresh for the `soundcloud-check-token` IPC.
//
// SoundCloud access tokens last about an hour, and a refresh token is
// SINGLE-USE: every refresh returns a new one and the old one is dead from
// then on. The renderer asks for a token every time it builds the SoundCloud
// resolver config, so an album page resolving a dozen tracks asks a dozen
// times at once. When the access token had just expired, each of those calls
// used to POST the same refresh token: the first rotated it, the rest got
// `invalid_grant`, and the invalid_grant branch deleted every stored token,
// including the ones the winning refresh had just saved. The user was signed
// out about once an hour of use.
//
// Two guards, either of which alone would have stopped it:
//   - one refresh at a time: concurrent checks share the in-flight refresh;
//   - a dead-refresh-token reply only clears the tokens if the stored refresh
//     token is still the one that was sent (otherwise another refresh already
//     rotated it, and what's stored is good).

'use strict';

const TOKEN_KEYS = ['soundcloud_token', 'soundcloud_refresh_token', 'soundcloud_token_expiry', 'soundcloud_last_refresh'];
const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
// A refresh token unused for long enough expires; refreshing weekly keeps it alive.
const PROACTIVE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRES_IN_S = 3600;

function createSoundCloudTokenSource({ store, fetch, getCredentials, now = Date.now, log = console }) {
  let refreshInFlight = null;

  const storedValidToken = () => {
    const token = store.get('soundcloud_token');
    const expiry = store.get('soundcloud_token_expiry');
    return token && expiry && now() < expiry ? { token, expiresAt: expiry } : null;
  };

  const refresh = async (refreshToken, reason) => {
    const { clientId, clientSecret, source } = getCredentials();
    if (!clientId || !clientSecret) return null;
    log.log(`🔄 SoundCloud ${reason}, attempting automatic refresh using`, source, 'credentials...');
    try {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        })
      });

      if (!response.ok) {
        let errorBody = null;
        try { errorBody = await response.json(); } catch { /* not JSON */ }
        log.error('❌ SoundCloud token refresh failed:', response.status, response.statusText,
          errorBody && errorBody.error ? `(${errorBody.error})` : '');
        // HTTP 401, or RFC 6749 §5.2 `invalid_grant` (what SoundCloud sends,
        // with a 400), means the refresh token we SENT is dead. Clear the
        // tokens only if it's still the stored one, so a token another
        // refresh rotated in is never thrown away.
        const dead = response.status === 401 || (errorBody && errorBody.error) === 'invalid_grant';
        if (dead) {
          if (store.get('soundcloud_refresh_token') === refreshToken) {
            log.log('🔒 Clearing invalid SoundCloud tokens (refresh token expired or revoked)');
            TOKEN_KEYS.forEach((key) => store.delete(key));
          } else {
            log.log('SoundCloud refresh token was already rotated by another refresh; keeping the stored tokens');
            return storedValidToken();
          }
        }
        return null;
      }

      const data = await response.json();
      const expiresAt = now() + (data.expires_in || DEFAULT_EXPIRES_IN_S) * 1000;
      store.set('soundcloud_token', data.access_token);
      store.set('soundcloud_token_expiry', expiresAt);
      store.set('soundcloud_last_refresh', now());
      if (data.refresh_token) store.set('soundcloud_refresh_token', data.refresh_token);
      log.log('✅ SoundCloud token refreshed. New expiry:', new Date(expiresAt).toISOString());
      return { token: data.access_token, expiresAt };
    } catch (error) {
      log.error('Failed to refresh SoundCloud token:', error && error.message);
      return null;
    }
  };

  const checkToken = async () => {
    const lastRefresh = store.get('soundcloud_last_refresh');
    const proactive = !!lastRefresh && now() - lastRefresh > PROACTIVE_REFRESH_MS;
    const valid = storedValidToken();
    if (valid && !proactive) return valid;

    if (refreshInFlight) return refreshInFlight;
    const refreshToken = store.get('soundcloud_refresh_token');
    if (!refreshToken) return null;

    const reason = valid ? 'proactive refresh (keeping refresh token alive)' : 'token expired';
    // A failed proactive refresh (network, 5xx) still leaves a usable token:
    // hand that back rather than reporting the account signed out.
    refreshInFlight = refresh(refreshToken, reason)
      .then((result) => result || storedValidToken())
      .finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  };

  return { checkToken };
}

module.exports = { createSoundCloudTokenSource, PROACTIVE_REFRESH_MS, TOKEN_KEYS };

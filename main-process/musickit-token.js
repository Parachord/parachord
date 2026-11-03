'use strict';

// Which MusicKit developer token Apple Music gets.
//
// A developer token is a JWT with an `exp`, at most six months out. One
// generated at launch is always fresh, but a token from .env or one saved in
// Settings ages out, and MusicKit refuses an expired one ("Initialized with an
// expired token"): search, previews and the web player stop working while the
// token still looks configured. Expired candidates are skipped, so a fresh
// token further down the list is used instead.

// Pure, and loaded by both processes: the renderer (bundled by esbuild, no
// Buffer under contextIsolation) checks a token saved in Settings with it.
function decodeBase64Url(s) {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64url').toString('utf8');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

// Seconds since the epoch at which `token` expires, or null when it isn't a
// JWT with a numeric `exp` (an opaque token is passed through, not judged).
function tokenExpiry(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch (_e) {
    return null;
  }
}

function isTokenExpired(token, nowMs = Date.now()) {
  const exp = tokenExpiry(token);
  return exp !== null && exp * 1000 <= nowMs;
}

// The first candidate that is set and not expired. `candidates` is
// [{ source, token }] in order of preference; `onSkip(source, expiredAt)` is
// told about each expired one so the caller can log it.
function pickDeveloperToken(candidates, { now = Date.now(), onSkip } = {}) {
  for (const { source, token } of candidates) {
    if (!token) continue;
    if (isTokenExpired(token, now)) {
      if (onSkip) onSkip(source, new Date(tokenExpiry(token) * 1000));
      continue;
    }
    return token;
  }
  return null;
}

module.exports = { tokenExpiry, isTokenExpired, pickDeveloperToken };

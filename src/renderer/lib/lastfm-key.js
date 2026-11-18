// src/renderer/lib/lastfm-key.js: which Last.fm API key a request uses, and
// what happens when Last.fm turns a key down (#1538).
//
// From 1 December 2026 a Last.fm API key works only while the account that
// owns it has Last.fm Pro
// (https://support.last.fm/t/api-keys-will-require-pro-from-1st-december/121030).
// A person can enter their own key and secret in the Last.fm plug-in's
// Advanced settings, and the app uses them in place of its built-in pair. When
// Last.fm refuses that key (error 10, invalid API key, or 26, suspended), the
// app stops using it for the rest of the session, retries the request once
// with the built-in pair and says so once. A refusal of the built-in key
// throws "Last.fm unavailable": never an empty answer a caller could cache as
// a miss (CLAUDE.md "No resolver holds a row").
//
// The ONE place a Last.fm key is chosen. Two integration points use it:
//   - app.js's window.fetch interceptor (installLastfmKeyFallback): every
//     renderer GET to ws.audioscrobbler.com (app.js, the Last.fm plug-in,
//     spinoff-pool, the charts URL from charts-utils) has its api_key set
//     from readPair() and runs through call();
//   - scrobbler-loader.js's LastFmScrobbler (main-process proxyFetch, signed
//     calls): signs with signedPair() and runs through call().
// A key and secret are always switched together as a pair: a signed call
// never mixes the person's key with the built-in secret.
//
// Plain module; loads under plain Node. The session flag lives in memory, so
// it needs no store key, and a relaunch tries the person's key again.

'use strict';

const { userError } = require('./error-copy');

const LASTFM_API_HOST = 'ws.audioscrobbler.com';
// Last.fm's "this key is no good" codes: 10 invalid API key, 26 suspended.
const KEY_REFUSED_CODES = [10, 26];

// The toast, once per session, when the person's own key is turned down.
const OWN_KEY_REFUSED_NOTICE = 'Your own Last.fm API key was turned down, so Parachord is using its own for now. Your key needs Last.fm Pro since 1 December.';
// The same news in the plug-in's Advanced section, while the session flag is set.
const OWN_KEY_REFUSED_HINT = 'Last.fm turned down your API key, so Parachord is using its own for now. Your key needs Last.fm Pro.';
// What a request says when no key Last.fm accepts is left.
const UNAVAILABLE_MESSAGE = 'Last.fm isn’t available right now. Try again later.';

// A Last.fm error code from a parsed reply body, or null.
function lastfmErrorCode(body) {
  if (!body || typeof body !== 'object' || body.error === undefined || body.error === null) return null;
  const code = Number(body.error);
  return Number.isFinite(code) ? code : null;
}

const isKeyRefused = (code) => KEY_REFUSED_CODES.includes(code);

// The thrown "Last.fm unavailable": readable text, and the code for logs.
function lastfmUnavailableError(code) {
  const err = userError(UNAVAILABLE_MESSAGE);
  err.lastfmUnavailable = true;
  err.lastfmError = code;
  return err;
}

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// The session's key state. setOwn / setBuiltin are fed by the app (the
// plug-in's saved settings; main's built-in pair). Everything else reads it.
function createLastfmKeys() {
  let own = { apiKey: null, apiSecret: null };
  let builtin = { apiKey: null, apiSecret: null };
  // The person's key Last.fm turned down this session. A different key saved
  // later is tried afresh; the notice still shows only once.
  let refusedKey = null;
  let noticeGiven = false;
  const listeners = new Set();

  const ownRefused = () => !!own.apiKey && own.apiKey === refusedKey;
  const ownPair = () => ({ apiKey: own.apiKey, apiSecret: own.apiSecret, own: true });
  const builtinPair = () => ({ apiKey: builtin.apiKey, apiSecret: builtin.apiSecret, own: false });

  const keys = {
    setOwn(pair) {
      own = { apiKey: clean(pair && pair.apiKey), apiSecret: clean(pair && pair.apiSecret) };
    },
    // Merges: the key and the secret arrive from separate launch reads.
    setBuiltin(pair) {
      builtin = {
        apiKey: clean(pair && pair.apiKey) || builtin.apiKey,
        apiSecret: clean(pair && pair.apiSecret) || builtin.apiSecret,
      };
    },
    // For a read (api_key only): the person's key if set and not refused.
    readPair() {
      return own.apiKey && !ownRefused() ? ownPair() : builtinPair();
    },
    // For a signed call: the person's key AND secret, or the built-in pair.
    signedPair() {
      return own.apiKey && own.apiSecret && !ownRefused() ? ownPair() : builtinPair();
    },
    apiKey() {
      return keys.readPair().apiKey;
    },
    // A key this app chose (the person's or the built-in one). The fetch
    // interceptor only touches requests made with one of these.
    isKnownKey(key) {
      return !!key && (key === own.apiKey || key === builtin.apiKey);
    },
    // True while the person's saved key is the one turned down this session.
    ownKeyRefused: ownRefused,
    // What a reply made with `pair` means: 'ok' (not a key refusal), 'retry'
    // (the person's key was refused and another key is there to try) or
    // 'unavailable' (no key left that Last.fm hasn't turned down).
    noteReply(pair, code) {
      if (!isKeyRefused(code)) return 'ok';
      if (!pair || !pair.own) return 'unavailable';
      if (pair.apiKey && pair.apiKey === own.apiKey) {
        refusedKey = pair.apiKey;
        if (!noticeGiven) {
          noticeGiven = true;
          for (const cb of Array.from(listeners)) {
            try { cb(); } catch (_e) { /* a listener's failure isn't the request's */ }
          }
        }
      }
      const next = keys.readPair();
      return next.apiKey && next.apiKey !== pair.apiKey ? 'retry' : 'unavailable';
    },
    // Called once per session, at the first refusal of the person's key.
    onFallback(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    // Runs `attempt(pair)` (→ { code, result }) with the chosen pair; on a
    // refusal of the person's key, once more with the built-in pair. Returns
    // the result, or throws lastfmUnavailableError. Never retries twice.
    async call({ signed = false } = {}, attempt) {
      const choose = () => (signed ? keys.signedPair() : keys.readPair());
      let pair = choose();
      for (let tries = 0; ; tries += 1) {
        const { code, result } = await attempt(pair);
        const verdict = keys.noteReply(pair, code);
        if (verdict === 'ok') return result;
        if (verdict === 'retry' && tries === 0) {
          pair = choose();
          continue;
        }
        throw lastfmUnavailableError(code);
      }
    },
  };
  return keys;
}

// A GET to Last.fm's API made with one of our keys, as a URL; else null
// (other hosts, POSTs, Request objects, someone else's key pass through).
function lastfmApiGetUrl(input, init, keys) {
  if (typeof input !== 'string' && !(input && typeof input.href === 'string' && input.searchParams)) return null;
  const method = String((init && init.method) || 'GET').toUpperCase();
  if (method !== 'GET') return null;
  let url;
  try { url = new URL(String(input)); } catch (_e) { return null; }
  if (url.hostname !== LASTFM_API_HOST) return null;
  const key = url.searchParams.get('api_key');
  return keys.isKnownKey(key) ? url : null;
}

// The error code of a refused reply. Last.fm answers a refused key with an
// HTTP error status (403) and a JSON body, so only non-2xx replies are read
// (from a clone: the caller still gets the whole body).
async function replyErrorCode(response) {
  if (!response || response.ok || typeof response.clone !== 'function') return null;
  try {
    return lastfmErrorCode(await response.clone().json());
  } catch (_e) {
    return null;
  }
}

// The fetch wrapper for ws.audioscrobbler.com GETs: the request goes out with
// the session's read key, and a refusal of the person's key retries once with
// the built-in one. Anything else is passed to `fetch` untouched.
function createLastfmFetch({ fetch, keys }) {
  return function lastfmKeyFetch(input, init) {
    const url = lastfmApiGetUrl(input, init, keys);
    if (!url) return fetch(input, init);
    const sentKey = url.searchParams.get('api_key');
    return keys.call({ signed: false }, async (pair) => {
      let target = input;
      if (pair.apiKey && pair.apiKey !== sentKey) {
        url.searchParams.set('api_key', pair.apiKey);
        target = url.toString();
      }
      const response = await fetch(target, init);
      return { code: await replyErrorCode(response), result: response };
    });
  };
}

module.exports = {
  LASTFM_API_HOST,
  KEY_REFUSED_CODES,
  OWN_KEY_REFUSED_NOTICE,
  OWN_KEY_REFUSED_HINT,
  UNAVAILABLE_MESSAGE,
  lastfmErrorCode,
  lastfmUnavailableError,
  createLastfmKeys,
  createLastfmFetch,
  lastfmApiGetUrl,
};

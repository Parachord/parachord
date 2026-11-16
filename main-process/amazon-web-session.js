// main-process/amazon-web-session.js — the ONE host instance behind Amazon
// Music's `persist:amazon-music` partition (#1356 M11, the teardown: the last
// host-side remnant of amazon-web-player.js, which is deleted).
//
// The whole split in one sentence (docs/architecture/web-session.md): the
// PLUGIN owns every piece of Amazon service knowledge — the searches, the
// catalog, the playlist import, the recommendations, the DRM pair, sign-in/
// out, the status read AND the diagnostic capture all live in
// plugins-src/amazonmusic and drive this instance through the
// window.electron.webSession bridge; the HOST supplies the machinery — the
// hidden offscreen view, the request capture, the page-world fetch, the load
// chain, the readers/writer gate, the idle-park fuse, the sign-in window,
// sign-out — and nothing service-specific may grow here. This module is only
// the instance and its config; main.js registers it with the bridge by
// reference (registerWebSession('amazon-music', …)) and wires setHost to the
// app window's lifecycle. Never create a second host for this partition:
// webRequest has a single listener slot per method per session, so two
// instances would silently replace each other's capture listener.
//
// The preload (amazon-player-preload.js, at the repo root) runs in the hidden
// view's page: the media-session hijack + the visibility stub for Amazon's
// pages. The sign-in window gets NO preload (it must behave like a normal
// browser window — web-session.js's rule).

'use strict';

const path = require('path');
const { createWebSessionHost, chromeUserAgent } = require('./web-session');

const PARTITION = 'persist:amazon-music';
const PRELOAD = path.join(__dirname, '..', 'amazon-player-preload.js');

// One owner of the partition (see the header): every view, navigation, gate
// entry, capture registration and sign-in window for Amazon Music flows
// through this single host instance. The timings are the host's defaults
// (warmMs 30 000, loadTimeoutMs 30 000, pageFetchTimeoutMs 12 000) — a flow
// that ever needs a different value passes it explicitly per call.
const webSession = createWebSessionHost({
  id: 'amazon-music',
  partition: PARTITION,
  preload: PRELOAD,
  userAgent: chromeUserAgent(),
  // The auth-cookie hedge (the plugin's amazonAuthCookieState over the
// reported names) reads FEWER cookies than the pre-refactor whole-partition
// read: the host reads cookies.get({ url }) per declared domain, so a
// host-only cookie on some other Amazon host, or one scoped to a path other
// than '/', is no longer seen. The known auth cookies all live on
// `.amazon.com` (at-main, sess-at-main, x-main); music.amazon.com and
// www.amazon.com cover the hosts a host-only auth-shaped rotation could
// land on. state() reports names only; Electron's clear() still wipes the
// whole partition.
  cookieDomains: ['amazon.com', 'music.amazon.com', 'www.amazon.com'],
  // The EXACT hosts the session's data-source primitives may reach (#1432
  // review, finding 1): fetch/pageFetch URLs, every redirect hop and capture
  // prefixes are scoped to this list, which is deliberately much narrower than
  // the cookie domains — amazon.com is the whole retail account, and a
  // session-bearing fetcher scoped only to the cookie domains would read it.
  // Exactly the hosts the flows call, nothing broader: the
  // home/search/dmls/config.json/telemetry host and the gql host. A new host
  // is added to this list deliberately, one entry per service surface — never
  // by widening a domain or falling back to the cookie domains.
  allowedHosts: ['music.amazon.com', 'gql.music.amazon.com'],
  // The visible sign-in window's title (host config, never a caller choice).
  signInTitle: 'Sign in to Amazon Music'
});

module.exports = webSession;

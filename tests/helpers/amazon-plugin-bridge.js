// The Amazon plugin's test scaffolding (#1356 M5): instantiate the .axe the
// way resolver-loader.js does — including the #1402 plugin library
// (implementation._lib materialized and CALLED once, frozen, injected as
// this.lib) — plus window.electron.webSession mocks shaped like the preload
// wrappers (docs/architecture/web-session.md, "The IPC bridge"), so tests
// drive the plugin's own spec-search runner at the same seam the renderer
// does.

const fs = require('fs');
const path = require('path');

function loadAmazonAxe() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../..', 'plugins/amazonmusic.axe'), 'utf8'));
}

// resolver-loader.js's createResolverInstance, distilled: `_lib` is not a
// method — the factory is materialized and invoked exactly once and its
// frozen result is `this.lib` for every method. A test instantiate() that
// skips this makes requireLib throw on every call, so every Amazon plugin
// test goes through here.
function instantiateAmazonPlugin(axeContent) {
  const { manifest, capabilities, implementation } = axeContent;
  const { _lib: libSource, ...methods } = implementation;
  let lib = null;
  if (libSource !== undefined) {
    const factory = new Function('return ' + libSource)();
    if (typeof factory !== 'function') throw new Error('_lib must materialize to a function');
    lib = factory();
    if (!lib || typeof lib !== 'object') throw new Error('_lib must return the library (an object)');
  }
  const resolver = {
    id: manifest.id,
    name: manifest.name,
    capabilities,
    lib: lib ? Object.freeze(lib) : null,
    ...Object.fromEntries(
      Object.entries(methods).map(([k, src]) => [k, new Function('return ' + src)()])
    )
  };
  // Bind `this` the way resolver-loader's _bindContext does so this.search
  // works inside resolve and this.requireLib inside every method.
  for (const key of Object.keys(methods)) {
    const original = resolver[key];
    resolver[key] = function (...args) { return original.call(resolver, ...args); };
  }
  return resolver;
}

// One captured SpecSearchSeeMorePage request body, as the bridge's returned
// captures carry them (headers paired by request id, echo flagged when a
// pageFetch was in flight as the request was seen).
function amazonSearchCapture(searchText, { specType = 'track', echo = false, hash = 'deadbeefhash' } = {}) {
  return {
    url: 'https://gql.music.amazon.com/',
    method: 'POST',
    echo,
    body: JSON.stringify({
      operationName: 'SpecSearchSeeMorePage',
      variables: {
        searchText,
        specType,
        firstLimit: 30,
        isAuthenticated: true,
        audiobooksEnabled: true,
        merchEnabled: true,
        categoryInEntityUnionEnabled: false
      },
      extensions: {
        clientLibrary: { name: '@apollo/client', version: '4.1.6' },
        persistedQuery: { version: 1, sha256Hash: hash }
      }
    }),
    headers: { 'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': '1' }
  };
}

// The SpecSearchSeeMorePage response envelope for given bridge-shaped tracks
// ({ asin, title, artist, album, albumAsin?, duration, albumArt?, explicit? }).
function amazonSpecEnvelope(tracks) {
  return {
    data: {
      specificationSearch: {
        result: [{
          edges: tracks.map((t) => ({
            node: {
              __typename: 'Track',
              id: t.asin,
              title: t.title,
              contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: t.artist } }] },
              album: { id: t.albumAsin || null, shortTitle: t.album || 'Album' },
              duration: t.duration || 0,
              images: t.albumArt
                ? [{ url: t.albumArt, width: 500, height: 500, imageType: 'PRIMARY' }]
                : undefined
            }
          }))
        }]
      }
    }
  };
}

// The album-spec SpecSearchSeeMorePage response envelope for bridge-shaped
// albums ({ asin, name, artist, albumArt?, explicit? }) — the search spec
// carries no releaseDate/trackCount and the response's own node url carries a
// ?ref= tracker, which the mapper drops in favor of the canonical ASIN url.
function amazonAlbumSpecEnvelope(albums) {
  return {
    data: {
      specificationSearch: {
        result: [{
          edges: albums.map((a) => ({
            node: {
              __typename: 'Album',
              id: a.asin,
              title: a.explicit ? a.name + ' [Explicit]' : a.name,
              url: 'https://music.amazon.com/albums/' + a.asin + '?ref=dm_ff_amazonmusic_greenhornet_web',
              contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: a.artist } }] },
              images: a.albumArt
                ? [{ url: a.albumArt, width: 1400, height: 1400, imageType: 'PRIMARY' }]
                : [],
              parentalSettings: a.explicit ? { hasExplicitLanguage: true } : undefined
            }
          }))
        }]
      }
    }
  };
}

// The artist-spec SpecSearchSeeMorePage response envelope for artists shaped
// { asin, name, images: [{ url, width, imageType }] } (the mapper accepts
// only Artist nodes and bare https m.media-amazon.com urls).
function amazonArtistSpecEnvelope(artists) {
  return {
    data: {
      specificationSearch: {
        result: [{
          edges: artists.map((a) => ({
            node: {
              __typename: 'Artist',
              id: a.asin,
              name: a.name,
              images: a.images || []
            }
          }))
        }]
      }
    }
  };
}

// Whether a capture satisfies a doneWhen record — the host's own predicate
// (captureSatisfiesDoneWhen in main-process/web-session.js), mirrored here so
// the mock simulates the host's early stop by the host's rule: header-complete
// (the mock's entries all carry headers), no echo, and every present needle a
// substring of the capture's own field.
function captureSatisfiesDoneWhen(doneWhen, entry) {
  if (!doneWhen || !entry || !entry.headers) return false;
  if (entry.echo) return false;
  if (doneWhen.bodyIncludes && !(typeof entry.body === 'string' && entry.body.includes(doneWhen.bodyIncludes))) return false;
  if (doneWhen.urlIncludes && !(typeof entry.url === 'string' && entry.url.includes(doneWhen.urlIncludes))) return false;
  return true;
}

// The quiet window's end over a request timeline, by the host's own poll
// rules (awaitCaptureQuiet in main-process/web-session.js): walk the requests
// in order — the window is open at a request's atMs when no earlier end has
// been decided, and each CAPTURED request's quietMs pushes the end out, never
// before loadMs (the poll starts after the navigation settles), never past
// loadMs + budgetMs. Zero captured requests → the budget (the cold-view
// rule: a page that has fired nothing has not started).
function quietWindowEnd(loadMs, requests, quietMs, budgetMs) {
  const hardEnd = loadMs + budgetMs;
  let end = null;
  for (const r of [...requests].sort((a, b) => a.atMs - b.atMs)) {
    if (end !== null && r.atMs >= end) break; // the window had already closed — never captured
    end = Math.min(hardEnd, Math.max(loadMs, r.atMs + quietMs));
  }
  return end === null ? hardEnd : end;
}

// A window.electron.webSession mock: the page flow's load answers the flow's
// own searchText out of the URL (the URL builder put it there), and pageFetch
// answers the configured envelope. opts:
//   tracks / envelope — what the search answers (default: no tracks)
//   albums — the album-spec response rows (the albums tab; default none)
//   artists — the artist-spec response rows (the artists tab; default none)
//   replay           — overrides for the pageFetch outcome ({ status, text }
//                      merged after the default), or { error } to fail replays
//   signedIn         — false serves a logged-out cookie jar (default true)
//   viewUrl          — the hidden view's URL (a wall makes the fast path
//                      throw not-signed-in; null/absent means no view)
//   tier             — config.json's tier for the plan gate (default
//                      'UNLIMITED_AUDIO'; 'PRIME' and null are the refusals)
//   capturesFor      — (url, opts) => captures the load returns (default: one
//                      capture carrying the URL's searchText, specType from
//                      the URL's tab)
//   finalUrl         — the load's final URL (a wall redirect)
//   loadResult       — the load's whole outcome ({ success: false, reason } for
//                      the failure paths)
//   captureDelayMs   — the ms after load-finish the page's first capture fires
//                      (default 0): the load returns it only when it fired
//                      BEFORE the quiet window closed (see load below)
//   generation       — the session generation state() carries (default 0;
//                      a bumped value after a sign-out→sign-in drops the
//                      plugin's session-scoped caches)
//   timing           — the host's CLOCK, for a test that measures a flow's
//                      total time (fake timers): { loadMs, requests, finalUrl }.
//                      loadMs is when the page's did-finish-load settles;
//                      requests is [{ atMs, entry }] — the page's gql requests,
//                      at atMs ms after the load START, header-complete at
//                      atMs; finalUrl overrides the load's final URL. The
//                      load sleeps the window's own end by the host's rules
//                      (sleeping past it needs jest.advanceTimersByTimeAsync)
//                      and returns the captures the window saw: a doneWhen
//                      match ends it AT the matching request (the early stop,
//                      before did-finish-load); otherwise the quiet window —
//                      quietMs past the last captured request, never before
//                      loadMs, capped at loadMs + budgetMs; zero requests →
//                      loadMs + budgetMs. The replay's own cost is the
//                      pageFetch override's business (the plugin's call).
function amazonWebSessionMock(opts = {}) {
  const envelope = opts.envelope !== undefined
    ? opts.envelope
    : (opts.albums ? amazonAlbumSpecEnvelope(opts.albums)
      : (opts.artists ? amazonArtistSpecEnvelope(opts.artists)
        : amazonSpecEnvelope(opts.tracks || [])));
  const replayOutcome = Object.assign(
    { status: 200, text: JSON.stringify(envelope) },
    opts.replay || {}
  );
  const capturesFor = opts.capturesFor || ((url) => {
    const m = decodeURIComponent(String(url)).match(/\/search\/(.+)\/(songs|albums|artists)$/);
    if (!m) return [];
    const specType = { songs: 'track', albums: 'album', artists: 'artist' }[m[2]];
    return [amazonSearchCapture(m[1], { specType })];
  });
  const ws = {
    state: jest.fn().mockResolvedValue({
      success: true,
      url: 'viewUrl' in opts ? opts.viewUrl : 'https://music.amazon.com/search/x/songs',
      signInUrl: opts.signInUrl || null,
      cookieNames: opts.signedIn === false
        ? ['session-id', 'ubid-main']
        : ['at-main', 'sess-at-main'],
      generation: 'generation' in opts ? opts.generation : 0
    }),
    fetch: jest.fn().mockResolvedValue(
      opts.configResult !== undefined
        ? opts.configResult
        : { success: true, status: 200, headers: {}, text: JSON.stringify({ tier: 'tier' in opts ? opts.tier : 'UNLIMITED_AUDIO', customerId: 'A1B2' }) }
    ),
    load: jest.fn().mockImplementation(async (id, url, o) => {
      if (id !== 'amazon-music') throw new Error('the plugin must drive its own session id');
      if (opts.loadResult) return opts.loadResult;
      const quietMs = o && o.capture && Number.isFinite(o.capture.quietMs) ? o.capture.quietMs : 1000;
      const budgetMs = o && o.capture && Number.isFinite(o.capture.budgetMs) ? o.capture.budgetMs : 8000;
      const doneWhen = o && o.capture && o.capture.doneWhen;
      // The host's clock (opts.timing): resolve at the window's own end,
      // computed by the host's rules over the request timeline — the early
      // stop at a doneWhen match, else the quiet window / the budget.
      if (opts.timing) {
        const requests = (opts.timing.requests || []).slice().sort((a, b) => a.atMs - b.atMs);
        const quietEnd = quietWindowEnd(opts.timing.loadMs, requests, quietMs, budgetMs);
        const match = doneWhen && requests.find((r) => captureSatisfiesDoneWhen(doneWhen, r.entry));
        const endMs = match && match.atMs < quietEnd ? match.atMs : quietEnd;
        await new Promise((resolve) => setTimeout(resolve, endMs));
        return {
          success: true,
          finalUrl: 'finalUrl' in opts.timing ? opts.timing.finalUrl : url,
          captures: requests.filter((r) => r.atMs <= endMs).map((r) => r.entry)
        };
      }
      // The host's capture-window rules, simulated at the decision point (the
      // host polls in real time; a test computes the same verdict).
      //
      // doneWhen first (rule 5's data-only stop): a header-complete capture
      // satisfying the caller's record ends the window AT that capture — the
      // host checks it on the pairing listener, before did-finish-load
      // included — so the returned captures are everything up to and
      // including the first match; a test's capturesFor list is a timeline,
      // and the entries after the match are the requests the window never
      // saw. A doneWhen nothing satisfies falls through to the quiet rules.
      //
      // The quiet window: a page that has fired NOTHING yet is not quiet —
      // it has not started — so the wait runs to budgetMs for the first
      // request, and closes quietMs after the last one. A page whose first
      // capture fires captureDelayMs after load-finish is inside the
      // returned captures only when it fired before the close
      // (captureDelayMs < max(quietMs, budgetMs)); a request after the close
      // is not among them, exactly the captures: [] the host returns.
      const delayMs = Number.isFinite(opts.captureDelayMs) ? opts.captureDelayMs : 0;
      let captures = delayMs < Math.max(quietMs, budgetMs) ? capturesFor(url, o) : [];
      if (doneWhen && captures.length) {
        const at = captures.findIndex((entry) => captureSatisfiesDoneWhen(doneWhen, entry));
        if (at >= 0) captures = captures.slice(0, at + 1);
      }
      return { success: true, finalUrl: 'finalUrl' in opts ? opts.finalUrl : url, captures };
    }),
    pageFetch: jest.fn().mockImplementation(async (id, request) => {
      if (id !== 'amazon-music') throw new Error('the plugin must drive its own session id');
      if (replayOutcome.error) return { success: true, error: replayOutcome.error };
      return { success: true, status: replayOutcome.status, text: replayOutcome.text };
    }),
    clear: jest.fn().mockResolvedValue({ success: true })
  };
  global.window = { electron: { webSession: ws } };
  return ws;
}

module.exports = {
  loadAmazonAxe,
  instantiateAmazonPlugin,
  amazonSearchCapture,
  amazonSpecEnvelope,
  amazonAlbumSpecEnvelope,
  amazonArtistSpecEnvelope,
  amazonWebSessionMock,
  captureSatisfiesDoneWhen
};

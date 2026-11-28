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

// One captured playlistDetail request body, as the bridge's returned captures
// carry them — the request the playlist page itself fires for OUR playlist id
// (a persisted query / APQ: operationName + variables + a hash, never an
// inline query). playlistPages supplies the paginated responses.
function amazonPlaylistDetailCapture(playlistId, { firstLimit = 100, hash = 'playlisthash', echo = false } = {}) {
  return {
    url: 'https://gql.music.amazon.com/',
    method: 'POST',
    echo,
    body: JSON.stringify({
      operationName: 'playlistDetail',
      variables: { id: playlistId, firstLimit, isAuthenticated: true, includeCollaborators: false },
      extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' }, persistedQuery: { version: 1, sha256Hash: hash } }
    }),
    headers: { 'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': '1', 'music-territory': 'US' }
  };
}

// One playlistDetail response page for bridge-shaped tracks
// ({ asin, title, artist, album, albumAsin?, duration?, albumArt? }): the
// playlist envelope plus a pageInfo whose token is the ONLY continuation the
// server honors (the Relay-style endCursor is the decoy the real server
// answers with page 1 for). pageInfo(null) means no pageInfo at all.
function amazonPlaylistPage(playlist, tracks, pageInfo) {
  const page = {
    data: {
      playlist: {
        id: playlist.id,
        title: playlist.name,
        trackCount: playlist.trackCount != null ? playlist.trackCount : tracks.length,
        images: playlist.albumArt
          ? [{ url: playlist.albumArt, width: 2400, height: 2400, imageType: 'PRIMARY' }]
          : [],
        curator: playlist.owner || null,
        tracks: {
          edges: tracks.map((t, i) => ({
            cursor: t.cursor != null ? String(t.cursor) : `${i}:${t.cursorId || t.asin}`,
            node: {
              id: t.asin,
              title: t.title,
              duration: t.duration || 0,
              contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: t.artist } }] },
              album: { id: t.albumAsin || null, shortTitle: t.album || 'Album' },
              images: t.albumArt ? [{ url: t.albumArt, width: 500, height: 500, imageType: 'PRIMARY' }] : undefined
            }
          }))
        }
      }
    }
  };
  if (pageInfo) page.data.playlist.tracks.pageInfo = pageInfo;
  return page;
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
//   loadTimedOut     — true simulates the navigation budget FIRING (a slow
//                      subresource holds did-finish-load past it); the mock
//                      then answers by the host's OPT-IN rule: a caller that
//                      passed capture.returnOnTimeout gets the held captures
//                      back with { loadTimedOut: true } (rule 5's escape),
//                      every other caller gets the old contract — load-failed
//                      (nothing captured still fails either way — pass
//                      loadResult for that)
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
      const out = { success: true, finalUrl: 'finalUrl' in opts ? opts.finalUrl : url, captures };
      // The host's rule-5 escape, simulated at its decision point and under
      // its OPT-IN rule: the navigation budget ran out with the capture
      // already holding requests, so a caller that passed
      // capture.returnOnTimeout gets them with the flag, and every other
      // caller — the default contract — gets load-failed (a transient
      // refusal its flow already handles, never a structural read).
      if (opts.loadTimedOut) {
        if (o && o.capture && o.capture.returnOnTimeout && captures.length) {
          out.loadTimedOut = true;
        } else {
          return { success: false, reason: 'load-failed', error: 'page did not finish loading within 30000ms: ' + url };
        }
      }
      return out;
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
  amazonPlaylistDetailCapture,
  amazonPlaylistPage,
  amazonWebSessionMock,
  captureSatisfiesDoneWhen,
  amazonMusicHomeCapture,
  amazonMusicHomeData,
  amazonSeeMoreCapture,
  amazonSeeMoreData,
  amazonRecommendationsMock
};

// ── The recommendations fixtures (#1356 M8) ────────────────────────────────

// One captured MusicHomePage / BrowseHomePage request body, as the bridge's
// load returns it (the home page's own request; firstLimit is the page's own
// 5, the walk bumps it). operationName picks the home: 'MusicHomePage' (the
// music tab) or 'BrowseHomePage' (the full home, the #1328 fallback).
function amazonMusicHomeCapture({ operationName = 'MusicHomePage', firstLimit = 5, csrfTs = '2000', echo = false, hash = 'browsehash' } = {}) {
  return {
    url: 'https://gql.music.amazon.com/',
    method: 'POST',
    echo,
    body: JSON.stringify({
      operationName,
      variables: {
        firstLimit,
        recommenderItemLimit: 15,
        type: 'music-home',
        topRecommenderId: 'musicTopOneRecommender',
        isAuthenticated: true,
        audiobooksEnabled: true,
        merchEnabled: true,
        categoryInEntityUnionEnabled: false,
        paginating: false
      },
      extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' }, persistedQuery: { version: 1, sha256Hash: hash } }
    }),
    headers: { 'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': csrfTs }
  };
}

// One MusicHomePage response for given sections ({ id, name, recommendedContent:
// { edges } } nodes; a section node's items are raw gql entity nodes) and the
// connection's pageInfo (hasNextPage + token drive the walk's offset cursor).
// data.t1r is the page's station-mix top row (never mapped) and data.genres
// are navigation chips.
function amazonMusicHomeData(sections, pageInfo = { hasNextPage: false, endCursor: null, token: null }) {
  return {
    data: {
      user: { id: 'u', tier: 'UNLIMITED' },
      t1r: { recommendationConnection: { edges: [{ node: { id: 'uri:///recommendations/music-home/playMusic', parentContainer: { node: { __typename: 'Station', id: 'A1ESXGJW9GSMCX', name: 'My Soundtrack' } }, recommendedContent: { edges: [] } } }] } },
      browse: { recommendationConnection: { edges: sections.map(s => ({ node: s })), pageInfo } },
      genres: []
    }
  };
}

// One captured RecommenderSeeMorePage request body (the see-more route's own
// request). variables.id is the SEE-MORE id (the browse-home prefix even for a
// music-home strategy).
function amazonSeeMoreCapture({ id = 'uri:///recommendations/browse-home/music-home_mp3PrimeAlbumsStrategy', csrfTs = '2000', echo = false, hash = 'seemorehash', afterCursor } = {}) {
  const variables = {
    id,
    firstLimit: 20,
    isAuthenticated: true,
    audiobooksEnabled: true,
    merchEnabled: true,
    categoryInEntityUnionEnabled: false
  };
  if (afterCursor != null) variables.afterCursor = afterCursor;
  return {
    url: 'https://gql.music.amazon.com/',
    method: 'POST',
    echo,
    body: JSON.stringify({
      operationName: 'RecommenderSeeMorePage',
      variables,
      extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' }, persistedQuery: { version: 1, sha256Hash: hash } }
    }),
    headers: { 'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': csrfTs }
  };
}

// One RecommenderSeeMorePage response: the section's one page of items (raw
// gql entity nodes) and its pageInfo (hasNextPage + token = the offset cursor).
function amazonSeeMoreData(items, pageInfo = { hasNextPage: false, endCursor: null, token: null }, title = 'Albums for You') {
  return {
    data: {
      recommender: {
        edges: [{ node: { id: 'uri:///recommendations/browse-home/music-home_mp3PrimeAlbumsStrategy', name: title, recommendedContent: { edges: items.map(node => ({ node })), pageInfo } } }]
      }
    }
  };
}

// The webSession mock for the recommendations flows: every pageFetch answers
// by operationName — homePage(body) for a MusicHomePage / BrowseHomePage walk
// replay, seeMorePage(body) for a RecommenderSeeMorePage replay — and the
// loads answer capturesFor(url) (default: the home flow's own captures: a
// MusicHomePage on the music tab, a BrowseHomePage on the full home, a
// RecommenderSeeMorePage on the see-more route). A responder returns a
// response payload (the full envelope with `data`), or { busy: true } /
// { fetchError } / { status, text } for the failure shapes. Every request
// body the plugin sent is recorded on the mock (ws.sentRequests).
function amazonRecommendationsMock({ homePage, seeMorePage, capturesFor, viewUrl, loadResult, finalUrl, state, signedIn } = {}) {
  const mockOpts = {
    capturesFor: capturesFor || ((url) => {
      const u = String(url);
      if (/\/music$/.test(u)) return [amazonMusicHomeCapture()];
      if (u === 'https://music.amazon.com/') return [amazonMusicHomeCapture({ operationName: 'BrowseHomePage' })];
      const route = /\/browse\/music-items\/home\/recommendation\/([^?]+)/.exec(u);
      if (route) {
        // The capture carries the SEE-MORE id for the strategy in the route
        // URL (the browse-home prefix even for a music-home strategy).
        let strategy;
        try { strategy = decodeURIComponent(route[1]); } catch (e) { strategy = route[1]; }
        return [amazonSeeMoreCapture({ id: 'uri:///recommendations/browse-home/' + strategy })];
      }
      return [];
    }),
    envelope: {}
  };
  if (viewUrl !== undefined) mockOpts.viewUrl = viewUrl;
  if (signedIn !== undefined) mockOpts.signedIn = signedIn;
  if (loadResult !== undefined) mockOpts.loadResult = loadResult;
  if (finalUrl !== undefined) mockOpts.finalUrl = finalUrl;
  const ws = amazonWebSessionMock(mockOpts);
  if (state) ws.state.mockImplementation(state);
  const sentRequests = [];
  ws.pageFetch.mockImplementation(async (id, request) => {
    const body = JSON.parse(request.body);
    sentRequests.push(body);
    let outcome;
    if (body.operationName === 'MusicHomePage' || body.operationName === 'BrowseHomePage') {
      outcome = homePage ? await homePage(body) : { error: 'no homePage responder' };
    } else if (body.operationName === 'RecommenderSeeMorePage') {
      outcome = seeMorePage ? await seeMorePage(body) : { error: 'no seeMorePage responder' };
    } else {
      outcome = { error: 'unexpected operation ' + body.operationName };
    }
    if (outcome && outcome.busy) return { success: true, error: 'busy' };
    if (outcome && outcome.fetchError) return { success: true, error: outcome.fetchError };
    if (outcome && outcome.status) return { success: true, status: outcome.status, text: JSON.stringify(outcome.text || {}) };
    return { success: true, status: 200, text: JSON.stringify(outcome) };
  });
  ws.sentRequests = sentRequests;
  return ws;
}

// ── The bought tracks fixtures (#1494) ─────────────────────────────────────

// The library Purchased page's own LibraryPurchasedPageQuery request, as a
// load captures it (variables as captured 2026-11-21: firstLimit 50,
// isAuthenticated).
function amazonLibraryCapture({ csrfTs = '3000', echo = false, hash = 'purchasedhash' } = {}) {
  return {
    url: 'https://gql.music.amazon.com/',
    method: 'POST',
    echo,
    body: JSON.stringify({
      operationName: 'LibraryPurchasedPageQuery',
      variables: { firstLimit: 50, isAuthenticated: true },
      extensions: { persistedQuery: { version: 1, sha256Hash: hash } }
    }),
    headers: { 'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': csrfTs }
  };
}

// One library song row (#1494): a bought Track has
// purchaseContext.isPurchased true and a library playParams id; a row that
// says false (a liked-only song, the shape the Songs page carries) must never
// count as bought. Both carry the catalog ASIN as the node id, as the live
// Purchased page does.
function amazonLibrarySong({ asin, title, artist, album = 'An Album', albumAsin = 'BALBUM0001', bought = true, duration = 200, cursor }) {
  return {
    cursor: cursor || `c-${asin}`,
    node: {
      __typename: 'Track',
      id: asin,
      title,
      url: `/tracks/${asin}/`,
      duration,
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: artist } }] },
      album: { id: albumAsin, title: album },
      images: [{ url: `https://m.media-amazon.com/images/I/${asin}.jpg`, width: 500, imageType: 'PRIMARY' }],
      purchaseContext: { isPurchased: bought },
      playParams: bought
        ? { id: `mrn:1.0:library:track:objectid:${asin.toLowerCase()}`, selections: ['PLAY', 'SHUFFLE', 'STATION', 'PREVIEW'] }
        : { id: `mrn:1.0:catalog:track:asin:${asin}`, selections: ['STATION', 'PREVIEW'] }
    }
  };
}

// One LibraryPurchasedPageQuery answer, in the live envelope
// (data.user.purchased: edges and pageInfo; endCursor is null there). token is
// the continuation the next page is asked for with (afterCursor).
function amazonLibraryPage(songs, { token = null, hasNextPage = !!token } = {}) {
  return {
    data: {
      user: {
        purchased: {
          edges: songs.map(amazonLibrarySong),
          pageInfo: { hasNextPage, token, endCursor: null, hasPreviousPage: null, startCursor: null, __typename: 'PageInfo' }
        }
      }
    }
  };
}

// Serve the library through a webSession mock: a load of /my/purchases
// captures the page's own LibraryPurchasedPageQuery request, and a replay of it answers the page
// its afterCursor asks for (pages[cursor || 'first']). Other loads and
// replays go to the mock's own handlers. Returns the replayed bodies.
function serveAmazonLibrary(ws, pages, { capture = amazonLibraryCapture() } = {}) {
  const replays = [];
  const load = ws.load.getMockImplementation();
  ws.load.mockImplementation(async (id, url, o) => {
    if (String(url).endsWith('/my/purchases')) {
      return { success: true, finalUrl: url, captures: capture ? [capture] : [] };
    }
    return load(id, url, o);
  });
  const pageFetch = ws.pageFetch.getMockImplementation();
  ws.pageFetch.mockImplementation(async (id, request) => {
    let body = null;
    try { body = JSON.parse(request.body); } catch (e) { /* not ours */ }
    if (body && body.operationName === 'LibraryPurchasedPageQuery') {
      replays.push(body);
      const page = pages[(body.variables && body.variables.afterCursor) || 'first'];
      if (!page) return { success: true, status: 500, text: '{}' };
      return { success: true, status: 200, text: JSON.stringify(page) };
    }
    return pageFetch ? pageFetch(id, request) : { success: true, status: 404, text: '' };
  });
  return replays;
}

module.exports.amazonLibraryCapture = amazonLibraryCapture;
module.exports.amazonLibrarySong = amazonLibrarySong;
module.exports.amazonLibraryPage = amazonLibraryPage;
module.exports.serveAmazonLibrary = serveAmazonLibrary;

// ── The loves fixtures (#1559) ───────────────────────────────────────
// The likes list (LikedSongsPage) and the like mutation (likeTrack), shaped
// as the live web session carries them (live-captured 2026-11-27; see
// plugins-src/amazonmusic/implementation.js "Loves").

// One captured LikedSongsPage request, as the bridge's returned captures
// carry them (the /my/songs page fires it on load).
function amazonLikedSongsCapture({ csrfTs = '3000', echo = false, hash = 'likedhash' } = {}) {
  return {
    url: 'https://gql.music.amazon.com/',
    method: 'POST',
    echo,
    body: JSON.stringify({
      operationName: 'LikedSongsPage',
      variables: { firstLimit: 50, isAuthenticated: true, sortBy: 'name' },
      extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' }, persistedQuery: { version: 1, sha256Hash: hash } }
    }),
    headers: { 'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': csrfTs }
  };
}

// One likes row: a catalog Track node with its like state (the live list
// answers ONLY likes — purchase rows never appear — but a non-LIKE row must
// still not become a love).
function amazonLikedSong({ asin, title, artist, album = 'An Album', albumAsin = 'BALBUM0001', duration = 200, state = 'LIKE', explicitMarker = false } = {}) {
  return {
    node: {
      __typename: 'Track',
      id: asin,
      title: explicitMarker ? `${title} [Explicit]` : title,
      url: `/tracks/${asin}/`,
      duration,
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: artist } }] },
      album: { id: albumAsin, title: album },
      images: [{ url: `https://m.media-amazon.com/images/I/${asin}.jpg`, width: 500, imageType: 'PRIMARY' }],
      likesContext: { state, __typename: 'LikesContext' },
      purchaseContext: { isPurchased: false, __typename: 'PurchaseContext' }
    }
  };
}

// The LikedSongsPage response: data.user.tracks, paged by pageInfo token.
function amazonLikedSongsPage(songs, { token = null, hasNextPage = !!token } = {}) {
  return {
    data: {
      user: {
        tracks: {
          edges: songs,
          pageInfo: { hasNextPage, token, endCursor: null, hasPreviousPage: null, startCursor: null, __typename: 'PageInfo' }
        }
      }
    }
  };
}

// The likeTrack mutation's 200 reply, as the live session answers it.
function amazonLikeTrackReply(asin, state = 'LIKE') {
  return { data: { setTrackLikeState: { track: { __typename: 'Track', id: asin, likesContext: { state, __typename: 'LikesContext' } }, __typename: 'SetUserTrackLikeStateResponse' } } };
}

// Serve the likes flows over a web-session mock: /my/songs loads return the
// page's own LikedSongsPage capture, LikedSongsPage replays answer by
// afterCursor ('first' for the first), and likeTrack mutations answer the
// 200 like reply (opts.likeReplies overrides per call, for failure tests).
function serveAmazonLikes(ws, pages, { likeReplies } = {}) {
  const replays = [];
  const loads = [];
  const load = ws.load.getMockImplementation();
  ws.load.mockImplementation(async (id, url, o) => {
    if (String(url).endsWith('/my/songs')) {
      loads.push({ url, capture: o && o.capture });
      return { success: true, finalUrl: url, captures: [amazonLikedSongsCapture()] };
    }
    return load(id, url, o);
  });
  const pageFetch = ws.pageFetch.getMockImplementation();
  ws.pageFetch.mockImplementation(async (id, request) => {
    let body = null;
    try { body = JSON.parse(request.body); } catch (e) { /* not ours */ }
    if (body && body.operationName === 'LikedSongsPage') {
      replays.push(body);
      const page = pages[(body.variables && body.variables.afterCursor) || 'first'];
      if (!page) return { success: true, status: 500, text: '{}' };
      return { success: true, status: 200, text: JSON.stringify(page) };
    }
    if (body && body.operationName === 'likeTrack') {
      replays.push(body);
      const reply = (likeReplies && likeReplies.length) ? likeReplies.shift() : amazonLikeTrackReply(body.variables && body.variables.trackId);
      if (reply && reply.error) return { success: true, error: reply.error };
      return { success: true, status: (reply && reply.status) || 200, text: JSON.stringify(reply) };
    }
    return pageFetch ? pageFetch(id, request) : { success: true, status: 404, text: '' };
  });
  return { replays, loads };
}

module.exports.amazonLikedSongsCapture = amazonLikedSongsCapture;
module.exports.amazonLikedSong = amazonLikedSong;
module.exports.amazonLikedSongsPage = amazonLikedSongsPage;
module.exports.amazonLikeTrackReply = amazonLikeTrackReply;
module.exports.serveAmazonLikes = serveAmazonLikes;

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
      // The host's quiet window, simulated at the decision point (the host
      // polls in real time; a test computes the same verdict): the window
      // closes quietMs after load-finish with no new captured request, so a
      // page whose first capture fires captureDelayMs after load-finish is
      // inside the returned captures only when it fired before the close
      // (captureDelayMs < quietMs) — a request after the close is not among
      // them, exactly the captures: [] the host returns. The host's
      // DEFAULTS.captureQuietMs (1000) applies when the caller passes none.
      const quietMs = o && o.capture && Number.isFinite(o.capture.quietMs) ? o.capture.quietMs : 1000;
      const delayMs = Number.isFinite(opts.captureDelayMs) ? opts.captureDelayMs : 0;
      const captures = delayMs < quietMs ? capturesFor(url, o) : [];
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
  amazonWebSessionMock
};

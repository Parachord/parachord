/**
 * Plugins that filter their own results before the platform's confidence gate.
 *
 * Subsonic's and Amazon Music's resolve() each pick one result from a search and
 * return null when none passes their own check. The platform never sees what was
 * dropped, so a check narrower than validateResolvedTrack loses a correct match
 * outright. These tests hold each plugin to the gate: for every row of the shared
 * credit vectors, a result reaches the platform exactly when the gate would accept
 * it. An .axe can't import the scorer (each function materializes on its own), so
 * this is what keeps the plugin copies from drifting.
 */

const fs = require('fs');
const path = require('path');
const { ARTIST_CREDIT_VECTORS } = require('../helpers/artist-credit-vectors');
const {
  calculateConfidence,
  MIN_CONFIDENCE_THRESHOLD,
} = require('../../sync-providers/confidence-scoring');

function loadAxe(id) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins/${id}.axe`), 'utf8'));
}

// Builds the resolver the way resolver-loader.js does, the #1402 plugin library
// included (_lib materialized and CALLED once, frozen, injected as this.lib).
// `RegExpImpl` shadows the global RegExp inside the plugin's functions, to
// stand in for another engine.
function instantiate(axe, RegExpImpl = RegExp) {
  const { _lib: libSource, ...methods } = axe.implementation;
  const resolver = { id: axe.manifest.id, lib: null };
  if (libSource !== undefined) {
    const factory = new Function('return ' + libSource)();
    const lib = factory();
    if (!lib || typeof lib !== 'object') throw new Error('_lib must return the library (an object)');
    resolver.lib = Object.freeze(lib);
  }
  for (const [key, src] of Object.entries(methods)) {
    const fn = new Function('RegExp', 'return ' + src)(RegExpImpl);
    resolver[key] = (...args) => fn.apply(resolver, args);
  }
  return resolver;
}

function subsonicResponse(songs) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      'subsonic-response': { status: 'ok', searchResult3: { song: songs } },
    }),
  };
}

function toSong(row, i) {
  return { id: `song-${i}`, title: row.title, artist: row.artist, album: 'Album', duration: 200 };
}

const PLUGINS = {
  subsonic: {
    config: { serverUrl: 'http://navidrome.local:4533', username: 'alice', password: 'sekret' },
    serve(rows) {
      global.window = { crypto: require('crypto').webcrypto };
      global.fetch = jest.fn(async () => subsonicResponse(rows.map(toSong)));
    },
  },
  amazonmusic: {
    config: {},
    // #1356 M5: the plugin's own spec-search runner answers through the
    // window.electron.webSession bridge (signed in, Music Unlimited, and the
    // page flow's load/pageFetch pair serving the rows as a spec envelope).
    serve(rows) {
      const tracks = rows.map((row, i) => ({
        asin: `song-${i}`,
        title: row.title,
        artist: row.artist,
        album: 'Album',
        duration: 200,
      }));
      const envelope = {
        data: {
          specificationSearch: {
            result: [{
              edges: tracks.map((t) => ({
                node: {
                  __typename: 'Track',
                  id: t.asin,
                  title: t.title,
                  contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: t.artist } }] },
                  album: { shortTitle: t.album },
                  duration: t.duration,
                },
              })),
            }],
          },
        },
      };
      const captureFor = (url) => {
        // The flow's own searchText comes out of the URL (the builder put it
        // there) — the matcher keys on variables.searchText.
        const m = decodeURIComponent(String(url)).match(/\/search\/(.+)\/songs$/);
        const searchText = m ? m[1] : '';
        return [{
          url: 'https://gql.music.amazon.com/',
          method: 'POST',
          body: JSON.stringify({
            operationName: 'SpecSearchSeeMorePage',
            variables: { searchText, specType: 'track', firstLimit: 30 },
            extensions: { persistedQuery: { version: 1, sha256Hash: 'hash' } },
          }),
          headers: { 'x-api-key': 'k', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': '1' },
        }];
      };
      global.window = {
        electron: {
          webSession: {
            state: jest.fn().mockResolvedValue({
              success: true,
              url: 'https://music.amazon.com/search/x/songs',
              signInUrl: null,
              cookieNames: ['at-main', 'sess-at-main'],
            }),
            fetch: jest.fn().mockResolvedValue({
              success: true, status: 200, headers: {},
              text: JSON.stringify({ tier: 'UNLIMITED_AUDIO', customerId: 'A1' }),
            }),
            load: jest.fn().mockImplementation(async (_id, url) => ({
              success: true, finalUrl: url, captures: captureFor(url),
            })),
            pageFetch: jest.fn().mockResolvedValue({
              success: true, status: 200, text: JSON.stringify(envelope),
            }),
          },
        },
      };
    },
  },
};

const originalFetch = global.fetch;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.window;
  global.fetch = originalFetch;
});

describe.each(Object.keys(PLUGINS))('%s resolve accepts what the platform gate accepts', (id) => {
  const plugin = PLUGINS[id];
  const axe = loadAxe(id);

  const reachesPlatform = async (target, result) => {
    plugin.serve([result]);
    const hit = await instantiate(axe).resolve(target.artist, target.title, null, plugin.config);
    return !!hit;
  };

  const gateAccepts = (target, result) =>
    calculateConfidence(target, result) >= MIN_CONFIDENCE_THRESHOLD;

  test.each(ARTIST_CREDIT_VECTORS)(
    '%s / %s vs %s / %s',
    async (targetArtist, targetTitle, resultArtist, resultTitle) => {
      const target = { artist: targetArtist, title: targetTitle };
      const result = { artist: resultArtist, title: resultTitle };
      expect(await reachesPlatform(target, result)).toBe(gateAccepts(target, result));
    },
  );

  test.each(ARTIST_CREDIT_VECTORS)(
    'swapped: %s / %s vs %s / %s',
    async (targetArtist, targetTitle, resultArtist, resultTitle) => {
      const target = { artist: resultArtist, title: resultTitle };
      const result = { artist: targetArtist, title: targetTitle };
      expect(await reachesPlatform(target, result)).toBe(gateAccepts(target, result));
    },
  );

  test('finds the credit behind a result with the wrong one', async () => {
    plugin.serve([
      { artist: 'Erykah Badu & Madlib', title: 'Breezy' },
      { artist: 'Erykah Badu & The Alchemist', title: 'Breezy' },
    ]);
    const hit = await instantiate(axe).resolve(
      'Erykah Badu and The Alchemist',
      'Breezy',
      null,
      plugin.config,
    );
    expect(hit.artist).toBe('Erykah Badu & The Alchemist');
  });
});

describe('amazonmusic resolve ranks a differently joined credit like any other', () => {
  const axe = loadAxe('amazonmusic');

  const resolveAmong = async (rows, artist, title) => {
    PLUGINS.amazonmusic.serve(rows);
    return instantiate(axe).resolve(artist, title, null, {});
  };

  test('an exact title under the same credit beats a containing title ranked above it', async () => {
    const hit = await resolveAmong(
      [
        { artist: 'Erykah Badu, The Alchemist', title: 'Breezy Medley' },
        { artist: 'Erykah Badu & The Alchemist', title: 'Breezy' },
      ],
      'Erykah Badu and The Alchemist',
      'Breezy',
    );
    expect(hit.title).toBe('Breezy');
  });

  test('another version under the same credit does not beat the original', async () => {
    const hit = await resolveAmong(
      [
        { artist: 'Erykah Badu & The Alchemist', title: 'Breezy (Live)' },
        { artist: 'Erykah Badu, The Alchemist', title: 'Breezy' },
      ],
      'Erykah Badu and The Alchemist',
      'Breezy',
    );
    expect(hit.title).toBe('Breezy');
  });

  test('a name shared with the credit does not make it the same credit', async () => {
    const hit = await resolveAmong(
      [
        { artist: 'Erykah Badu', title: 'Breezy' },
        { artist: 'Erykah Badu, The Alchemist', title: 'Breezy' },
      ],
      'Erykah Badu and The Alchemist',
      'Breezy',
    );
    expect(hit.artist).toBe('Erykah Badu, The Alchemist');
  });
});

// A self-hosted server's search requires every word of the query (Navidrome ANDs
// its tokens, in both its FTS and legacy backends, after dropping punctuation), so
// a word only the request's credit has finds nothing, and the filter never runs.
describe('subsonic resolve asks a server that requires every query word', () => {
  const axe = loadAxe('subsonic');

  const words = (s) => s.toLowerCase().match(/[^\s,&()[\]."']+/g) || [];

  const serveLibrary = (rows) => {
    global.window = { crypto: require('crypto').webcrypto };
    const queries = [];
    global.fetch = jest.fn(async (url) => {
      const query = decodeURIComponent(new URL(url).searchParams.get('query'));
      queries.push(query);
      const found = rows.filter((row) => {
        const have = words(`${row.artist} ${row.title} ${row.album || ''}`);
        return words(query).every((w) => have.some((h) => h.startsWith(w)));
      });
      return subsonicResponse(found.map(toSong));
    });
    return queries;
  };

  const resolve = (artist, title) =>
    instantiate(axe).resolve(artist, title, null, PLUGINS.subsonic.config);

  test.each([
    ['Erykah Badu and The Alchemist', 'Erykah Badu & The Alchemist'],
    ['Erykah Badu x The Alchemist', 'Erykah Badu & The Alchemist'],
    ['Shakey Graves feat. Sierra Ferrell', 'Shakey Graves, Sierra Ferrell'],
    ['Shakey Graves ft Sierra Ferrell', 'Shakey Graves, Sierra Ferrell'],
    ['Shakey Graves featuring Sierra Ferrell', 'Shakey Graves, Sierra Ferrell'],
    ['Shakey Graves (feat. Sierra Ferrell)', 'Shakey Graves, Sierra Ferrell'],
  ])('asked for %s, finds %s', async (asked, tagged) => {
    serveLibrary([{ artist: tagged, title: 'Song' }]);
    const hit = await resolve(asked, 'Song');
    expect(hit && hit.artist).toBe(tagged);
  });

  test('a credit in the requested title stays out of the query', async () => {
    serveLibrary([{ artist: 'Artist One', title: 'Song (ft. Artist Two)' }]);
    const hit = await resolve('Artist One', 'Song (feat. Artist Two)');
    expect(hit && hit.title).toBe('Song (ft. Artist Two)');
  });

  test('names that contain a join word keep it', async () => {
    const queries = serveLibrary([{ artist: 'Malcolm X', title: 'Song' }]);
    await resolve('Malcolm X', 'Song');
    await resolve('Little Feat', 'Song');
    await resolve('And One', 'Song');
    expect(queries).toEqual(['Malcolm X Song', 'Little Feat Song', 'And One Song']);
  });

  test('a title that is only a credit is still searched for', async () => {
    const queries = serveLibrary([]);
    await resolve('Artist One', '(feat. Artist Two)');
    expect(queries).toEqual(['Artist One (feat. Artist Two)']);
  });

  test('sends the requested spelling, not the folded one the match uses', async () => {
    const queries = serveLibrary([]);
    await resolve('Björk', 'バカンス');
    expect(queries).toEqual(['Björk バカンス']);
  });
});

describe.each(Object.keys(PLUGINS))('%s resolve stays engine-portable', (id) => {
  const plugin = PLUGINS[id];
  const axe = loadAxe(id);

  // An engine without Unicode property escapes.
  function NoPropertyEscapes(pattern, flags) {
    if (/\\p\{/.test(String(pattern))) throw new SyntaxError('Invalid regular expression');
    return new RegExp(pattern, flags);
  }

  test('has no property-escape regex literal, which would stop the function parsing', () => {
    // A single backslash: a literal's \p, not the escaped '\\p' of a guarded string.
    expect(axe.implementation.resolve).not.toMatch(/(?<!\\)\\p\{/);
  });

  test('without property escapes, Latin credits still match', async () => {
    plugin.serve([{ artist: 'Björk & José González', title: 'Song' }]);
    const hit = await instantiate(axe, NoPropertyEscapes).resolve(
      'Bjork and Jose Gonzalez',
      'Song',
      null,
      plugin.config,
    );
    expect(hit && hit.artist).toBe('Björk & José González');
  });

  test('without property escapes, a non-Latin name misses instead of throwing', async () => {
    plugin.serve([{ artist: '椎名林檎', title: '丸の内サディスティック' }]);
    const hit = await instantiate(axe, NoPropertyEscapes).resolve(
      '椎名林檎',
      '丸の内サディスティック',
      null,
      plugin.config,
    );
    expect(hit).toBeNull();
  });

  test('without String.prototype.normalize, it still runs', async () => {
    const { normalize } = String.prototype;
    delete String.prototype.normalize;
    try {
      plugin.serve([{ artist: 'Artist One & Artist Two', title: 'Song' }]);
      const hit = await instantiate(axe).resolve(
        'Artist One and Artist Two',
        'Song',
        null,
        plugin.config,
      );
      expect(hit && hit.artist).toBe('Artist One & Artist Two');
    } finally {
      String.prototype.normalize = normalize;
    }
  });
});

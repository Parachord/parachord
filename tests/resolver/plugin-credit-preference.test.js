/**
 * Plugins that fall back to a top result instead of filtering.
 *
 * Bandcamp's and Apple Music's resolve() always hand the platform something when
 * there are results, and the confidence gate decides. So they can't lose a correct
 * track by refusing it, as Subsonic and Amazon Music could, and the equivalence in
 * plugin-credit-match.test.js doesn't hold for them. They can lose it by choosing:
 * resolve returns one track, so a wrong artist ranked above the right one is what
 * the gate sees, and the gate drops it. These tests hold them to preferring what the
 * gate would accept.
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

// Builds resolve the way resolver-loader.js does, with search stubbed. `RegExpImpl`
// shadows the global RegExp inside the function, to stand in for another engine.
// A stubbed search takes a list of rows, or a function of the query.
function instantiate(id, rows, RegExpImpl = RegExp) {
  const fn = new Function('RegExp', 'return ' + loadAxe(id).implementation.resolve)(RegExpImpl);
  const queries = [];
  const resolver = {
    search: async (query) => {
      queries.push(query);
      return typeof rows === 'function' ? rows(query) : rows;
    },
  };
  return {
    queries,
    resolve: (artist, title, album = null) => fn.call(resolver, artist, title, album, {}),
  };
}

const row = (artist, title) => ({ artist, title });
const gateAccepts = (target, result) =>
  calculateConfidence(target, result) >= MIN_CONFIDENCE_THRESHOLD;

// Refused by the gate for any row of the vectors.
const DECOY = row('Nobody At All', 'Nothing Alike');

// An engine without Unicode property escapes.
function NoPropertyEscapes(pattern, flags) {
  if (/\\p\{/.test(String(pattern))) throw new SyntaxError('Invalid regular expression');
  return new RegExp(pattern, flags);
}

beforeEach(() => {
  global.window = {};
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // Apple Music's album cache expires on a 60s timer, which would hold jest open.
  jest.spyOn(global, 'setTimeout').mockImplementation(() => 0);
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.window;
});

const BREEZY_REQUEST = ['Erykah Badu and The Alchemist', 'Breezy'];

describe.each(['bandcamp', 'applemusic'])('%s resolve prefers what the gate accepts', (id) => {
  test('finds the credit behind a result with the wrong one', async () => {
    const hit = await instantiate(id, [
      row('Erykah Badu & Madlib', 'Breezy'),
      row('Erykah Badu & The Alchemist', 'Breezy'),
    ]).resolve(...BREEZY_REQUEST);
    expect(hit.artist).toBe('Erykah Badu & The Alchemist');
  });

  // The gate's own rules, through the same vectors. Both directions, since the
  // table is symmetric on mobile's side too.
  const bothWays = ARTIST_CREDIT_VECTORS.flatMap(([ta, tt, ra, rt]) => [
    [ta, tt, ra, rt],
    [ra, rt, ta, tt],
  ]);

  test.each(bothWays)(
    'behind a wrong result, %s / %s finds what the gate accepts in %s / %s',
    async (targetArtist, targetTitle, resultArtist, resultTitle) => {
      const target = row(targetArtist, targetTitle);
      const result = row(resultArtist, resultTitle);
      if (!gateAccepts(target, result)) return;
      const hit = await instantiate(id, [DECOY, result]).resolve(targetArtist, targetTitle);
      expect(hit).toBe(result);
    },
  );

  test.each(bothWays)(
    'asked for %s / %s, %s / %s does not beat the requested credit unless the gate accepts it',
    async (targetArtist, targetTitle, resultArtist, resultTitle) => {
      const target = row(targetArtist, targetTitle);
      const result = row(resultArtist, resultTitle);
      if (gateAccepts(target, result)) return;
      const hit = await instantiate(id, [result, target]).resolve(targetArtist, targetTitle);
      expect(hit).toBe(target);
    },
  );

  test('a name shared with the credit does not outrank the credit itself', async () => {
    const hit = await instantiate(id, [
      row('Erykah Badu', 'Breezy'),
      row('Erykah Badu, The Alchemist', 'Breezy'),
    ]).resolve(...BREEZY_REQUEST);
    expect(hit.artist).toBe('Erykah Badu, The Alchemist');
  });

  test('a non-Latin credit behind the wrong one is found', async () => {
    const right = row('椎名林檎, 宇多田ヒカル', '二時間だけのバカンス');
    const hit = await instantiate(id, [row('別の人', '二時間だけのバカンス'), right]).resolve(
      '宇多田ヒカル＆椎名林檎',
      '二時間だけのバカンス',
    );
    expect(hit).toBe(right);
  });

  test('has no property-escape regex literal, which would stop the function parsing', () => {
    // A single backslash: a literal's \p, not the escaped '\\p' of a guarded string.
    expect(loadAxe(id).implementation.resolve).not.toMatch(/(?<!\\)\\p\{/);
  });

  test('without property escapes, Latin credits still match', async () => {
    const right = row('Björk & José González', 'Song');
    const hit = await instantiate(id, [DECOY, right], NoPropertyEscapes).resolve(
      'Bjork and Jose Gonzalez',
      'Song',
    );
    expect(hit).toBe(right);
  });

  test('without property escapes, a non-Latin name falls through to the top result', async () => {
    const top = row('椎名林檎', '丸の内サディスティック');
    const hit = await instantiate(id, [top, row('別の人', '別の曲')], NoPropertyEscapes).resolve(
      '椎名林檎',
      '丸の内サディスティック',
    );
    expect(hit).toBe(top);
  });

  test('without String.prototype.normalize, it still runs', async () => {
    const { normalize } = String.prototype;
    delete String.prototype.normalize;
    try {
      const right = row('Artist One & Artist Two', 'Song');
      const hit = await instantiate(id, [DECOY, right]).resolve('Artist One and Artist Two', 'Song');
      expect(hit).toBe(right);
    } finally {
      String.prototype.normalize = normalize;
    }
  });
});

describe('bandcamp resolve keeps its passes', () => {
  const resolveAmong = (rows, artist, title) => instantiate('bandcamp', rows).resolve(artist, title);

  test('an exact title under the same credit beats a containing title ranked above it', async () => {
    const hit = await resolveAmong(
      [row('Erykah Badu, The Alchemist', 'Breezy Medley'), row('Erykah Badu & The Alchemist', 'Breezy')],
      ...BREEZY_REQUEST,
    );
    expect(hit.title).toBe('Breezy');
  });

  test('another version under the same credit does not beat the original', async () => {
    const hit = await resolveAmong(
      [row('Erykah Badu & The Alchemist', 'Breezy (Live)'), row('Erykah Badu, The Alchemist', 'Breezy')],
      ...BREEZY_REQUEST,
    );
    expect(hit.title).toBe('Breezy');
  });

  test('only another version under the same credit is still no match', async () => {
    const hit = await resolveAmong([row('Erykah Badu & The Alchemist', 'Breezy (Live)')], ...BREEZY_REQUEST);
    expect(hit).toBeNull();
  });

  test('when nothing passes, the top result that is not another version goes to the gate', async () => {
    const hit = await resolveAmong(
      [row('Erykah Badu & Madlib', 'Breezy (Live)'), row('Erykah Badu & Madlib', 'Breezy')],
      ...BREEZY_REQUEST,
    );
    expect(hit.artist).toBe('Erykah Badu & Madlib');
    expect(hit.title).toBe('Breezy');
  });
});

describe('applemusic resolve keeps its fallback and its album cache', () => {
  test('when nothing passes, the top result goes to the gate', async () => {
    const top = row('Erykah Badu & Madlib', 'Breezy');
    const hit = await instantiate('applemusic', [top, DECOY]).resolve(...BREEZY_REQUEST);
    expect(hit).toBe(top);
  });

  test('no results is no match', async () => {
    expect(await instantiate('applemusic', []).resolve(...BREEZY_REQUEST)).toBeNull();
  });

  test('a result containing the request still beats a shorter title the gate would also accept', async () => {
    const hit = await instantiate('applemusic', [
      row('Artist', 'Stay'),
      row('Artist', 'Stay With Me'),
    ]).resolve('Artist', 'Stay With Me');
    expect(hit.title).toBe('Stay With Me');
  });

  test('the album search finds a differently joined credit, with no second search', async () => {
    const right = row('Erykah Badu & The Alchemist', 'Breezy');
    const plugin = instantiate('applemusic', [row('Erykah Badu & Madlib', 'Breezy'), right]);
    const hit = await plugin.resolve(...BREEZY_REQUEST, 'Some Album');
    expect(hit).toBe(right);
    expect(plugin.queries).toEqual(['Erykah Badu and The Alchemist Some Album']);
  });

  test('a second track on the album comes from the cache', async () => {
    const plugin = instantiate('applemusic', [
      row('Erykah Badu & The Alchemist', 'Breezy'),
      row('Erykah Badu & The Alchemist', 'Other'),
    ]);
    await plugin.resolve(...BREEZY_REQUEST, 'Some Album');
    const hit = await plugin.resolve('Erykah Badu and The Alchemist', 'Other', 'Some Album');
    expect(hit.title).toBe('Other');
    expect(plugin.queries).toHaveLength(1);
  });

  test('a shorter title on the album does not stop the search for the requested one', async () => {
    const right = row('Artist', 'Song Part 2');
    const plugin = instantiate('applemusic', (query) =>
      query === 'Artist Album' ? [row('Artist', 'Song')] : [right],
    );
    const hit = await plugin.resolve('Artist', 'Song Part 2', 'Album');
    expect(hit).toBe(right);
    expect(plugin.queries).toEqual(['Artist Album', 'Artist Song Part 2']);
  });

  test('two non-Latin albums do not share a cache entry', async () => {
    const plugin = instantiate('applemusic', (query) =>
      query.includes('一') ? [row('椎名林檎', '曲一')] : [row('宇多田ヒカル', '曲二')],
    );
    await plugin.resolve('椎名林檎', '曲一', '一');
    const hit = await plugin.resolve('宇多田ヒカル', '曲二', '二');
    expect(hit.title).toBe('曲二');
    expect(plugin.queries).toEqual(['椎名林檎 一', '宇多田ヒカル 二']);
  });
});

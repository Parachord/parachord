// Spinoff's pool (#1281). Last.fm has no similar tracks for some of the most
// played songs ("Shape of You" answers an empty list), so below a threshold the
// pool is topped up from the seed artist's similar artists' top tracks.

const {
  MIN_SIMILAR_TRACKS,
  FALLBACK_ARTISTS,
  TOP_TRACKS_PER_ARTIST,
  dealRoundRobin,
  buildSpinoffPool,
  checkSpinoffAvailable,
} = require('../../src/renderer/lib/spinoff-pool');

const NOT_FOUND = { error: 6, message: 'Track not found', links: [] };

// A fake Last.fm: answers by method, records every URL it was asked for.
function fakeLastfm({ similarTracks = [], similarArtists = [], topTracks = {}, fail = [] } = {}) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const method = u.searchParams.get('method');
    if (fail.includes(method)) return null;
    if (method === 'track.getsimilar') {
      if (similarTracks === 'not-found') return NOT_FOUND;
      const limit = Number(u.searchParams.get('limit'));
      return { similartracks: { track: similarTracks.slice(0, limit).map(([artist, name]) => ({ name, match: '0.5', artist: { name: artist } })) } };
    }
    if (method === 'artist.getsimilar') {
      const limit = Number(u.searchParams.get('limit'));
      return { similarartists: { artist: similarArtists.slice(0, limit).map((name, i) => ({ name, match: String(1 - i / 10) })) } };
    }
    if (method === 'artist.gettoptracks') {
      const artist = u.searchParams.get('artist');
      const names = topTracks[artist];
      if (names === undefined) return { error: 6, message: 'The artist you supplied could not be found' };
      return { toptracks: { track: names.slice(0, Number(u.searchParams.get('limit'))).map((name) => ({ name, artist: { name: artist } })) } };
    }
    throw new Error(`unexpected ${method}`);
  };
  return { fetchJson, calls, methods: () => calls.map((c) => new URL(c).searchParams.get('method')) };
}

const seed = { artist: 'Ed Sheeran', title: 'Shape of You' };
const rng = () => 0; // deterministic shuffles
const twenty = Array.from({ length: 20 }, (_, i) => [`Artist ${i}`, `Song ${i}`]);
const artists = ['James Arthur', 'Lewis Capaldi', 'Myles Smith', 'Shawn Mendes', 'James Bay', 'James TW', 'Niall Horan', 'Calum Scott', 'Ninth'];
const tops = Object.fromEntries(artists.map((a) => [a, [`${a} A`, `${a} B`, `${a} C`, `${a} D`]]));

const noRunsBySameArtist = (tracks) => tracks.every((t, i) => i === 0 || t.artist !== tracks[i - 1].artist);

describe('constants', () => {
  test('match the issue', () => {
    expect(MIN_SIMILAR_TRACKS).toBe(5);
    expect(FALLBACK_ARTISTS).toBe(8);
    expect(TOP_TRACKS_PER_ARTIST).toBe(3);
  });
});

describe('dealRoundRobin', () => {
  test('never puts two tracks by the same artist next to each other', () => {
    const groups = ['A', 'B', 'C'].map((artist) => ({ artist, tracks: [1, 2, 3].map((n) => ({ artist, title: `${artist}${n}` })) }));
    for (const r of [() => 0, () => 0.99, () => 0.5, Math.random]) {
      const dealt = dealRoundRobin(groups, r);
      expect(dealt).toHaveLength(9);
      expect(noRunsBySameArtist(dealt)).toBe(true);
    }
  });

  test('uneven groups still deal every track', () => {
    const dealt = dealRoundRobin([
      { artist: 'A', tracks: [{ artist: 'A', title: 'a1' }] },
      { artist: 'B', tracks: [{ artist: 'B', title: 'b1' }, { artist: 'B', title: 'b2' }] },
    ], rng);
    expect(dealt.map((t) => t.title).sort()).toEqual(['a1', 'b1', 'b2']);
  });
});

describe('buildSpinoffPool', () => {
  test('enough similar tracks: one request, no fallback', async () => {
    const lf = fakeLastfm({ similarTracks: twenty });
    const pool = await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed, rng });
    expect(pool.failed).toBe(false);
    expect(pool.usedFallback).toBe(false);
    expect(pool.tracks).toHaveLength(20);
    expect(lf.methods()).toEqual(['track.getsimilar']);
  });

  test('no similar tracks: the pool comes from 8 similar artists, 3 top tracks each', async () => {
    const lf = fakeLastfm({ similarTracks: [], similarArtists: artists, topTracks: tops });
    const pool = await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed, rng });
    expect(pool.usedFallback).toBe(true);
    expect(pool.tracks).toHaveLength(24);
    expect(new Set(pool.tracks.map((t) => t.artist)).size).toBe(8);
    expect(pool.tracks.some((t) => t.artist === 'Ninth')).toBe(false);
    expect(noRunsBySameArtist(pool.tracks)).toBe(true);
    expect(lf.methods().filter((m) => m === 'artist.gettoptracks')).toHaveLength(8);
    const topCall = lf.calls.find((c) => c.includes('artist.gettoptracks'));
    expect(new URL(topCall).searchParams.get('limit')).toBe('3');
  });

  test('a few similar tracks come first, then the top-up', async () => {
    const lf = fakeLastfm({ similarTracks: [['Rag n Bone Man', 'Human'], ['Passenger', 'Let Her Go']], similarArtists: artists, topTracks: tops });
    const pool = await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed, rng });
    expect(pool.usedFallback).toBe(true);
    expect(pool.tracks.slice(0, 2).map((t) => t.title).sort()).toEqual(['Human', 'Let Her Go']);
    expect(pool.tracks).toHaveLength(26);
  });

  test('exactly the threshold does not fall back', async () => {
    const lf = fakeLastfm({ similarTracks: twenty.slice(0, 5), similarArtists: artists, topTracks: tops });
    const pool = await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed, rng });
    expect(pool.usedFallback).toBe(false);
    expect(lf.methods()).toEqual(['track.getsimilar']);
  });

  test('a track Last.fm does not know counts as empty, not as a failure', async () => {
    const lf = fakeLastfm({ similarTracks: 'not-found', similarArtists: artists, topTracks: tops });
    const pool = await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed, rng });
    expect(pool.failed).toBe(false);
    expect(pool.tracks).toHaveLength(24);
  });

  test('a failed similar-tracks request fails the pool without asking anything else', async () => {
    const lf = fakeLastfm({ fail: ['track.getsimilar'], similarArtists: artists, topTracks: tops });
    const pool = await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed, rng });
    expect(pool).toEqual({ tracks: [], failed: true, usedFallback: false });
    expect(lf.methods()).toEqual(['track.getsimilar']);
  });

  test('a failed similar-artists request keeps the similar tracks it had', async () => {
    const lf = fakeLastfm({ similarTracks: [['Passenger', 'Let Her Go']], fail: ['artist.getsimilar'] });
    const pool = await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed, rng });
    expect(pool.failed).toBe(false);
    expect(pool.tracks.map((t) => t.title)).toEqual(['Let Her Go']);
  });

  test('one artist\'s top tracks failing leaves the others', async () => {
    const lf = fakeLastfm({ similarTracks: [], similarArtists: artists, topTracks: { ...tops, 'James Arthur': undefined } });
    const pool = await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed, rng });
    expect(pool.tracks).toHaveLength(21);
    expect(pool.tracks.some((t) => t.artist === 'James Arthur')).toBe(false);
  });

  test('leaves out the seed track and duplicates, however they are spelled', async () => {
    const lf = fakeLastfm({
      similarTracks: [['ed sheeran', 'Shape Of You'], ['Passenger', 'Let Her Go']],
      similarArtists: ['Passenger', 'Ed Sheeran'],
      topTracks: { Passenger: ['Let Her Go', 'Holes'], 'Ed Sheeran': ['Shape of You!', 'Perfect'] },
    });
    const pool = await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed, rng });
    const keys = pool.tracks.map((t) => `${t.artist}|${t.title}`);
    expect(keys).not.toContain('ed sheeran|Shape Of You');
    expect(keys).not.toContain('Ed Sheeran|Shape of You!');
    expect(keys.filter((k) => k.endsWith('Let Her Go'))).toHaveLength(1);
    expect(keys).toEqual(expect.arrayContaining(['Passenger|Holes', 'Ed Sheeran|Perfect']));
  });

  test('every track has the shape the spinoff queue uses', async () => {
    const lf = fakeLastfm({ similarTracks: [], similarArtists: artists, topTracks: tops });
    const { tracks } = await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed, rng });
    for (const t of tracks) {
      expect(typeof t.title).toBe('string');
      expect(typeof t.artist).toBe('string');
      expect(Number.isInteger(t.match)).toBe(true);
      expect(t.source).toBe('lastfm-similar-artist');
    }
  });

  test('a single track instead of a list still parses', async () => {
    const fetchJson = async (url) => (new URL(url).searchParams.get('method') === 'track.getsimilar'
      ? { similartracks: { track: { name: 'Holes', match: '1', artist: { name: 'Passenger' } } } }
      : { similarartists: { artist: [] } });
    const pool = await buildSpinoffPool({ fetchJson, apiKey: 'k', ...seed, rng });
    expect(pool.tracks.map((t) => t.title)).toEqual(['Holes']);
  });

  test('sends the key and encodes names', async () => {
    const lf = fakeLastfm({ similarTracks: twenty });
    await buildSpinoffPool({ fetchJson: lf.fetchJson, apiKey: 'KEY', artist: 'AC/DC', title: 'T.N.T. & more', rng });
    const u = new URL(lf.calls[0]);
    expect(u.searchParams.get('api_key')).toBe('KEY');
    expect(u.searchParams.get('artist')).toBe('AC/DC');
    expect(u.searchParams.get('track')).toBe('T.N.T. & more');
    expect(u.searchParams.get('format')).toBe('json');
  });
});

describe('checkSpinoffAvailable', () => {
  test('a song with similar tracks: one request', async () => {
    const lf = fakeLastfm({ similarTracks: twenty });
    expect(await checkSpinoffAvailable({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed })).toBe(true);
    expect(lf.methods()).toEqual(['track.getsimilar']);
    expect(new URL(lf.calls[0]).searchParams.get('limit')).toBe('1');
  });

  test('no similar tracks but similar artists: available', async () => {
    const lf = fakeLastfm({ similarTracks: [], similarArtists: artists });
    expect(await checkSpinoffAvailable({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed })).toBe(true);
    expect(lf.methods()).toEqual(['track.getsimilar', 'artist.getsimilar']);
    expect(new URL(lf.calls[1]).searchParams.get('limit')).toBe('1');
  });

  test('neither: unavailable', async () => {
    const lf = fakeLastfm({ similarTracks: [], similarArtists: [] });
    expect(await checkSpinoffAvailable({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed })).toBe(false);
  });

  test('a failed request is unavailable and asks nothing more', async () => {
    const lf = fakeLastfm({ fail: ['track.getsimilar'], similarArtists: artists });
    expect(await checkSpinoffAvailable({ fetchJson: lf.fetchJson, apiKey: 'k', ...seed })).toBe(false);
    expect(lf.methods()).toEqual(['track.getsimilar']);
  });

  test('no key or no names: unavailable, no requests', async () => {
    const lf = fakeLastfm({ similarTracks: twenty });
    expect(await checkSpinoffAvailable({ fetchJson: lf.fetchJson, apiKey: '', ...seed })).toBe(false);
    expect(await checkSpinoffAvailable({ fetchJson: lf.fetchJson, apiKey: 'k', artist: 'A', title: '' })).toBe(false);
    expect(lf.calls).toHaveLength(0);
  });
});

describe('wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const engine = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('startSpinoff builds its pool here, and nothing else asks track.getsimilar', () => {
    expect(engine).toContain('const pool = await buildSpinoffPool({');
    expect(engine).toContain('if (pool.failed) {');
    expect(engine).not.toContain('method=track.getsimilar');
    expect(app).not.toContain('method=track.getsimilar');
  });

  test('the Spinoff button asks checkSpinoffAvailable', () => {
    expect(app).toContain('const available = await checkSpinoffAvailable({');
  });
});

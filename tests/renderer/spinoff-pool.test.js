// Spinoff's pool (#1281). Some of the most played songs have no similar tracks
// ("Shape of You" answers an empty list on Last.fm), so below a threshold the
// pool is topped up from the seed artist's similar artists' top tracks. The
// lookups ask every plug-in that names similar music (#1539); their parsing is
// tested with the plug-ins (tests/resolver/similar-music-plugins.test.js).

const {
  MIN_SIMILAR_TRACKS,
  FALLBACK_ARTISTS,
  TOP_TRACKS_PER_ARTIST,
  dealRoundRobin,
  buildSpinoffPool,
  checkSpinoffAvailable,
} = require('../../src/renderer/lib/spinoff-pool');

// Fake plug-in lookups (lib/similar-music.js shapes): answer from tables and
// record every call. `fail` names a lookup that no plug-in answered.
function fakePlugins({ similarTracks = [], similarArtists = [], topTracks = {}, fail = [] } = {}) {
  const calls = [];
  return {
    calls,
    names: () => calls.map((c) => c.name),
    similarTracks: async (q) => {
      calls.push({ name: 'similarTracks', q });
      if (fail.includes('similarTracks')) return { tracks: [], failed: true };
      return { tracks: similarTracks.slice(0, q.limit).map(([artist, title]) => ({ artist, title, match: 50 })), failed: false };
    },
    similarArtists: async (q) => {
      calls.push({ name: 'similarArtists', q });
      if (fail.includes('similarArtists')) return { artists: [], failed: true };
      return { artists: similarArtists.slice(0, q.limit).map((name, i) => ({ name, match: 100 - i * 10 })), failed: false };
    },
    // Like app.js's getArtistTopTracks: [] when it fails or the artist is unknown.
    topTracks: async (name, limit) => {
      calls.push({ name: 'topTracks', q: { name, limit } });
      const titles = topTracks[name];
      return titles === undefined ? [] : titles.slice(0, limit).map((title) => ({ title, artist: name }));
    },
  };
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
  const pool = (fp, extra = {}) => buildSpinoffPool({ similarTracks: fp.similarTracks, similarArtists: fp.similarArtists, topTracks: fp.topTracks, ...seed, rng, ...extra });

  test('enough similar tracks: one lookup, no fallback', async () => {
    const fp = fakePlugins({ similarTracks: twenty });
    const out = await pool(fp);
    expect(out.failed).toBe(false);
    expect(out.usedFallback).toBe(false);
    expect(out.tracks).toHaveLength(20);
    expect(fp.calls).toEqual([{ name: 'similarTracks', q: { artist: seed.artist, title: seed.title, limit: 20 } }]);
  });

  test('no similar tracks: the pool comes from 8 similar artists, 3 top tracks each', async () => {
    const fp = fakePlugins({ similarTracks: [], similarArtists: artists, topTracks: tops });
    const out = await pool(fp);
    expect(out.usedFallback).toBe(true);
    expect(out.tracks).toHaveLength(24);
    expect(new Set(out.tracks.map((t) => t.artist)).size).toBe(8);
    expect(out.tracks.some((t) => t.artist === 'Ninth')).toBe(false);
    expect(noRunsBySameArtist(out.tracks)).toBe(true);
    expect(fp.calls.find((c) => c.name === 'similarArtists').q).toEqual({ name: seed.artist, limit: 8 });
    const tops8 = fp.calls.filter((c) => c.name === 'topTracks');
    expect(tops8).toHaveLength(8);
    expect(tops8[0].q.limit).toBe(3);
  });

  test('a few similar tracks come first, then the top-up', async () => {
    const fp = fakePlugins({ similarTracks: [['Rag n Bone Man', 'Human'], ['Passenger', 'Let Her Go']], similarArtists: artists, topTracks: tops });
    const out = await pool(fp);
    expect(out.usedFallback).toBe(true);
    expect(out.tracks.slice(0, 2).map((t) => t.title).sort()).toEqual(['Human', 'Let Her Go']);
    expect(out.tracks).toHaveLength(26);
  });

  test('exactly the threshold does not fall back', async () => {
    const fp = fakePlugins({ similarTracks: twenty.slice(0, 5), similarArtists: artists, topTracks: tops });
    const out = await pool(fp);
    expect(out.usedFallback).toBe(false);
    expect(fp.names()).toEqual(['similarTracks']);
  });

  test('no plug-in answering similar tracks fails the pool without asking anything else', async () => {
    const fp = fakePlugins({ fail: ['similarTracks'], similarArtists: artists, topTracks: tops });
    expect(await pool(fp)).toEqual({ tracks: [], failed: true, usedFallback: false });
    expect(fp.names()).toEqual(['similarTracks']);
  });

  test('a lookup that throws counts as a failure', async () => {
    const out = await buildSpinoffPool({ similarTracks: async () => { throw new Error('down'); }, ...seed, rng });
    expect(out).toEqual({ tracks: [], failed: true, usedFallback: false });
  });

  test('no similar-artists answer keeps the similar tracks it had', async () => {
    const fp = fakePlugins({ similarTracks: [['Passenger', 'Let Her Go']], fail: ['similarArtists'] });
    const out = await pool(fp);
    expect(out.failed).toBe(false);
    expect(out.tracks.map((t) => t.title)).toEqual(['Let Her Go']);
  });

  test('one artist\'s top tracks failing leaves the others', async () => {
    const fp = fakePlugins({ similarTracks: [], similarArtists: artists, topTracks: { ...tops, 'James Arthur': undefined } });
    const out = await pool(fp);
    expect(out.tracks).toHaveLength(21);
    expect(out.tracks.some((t) => t.artist === 'James Arthur')).toBe(false);
  });

  test('a top-tracks lookup that throws is one empty group', async () => {
    const fp = fakePlugins({ similarTracks: [], similarArtists: artists, topTracks: tops });
    const out = await pool(fp, { topTracks: async (name, limit) => { if (name === 'James Arthur') throw new Error('x'); return fp.topTracks(name, limit); } });
    expect(out.tracks).toHaveLength(21);
  });

  test('leaves out the seed track and duplicates, however they are spelled', async () => {
    const fp = fakePlugins({
      similarTracks: [['ed sheeran', 'Shape Of You'], ['Passenger', 'Let Her Go']],
      similarArtists: ['Passenger', 'Ed Sheeran'],
      topTracks: { Passenger: ['Let Her Go', 'Holes'], 'Ed Sheeran': ['Shape of You!', 'Perfect'] },
    });
    const out = await pool(fp);
    const keys = out.tracks.map((t) => `${t.artist}|${t.title}`);
    expect(keys).not.toContain('ed sheeran|Shape Of You');
    expect(keys).not.toContain('Ed Sheeran|Shape of You!');
    expect(keys.filter((k) => k.endsWith('Let Her Go'))).toHaveLength(1);
    expect(keys).toEqual(expect.arrayContaining(['Passenger|Holes', 'Ed Sheeran|Perfect']));
  });

  test('every track has the shape the spinoff queue uses', async () => {
    const fp = fakePlugins({ similarTracks: [], similarArtists: artists, topTracks: tops });
    const { tracks } = await pool(fp);
    for (const t of tracks) {
      expect(typeof t.title).toBe('string');
      expect(typeof t.artist).toBe('string');
      expect(Number.isInteger(t.match)).toBe(true);
      expect(t.source).toBe('similar-artist');
    }
  });

  test('no lookup or no names: failed, nothing asked', async () => {
    const fp = fakePlugins({ similarTracks: twenty });
    expect((await buildSpinoffPool({ ...seed, rng })).failed).toBe(true);
    expect((await pool(fp, { title: '' })).failed).toBe(true);
    expect(fp.calls).toHaveLength(0);
  });
});

describe('checkSpinoffAvailable', () => {
  const check = (fp, extra = {}) => checkSpinoffAvailable({ similarTracks: fp.similarTracks, similarArtists: fp.similarArtists, ...seed, ...extra });

  test('a song with similar tracks: one lookup, limit 1', async () => {
    const fp = fakePlugins({ similarTracks: twenty });
    expect(await check(fp)).toBe(true);
    expect(fp.calls).toEqual([{ name: 'similarTracks', q: { artist: seed.artist, title: seed.title, limit: 1 } }]);
  });

  test('no similar tracks but similar artists: available', async () => {
    const fp = fakePlugins({ similarTracks: [], similarArtists: artists });
    expect(await check(fp)).toBe(true);
    expect(fp.names()).toEqual(['similarTracks', 'similarArtists']);
    expect(fp.calls[1].q.limit).toBe(1);
  });

  test('neither: unavailable', async () => {
    expect(await check(fakePlugins({ similarTracks: [], similarArtists: [] }))).toBe(false);
  });

  test('no plug-in answering is unavailable and asks nothing more', async () => {
    const fp = fakePlugins({ fail: ['similarTracks'], similarArtists: artists });
    expect(await check(fp)).toBe(false);
    expect(fp.names()).toEqual(['similarTracks']);
  });

  test('no names: unavailable, no lookups', async () => {
    const fp = fakePlugins({ similarTracks: twenty });
    expect(await check(fp, { title: '' })).toBe(false);
    expect(fp.calls).toHaveLength(0);
  });
});

describe('wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const engine = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('startSpinoff builds its pool from the plug-ins, and nothing else asks track.getsimilar', () => {
    expect(engine).toContain('const pool = await buildSpinoffPool({');
    expect(engine).toContain('similarTracks: (q) => findSimilarTracksRef.current(q),');
    expect(engine).toContain('topTracks: (name, limit) => getArtistTopTracks(name, limit),');
    expect(engine).toContain('if (pool.failed) {');
    expect(engine).not.toContain('method=track.getsimilar');
    expect(app).not.toContain('method=track.getsimilar');
  });

  test('the Spinoff button asks checkSpinoffAvailable', () => {
    expect(app).toContain('const available = await checkSpinoffAvailable({');
    expect(app).toContain('similarTracks: findSimilarTracks,');
  });
});

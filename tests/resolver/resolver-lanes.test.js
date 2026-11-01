/**
 * Lanes in the resolver queues (2026-11-01). Track resolution is what matters
 * most, and a play click most of all: covers used to share the resolver,
 * MusicKit and iTunes queues with resolution on equal terms, and a play
 * click's resolve waited behind the page's own rows (an album page queued 42
 * searches at once; a request behind them waited 7.5s).
 *   - priority: the front of the foreground queue (a play click)
 *   - foreground: track resolution (rows on screen, the queue, Search)
 *   - background: covers, which wait behind all of it
 */

const fs = require('fs');
const path = require('path');
const { createLimiter, wrapResolverSearchesWithLimiter, laneRunOptions } = require('../../resolver-limiter');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const hook = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');
const fnBody = (src, marker, end = '\n  };') => {
  const s = src.indexOf(marker);
  expect(s).toBeGreaterThan(-1);
  return src.slice(s, src.indexOf(end, s));
};

describe('createLimiter priority', () => {
  test('a priority job goes ahead of waiting foreground jobs, and they still go before background', async () => {
    const limiter = createLimiter({ name: 't', maxConcurrency: 1, minGapMs: 0, cooldownMs: 0, errorThreshold: 99, isThrottleError: () => false });
    const log = [];
    let release;
    const first = limiter.run(() => new Promise((r) => { release = r; }));
    const jobs = [
      limiter.run(async () => { log.push('bg'); }, { background: true }),
      limiter.run(async () => { log.push('row1'); }),
      limiter.run(async () => { log.push('row2'); }),
      limiter.run(async () => { log.push('click'); }, { priority: true }),
    ];
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([first, ...jobs]);
    expect(log).toEqual(['click', 'row1', 'row2', 'bg']);
  });
});

describe('laneRunOptions and the resolver wrap', () => {
  test('maps config.__lane to limiter options', () => {
    expect(laneRunOptions({ __lane: 'priority' })).toEqual({ priority: true });
    expect(laneRunOptions({ __lane: 'background' })).toEqual({ background: true });
    expect(laneRunOptions({ token: 'x' })).toBeUndefined();
    expect(laneRunOptions(undefined)).toBeUndefined();
  });

  test('a wrapped search runs in the lane its config names', async () => {
    const calls = [];
    const fakeLimiter = { run: (fn, opts) => { calls.push(opts); return fn(); } };
    const r = { id: 'bandcamp', search: async () => ['hit'] };
    wrapResolverSearchesWithLimiter([r], fakeLimiter);
    await r.search('q', { __lane: 'background' });
    await r.search('q', { __lane: 'priority' });
    await r.search('q', {});
    expect(calls).toEqual([{ background: true }, { priority: true }, undefined]);
  });
});

describe('who uses which lane', () => {
  test('a play click resolves in the priority lane (both resolve passes)', () => {
    expect((hook.match(/__lane: 'priority'/g) || []).length).toBe(2);
  });

  test('cover lookups that search resolvers go in the background lane', () => {
    expect(app).toMatch(/searchResolvers\(`\$\{artist\} \$\{album\}`, \{ earlyReturn: true, requireAlbumArt: true, lane: 'background' \}\)/);
    const body = fnBody(app, 'const searchResolvers = async (query, options = {}) => {');
    expect(body).toMatch(/resolver\.search\(query, lane \? \{ \.\.\.config, __lane: lane \} : config\)/);
  });

  test("the cover pipeline's iTunes calls go in iTunes' background lane", () => {
    expect(app).toMatch(/fetchItunes: \(url\) => window\.iTunesRateLimiter\.fetch\(url, \{ background: true \}\)/);
  });

  test('the iTunes limiter serves foreground (and priority) before background', () => {
    const s = app.indexOf('window.iTunesRateLimiter = (() => {');
    const body = app.slice(s, app.indexOf('})();', s));
    expect(body).toMatch(/pendingQueue\.length > 0 \? pendingQueue\.shift\(\) : pendingBackground\.shift\(\)/);
    expect(body).toMatch(/if \(opts && opts\.background\) pendingBackground\.push\(job\);\s*else if \(opts && opts\.priority\) pendingQueue\.unshift\(job\);\s*else pendingQueue\.push\(job\);/);
  });

  test("Apple Music's host hook applies the plugin's lane to the MusicKit and iTunes queues", () => {
    const s = app.indexOf('window.appleMusicSearchWithMusicKit = async (query, storefront = \'us\', limit = 20, opts = {}) => {');
    expect(s).toBeGreaterThan(-1);
    const body = app.slice(s, app.indexOf('\n};\n', s));
    expect(body).toMatch(/window\.nativeMusicKitLimiter\.run\(\s*\(\) => window\.electron\.musicKit\.search\(query, limit\),\s*laneRun\s*\)/);
    expect(body).toMatch(/storefront, laneRun\);/);
  });
});

describe('the Apple Music plugin passes its caller\'s lane on', () => {
  const plugin = require('../../plugins-src/applemusic/implementation');
  afterEach(() => { delete global.window; });

  test('to the host hook', async () => {
    const seen = [];
    global.window = { appleMusicSearchWithMusicKit: async (...args) => { seen.push(args); return []; } };
    await plugin.search('roads portishead', { storefront: 'us', __lane: 'background' });
    expect(seen[0]).toEqual(['roads portishead', 'us', 20, { lane: 'background' }]);
  });

  test('to iTunes when there is no host hook', async () => {
    const seen = [];
    global.window = { iTunesRateLimiter: { fetch: async (url, opts) => { seen.push(opts); return { ok: true, json: async () => ({ results: [] }) }; } } };
    await plugin.search('roads portishead', { storefront: 'us', __lane: 'priority' });
    expect(seen[0]).toEqual({ priority: true });
  });
});

/**
 * createLimiter's backgroundMaxConcurrency: background jobs hold at most that
 * many of the slots, so the rest stay free for foreground jobs. The MusicBrainz
 * limiter runs two slots with one reserved: a click never waits for a slow
 * background request that has already started (an artist page's lookup sat 4s
 * behind a cover search, 2026-11-01), while minGapMs still spaces every start.
 */

const { createLimiter } = require('../../resolver-limiter');

const makeLimiter = (opts = {}) => createLimiter({
  name: 't', maxConcurrency: 2, backgroundMaxConcurrency: 1, minGapMs: 1000,
  cooldownMs: 0, errorThreshold: 99, isThrottleError: () => false, ...opts,
});

// A job that records its start and finishes when released.
const held = (log, tag) => {
  let release;
  const fn = () => { log.push(tag); return new Promise((r) => { release = r; }); };
  return { fn, release: (v) => release(v) };
};

describe('createLimiter foreground slot', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('a foreground job starts while a slow background job runs, one gap later', async () => {
    const limiter = makeLimiter();
    const log = [];
    const bg = held(log, 'bg');
    const fg = held(log, 'fg');
    limiter.run(bg.fn, { background: true });
    await jest.advanceTimersByTimeAsync(0);
    limiter.run(fg.fn);
    await jest.advanceTimersByTimeAsync(999);
    expect(log).toEqual(['bg']); // the gap still applies
    await jest.advanceTimersByTimeAsync(1);
    expect(log).toEqual(['bg', 'fg']); // started while bg is still running
    expect(limiter.getInFlight()).toBe(2);
    bg.release(); fg.release();
  });

  test('background jobs never hold the second slot', async () => {
    const limiter = makeLimiter();
    const log = [];
    const a = held(log, 'bg1');
    limiter.run(a.fn, { background: true });
    limiter.run(held(log, 'bg2').fn, { background: true });
    await jest.advanceTimersByTimeAsync(5000);
    expect(log).toEqual(['bg1']);
    expect(limiter.getBackgroundQueueLength()).toBe(1);
    a.release();
    await jest.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['bg1', 'bg2']); // the next one starts when the first ends
  });

  test('foreground jobs may use both slots, still spaced by the gap', async () => {
    const limiter = makeLimiter();
    const log = [];
    const one = held(log, 'fg1');
    const two = held(log, 'fg2');
    limiter.run(one.fn);
    limiter.run(two.fn);
    limiter.run(held(log, 'fg3').fn);
    await jest.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['fg1']);
    await jest.advanceTimersByTimeAsync(1000);
    expect(log).toEqual(['fg1', 'fg2']);
    await jest.advanceTimersByTimeAsync(5000);
    expect(log).toEqual(['fg1', 'fg2']); // two in flight is the cap
    one.release();
    await jest.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['fg1', 'fg2', 'fg3']);
  });

  test('a waiting foreground job still goes before waiting background jobs', async () => {
    const limiter = makeLimiter({ maxConcurrency: 1, backgroundMaxConcurrency: 1, minGapMs: 0 });
    const log = [];
    const first = held(log, 'first');
    limiter.run(first.fn);
    limiter.run(async () => { log.push('bg'); }, { background: true });
    limiter.run(async () => { log.push('fg'); });
    await jest.advanceTimersByTimeAsync(0);
    first.release();
    await jest.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['first', 'fg', 'bg']);
  });

  test('without the option, background jobs may use every slot (other limiters unchanged)', async () => {
    const limiter = createLimiter({
      name: 't', maxConcurrency: 2, minGapMs: 0, cooldownMs: 0, errorThreshold: 99, isThrottleError: () => false,
    });
    const log = [];
    limiter.run(held(log, 'bg1').fn, { background: true });
    limiter.run(held(log, 'bg2').fn, { background: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['bg1', 'bg2']);
  });
});

test('the MusicBrainz limiter keeps a slot for the foreground', () => {
  const app = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const s = app.indexOf('window.musicbrainzLimiter = window.createLimiter({');
  const config = app.slice(s, app.indexOf('});', s));
  expect(config).toMatch(/maxConcurrency: 2,/);
  expect(config).toMatch(/backgroundMaxConcurrency: 1,/);
  expect(config).toMatch(/minGapMs: 1100,/);
});

test('a priority job (a play click) still goes first with background jobs capped', async () => {
  const limiter = createLimiter({ name: 't', maxConcurrency: 2, backgroundMaxConcurrency: 1, minGapMs: 0, cooldownMs: 0, errorThreshold: 99, isThrottleError: () => false });
  const log = [];
  let releaseA; let releaseB;
  const a = limiter.run(() => new Promise((r) => { releaseA = r; }));
  const b = limiter.run(() => new Promise((r) => { releaseB = r; }));
  const rest = [
    limiter.run(async () => { log.push('bg'); }, { background: true }),
    limiter.run(async () => { log.push('row'); }),
    limiter.run(async () => { log.push('click'); }, { priority: true }),
  ];
  await new Promise((r) => setTimeout(r, 0));
  releaseA(); releaseB();
  await Promise.all([a, b, ...rest]);
  expect(log.slice(0, 2)).toEqual(['click', 'row']);
  expect(log[2]).toBe('bg');
});

/**
 * The Amazon search view's job queue (createLaneQueue in amazon-music-logic.js,
 * enqueueSearch in amazon-web-player.js). One job at a time; a foreground job
 * (a playlist the user opened) starts before every queued background job
 * (artist photos, recommendations, catalog fallbacks); FIFO within a lane; a
 * running job is never interrupted; a throwing job rejects only itself.
 */

const { createLaneQueue } = require('../../amazon-music-logic');
const amazonWebPlayer = require('../../amazon-web-player');

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const flush = () => new Promise((r) => setImmediate(r));

describe('createLaneQueue', () => {
  test('runs one job at a time, FIFO in the background lane', async () => {
    const q = createLaneQueue();
    const order = [];
    const gate = deferred();
    const a = q.run(async () => { order.push('a:start'); await gate.promise; order.push('a:end'); return 'a'; });
    const b = q.run(async () => { order.push('b'); return 'b'; });
    const c = q.run(async () => { order.push('c'); return 'c'; });
    await flush();
    expect(order).toEqual(['a:start']);
    expect(q.isRunning()).toBe(true);
    expect(q.pending()).toEqual({ foreground: 0, background: 2 });
    gate.resolve();
    expect(await Promise.all([a, b, c])).toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['a:start', 'a:end', 'b', 'c']);
    expect(q.isRunning()).toBe(false);
  });

  test('a foreground job starts before every queued background job, after the running one', async () => {
    const q = createLaneQueue();
    const order = [];
    const gate = deferred();
    const running = q.run(async () => { order.push('running'); await gate.promise; });
    const bg1 = q.run(async () => { order.push('bg1'); });
    const bg2 = q.run(async () => { order.push('bg2'); });
    const fg1 = q.run(async () => { order.push('fg1'); }, { lane: 'foreground' });
    const fg2 = q.run(async () => { order.push('fg2'); }, { lane: 'foreground' });
    await flush();
    expect(order).toEqual(['running']); // never interrupted
    gate.resolve();
    await Promise.all([running, bg1, bg2, fg1, fg2]);
    expect(order).toEqual(['running', 'fg1', 'fg2', 'bg1', 'bg2']);
  });

  test('a job that throws rejects only itself; the queue moves on', async () => {
    const q = createLaneQueue();
    const bad = q.run(async () => { throw new Error('boom'); });
    const sync = q.run(() => { throw new Error('sync boom'); });
    const good = q.run(async () => 'ok');
    await expect(bad).rejects.toThrow('boom');
    await expect(sync).rejects.toThrow('sync boom');
    await expect(good).resolves.toBe('ok');
  });

  test('an unknown lane is background', async () => {
    const q = createLaneQueue();
    const gate = deferred();
    q.run(() => gate.promise);
    q.run(async () => {}, { lane: 'priority' });
    await flush();
    expect(q.pending()).toEqual({ foreground: 0, background: 1 });
    gate.resolve();
  });
});

describe('enqueueSearch lanes', () => {
  let saved;
  beforeEach(() => {
    saved = amazonWebPlayer.searchQueue;
    amazonWebPlayer.searchQueue = createLaneQueue();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    amazonWebPlayer.searchQueue = saved;
    console.log.mockRestore();
  });

  test('a playlist lookup goes ahead of queued background work', async () => {
    const order = [];
    const gate = deferred();
    const running = amazonWebPlayer.enqueueSearch(async () => { order.push('recommendations'); await gate.promise; });
    const photo1 = amazonWebPlayer.enqueueSearch(async () => { order.push('photo1'); });
    const photo2 = amazonWebPlayer.enqueueSearch(async () => { order.push('photo2'); });
    const playlist = amazonWebPlayer.enqueueSearch(async () => { order.push('playlist'); return 'tracks'; }, { lane: 'foreground' });
    expect(console.log).toHaveBeenCalledWith('[Amazon] search queue: foreground job goes ahead of 2 queued background job(s)');
    gate.resolve();
    await Promise.all([running, photo1, photo2]);
    expect(await playlist).toBe('tracks');
    expect(order).toEqual(['recommendations', 'playlist', 'photo1', 'photo2']);
  });

  test('every job holds searchViewBusy while it runs, and releases it on throw', async () => {
    const before = amazonWebPlayer.searchViewBusy;
    let during = null;
    await amazonWebPlayer.enqueueSearch(async () => { during = amazonWebPlayer.searchViewBusy; });
    await expect(amazonWebPlayer.enqueueSearch(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(during).toBe(before + 1);
    expect(amazonWebPlayer.searchViewBusy).toBe(before);
  });

  test('lookupPlaylist uses the foreground lane', async () => {
    const spy = jest.spyOn(amazonWebPlayer, 'enqueueSearch').mockResolvedValue(null);
    const signed = jest.spyOn(amazonWebPlayer, 'isSignedIn').mockResolvedValue(true);
    await amazonWebPlayer.lookupPlaylist('https://music.amazon.com/user-playlists/d1670975fc554eed80edd41f03d355f4sune');
    expect(spy).toHaveBeenCalledWith(expect.any(Function), { lane: 'foreground' });
    spy.mockRestore();
    signed.mockRestore();
  });
});

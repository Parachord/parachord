/**
 * The host's load chain in two lanes (createLaneQueue + enqueue(fn, { lane })
 * in main-process/web-session.js). One job at a time; a foreground job starts
 * before every queued background job (the plugin's page flows — artist
 * photos, recommendations, catalog fallbacks — ride the bridge's background
 * lane); FIFO within a lane; a running job is never interrupted; a throwing
 * job rejects only itself. The lanes live on webSession since the one-owner
 * step (#1356). The plugin's page flows reach the chain through the bridge's
 * load since the session move (#1356 M10 — the Amazon wrapper enqueueSearch
 * died with the host's remaining plugin flows; the bridge's load, the session
 * mint and the diagnostic capture are the host-side riders now); the plugin's
 * own two-lane queue (its mirror of these semantics) and its foreground
 * playlist lookup are pinned in tests/resolver/amazon-music-plugin-playlist.test.js.
 * The host instance the enqueue lanes below drive has lived in
 * main-process/amazon-web-session.js since the teardown (#1356 M11 deleted
 * amazon-web-player.js, its previous owner).
 */

const amazonWebSession = require('../../main-process/amazon-web-session');
const { createLaneQueue } = require('../../main-process/web-session');

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

describe('enqueue lanes (the host chain under Amazon)', () => {
  let savedChain;
  beforeEach(() => {
    savedChain = amazonWebSession._chain;
    amazonWebSession._chain = createLaneQueue();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    amazonWebSession._chain = savedChain;
    console.log.mockRestore();
  });

  test('a playlist lookup goes ahead of queued background work', async () => {
    const order = [];
    const gate = deferred();
    const running = amazonWebSession.enqueue(async () => { order.push('recommendations'); await gate.promise; });
    const photo1 = amazonWebSession.enqueue(async () => { order.push('photo1'); });
    const photo2 = amazonWebSession.enqueue(async () => { order.push('photo2'); });
    const playlist = amazonWebSession.enqueue(async () => { order.push('playlist'); return 'tracks'; }, { lane: 'foreground' });
    expect(console.log).toHaveBeenCalledWith('[web-session amazon-music] foreground job goes ahead of 2 queued background job(s)');
    gate.resolve();
    await Promise.all([running, photo1, photo2]);
    expect(await playlist).toBe('tracks');
    expect(order).toEqual(['recommendations', 'playlist', 'photo1', 'photo2']);
  });

  test('every job holds the host busy count while it runs, and releases it on throw', async () => {
    const before = amazonWebSession._chainBusy;
    let during = null;
    await amazonWebSession.enqueue(async () => { during = amazonWebSession._chainBusy; });
    await expect(amazonWebSession.enqueue(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(during).toBe(before + 1);
    expect(amazonWebSession._chainBusy).toBe(before);
  });
});

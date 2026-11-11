/**
 * src/renderer/lib/debounced-saver.js: the trigger that saves the
 * track-sources cache soon after resolutions (instead of only on the 5-minute
 * timer, which lost every track resolved in a shorter session).
 */

const { createDebouncedSaver } = require('../../src/renderer/lib/debounced-saver');

describe('createDebouncedSaver', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const make = (opts = {}) => {
    const save = jest.fn().mockResolvedValue(undefined);
    const saver = createDebouncedSaver({ save, delayMs: 15000, maxWaitMs: 60000, ...opts });
    return { save, saver };
  };

  test('nothing changed: never saves', async () => {
    const { save } = make();
    await jest.advanceTimersByTimeAsync(120000);
    expect(save).not.toHaveBeenCalled();
  });

  test('saves once, delayMs after the last change of a burst', async () => {
    const { save, saver } = make();
    saver.markDirty();
    await jest.advanceTimersByTimeAsync(10000);
    saver.markDirty();
    await jest.advanceTimersByTimeAsync(10000);
    saver.markDirty();
    await jest.advanceTimersByTimeAsync(14999);
    expect(save).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.isDirty()).toBe(false);
  });

  test('a page that keeps changing is still saved by maxWaitMs after the first change', async () => {
    const { save, saver } = make();
    for (let t = 0; t < 59000; t += 5000) {
      saver.markDirty();
      await jest.advanceTimersByTimeAsync(5000);
    }
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('canSave false (the cache has not loaded from disk yet): no save until it is true', async () => {
    let loaded = false;
    const { save, saver } = make({ canSave: () => loaded });
    saver.markDirty();
    await jest.advanceTimersByTimeAsync(90000);
    expect(save).not.toHaveBeenCalled();
    expect(saver.isDirty()).toBe(true);
    loaded = true;
    await jest.advanceTimersByTimeAsync(15000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('a failed save stays pending and retries', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const onError = jest.fn();
    const saver = createDebouncedSaver({ save, delayMs: 15000, maxWaitMs: 60000, onError });
    saver.markDirty();
    await jest.advanceTimersByTimeAsync(15000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(saver.isDirty()).toBe(true);
    await jest.advanceTimersByTimeAsync(15000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(saver.isDirty()).toBe(false);
  });

  test('a change during a save is saved afterwards, not lost', async () => {
    let finish;
    const save = jest.fn()
      .mockImplementationOnce(() => new Promise(r => { finish = r; }))
      .mockResolvedValue(undefined);
    const saver = createDebouncedSaver({ save, delayMs: 15000, maxWaitMs: 60000 });
    saver.markDirty();
    await jest.advanceTimersByTimeAsync(15000);
    expect(save).toHaveBeenCalledTimes(1);
    saver.markDirty(); // while the first save is still writing
    finish();
    await jest.advanceTimersByTimeAsync(15000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(saver.isDirty()).toBe(false);
  });

  test('flush saves pending changes at once; cancel drops them', async () => {
    const { save, saver } = make();
    saver.markDirty();
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    saver.markDirty();
    saver.cancel();
    await jest.advanceTimersByTimeAsync(120000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

// The measured-bitrate meter behind the shared players' streamQuality
// records (the root stream-quality.js contract). Pure: decoded audio bytes
// sampled against media time, reduced to a running median of short windows.
const { createStreamBitrateMeter } = require('../../src/renderer/lib/stream-bitrate-meter');

// 320 kbps = 40,000 bytes/s = 80,000 bytes per 2s window.
const BYTES_PER_SEC_320 = 40000;

function feed320(meter, from, to) {
  let estimate = null;
  for (let t = from; t <= to; t += 1) {
    estimate = meter.sample(t, t * BYTES_PER_SEC_320);
  }
  return estimate;
}

describe('createStreamBitrateMeter', () => {
  test('no estimate before enough windows have closed', () => {
    const meter = createStreamBitrateMeter();
    expect(meter.sample(0, 0)).toBeNull();
    expect(meter.sample(2, BYTES_PER_SEC_320 * 2)).toBeNull(); // 1 window
    expect(meter.sample(4, BYTES_PER_SEC_320 * 4)).toBeNull(); // 2 windows
    // 3rd window closes: the median exists.
    expect(meter.sample(6, BYTES_PER_SEC_320 * 6)).toBe(320);
  });

  test('computes kbps from the window ratio', () => {
    const meter = createStreamBitrateMeter();
    // 128 kbps = 16,000 bytes/s.
    meter.sample(0, 0);
    meter.sample(2, 32000);
    meter.sample(4, 64000);
    expect(meter.sample(6, 96000)).toBe(128);
  });

  test('sub-window samples do not close a window early', () => {
    const meter = createStreamBitrateMeter();
    meter.sample(0, 0);
    meter.sample(0.5, BYTES_PER_SEC_320 * 0.5);
    meter.sample(1.9, BYTES_PER_SEC_320 * 1.9);
    expect(meter.estimate()).toBeNull(); // still one open window
  });

  test('the median absorbs a decode-ahead burst and seeks', () => {
    const meter = createStreamBitrateMeter();
    meter.sample(0, 0);
    // Window 1: the load-time decode-ahead burst inflates it (6s worth of
    // audio decoded inside the first 2s of media time).
    meter.sample(2, 240000);
    // Windows 2 and 3: settled playback.
    meter.sample(4, 320000);
    meter.sample(6, 400500);
    // [ 960, 320, 322 ] -> median 322, not the burst.
    expect(meter.estimate()).toBe(322);
  });

  test('the decoded counter going backwards restarts the meter (new load)', () => {
    const meter = createStreamBitrateMeter();
    meter.sample(0, 0);
    meter.sample(2, BYTES_PER_SEC_320 * 2);
    meter.sample(4, BYTES_PER_SEC_320 * 4);
    expect(meter.sample(6, BYTES_PER_SEC_320 * 6)).toBe(320);
    // A new track on the same element: the byte counter restarts.
    expect(meter.sample(0.2, 5000)).toBeNull();
    expect(meter.estimate()).toBeNull();
    meter.sample(2.2, 5000 + BYTES_PER_SEC_320 * 2);
    meter.sample(4.2, 5000 + BYTES_PER_SEC_320 * 4);
    expect(meter.sample(6.2, 5000 + BYTES_PER_SEC_320 * 6)).toBe(320);
  });

  test('media time going backwards restarts the meter', () => {
    const meter = createStreamBitrateMeter();
    meter.sample(0, 0);
    meter.sample(2, BYTES_PER_SEC_320 * 2);
    meter.sample(4, BYTES_PER_SEC_320 * 4);
    expect(meter.sample(6, BYTES_PER_SEC_320 * 6)).toBe(320);
    // A seek back to 0 mid-window: time regressed.
    expect(meter.sample(0.5, BYTES_PER_SEC_320 * 7)).toBeNull();
    expect(meter.estimate()).toBeNull();
  });

  test('a window far longer than the cadence is dropped, not rated', () => {
    const meter = createStreamBitrateMeter();
    meter.sample(0, 0);
    // A seek forward (or a long stall between samples): dt is 600s.
    expect(meter.sample(600, BYTES_PER_SEC_320 * 700)).toBeNull();
    // The anchor advanced, so the NEXT window still measures cleanly.
    meter.sample(602, BYTES_PER_SEC_320 * 700 + BYTES_PER_SEC_320 * 2);
    meter.sample(604, BYTES_PER_SEC_320 * 700 + BYTES_PER_SEC_320 * 4);
    expect(meter.sample(606, BYTES_PER_SEC_320 * 700 + BYTES_PER_SEC_320 * 6)).toBe(320);
  });

  test('a window that decoded nothing does not poison the median with 0', () => {
    const meter = createStreamBitrateMeter();
    meter.sample(0, 0);
    meter.sample(2, BYTES_PER_SEC_320 * 2);
    meter.sample(4, BYTES_PER_SEC_320 * 4);
    expect(meter.sample(6, BYTES_PER_SEC_320 * 6)).toBe(320);
    // A decode stall: 2 more seconds of media time, no bytes decoded.
    meter.sample(8, BYTES_PER_SEC_320 * 6);
    expect(meter.estimate()).toBe(320);
  });

  test('the median follows the last keepWindows windows', () => {
    const meter = createStreamBitrateMeter({ keepWindows: 4, minWindows: 2 });
    // 100 kbps = 12,500 bytes/s; 500 kbps = 62,500 bytes/s.
    let t = 0;
    let bytes = 0;
    const rate = (kbps) => {
      for (let w = 0; w < 2; w += 1) {
        t += 2;
        bytes += (kbps * 1000 / 8) * 2;
        meter.sample(t, bytes);
      }
    };
    rate(100);
    rate(100);
    expect(meter.estimate()).toBe(100);
    rate(500);
    // [100, 100, 500, 500] -> 300
    expect(meter.estimate()).toBe(300);
    rate(500);
    rate(500);
    // [500, 500, 500, 500] (the 100s slid out)
    expect(meter.estimate()).toBe(500);
  });

  test('reset empties the meter', () => {
    const meter = createStreamBitrateMeter();
    feed320(meter, 0, 6);
    expect(meter.estimate()).toBe(320);
    meter.reset();
    expect(meter.estimate()).toBeNull();
    expect(meter.sample(2, BYTES_PER_SEC_320 * 2)).toBeNull(); // fresh meter, 1 window
  });

  test('rejects nonsense samples', () => {
    const meter = createStreamBitrateMeter();
    expect(meter.sample(-1, 100)).toBeNull();
    expect(meter.sample(1, -1)).toBeNull();
    expect(meter.sample(NaN, 100)).toBeNull();
    expect(meter.sample(1, Infinity)).toBeNull();
    expect(meter.sample('2', 100)).toBeNull();
    expect(meter.sample(1, '100')).toBeNull();
    expect(meter.estimate()).toBeNull();
  });
});

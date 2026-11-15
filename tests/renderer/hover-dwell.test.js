const { hoverDwell } = require('../../src/renderer/lib/hover-dwell');

describe('hoverDwell', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('runs after a 250ms rest, not on a pass', () => {
    const fn = jest.fn();
    const el = {};
    const h = hoverDwell(fn);
    h.onMouseEnter({ currentTarget: el });
    jest.advanceTimersByTime(200);
    h.onMouseLeave({ currentTarget: el });
    jest.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    h.onMouseEnter({ currentTarget: el });
    jest.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a re-render between enter and leave still cancels (the timer lives on the element)', () => {
    const fn = jest.fn();
    const el = {};
    hoverDwell(fn).onMouseEnter({ currentTarget: el });
    hoverDwell(fn).onMouseLeave({ currentTarget: el });
    jest.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});

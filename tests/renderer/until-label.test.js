// lib/until-label.js: when something ends, time first (#909's "Paused until …").
const { untilLabel } = require('../../src/renderer/lib/until-label');

const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime();
const now = at(17, 14, 0);
const time = (d, h, m) => new Date(2026, 10, d, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

test('later today is just the time', () => {
  expect(untilLabel(at(17, 16, 5), now)).toBe(time(17, 16, 5));
});

test('tomorrow says so, after the time', () => {
  expect(untilLabel(at(18, 9, 0), now)).toBe(`${time(18, 9, 0)} tomorrow`);
});

test('further out names the weekday', () => {
  const wd = new Date(2026, 10, 20).toLocaleDateString([], { weekday: 'short' });
  expect(untilLabel(at(20, 9, 0), now)).toBe(`${time(20, 9, 0)} on ${wd}`);
});

test('junk is empty, never "Invalid Date"', () => {
  expect(untilLabel('soon', now)).toBe('');
  expect(untilLabel(undefined, now)).toBe('');
});

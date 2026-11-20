/**
 * timeAgo (lib/time-ago.js): one relative-time phrase (#1388).
 */
const fs = require('fs');
const path = require('path');
const { timeAgo } = require('../../src/renderer/lib/time-ago');

const NOW = Date.UTC(2026, 10, 14, 12);
const MIN = 60000;

test('the scale', () => {
  expect(timeAgo(NOW - 20 * 1000, NOW)).toBe('just now');
  expect(timeAgo(NOW - 18 * MIN, NOW)).toBe('18m ago');
  expect(timeAgo(NOW - 3 * 60 * MIN, NOW)).toBe('3h ago');
  expect(timeAgo(NOW - 5 * 24 * 60 * MIN, NOW)).toBe('5d ago');
  expect(timeAgo(NOW - 65 * 24 * 60 * MIN, NOW)).toBe('2mo ago');
  expect(timeAgo(NOW - 400 * 24 * 60 * MIN, NOW)).toBe('1y ago');
  expect(timeAgo(NOW + MIN, NOW)).toBe('just now');
});

// #1569: 360 to 364 days are twelve 30-day months but not yet a year; they
// read "12mo ago", never "0y ago".
test('months until a full year has passed', () => {
  const DAY = 24 * 60 * MIN;
  expect(timeAgo(NOW - 359 * DAY, NOW)).toBe('11mo ago');
  for (const d of [360, 362, 364]) expect(timeAgo(NOW - d * DAY, NOW)).toBe('12mo ago');
  expect(timeAgo(NOW - 365 * DAY, NOW)).toBe('1y ago');
  expect(timeAgo(NOW - 730 * DAY, NOW)).toBe('2y ago');
});

test('no other copy of the "m ago" ladder in the renderer', () => {
  const dir = path.join(__dirname, '../../src/renderer');
  const files = ['app.js', ...['components', 'lib', 'hooks'].flatMap((d) => fs.readdirSync(path.join(dir, d)).map((f) => `${d}/${f}`))]
    .filter((f) => f !== 'lib/time-ago.js' && f.endsWith('.js'));
  const hits = files.filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n')
    .some((line) => /\}m ago`/.test(line) && !/console\./.test(line)));
  expect(hits).toEqual([]);
});

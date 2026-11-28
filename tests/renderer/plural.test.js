/**
 * countOf (lib/plural.js): one helper for counts in UI text (#1388).
 */
const fs = require('fs');
const path = require('path');
const { countOf } = require('../../src/renderer/lib/plural');

test('singular for one, plural otherwise, grouped digits', () => {
  expect(countOf(1, 'track')).toBe('1 track');
  expect(countOf(1, 'play')).toBe('1 play');
  expect(countOf(0, 'track')).toBe('0 tracks');
  expect(countOf(1204, 'track')).toBe('1,204 tracks');
  expect(countOf(2, 'entry', 'entries')).toBe('2 entries');
  expect(countOf(undefined, 'album')).toBe('0 albums');
});

test('UI text never hard-codes "${n} tracks" or "${n} track(s)"', () => {
  const dir = path.join(__dirname, '../../src/renderer');
  const files = ['app.js', ...['components', 'lib'].flatMap((d) => fs.readdirSync(path.join(dir, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`))];
  const hits = [];
  for (const f of files) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      // AI-facing context lines are for the model, not the reader.
      if (/lines\.push|error: `Invalid index|console\./.test(line)) return;
      if ((/\$\{[^}]+\} (tracks|songs|albums|playlists|plays|results)\b/.test(line) || /\$\{[^}]+\} [a-z]+\(s\)/.test(line)) && !/\$\{[^}]*(title|name)\} tracks/.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  expect(hits).toEqual([]);
});

describe('andList', () => {
  const { andList } = require('../../src/renderer/lib/plural');
  test('names in a sentence', () => {
    expect(andList([])).toBe('');
    expect(andList(['Last.fm'])).toBe('Last.fm');
    expect(andList(['Last.fm', 'ListenBrainz'])).toBe('Last.fm and ListenBrainz');
    expect(andList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(andList(['A', '', null, 'B'])).toBe('A and B');
  });
});

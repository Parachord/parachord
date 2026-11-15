/**
 * errorText / userError (lib/error-copy.js): UI text never shows a raw
 * error.message (#1388).
 */
const fs = require('fs');
const path = require('path');
const { userError, errorText } = require('../../src/renderer/lib/error-copy');

test("a userError's message reaches the reader; any other error gets the fallback", () => {
  expect(errorText(userError('There’s no Last.fm user with that name.'), 'Couldn’t add that friend.')).toBe('There’s no Last.fm user with that name.');
  expect(errorText(new Error('Last.fm API error: 500'), 'Couldn’t add that friend.')).toBe('Couldn’t add that friend.');
  expect(errorText(undefined, 'Fallback')).toBe('Fallback');
});

test('no toast or dialog message is built from error.message', () => {
  const dir = path.join(__dirname, '../../src/renderer');
  const files = ['app.js',
    ...fs.readdirSync(path.join(dir, 'components')).map((f) => `components/${f}`),
    ...fs.readdirSync(path.join(dir, 'hooks')).map((f) => `hooks/${f}`)];
  const hits = [];
  for (const f of files) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      if (/console\./.test(line)) return;
      if (/(showToast\(|message:).*\b(error|err|e)\.message/.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  expect(hits).toEqual([]);
});

/**
 * Resolver hints: the facts about the track being resolved that a plugin may
 * use to pick between same-named candidates (Amazon Music drops a candidate
 * whose length is another recording). Passed to every track-specific
 * resolve()/search(), never to a plain user search.
 */

const fs = require('fs');
const path = require('path');
const { resolverHints } = require('../../src/renderer/lib/resolver-hints');

describe('resolverHints', () => {
  test('duration is seconds from the track row', () => {
    expect(resolverHints({ duration: 244 })).toEqual({ duration: 244 });
    expect(resolverHints({ duration: 244.4 })).toEqual({ duration: 244 });
  });

  test('millisecond shapes are converted', () => {
    expect(resolverHints({ duration: 244527 })).toEqual({ duration: 245 }); // a ms value in duration
    expect(resolverHints({ duration_ms: 244527 })).toEqual({ duration: 245 }); // Spotify-shaped
    expect(resolverHints({ length: 192000 })).toEqual({ duration: 192 }); // MusicBrainz-shaped
  });

  test('unknown length is null', () => {
    expect(resolverHints({ duration: 0 })).toEqual({ duration: null });
    expect(resolverHints({})).toEqual({ duration: null });
    expect(resolverHints(null)).toEqual({ duration: null });
  });
});

describe('app.js call sites', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('every resolve() call passes hints', () => {
    const calls = src.match(/resolver\.resolve\([^;]*\);/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(11);
    for (const call of calls) expect(call).toMatch(/resolverHints\(/);
  });

  test('the track-specific searches pass hints; the general searches do not', () => {
    const withHints = src.match(/resolver\.search\([^;]*resolverHints\([^;]*\);/g) || [];
    expect(withHints.length).toBe(3);
    // The search page, the DJ tools and the chat search stay unfiltered.
    expect((src.match(/resolver\.search\(query, config\);/g) || []).length).toBe(3);
  });
});

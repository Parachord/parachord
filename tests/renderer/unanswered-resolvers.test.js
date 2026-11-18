/**
 * A saved track-sources entry with no entry for a service means that service
 * never answered (it threw, or ran past RESOLVE_BUDGET_MS): an answered "no
 * match" always leaves a noMatch sentinel. Before this, resolveTrack read a
 * missing service as "no match" for the 7-day TTL, so a lookup that timed out
 * during a burst was never asked again (2026-11-15: ~5,700 saved tracks had no
 * Apple Music entry, Recommendations rows showed Spotify only).
 */
const fs = require('fs');
const path = require('path');
const {
  UNANSWERED_RETRY_MS,
  resolversToAskAgain,
  nextUnanswered,
} = require('../../src/renderer/lib/unanswered-resolvers');

const NOW = 1_800_000_000_000;

describe('resolversToAskAgain', () => {
  const ids = ['spotify', 'applemusic', 'bandcamp'];

  test('a service with no entry is asked again', () => {
    const entry = { sources: { spotify: { id: 's' }, bandcamp: { noMatch: true } } };
    expect(resolversToAskAgain(entry, ids, NOW)).toEqual(['applemusic']);
  });

  test('a real source or a noMatch sentinel is an answer', () => {
    const entry = { sources: { spotify: { id: 's' }, applemusic: { id: 'a' }, bandcamp: { noMatch: true } } };
    expect(resolversToAskAgain(entry, ids, NOW)).toEqual([]);
  });

  test('a service that just failed waits out the retry window', () => {
    const entry = { sources: { spotify: { id: 's' }, bandcamp: { noMatch: true } }, unanswered: { applemusic: NOW - 1000 } };
    expect(resolversToAskAgain(entry, ids, NOW)).toEqual([]);
  });

  test('after the window it is asked again', () => {
    const entry = { sources: { spotify: { id: 's' }, bandcamp: { noMatch: true } }, unanswered: { applemusic: NOW - UNANSWERED_RETRY_MS } };
    expect(resolversToAskAgain(entry, ids, NOW)).toEqual(['applemusic']);
  });

  test('no entry at all asks nothing (that is a fresh resolve, not a retry)', () => {
    expect(resolversToAskAgain(null, ids, NOW)).toEqual([]);
    expect(resolversToAskAgain({}, ids, NOW)).toEqual(ids);
  });
});

describe('nextUnanswered', () => {
  test('records the services that failed', () => {
    expect(nextUnanswered(undefined, { failed: ['applemusic'], answered: ['spotify'] }, NOW))
      .toEqual({ applemusic: NOW });
  });

  test('an answer clears a recorded failure', () => {
    expect(nextUnanswered({ applemusic: NOW - 5 }, { failed: [], answered: ['applemusic'] }, NOW))
      .toBeUndefined();
  });

  test('keeps failures for services not asked this time', () => {
    expect(nextUnanswered({ bandcamp: NOW - 5 }, { failed: ['applemusic'], answered: [] }, NOW))
      .toEqual({ bandcamp: NOW - 5, applemusic: NOW });
  });
});

describe('resolveTrack wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const start = src.indexOf('const resolveTrack = async');
  const body = src.slice(start, src.indexOf('// Keep resolveTrackRef in sync', start));

  test('a valid cache still lists services that never answered', () => {
    expect(body).toMatch(/const missingResolvers = cacheValid\s*\?\s*resolversToAskAgain\(/);
    expect(body).not.toMatch(/const missingResolvers = cacheValid \? \[\] :/);
  });

  test('the cache-hit branch only returns early when nothing is left to ask', () => {
    expect(body).toMatch(/if \(missingResolvers\.length === 0\) \{[\s\S]{0,400}return displaySources;/);
  });

  test('every fan-out records which services failed on the saved entry', () => {
    const writes = body.match(/unanswered: (nextUnanswered|unansweredAfter)\(/g) || [];
    // persisted-but-missing, cache-valid-but-missing, and the full fan-out
    expect(writes.length).toBe(3);
  });

  test('the cache-valid retry stores a noMatch sentinel for a miss, like the other branches', () => {
    const branch = body.slice(body.indexOf('if (askAgainOnly) {'));
    const head = branch.slice(0, branch.indexOf('await Promise.all(resolverPromises)'));
    // A miss is built by newMiss (lib/cached-miss.js, #1535).
    expect((head.match(/sources\[resolver\.id\] = newMiss\(resolver\);/g) || []).length).toBe(2);
  });
});

describe('background playlist resolution persists to its playlist', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const start = src.indexOf('if (!cacheValid && hasValidPersistedSources && missingResolvers.length > 0)');
  const branch = src.slice(start, src.indexOf('if (askAgainOnly) {', start));

  test('the persisted-but-missing branch writes to an explicit playlistId', () => {
    expect(branch).toMatch(/if \(track\.id && playlistId\) \{\s*queuePlaylistSourceUpdate\(playlistId, track\.id, sources\);/);
  });
});

describe('full fan-out', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const start = src.indexOf('console.log(`🔍 Resolving: ${artistName} - ${track.title}');
  const fanout = src.slice(start, src.indexOf('// Keep resolveTrackRef in sync', start));

  test('a wrong-song result is saved as an answer, not left as a gap', () => {
    expect(fanout).toMatch(/sources\[resolver\.id\] = existingRealSources\[resolver\.id\] \|\| newMiss\(resolver\);\s*return;/);
  });
});

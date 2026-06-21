/**
 * N-way multimaster playlist merge — Phase 0 tests.
 *
 * Two layers:
 *   1. The shared cross-engine fixture suite — canonical-fixtures.json,
 *      vendored verbatim from parachord-mobile (the SAME file the Kotlin
 *      PlaylistMergeTest runs against). Identical fixtures passing on both
 *      engines is the parity contract (Parachord/parachord#911).
 *   2. canonicalTrackKey unit coverage (key derivation precedence) +
 *      a couple of pure-merge edge cases.
 *
 * Design: docs/plans/2026-06-21-nway-multimaster-playlist-sync-design.md
 * (parachord-mobile).
 */

const fs = require('fs');
const path = require('path');
const {
  mergePlaylist,
  canonicalTrackKey,
  exceedsMassChangeThreshold,
} = require('../helpers/playlist-merge');

const CANONICAL = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'nway-merge', 'canonical-fixtures.json'),
    'utf8'
  )
);

describe('N-way merge — canonical cross-engine fixtures', () => {
  test('fixture file carries the expected case count', () => {
    // A glob/parse slip shouldn't silently pass with zero cases.
    expect(Array.isArray(CANONICAL.cases)).toBe(true);
    expect(CANONICAL.cases.length).toBe(12);
  });

  for (const c of CANONICAL.cases) {
    test(`${c.name}`, () => {
      expect(mergePlaylist(c.baseline, c.copies)).toEqual(c.expected);
    });
  }
});

describe('mergePlaylist — edge cases', () => {
  test('no copies: merged equals baseline', () => {
    expect(mergePlaylist(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  test('a copy equal to baseline is ignored (no delta, not the order winner)', () => {
    // applemusic == baseline (unchanged); spotify reorders. Winner is the
    // only CHANGED copy regardless of editedAt, so order follows spotify.
    const r = mergePlaylist(['a', 'b', 'c'], [
      { id: 'applemusic', tracks: ['a', 'b', 'c'], editedAt: 99 },
      { id: 'spotify', tracks: ['c', 'b', 'a'], editedAt: 1 },
    ]);
    expect(r).toEqual(['c', 'b', 'a']);
  });

  test('delete always wins even against a strictly-newer keeper', () => {
    // Pins the Q1 decision: no presence-LWW.
    expect(
      mergePlaylist(['x', 'z'], [
        { id: 'spotify', tracks: ['z'], editedAt: 5 },
        { id: 'applemusic', tracks: ['x', 'z', 'y'], editedAt: 9 },
      ])
    ).toEqual(['z', 'y']);
  });

  test('output is deterministic regardless of input order on an editedAt tie', () => {
    // maxByOrNull-equivalent: first input copy among tied-max editedAt wins.
    const a = mergePlaylist(['a'], [
      { id: 'spotify', tracks: ['a', 's'], editedAt: 1000 },
      { id: 'applemusic', tracks: ['a', 'm'], editedAt: 1000 },
    ]);
    expect(a).toEqual(['a', 's', 'm']); // spotify is first input among tied-max
    const b = mergePlaylist(['a'], [
      { id: 'applemusic', tracks: ['a', 'm'], editedAt: 1000 },
      { id: 'spotify', tracks: ['a', 's'], editedAt: 1000 },
    ]);
    expect(b).toEqual(['a', 'm', 's']); // applemusic is first input among tied-max
  });
});

describe('exceedsMassChangeThreshold — caller-side guard (not part of pure merge)', () => {
  test('default 0.7: a 50% drop does not trip; a 100% drop does', () => {
    expect(exceedsMassChangeThreshold(2, 1)).toBe(false); // 50% dropped
    expect(exceedsMassChangeThreshold(2, 0)).toBe(true); // 100% dropped
  });
  test('honors a custom threshold', () => {
    expect(exceedsMassChangeThreshold(2, 1, 0.4)).toBe(true); // 50% > 40%
  });
  test('empty baseline never trips', () => {
    expect(exceedsMassChangeThreshold(0, 0)).toBe(false);
  });
});

describe('canonicalTrackKey — derivation precedence', () => {
  test('valid ISRC wins, uppercased', () => {
    expect(
      canonicalTrackKey({ isrc: 'gbaye0601498', recordingMbid: 'x', artist: 'a', title: 't' })
    ).toBe('isrc-GBAYE0601498');
  });

  test('falls through to MBID when ISRC missing/invalid', () => {
    const mbid = 'b2181aae-5cba-496c-bb0c-b4cc0109ebf8';
    expect(canonicalTrackKey({ isrc: 'not-an-isrc', recordingMbid: mbid })).toBe(`mbid-${mbid}`);
    expect(canonicalTrackKey({ mbid })).toBe(`mbid-${mbid}`);
  });

  test('falls through to norm artist|title when no ISRC/MBID', () => {
    expect(canonicalTrackKey({ artist: '  Radiohead ', title: 'Creep ' })).toBe('norm-radiohead|creep');
  });

  test('norm is lower + trimmed only (NOT strip-non-alphanumeric)', () => {
    expect(canonicalTrackKey({ artist: 'Sigur Rós', title: '( )' })).toBe('norm-sigur rós|( )');
  });

  test('missing fields degrade safely', () => {
    expect(canonicalTrackKey({})).toBe('norm-|');
    expect(canonicalTrackKey(null)).toBe('norm-|');
  });
});

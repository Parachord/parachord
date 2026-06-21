/**
 * N-way multimaster playlist merge — Phase 0 tests.
 *
 * Two layers:
 *   1. The shared cross-engine fixture suite (tests/fixtures/nway-merge/*.json)
 *      — the SAME files the Kotlin merge runs against. Identical fixtures
 *      passing on both engines is the parity contract (Parachord/parachord#911).
 *   2. canonicalTrackKey unit coverage (key derivation precedence).
 *
 * Design: docs/plans/2026-06-21-nway-multimaster-playlist-sync-design.md
 * (parachord-mobile).
 */

const fs = require('fs');
const path = require('path');
const { mergePlaylist, canonicalTrackKey } = require('../helpers/playlist-merge');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'nway-merge');

const fixtureFiles = fs
  .readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe('N-way merge — shared cross-engine fixtures', () => {
  // Sanity: the suite must actually load fixtures (a glob typo shouldn't
  // silently pass with zero cases).
  test('fixture files are present', () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(11);
  });

  for (const file of fixtureFiles) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
    test(`${file} — ${fixture.name}`, () => {
      const result = mergePlaylist({
        baseline: fixture.baseline,
        copies: fixture.copies,
        options: fixture.options,
      });
      if (fixture.expected.aborted) {
        expect(result.aborted).toBe(true);
        expect(result.reason).toBe(fixture.expected.reason);
      } else {
        expect(result.aborted).toBe(false);
        expect(result.merged).toEqual(fixture.expected.merged);
      }
    });
  }
});

describe('mergePlaylist — edge cases', () => {
  test('empty baseline + one copy adds: union of adds, no abort', () => {
    const r = mergePlaylist({
      baseline: [],
      copies: [{ id: 'spotify', editedAt: 1, keys: ['A', 'B'] }],
    });
    expect(r.aborted).toBe(false);
    expect(r.merged).toEqual(['A', 'B']);
  });

  test('empty baseline never trips the mass-change guard (no base to drop)', () => {
    const r = mergePlaylist({
      baseline: [],
      copies: [{ id: 'spotify', editedAt: 1, keys: [] }],
    });
    expect(r.aborted).toBe(false);
    expect(r.merged).toEqual([]);
  });

  test('no copies: merged equals baseline (nothing to reconcile)', () => {
    const r = mergePlaylist({ baseline: ['A', 'B'], copies: [] });
    expect(r.aborted).toBe(false);
    expect(r.merged).toEqual(['A', 'B']);
  });

  test('massChangeThreshold is honored (lower threshold aborts a 50% drop)', () => {
    const args = {
      baseline: ['A', 'B'],
      copies: [
        { id: 'spotify', editedAt: 2, keys: ['A'] },
        { id: 'applemusic', editedAt: 1, keys: ['A', 'B'] },
      ],
    };
    // 50% drop: passes the default 0.7, aborts at 0.4.
    expect(mergePlaylist({ ...args }).aborted).toBe(false);
    expect(mergePlaylist({ ...args, options: { massChangeThreshold: 0.4 } }).aborted).toBe(true);
  });

  test('output is order-deterministic regardless of input copy order', () => {
    const a = mergePlaylist({
      baseline: ['A'],
      copies: [
        { id: 'spotify', editedAt: 1000, keys: ['A', 'S'] },
        { id: 'applemusic', editedAt: 1000, keys: ['A', 'M'] },
      ],
    });
    const b = mergePlaylist({
      baseline: ['A'],
      copies: [
        { id: 'applemusic', editedAt: 1000, keys: ['A', 'M'] },
        { id: 'spotify', editedAt: 1000, keys: ['A', 'S'] },
      ],
    });
    expect(a.merged).toEqual(b.merged);
    expect(a.merged).toEqual(['A', 'M', 'S']); // id-asc tiebreak
  });
});

describe('canonicalTrackKey — derivation precedence', () => {
  test('valid ISRC wins, uppercased', () => {
    expect(canonicalTrackKey({ isrc: 'gbaye0601498', recordingMbid: 'x', artist: 'a', title: 't' }))
      .toBe('isrc-GBAYE0601498');
  });

  test('falls through to MBID when ISRC missing/invalid', () => {
    const mbid = 'b2181aae-5cba-496c-bb0c-b4cc0109ebf8';
    expect(canonicalTrackKey({ isrc: 'not-an-isrc', recordingMbid: mbid })).toBe(`mbid-${mbid}`);
    expect(canonicalTrackKey({ mbid })).toBe(`mbid-${mbid}`); // accepts `mbid` too
  });

  test('falls through to norm artist|title when no ISRC/MBID', () => {
    expect(canonicalTrackKey({ artist: '  Radiohead ', title: 'Creep ' })).toBe('norm-radiohead|creep');
  });

  test('norm is lower + trimmed only (NOT strip-non-alphanumeric)', () => {
    // Distinguishes this from confidence-scoring normalizeStr.
    expect(canonicalTrackKey({ artist: "Sigur Rós", title: '( )' })).toBe('norm-sigur rós|( )');
  });

  test('missing fields degrade safely', () => {
    expect(canonicalTrackKey({})).toBe('norm-|');
    expect(canonicalTrackKey(null)).toBe('norm-|');
  });
});

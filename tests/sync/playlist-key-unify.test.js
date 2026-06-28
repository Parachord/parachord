/**
 * N-way cross-copy key unification — pre-pass tests (Phase 4 prerequisite,
 * Parachord/parachord#911).
 *
 * Layers:
 *   1. The shared cross-engine fixture suite — key-unify-fixtures.json,
 *      vendored verbatim from parachord-mobile (the SAME file the Kotlin
 *      engine runs against). Identical fixtures passing on both engines is
 *      the parity contract.
 *   2. The norm remaster-strip identity rule (norm-strip cases, transcribed
 *      desktop-side per the 2026-06-23 contract update) + the trackTiers
 *      bridge + the unify→merge pipeline shape.
 */

const fs = require('fs');
const path = require('path');
const { unifyTrackKeys, trackTiers } = require('../../sync-engine/playlist-key-unify');
const {
  canonicalTrackKey,
  mergePlaylist,
  deriveNorm,
  stripRemasterSuffix,
} = require('../../sync-engine/playlist-merge');

const UNIFY = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'nway-merge', 'key-unify-fixtures.json'),
    'utf8'
  )
);

describe('unifyTrackKeys — canonical cross-engine fixtures', () => {
  test('fixture file carries the expected case count', () => {
    expect(Array.isArray(UNIFY.cases)).toBe(true);
    expect(UNIFY.cases.length).toBe(16);
  });

  for (const c of UNIFY.cases) {
    test(`${c.name}`, () => {
      expect(unifyTrackKeys(c.lists)).toEqual(c.expected);
    });
  }
});

describe('unifyTrackKeys — additional properties', () => {
  test('transitive: A~B via isrc, B~C via norm -> one class', () => {
    const [out] = unifyTrackKeys([
      [
        { isrc: 'USABC1234567', mbid: 'a', norm: 'x|one' },
        { isrc: 'USABC1234567', mbid: 'b', norm: 'x|two' }, // shares isrc with #0
        { mbid: 'c', norm: 'x|two' }, // shares norm with #1
      ],
    ]);
    // All three unify; strongest tier is isrc -> the single isrc value.
    expect(out).toEqual(['isrc-USABC1234567', 'isrc-USABC1234567', 'isrc-USABC1234567']);
  });

  // ── Norm-bridge-guard behaviors explicit in the fixture _semantics but not
  // yet pinned by a shared fixture (proposed to mobile as guard_v12/v13). Lock
  // the correct reading desktop-side so a refactor can't silently drift.

  test('guard: "component carries ISRC" is GLOBAL across norm groups (not group-local)', () => {
    // #0 isrc A + mbid M (norm "a|one");  #1 mbid M (norm "a|two") — strong phase
    // unions #0,#1 via M into one component that carries ISRC A *in group a|one*.
    // #2 isrc B (norm "a|two");  #3 norm-only (norm "a|two").
    // Group "a|two" = {#1,#2,#3}. #1 is ISRC-free locally, but its COMPONENT
    // carries A → cIsrc=2 (compA via #1, compB via #2) → must NOT bridge across.
    // A group-local reading would see cIsrc=1 and false-merge A and B.
    const [out] = unifyTrackKeys([
      [
        { isrc: 'XXAAA0000001', mbid: 'm-shared', norm: 'a|one' },
        { mbid: 'm-shared', norm: 'a|two' },
        { isrc: 'XXBBB0000002', norm: 'a|two' },
        { norm: 'a|two' },
      ],
    ]);
    expect(out).toEqual([
      'isrc-XXAAA0000001', // #0
      'isrc-XXAAA0000001', // #1 — stays with #0's component (A), NOT merged into B
      'isrc-XXBBB0000002', // #2 — distinct ISRC, kept separate
      'norm-a|two',        // #3 — weak, alone
    ]);
  });

  test('guard: under ISRC conflict the weak set is ISRC-FREE (an mbid-only node joins it)', () => {
    // Two disagreeing ISRCs (A,B) + an mbid-only node + a pure-norm node, all
    // same norm. cIsrc=2 → weak = {mbid-only, pure-norm} union together →
    // mbid repr (strongest in the weak class). A "pure-norm-only" weak reading
    // would wrongly leave the mbid-only node a singleton.
    const [out] = unifyTrackKeys([
      [
        { isrc: 'XXAAA0000001', norm: 'a|b' },
        { isrc: 'XXBBB0000002', norm: 'a|b' },
        { mbid: 'm-weak', norm: 'a|b' },
        { norm: 'a|b' },
      ],
    ]);
    expect(out).toEqual([
      'isrc-XXAAA0000001',
      'isrc-XXBBB0000002',
      'mbid-m-weak', // mbid-only node + pure-norm node unite → mbid repr
      'mbid-m-weak',
    ]);
  });

  test('singleton representative == canonicalTrackKey', () => {
    const track = { mbid: 'b2181aae-5cba-496c-bb0c-b4cc0109ebf8', artist: 'Radiohead', title: 'Creep' };
    const tiers = trackTiers(track);
    const [out] = unifyTrackKeys([[tiers]]);
    expect(out[0]).toBe(canonicalTrackKey(track));
  });

  test('empty / missing lists degrade safely', () => {
    expect(unifyTrackKeys([])).toEqual([]);
    expect(unifyTrackKeys([[]])).toEqual([[]]);
    expect(unifyTrackKeys(null)).toEqual([]);
  });
});

describe('norm remaster-strip (cross-engine identity rule)', () => {
  test('strips trailing remaster annotations (various forms)', () => {
    expect(stripRemasterSuffix('zombie - 2025 remastered')).toBe('zombie');
    expect(stripRemasterSuffix('creep - 2009 remaster')).toBe('creep');
    expect(stripRemasterSuffix('bohemian rhapsody (remastered 2011)')).toBe('bohemian rhapsody');
    expect(stripRemasterSuffix('let it be (2009 remaster)')).toBe('let it be');
    expect(stripRemasterSuffix('a day in the life - remastered')).toBe('a day in the life');
  });

  test('does NOT strip live / acoustic / single / radio / feat (genuinely different recordings)', () => {
    expect(stripRemasterSuffix('creep - live')).toBe('creep - live');
    expect(stripRemasterSuffix('hurt - acoustic')).toBe('hurt - acoustic');
    expect(stripRemasterSuffix('roar - single version')).toBe('roar - single version');
    expect(stripRemasterSuffix('umbrella (feat. jay-z)')).toBe('umbrella (feat. jay-z)');
  });

  test('deriveNorm applies the strip to the title only, lower+trims both', () => {
    expect(deriveNorm('The Beatles', 'Let It Be - 2009 Remaster')).toBe('the beatles|let it be');
    expect(deriveNorm('Radiohead', 'Creep')).toBe('radiohead|creep');
  });

  test('un-stripped twins unify via norm once derived', () => {
    // Same recording, drifted title (remaster). No isrc/mbid -> only norm
    // can bridge; the strip makes the two derived norms equal so they unify.
    const a = trackTiers({ artist: 'The Beatles', title: 'Let It Be' });
    const b = trackTiers({ artist: 'The Beatles', title: 'Let It Be - 2009 Remaster' });
    const out = unifyTrackKeys([[a], [b]]);
    expect(out[0][0]).toBe(out[1][0]); // same representative
    expect(out[0][0]).toBe('norm-the beatles|let it be');
  });
});

describe('pipeline — unifyTrackKeys feeds merge unchanged', () => {
  test('representative keys merge correctly (cross-service same-song add)', () => {
    // baseline + two copies; the "same song" is keyed mbid- on one copy and
    // norm- on the other. After unify both become the strongest representative,
    // so the merge sees one track, not an add+remove.
    const baseline = [trackTiers({ recordingMbid: 'b2181aae-5cba-496c-bb0c-b4cc0109ebf8', artist: 'A', title: 'Song' })];
    const spotifyTracks = [trackTiers({ recordingMbid: 'b2181aae-5cba-496c-bb0c-b4cc0109ebf8', artist: 'A', title: 'Song' })];
    const lbTracks = [trackTiers({ artist: 'A', title: 'Song' })]; // un-enriched twin, bridges via norm

    const [uBaseline, uSpotify, uLb] = unifyTrackKeys([baseline, spotifyTracks, lbTracks]);
    const merged = mergePlaylist(uBaseline, [
      { id: 'spotify', tracks: uSpotify, editedAt: 1 },
      { id: 'listenbrainz', tracks: uLb, editedAt: 2 },
    ]);
    // One unified track, no false add/remove.
    expect(merged).toEqual(['mbid-b2181aae-5cba-496c-bb0c-b4cc0109ebf8']);
  });
});

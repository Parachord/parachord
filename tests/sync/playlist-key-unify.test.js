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
    expect(UNIFY.cases.length).toBe(8);
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

/**
 * Resolver Confidence Scoring Tests
 *
 * Mirrors parachord-mobile's ConfidenceScoringTest cases plus desktop-specific
 * regression coverage for the wrong-artist match bug.
 *
 * The bug: prior to this scoring, calculateConfidence ignored artist entirely.
 * A "Yesterday" search for The Beatles could resolve to a different artist's
 * "Yesterday" with confidence 0.85, and since the source-selection sort had no
 * confidence floor, that wrong-artist match could outrank a correct local file.
 *
 * Fix: both axes (title AND artist, normalized substring match) must match,
 * else 0.50; selection gates on MIN_CONFIDENCE_THRESHOLD = 0.6.
 */

const {
  normalizeStr,
  validateResolvedTrack,
  calculateConfidence,
  MIN_CONFIDENCE_THRESHOLD,
} = require('../helpers/confidence-scoring');

// Identity tier (parachord#926): the same ISRC or recording MBID on both sides
// is the same recording whatever the strings look like, and scores 1.0 before
// any name comparison. Only an exact id on BOTH sides counts; a missing or
// different id falls through to the name gate unchanged.
describe('calculateConfidence identity tier (ISRC / MBID)', () => {
  const original = { artist: 'Radiohead', title: 'Everything in Its Right Place' };

  test('matching ISRC scores 1.0 even when the names would fail', () => {
    expect(calculateConfidence({ ...original, isrc: 'GBAYK0000001' }, { artist: 'Various Artists', title: 'Track 1', isrc: 'gbayk0000001 ' })).toBe(1.0);
  });

  test('the original ISRC may live on a resolver source instead of the top level', () => {
    const withSource = { ...original, sources: { spotify: { isrc: 'GBAYK0000001' } } };
    expect(calculateConfidence(withSource, { artist: 'X', title: 'Y', isrc: 'GBAYK0000001' })).toBe(1.0);
  });

  test('matching recording MBID scores 1.0 regardless of case and field name', () => {
    expect(calculateConfidence({ ...original, mbid: '2C6CF4F6-1A4F-4B8B-9B67-4C6C6A2F1C11' }, { artist: 'X', title: 'Y', recordingMbid: '2c6cf4f6-1a4f-4b8b-9b67-4c6c6a2f1c11' })).toBe(1.0);
  });

  test('a different id, a one-sided id, or a malformed ISRC falls through to the name gate', () => {
    expect(calculateConfidence({ ...original, isrc: 'GBAYK0000001' }, { ...original, isrc: 'USRC17607839' })).toBe(0.95);
    expect(calculateConfidence({ ...original, isrc: 'GBAYK0000001' }, { artist: 'X', title: 'Y' })).toBe(0.5);
    expect(calculateConfidence({ ...original, isrc: 'not-an-isrc' }, { artist: 'X', title: 'Y', isrc: 'not-an-isrc' })).toBe(0.5);
    expect(calculateConfidence({ ...original, mbid: 'abc' }, { artist: 'X', title: 'Y', mbid: 'xyz' })).toBe(0.5);
  });
});

describe('normalizeStr', () => {
  test('lowercases and strips punctuation', () => {
    expect(normalizeStr("Don't Stop Believin'")).toBe('dontstopbelievin');
  });

  test('strips whitespace', () => {
    expect(normalizeStr('  Hello  World  ')).toBe('helloworld');
  });

  test('folds Latin diacritics to base letters', () => {
    // Accented Latin chars decompose via NFKD then drop combining marks,
    // so the base letter survives. Previously this stripped accented chars
    // entirely (Björk → bjrk), which caused false rejections when a resolver
    // returned the canonical accented form against a stripped target.
    expect(normalizeStr('Björk')).toBe('bjork');
    expect(normalizeStr('café')).toBe('cafe');
    expect(normalizeStr('José González')).toBe('josegonzalez');
    expect(normalizeStr('österreich')).toBe('osterreich');
  });

  test('preserves non-Latin scripts', () => {
    // \p{L}/\p{N} keepset preserves CJK/Cyrillic/Arabic/etc. Previously
    // these all collapsed to "", which made validateResolvedTrack reject
    // every match for tracks with non-Latin titles (the listen-along bug
    // for users with diverse music libraries).
    expect(normalizeStr('動物寓意譚')).toBe('動物寓意譚');
    expect(normalizeStr('В лунном сиянии')).toBe('влунномсиянии');
  });

  test('handles null and undefined', () => {
    expect(normalizeStr(null)).toBe('');
    expect(normalizeStr(undefined)).toBe('');
    expect(normalizeStr('')).toBe('');
  });

  test('keeps digits', () => {
    expect(normalizeStr('99 Luftballons')).toBe('99luftballons');
  });
});

describe('validateResolvedTrack', () => {
  test('passes when both axes match exactly', () => {
    expect(
      validateResolvedTrack(
        { artist: 'Radiohead', title: 'Creep' },
        'Radiohead',
        'Creep'
      )
    ).toBe(true);
  });

  test('passes when result contains target (resolver returned a longer label)', () => {
    expect(
      validateResolvedTrack(
        { artist: 'Radiohead', title: 'Creep (Acoustic Version)' },
        'Radiohead',
        'Creep'
      )
    ).toBe(true);
  });

  test('passes when target contains result (target had extra qualifiers)', () => {
    expect(
      validateResolvedTrack(
        { artist: 'Radiohead', title: 'Creep' },
        'Radiohead',
        'Creep (Remastered 2019)'
      )
    ).toBe(true);
  });

  test('fails when artist mismatches (regression: wrong-song bug)', () => {
    expect(
      validateResolvedTrack(
        { artist: 'Stone Temple Pilots', title: 'Creep' },
        'Radiohead',
        'Creep'
      )
    ).toBe(false);
  });

  test('fails when title mismatches', () => {
    expect(
      validateResolvedTrack(
        { artist: 'Radiohead', title: 'Karma Police' },
        'Radiohead',
        'Creep'
      )
    ).toBe(false);
  });

  test('fails when result has missing artist or title', () => {
    expect(
      validateResolvedTrack({ artist: 'Radiohead' }, 'Radiohead', 'Creep')
    ).toBe(false);
    expect(
      validateResolvedTrack({ title: 'Creep' }, 'Radiohead', 'Creep')
    ).toBe(false);
  });

  test('fails when target is empty (degenerate input)', () => {
    expect(
      validateResolvedTrack(
        { artist: 'Radiohead', title: 'Creep' },
        '',
        ''
      )
    ).toBe(false);
  });
});

describe('calculateConfidence', () => {
  test('returns 0.95 when both title and artist match', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep' },
        { artist: 'Radiohead', title: 'Creep' }
      )
    ).toBe(0.95);
  });

  test('case-insensitive match', () => {
    expect(
      calculateConfidence(
        { artist: 'radiohead', title: 'creep' },
        { artist: 'RADIOHEAD', title: 'CREEP' }
      )
    ).toBe(0.95);
  });

  // Regression: wrong-song bug. Title-only match used to score 0.85.
  test('returns 0.50 for title match only (artist mismatch is wrong song)', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep' },
        { artist: 'Stone Temple Pilots', title: 'Creep' }
      )
    ).toBe(0.5);
  });

  test('returns 0.50 for artist match only (wrong song by right artist)', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep' },
        { artist: 'Radiohead', title: 'Karma Police' }
      )
    ).toBe(0.5);
  });

  test('returns 0.50 when neither match', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep' },
        { artist: 'The Beatles', title: 'Yesterday' }
      )
    ).toBe(0.5);
  });

  test('containment match — target contains matched', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep (Remastered 2019)' },
        { artist: 'Radiohead', title: 'Creep' }
      )
    ).toBe(0.95);
  });

  test('containment match — matched contains target', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep' },
        { artist: 'Radiohead', title: 'Creep (Acoustic Version)' }
      )
    ).toBe(0.95);
  });

  test('handles null matched values', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep' },
        null
      )
    ).toBe(0.5);
  });

  test('handles missing artist/title on matched', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep' },
        { artist: 'Radiohead' }
      )
    ).toBe(0.5);
  });

  test('special characters in titles', () => {
    expect(
      calculateConfidence(
        { artist: 'Sigur Rós', title: 'Hoppípolla' },
        { artist: 'Sigur Rós', title: 'Hoppípolla' }
      )
    ).toBe(0.95);
  });

  // Direct-ID matches (e.g. cached Spotify URI source) ship with confidence:1.0
  // pre-stamped. Validation still has to pass — but if it does, we keep the
  // higher score.
  test('preserves resolver-supplied 1.0 confidence on direct-ID matches', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep' },
        { artist: 'Radiohead', title: 'Creep', confidence: 1.0 }
      )
    ).toBe(1.0);
  });

  // Untrusted resolver-supplied confidence (e.g. a fuzzy 0.7 from an
  // older fuzzy-match resolver) does NOT bypass our validation. If the
  // validation passes, we return our canonical 0.95 — not the 0.7.
  test('does not honor resolver-supplied confidence below 0.95', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep' },
        { artist: 'Radiohead', title: 'Creep', confidence: 0.7 }
      )
    ).toBe(0.95);
  });

  // Wrong-artist match with high resolver-supplied confidence still drops.
  // This is the core fix: don't trust the resolver's confidence when the
  // basic artist+title sanity check fails.
  test('rejects wrong-artist match even when resolver claims 1.0 confidence', () => {
    expect(
      calculateConfidence(
        { artist: 'Radiohead', title: 'Creep' },
        { artist: 'TLC', title: 'Creep', confidence: 1.0 }
      )
    ).toBe(0.5);
  });
});

describe('MIN_CONFIDENCE_THRESHOLD', () => {
  test('is 0.6 — matches Android', () => {
    expect(MIN_CONFIDENCE_THRESHOLD).toBe(0.6);
  });

  test('drops single-axis matches but keeps both-axis matches', () => {
    const titleOnlyScore = calculateConfidence(
      { artist: 'Radiohead', title: 'Creep' },
      { artist: 'TLC', title: 'Creep' }
    );
    const bothScore = calculateConfidence(
      { artist: 'Radiohead', title: 'Creep' },
      { artist: 'Radiohead', title: 'Creep' }
    );
    expect(titleOnlyScore).toBeLessThan(MIN_CONFIDENCE_THRESHOLD);
    expect(bothScore).toBeGreaterThanOrEqual(MIN_CONFIDENCE_THRESHOLD);
  });
});

const {
  pickPlayableTrack,
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  pageBlocksPlayback,
  isNotReadyReason,
  AMAZON_QUALITY_OPTIONS,
  normalizeStreamingQuality,
  isAmazonSearchTrackLink,
  asinFromPlayerUrl,
  NEAR_END_MS
} = require('../../amazon-music-logic');

describe('pickPlayableTrack', () => {
  const tracks = [
    { asin: 'B1', title: 'Creep', artist: 'Radiohead' },
    { asin: 'B2', title: 'Creep', artist: 'Someone Else' },
    { asin: 'B3', title: '', artist: '' }
  ];

  test('exact ASIN wins and never falls through to a different track', () => {
    expect(pickPlayableTrack(tracks, { asin: 'B1', title: 'Creep', artist: 'Someone Else' }).asin).toBe('B1');
  });

  test('missing requested ASIN does not fuzzy-match a different ASIN', () => {
    expect(pickPlayableTrack(tracks, { asin: 'B9', title: 'Creep', artist: 'Radiohead' })).toBeNull();
  });

  test('empty title or artist does not match everything', () => {
    expect(pickPlayableTrack(tracks, { title: '', artist: 'Radiohead' })).toBeNull();
    expect(pickPlayableTrack(tracks, { title: 'Creep', artist: '' })).toBeNull();
  });

  test('fuzzy match requires both axes when no ASIN was requested', () => {
    expect(pickPlayableTrack(tracks, { title: 'Creep', artist: 'Radiohead' }).asin).toBe('B1');
  });

  test('Cyrillic titles are not stripped to empty', () => {
    const tracks = [{ asin: 'B9', title: 'На рахунок три', artist: 'Tember Blanche' }];
    expect(pickPlayableTrack(tracks, { title: 'На рахунок три', artist: 'Tember Blanche' }).asin).toBe('B9');
  });
});

describe('playerDurationMs', () => {
  test('treats the player value as milliseconds, including long tracks', () => {
    expect(playerDurationMs(180000)).toBe(180000);
    expect(playerDurationMs(1200000)).toBe(1200000);
    expect(playerDurationMs(0)).toBe(0);
    expect(playerDurationMs(null)).toBe(0);
  });
});

describe('decidePollAdvance', () => {
  const playing = { state: 'PLAYING', durationMs: 180000, pollCount: 5, expectedAsin: 'B1', actualAsin: 'B1' };

  test('does not skip when seeking backward near the end', () => {
    const decision = decidePollAdvance({
      ...playing,
      lastPositionMs: 176000,
      positionMs: 140000,
      seekSuppress: true
    });
    expect(decision.action).not.toBe('advance');
  });

  test('a backward seek is not an autoplay wrap even without the suppress flag', () => {
    const decision = decidePollAdvance({
      ...playing,
      lastPositionMs: 176000,
      positionMs: 140000
    });
    expect(decision.action).toBe('continue');
  });

  test('wrap to the start after 80% is a finish', () => {
    const decision = decidePollAdvance({
      ...playing,
      lastPositionMs: 176000,
      positionMs: 200
    });
    expect(decision).toEqual({ action: 'advance', reason: 'finished' });
  });

  test('does not cut off several seconds before the end', () => {
    const early = decidePollAdvance({ ...playing, lastPositionMs: 170000, positionMs: 176000 });
    expect(early.action).not.toBe('advance');
    const late = decidePollAdvance({
      ...playing,
      lastPositionMs: 179000,
      positionMs: 180000 - NEAR_END_MS
    });
    expect(late).toEqual({ action: 'advance', reason: 'near-end' });
  });

  test('polls faster only in the last few seconds', () => {
    expect(shouldPollFaster(180000, 100000)).toBe(false);
    expect(shouldPollFaster(180000, 175000)).toBe(true);
  });

  test('a different ASIN after the grace period advances', () => {
    expect(decidePollAdvance({ ...playing, pollCount: 1, actualAsin: 'B9' }).action).toBe('wait');
    expect(decidePollAdvance({ ...playing, pollCount: 3, actualAsin: 'B9' }).reason).toBe('track-changed');
  });
});

describe('pageBlocksPlayback', () => {
  test('profile picker and sign-in are not a finished session', () => {
    expect(pageBlocksPlayback('https://music.amazon.com/identity/who-is-listening')).toBe('not-signed-in');
    expect(pageBlocksPlayback('https://www.amazon.com/ap/signin?openid.return_to=music')).toBe('not-signed-in');
  });

  test('the player home is usable', () => {
    expect(pageBlocksPlayback('https://music.amazon.com/')).toBeNull();
    expect(pageBlocksPlayback('https://music.amazon.com/tracks/B000SNWG5Q')).toBeNull();
  });
});

describe('normalizeStreamingQuality', () => {
  test('maps the modal radios and the legacy HD value', () => {
    expect(normalizeStreamingQuality('BEST_AVAILABLE')).toBe('BEST_AVAILABLE');
    expect(normalizeStreamingQuality('HD')).toBe('BEST_AVAILABLE');
    expect(normalizeStreamingQuality('STANDARD')).toBe('STANDARD');
    expect(normalizeStreamingQuality('DATA_SAVER')).toBe('DATA_SAVER');
    expect(normalizeStreamingQuality('ULTRA_HD')).toBeNull();
    expect(AMAZON_QUALITY_OPTIONS.map(o => o.value)).toEqual([
      'BEST_AVAILABLE', 'STANDARD', 'DATA_SAVER'
    ]);
  });
});

describe('asinFromPlayerUrl', () => {
  test('reads the playing track ASIN from the player URL', () => {
    expect(asinFromPlayerUrl('https://music.amazon.com/tracks/B000SNWG5Q?do=play')).toBe('B000SNWG5Q');
    expect(asinFromPlayerUrl('https://music.amazon.com/')).toBeNull();
    expect(asinFromPlayerUrl('')).toBeNull();
  });
});

describe('isAmazonSearchTrackLink', () => {
  test('keeps search rows and drops the mini player', () => {
    expect(isAmazonSearchTrackLink('SearchResultsWidget_Item_Metadata_TrackTitle')).toBe(true);
    expect(isAmazonSearchTrackLink('SearchResultsWidget_TopResults_TrackItem_Metadata_TrackTitle')).toBe(true);
    expect(isAmazonSearchTrackLink('MiniPlayer_Title')).toBe(false);
    expect(isAmazonSearchTrackLink('')).toBe(false);
  });
});

describe('isNotReadyReason', () => {
  test('sign-in and missing-CDM are not empty search results', () => {
    expect(isNotReadyReason('not-signed-in')).toBe(true);
    expect(isNotReadyReason('no-cdm')).toBe(true);
    expect(isNotReadyReason('playback-failed')).toBe(false);
    expect(isNotReadyReason('app-not-managed')).toBe(false);
  });
});

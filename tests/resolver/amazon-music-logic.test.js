const {
  pickPlayableTrack,
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  relaunchAllowed,
  isNotReadyReason,
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

describe('relaunchAllowed', () => {
  test('refuses to relaunch without stored consent', () => {
    expect(relaunchAllowed({ platform: 'darwin', consented: false, portOpen: false, force: false }))
      .toEqual({ ok: false, reason: 'consent-required' });
  });

  test('a renderer cannot force the port open without consent', () => {
    expect(relaunchAllowed({ platform: 'darwin', consented: false, portOpen: false, force: true }).reason)
      .toBe('consent-required');
  });

  test('desktop app control is macOS-only', () => {
    expect(relaunchAllowed({ platform: 'linux', consented: true, portOpen: false }).reason)
      .toBe('unsupported-platform');
  });

  test('an already-managed app does not relaunch unless forced', () => {
    expect(relaunchAllowed({ platform: 'darwin', consented: true, portOpen: true, force: false }))
      .toEqual({ ok: true, relaunch: false });
    expect(relaunchAllowed({ platform: 'darwin', consented: true, portOpen: true, force: true }).relaunch)
      .toBe(true);
  });
});

describe('isNotReadyReason', () => {
  test('connect-needed reasons are not empty search results', () => {
    expect(isNotReadyReason('app-not-managed')).toBe(true);
    expect(isNotReadyReason('not-signed-in')).toBe(true);
    expect(isNotReadyReason('playback-failed')).toBe(false);
  });
});

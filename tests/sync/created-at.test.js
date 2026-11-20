// A synced playlist's "Created" date only ever moves earlier
// (sync-engine/created-at.js). Daily Brew read "Created" yesterday because
// each sync recalculated it from the oldest track still in today's rebuild.

const { stableCreatedAt, earliestTrackAddedAt } = require('../../sync-engine/created-at');

const DAY = 24 * 60 * 60 * 1000;
const JUNE_27 = Date.parse('2026-06-27T18:41:56Z');
const NOV_18 = Date.parse('2026-11-18T10:19:44Z');
const NOV_19 = Date.parse('2026-11-19T10:13:14Z');
const NOV_20 = Date.parse('2026-11-20T10:18:00Z');

describe('stableCreatedAt', () => {
  test('a rebuild that keeps two of yesterday’s tracks does not move the date forward', () => {
    const playlist = { createdAt: NOV_18, syncSources: { spotify: { addedAt: JUNE_27 } } };
    const today = [...Array(38).fill({ addedAt: NOV_20 }), { addedAt: NOV_19 }, { addedAt: NOV_19 }];
    expect(stableCreatedAt(playlist, today, 'spotify')).toBe(JUNE_27);
  });

  test('a drifted date heals back to when the import first saw the playlist', () => {
    const playlist = { createdAt: NOV_19, syncSources: { spotify: { addedAt: JUNE_27 } } };
    expect(stableCreatedAt(playlist, [{ addedAt: NOV_20 }], 'spotify')).toBe(JUNE_27);
  });

  test('with no import date, it keeps the earlier of what it has and the tracks', () => {
    expect(stableCreatedAt({ createdAt: NOV_18 }, [{ addedAt: NOV_20 }], 'spotify')).toBe(NOV_18);
    expect(stableCreatedAt({ createdAt: NOV_20 }, [{ addedAt: NOV_18 }], 'spotify')).toBe(NOV_18);
  });

  test('a playlist with no created date gets the earliest track date', () => {
    expect(stableCreatedAt({}, [{ addedAt: NOV_20 }, { addedAt: NOV_19 }], 'applemusic')).toBe(NOV_19);
  });

  test('a track’s date can come from its source record for this provider, not another', () => {
    const tracks = [
      { syncSources: { listenbrainz: { addedAt: NOV_18 } } },
      { syncSources: { spotify: { addedAt: JUNE_27 } } },
    ];
    expect(earliestTrackAddedAt(tracks, 'listenbrainz')).toBe(NOV_18);
    expect(stableCreatedAt({ createdAt: NOV_20 }, tracks, 'listenbrainz')).toBe(NOV_18);
  });

  test('date strings count; junk does not', () => {
    expect(stableCreatedAt({ createdAt: NOV_20 }, [{ addedAt: '2026-11-19T10:13:14Z' }], 'spotify')).toBe(NOV_19);
    expect(stableCreatedAt({ createdAt: NOV_20 }, [{ addedAt: 0 }, { addedAt: 'soon' }, { addedAt: NaN }, null], 'spotify')).toBe(NOV_20);
  });

  test('nothing to go on leaves the value as it was', () => {
    expect(stableCreatedAt({}, [], 'spotify')).toBeUndefined();
    expect(stableCreatedAt({ createdAt: NOV_20 }, [], 'spotify')).toBe(NOV_20);
  });

  test('never later than it was, whatever the order of syncs', () => {
    let playlist = { createdAt: NOV_18 };
    for (let day = 0; day < 5; day += 1) {
      playlist = { ...playlist, createdAt: stableCreatedAt(playlist, [{ addedAt: NOV_18 + day * DAY }], 'spotify') };
      expect(playlist.createdAt).toBe(NOV_18);
    }
  });
});

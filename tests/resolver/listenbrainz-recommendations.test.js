/**
 * Which ListenBrainz playlist the plugin's getRecommendations reads. It took
 * the first entry of /playlists/recommendations, which is newest first and
 * mixes Daily Jams, Weekly Jams, Weekly Exploration and the yearly "Top
 * Discoveries of <year>" / "Top Missed Recordings of <year>" round-ups, so the
 * page usually showed Daily Jams and, right after the round-ups, the user's
 * own listening from last year (the parachord#1021 mistake). The list shapes
 * mirror a live /1/user/<u>/playlists/recommendations response (Nov 2026).
 */
const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/listenbrainz.axe'), 'utf8'));
const getRecommendations = new Function('return ' + axe.implementation.getRecommendations)();

const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

// One /playlists/recommendations entry. `patch` null leaves source_patch out.
const entry = (id, title, daysAgo, patch) => ({
  playlist: {
    identifier: `https://listenbrainz.org/playlist/${id}`,
    title,
    date: iso(daysAgo),
    extension: {
      'https://musicbrainz.org/doc/jspf#playlist': {
        additional_metadata: patch === null ? {} : { algorithm_metadata: { source_patch: patch } }
      }
    }
  }
});

const jspf = (id) => ({
  playlist: {
    track: [
      { title: `Song from ${id}`, creator: 'Some Artist', duration: 200000, identifier: ['https://musicbrainz.org/recording/0f0e0d0c-0b0a-4908-8706-050403020100'] }
    ]
  }
});

let requested;
const run = async (playlists, { listStatus = 200 } = {}) => {
  requested = [];
  global.fetch = async (url) => {
    requested.push(url);
    if (url.includes('/playlists/recommendations')) {
      return { ok: listStatus === 200, status: listStatus, json: async () => ({ playlists }) };
    }
    const id = url.split('/').pop();
    return { ok: true, status: 200, json: async () => jspf(id) };
  };
  return getRecommendations({ username: 'someone' });
};
const playedId = () => (requested[1] || '').split('/').pop() || null;

afterEach(() => { delete global.fetch; });

describe('ListenBrainz getRecommendations picks a playlist by type', () => {
  test('a current Weekly Exploration beats a newer Daily Jams', async () => {
    await run([
      entry('daily', 'Daily Jams for someone, 2026-11-11 Wed', 0, 'daily-jams'),
      entry('explore', 'Weekly Exploration for someone, week of 2026-11-09 Mon', 2, 'weekly-exploration'),
      entry('jams', 'Weekly Jams for someone, week of 2026-11-09 Mon', 2, 'weekly-jams'),
    ]);
    expect(playedId()).toBe('explore');
  });

  test('a stale Weekly Exploration loses to the newest jams playlist', async () => {
    await run([
      entry('daily', 'Daily Jams for someone', 0, 'daily-jams'),
      entry('explore', 'Weekly Exploration for someone', 80, 'weekly-exploration'),
      entry('jams', 'Weekly Jams for someone', 80, 'weekly-jams'),
    ]);
    expect(playedId()).toBe('daily');
  });

  test('the yearly round-ups are never recommendations, even when newest', async () => {
    await run([
      entry('top-disc', 'Top Discoveries of 2025 for someone', 0, 'top-discoveries-of-2025'),
      entry('top-missed', 'Top Missed Recordings of 2025 for someone', 0, 'top-missed-recordings-of-2025'),
      entry('jams', 'Weekly Jams for someone', 30, 'weekly-jams'),
    ]);
    expect(playedId()).toBe('jams');
  });

  test('only round-ups is a miss, with no playlist fetched', async () => {
    const result = await run([
      entry('top-disc', 'Top Discoveries of 2025 for someone', 0, 'top-discoveries-of-2025'),
      entry('top-missed', 'Top Missed Recordings of 2025 for someone', 0, 'top-missed-recordings-of-2025'),
    ]);
    expect(result).toEqual({ sections: [] });
    expect(requested).toHaveLength(1);
  });

  test('a stale Weekly Exploration still plays when it is the only kind there is', async () => {
    await run([entry('explore', 'Weekly Exploration for someone', 80, 'weekly-exploration')]);
    expect(playedId()).toBe('explore');
  });

  test('without a source_patch the title decides', async () => {
    await run([
      entry('daily', 'Daily Jams for someone', 0, null),
      entry('explore', 'Weekly Exploration for someone, week of 2026-11-09 Mon', 3, null),
    ]);
    expect(playedId()).toBe('explore');
  });

  test('the chosen playlist becomes one untitled section of songs carrying the recording MBID', async () => {
    const result = await run([entry('explore', 'Weekly Exploration for someone', 1, 'weekly-exploration')]);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBeUndefined();
    expect(result.sections[0].items[0]).toMatchObject({
      type: 'song', name: 'Song from explore', artist: 'Some Artist', duration: 200,
      mbid: '0f0e0d0c-0b0a-4908-8706-050403020100'
    });
  });

  test('a failed list request throws rather than reading as a miss', async () => {
    await expect(run([], { listStatus: 500 })).rejects.toThrow(/500/);
  });
});

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
const getSimilarUsers = axe.implementation.getSimilarUsers
  ? new Function('return ' + axe.implementation.getSimilarUsers)()
  : null;

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
const run = async (playlists, { listStatus = 200, createdfor = [], createdforStatus = 200 } = {}) => {
  requested = [];
  global.fetch = async (url) => {
    requested.push(url);
    if (url.includes('/playlists/createdfor')) {
      return { ok: createdforStatus === 200, status: createdforStatus, json: async () => ({ playlists: createdfor }) };
    }
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
    // The list, then createdfor (weeklies are independent of the songs pick); no playlist.
    expect(requested).toHaveLength(2);
    expect(requested[1]).toContain('/playlists/createdfor');
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

describe('ListenBrainz weekly sections', () => {
  const weeks = (kind, n, idPrefix) => Array.from({ length: n }, (_, i) =>
    entry(`${idPrefix}${i}`, `Weekly ${kind} for someone, week of 2026-11-0${i} Mon`, 2 + i * 7, null));

  test('weekly sections: four newest of each, labels in order, Exploration and Jams ids', async () => {
    // Shuffled and over-long on purpose: only the newest four of each survive.
    const createdfor = [
      ...weeks('Jams', 6, 'j').reverse(),
      ...weeks('Exploration', 5, 'x'),
      entry('other', 'Top Discoveries of 2025 for someone', 0, null),
    ];
    const result = await run([entry('explore', 'Weekly Exploration for someone', 1, 'weekly-exploration')], { createdfor });
    expect(requested.filter(u => u.includes('/playlists/createdfor'))).toEqual([
      'https://api.listenbrainz.org/1/user/someone/playlists/createdfor?count=100'
    ]);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].title).toBeUndefined();
    const [, exploration, jams] = result.sections;
    expect(exploration).toMatchObject({ id: 'weekly-exploration', title: 'Weekly Exploration' });
    expect(jams).toMatchObject({ id: 'weekly-jams', title: 'Weekly Jams' });
    expect(exploration.items.map(i => i.id)).toEqual(['x0', 'x1', 'x2', 'x3']);
    expect(jams.items.map(i => i.id)).toEqual(['j0', 'j1', 'j2', 'j3']);
    expect(jams.items.map(i => i.name)).toEqual(['This Week', 'Last Week', '2 Weeks Ago', '3 Weeks Ago']);
    expect(exploration.items[0]).toEqual({
      type: 'playlist',
      id: 'x0',
      name: 'This Week',
      url: 'https://listenbrainz.org/playlist/x0/',
      weekly: { id: 'x0', contextType: 'weekly-exploration', label: 'Weekly Exploration', weekLabel: 'This Week', date: expect.any(String) }
    });
    expect(jams.items[1].weekly).toMatchObject({ contextType: 'weekly-jam', label: 'Weekly Jams', weekLabel: 'Last Week' });
  });

  test('no weekly playlists: only the songs section', async () => {
    const result = await run([entry('explore', 'Weekly Exploration for someone', 1, 'weekly-exploration')], {
      createdfor: [entry('other', 'Top Discoveries of 2025 for someone', 0, null)]
    });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].items[0].type).toBe('song');
  });

  test('weeklies still come back when the recommendations list is empty', async () => {
    const result = await run([], { createdfor: weeks('Jams', 2, 'j') });
    expect(result.sections.map(s => s.id)).toEqual(['weekly-jams']);
    expect(result.sections[0].items.map(i => i.id)).toEqual(['j0', 'j1']);
  });

  test('weeklies still come back when no recommendation playlist type is recognised', async () => {
    const result = await run(
      [entry('top-disc', 'Top Discoveries of 2025 for someone', 0, 'top-discoveries-of-2025')],
      { createdfor: weeks('Exploration', 1, 'x') }
    );
    expect(result.sections.map(s => s.id)).toEqual(['weekly-exploration']);
  });

  test('createdfor failure throws', async () => {
    await expect(run([entry('explore', 'Weekly Exploration for someone', 1, 'weekly-exploration')], { createdforStatus: 500 }))
      .rejects.toThrow(/500/);
  });
});

describe('ListenBrainz getSimilarUsers', () => {
  // The similar-users list, then each person's artist stats: `stats` maps
  // `user|range` to artist names, a missing entry answers 204 (no stats).
  const mockSimilar = (payload, stats = {}, failStats = false) => {
    requested = [];
    global.fetch = async (url) => {
      requested.push(url);
      const m = url.match(/\/stats\/user\/([^/]+)\/artists\?range=([a-z_]+)&count=3$/);
      if (m) {
        if (failStats) throw new Error('network');
        const names = stats[`${decodeURIComponent(m[1])}|${m[2]}`];
        if (!names) return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
        return { ok: true, status: 200, json: async () => ({ payload: { artists: names.map(n => ({ artist_name: n, listen_count: 1 })) } }) };
      }
      return { ok: true, status: 200, json: async () => ({ payload }) };
    };
  };

  test('getSimilarUsers maps and sorts the similar-users answer', async () => {
    mockSimilar([
      { user_name: 'low', similarity: 0.2 },
      { user_name: 'high', similarity: 0.9 },
      { similarity: 0.5 },
      { user_name: 'mid', similarity: 0.5 }
    ], { 'low|this_month': ['A'], 'high|this_month': ['B'], 'mid|month': ['C'] });
    const users = await getSimilarUsers({ username: 'some one' });
    expect(requested[0]).toBe('https://api.listenbrainz.org/1/user/some%20one/similar-users');
    expect(users).toEqual([
      { username: 'high', similarity: 0.9, topArtists: ['B'] },
      { username: 'mid', similarity: 0.5, topArtists: ['C'] },
      { username: 'low', similarity: 0.2, topArtists: ['A'] }
    ]);
  });

  test('only active listeners are kept, each with this month\'s top 3 artists, else last month\'s, from the 20 most similar', async () => {
    const payload = Array.from({ length: 22 }, (_, i) => ({ user_name: `u${i}`, similarity: 1 - i / 100 }));
    const stats = { 'u0|this_month': ['A', 'B', 'C'], 'u1|month': ['D', 'E'], 'u21|this_month': ['Z'] };
    mockSimilar(payload, stats);
    const users = await getSimilarUsers({ username: 'me' });
    // u0 played this month, u1 last month (this month's 204); u2..u19 have
    // no stats either month: inactive, dropped. u20 and u21 are past the 20
    // checked, so they are dropped unchecked.
    expect(users.map(u => u.username)).toEqual(['u0', 'u1']);
    expect(users[0].topArtists).toEqual(['A', 'B', 'C']);
    expect(users[1].topArtists).toEqual(['D', 'E']);
    // Only the 20 most similar are asked about.
    const asked = new Set(requested.filter(u => u.includes('/stats/')).map(u => u.match(/user\/([^/]+)\//)[1]));
    expect(asked.size).toBe(20);
    expect(asked.has('u20')).toBe(false);
    expect(requested).toContain('https://api.listenbrainz.org/1/stats/user/u0/artists?range=this_month&count=3');
    // u0 had this month, so last month was never asked.
    expect(requested).not.toContain('https://api.listenbrainz.org/1/stats/user/u0/artists?range=month&count=3');
  });

  test('a failed stats request is not "inactive": the person stays, without the line', async () => {
    mockSimilar([{ user_name: 'a', similarity: 0.5 }], {}, true);
    expect(await getSimilarUsers({ username: 'me' })).toEqual([{ username: 'a', similarity: 0.5 }]);
  });

  test('getSimilarUsers without a username makes no request', async () => {
    requested = [];
    global.fetch = async (url) => { requested.push(url); return { ok: true, json: async () => [] }; };
    expect(await getSimilarUsers({})).toEqual([]);
    expect(requested).toHaveLength(0);
  });

  test('getSimilarUsers failure throws', async () => {
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(getSimilarUsers({ username: 'someone' })).rejects.toThrow(/500/);
  });
});

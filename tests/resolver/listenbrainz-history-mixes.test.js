/**
 * ListenBrainz's history mixes (the plugin's getHistoryMixes,
 * capabilities.historyMixes): the newest Daily Jams and Weekly Jams.
 */
const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/listenbrainz.axe'), 'utf8'));
const getHistoryMixes = new Function('return ' + axe.implementation.getHistoryMixes)();
const getRecommendations = new Function('return ' + axe.implementation.getRecommendations)();

const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
const entry = (id, title, daysAgo, patch) => ({
  playlist: {
    identifier: `https://listenbrainz.org/playlist/${id}`,
    title,
    date: iso(daysAgo),
    extension: { 'https://musicbrainz.org/doc/jspf#playlist': { additional_metadata: { algorithm_metadata: { source_patch: patch } } } }
  }
});
const list = [
  entry('exp-new', 'Weekly Exploration for someone, week of 2026-11-09', 1, 'weekly-exploration'),
  entry('daily-old', 'Daily Jams for someone, 2026-11-10', 2, 'daily-jams'),
  entry('daily-new', 'Daily Jams for someone, 2026-11-11', 1, 'daily-jams'),
  entry('weekly-old', 'Weekly Jams for someone, week of 2026-11-02', 9, 'weekly-jams'),
  entry('weekly-new', 'Weekly Jams for someone, week of 2026-11-09', 3, 'weekly-jams')
];

const stub = (status = 200) => {
  global.fetch = jest.fn(async (url) => {
    if (url.includes('/playlists/recommendations')) return { ok: status === 200, status, json: async () => ({ playlists: list }) };
    if (url.includes('/playlists/createdfor')) return { ok: true, status: 200, json: async () => ({ playlists: list }) };
    return { ok: true, status: 200, json: async () => ({ playlist: { track: [] } }) };
  });
};

describe('ListenBrainz history mixes (capabilities.historyMixes)', () => {
  afterEach(() => { delete global.fetch; });

  test('the manifest declares the capability', () => {
    expect(axe.capabilities.historyMixes).toBe(true);
  });

  test('answers exactly the newest Daily and Weekly Jams', async () => {
    stub();
    const { mixes } = await getHistoryMixes({ username: 'someone' });
    expect(mixes.map(m => m.id)).toEqual(['daily-new', 'weekly-new']);
    expect(mixes.every(m => m.type === 'playlist' && m.url === `https://listenbrainz.org/playlist/${m.id}/`)).toBe(true);
    expect(mixes[0].description).toBeTruthy();
  });

  test('the Weekly Jams id is the one getRecommendations uses for it', async () => {
    stub();
    const { mixes } = await getHistoryMixes({ username: 'someone' });
    const { sections } = await getRecommendations({ username: 'someone' });
    const jams = sections.find(s => s.id === 'weekly-jams');
    const weekly = jams.items.find(i => i.id === mixes[1].id);
    expect(weekly).toBeTruthy();
    expect(weekly.url).toBe(mixes[1].url);
  });

  test('no username is a miss without a request', async () => {
    stub();
    expect(await getHistoryMixes({})).toEqual({ mixes: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a 503 rejects', async () => {
    jest.useFakeTimers();
    stub(503);
    const p = getHistoryMixes({ username: 'someone' });
    const assertion = expect(p).rejects.toThrow(/503/);
    await jest.runAllTimersAsync();
    await assertion;
    jest.useRealTimers();
  });
});

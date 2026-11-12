/**
 * ListenBrainz's history mixes (the plugin's getHistoryMixes,
 * capabilities.historyMixes): the newest Daily Jams and Weekly Jams.
 */
const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/listenbrainz.axe'), 'utf8'));
const getHistoryMixes = new Function('return ' + axe.implementation.getHistoryMixes)();
const lookupPlaylist = new Function('return ' + axe.implementation.lookupPlaylist)();
const ResolverLoader = require('../../resolver-loader');
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

describe('ListenBrainz playlist links (urlLookup, lookupPlaylist)', () => {
  afterEach(() => { delete global.fetch; jest.useRealTimers(); });

  const loader = () => {
    const l = new ResolverLoader();
    for (const pattern of axe.urlPatterns) l.urlPatterns.push({ pattern, resolverId: 'listenbrainz' });
    return l;
  };

  test('the manifest declares urlLookup and the patterns', () => {
    expect(axe.capabilities.urlLookup).toBe(true);
    expect(axe.manifest.version).toBe('1.5.0');
  });

  test.each([
    'https://listenbrainz.org/playlist/abc-123/',
    'https://listenbrainz.org/playlist/abc-123',
    'https://www.listenbrainz.org/playlist/abc-123/',
  ])('%s is a ListenBrainz playlist', (url) => {
    const l = loader();
    expect(l.findResolverForUrl(url)).toBe('listenbrainz');
    expect(l.getUrlType(url)).toBe('playlist');
  });

  test('other ListenBrainz pages are not claimed', () => {
    expect(loader().findResolverForUrl('https://listenbrainz.org/user/someone/')).toBeNull();
  });

  test('lookupPlaylist maps the JSPF to tracks', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ playlist: { title: 'Daily Jams', creator: 'listenbrainz', track: [
        { title: 'One', creator: 'A', album: 'Alb', duration: 201500, identifier: ['https://musicbrainz.org/recording/m-1'] },
        { creator: 'no title' },
        { title: 'Two', creator: 'B', identifier: [] }
      ] } })
    }));
    const pl = await lookupPlaylist('https://listenbrainz.org/playlist/abc-123/', {});
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.listenbrainz.org/1/playlist/abc-123');
    expect(pl.name).toBe('Daily Jams');
    expect(pl.creator).toBe('listenbrainz');
    expect(pl.tracks).toEqual([
      { artist: 'A', title: 'One', album: 'Alb', duration: 201, mbid: 'm-1' },
      { artist: 'B', title: 'Two', duration: null }
    ]);
  });

  test('a 503 rejects', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const assertion = expect(lookupPlaylist('https://listenbrainz.org/playlist/abc-123/', {})).rejects.toThrow(/503/);
    await jest.runAllTimersAsync();
    await assertion;
  });
});

describe('typeOf title-prefix fallback', () => {
  afterEach(() => { delete global.fetch; });
  test('entries without a source_patch are classified by title', async () => {
    const bare = (id, title, d) => ({ playlist: { identifier: `https://listenbrainz.org/playlist/${id}`, title, date: iso(d) } });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ playlists: [
      bare('d1', 'Daily Jams for x', 1), bare('w1', 'Weekly Jams for x', 2), bare('e1', 'Weekly Exploration for x', 1), bare('y', 'Top Discoveries of 2025', 1)
    ] }) }));
    const { mixes } = await getHistoryMixes({ username: 'x' });
    expect(mixes.map(m => m.id)).toEqual(['d1', 'w1']);
  });
});

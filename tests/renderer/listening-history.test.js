// Your listening history from every plug-in that keeps it (#1539 step 4):
// the period table, which sources count, the merges, the loader, and the
// wiring in app.js and the History page.

const fs = require('fs');
const path = require('path');
const { HISTORY_PERIODS, historyPeriodFor, signedInSources, mergeRecentListens, mergeArtistNames } = require('../../src/renderer/lib/listening-history');
const { historyPeriodOptions } = require('../../src/renderer/lib/history-options');
const ResolverLoader = require('../../resolver-loader');

describe('lib/listening-history', () => {
  test('every period in the menu maps to a plug-in period', () => {
    for (const { value } of historyPeriodOptions) expect(HISTORY_PERIODS[value]).toBeTruthy();
    expect(historyPeriodFor('7day')).toBe('week');
    expect(historyPeriodFor('overall')).toBe('all');
    expect(historyPeriodFor('nonsense')).toBe('all');
  });

  test('sources are the plug-ins you have a username for, in the order given', () => {
    const providers = [{ id: 'listenbrainz' }, { id: 'lastfm' }, { id: 'other' }];
    expect(signedInSources(providers, { lastfm: { username: 'me' }, listenbrainz: { username: 'me2' }, other: {} }).map((r) => r.id))
      .toEqual(['listenbrainz', 'lastfm']);
    expect(signedInSources(providers, {})).toEqual([]);
  });

  test('recent listens merge newest first, one per song per five minutes, each keeping its source', () => {
    const t = 1700000000000;
    const merged = mergeRecentListens([
      { id: 'a', items: [{ title: 'Song', artist: 'Band', playedAt: t }, { title: 'Old', artist: 'Band', playedAt: t - 3600000 }] },
      { id: 'b', items: [{ title: 'song ', artist: 'band', playedAt: t + 1000 }, { title: 'Other', artist: 'X', playedAt: t + 60000 }] },
    ]);
    expect(merged.map((m) => [m.title, m.source])).toEqual([['Other', 'b'], ['song ', 'b'], ['Old', 'a']]);
  });

  test('artist names merge, first spelling kept', () => {
    expect(mergeArtistNames([[{ name: 'Band' }, { name: 'X' }], [{ name: 'band ' }, { name: 'Y' }], null]))
      .toEqual([{ name: 'Band' }, { name: 'X' }, { name: 'Y' }]);
  });
});

describe('resolver-loader', () => {
  const loader = new ResolverLoader();
  beforeEach(() => loader.resolvers.clear());
  const register = (id, impl, capabilities = { listeningHistory: true }) => loader.resolvers.set(id, { id, capabilities, config: {}, ...impl });

  test('getNowPlaying is optional: null without the method, a checked answer with it', async () => {
    register('a', { getTopItems: async () => [], getRecentListens: async () => [], getNowPlaying: async (q) => ({ title: 'T', artist: q.user }) });
    register('b', { getTopItems: async () => [], getRecentListens: async () => [] });
    register('c', { getTopItems: async () => [], getRecentListens: async () => [], getNowPlaying: async () => ({ title: '', artist: 'x' }) });
    await expect(loader.getNowPlaying('a', { user: 'friend' })).resolves.toEqual({ title: 'T', artist: 'friend' });
    await expect(loader.getNowPlaying('b', { user: 'friend' })).resolves.toBeNull();
    await expect(loader.getNowPlaying('c', { user: 'friend' })).resolves.toBeNull();
  });

  test('lists plug-ins with the capability and both methods', () => {
    register('a', { getTopItems: async () => [], getRecentListens: async () => [] });
    register('b', { getTopItems: async () => [] });
    register('c', { getTopItems: async () => [], getRecentListens: async () => [] }, {});
    expect(loader.getListeningHistoryResolvers().map((r) => r.id)).toEqual(['a']);
  });

  test('drops unnamed rows by kind, passes null through, rejects on a throw', async () => {
    register('a', {
      getTopItems: async (q) => (q.kind === 'artists' ? [{ name: 'Band' }, { name: '' }] : (q.user === 'nobody' ? null : [{ title: 'T', artist: 'A' }, { title: ' ' }])),
      getRecentListens: async () => { throw new Error('down'); },
    });
    await expect(loader.getTopItems('a', { kind: 'artists' })).resolves.toEqual([{ name: 'Band' }]);
    await expect(loader.getTopItems('a', { kind: 'tracks' })).resolves.toEqual([{ title: 'T', artist: 'A' }]);
    await expect(loader.getTopItems('a', { kind: 'tracks', user: 'nobody' })).resolves.toBeNull();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loader.getRecentListens('a', {})).rejects.toThrow('down');
    spy.mockRestore();
    await expect(loader.getTopItems('missing', { kind: 'tracks' })).resolves.toBeNull();
  });
});

describe('app.js and the History page ask the plug-ins', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/history-page.js'), 'utf8');
  const fn = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start) + start.length));

  test('your own stats are never fetched by service name', () => {
    const own = [
      fn('const fetchListeningContext = async', '// Conversational DJ'),
      fn('const loadListeningHistory = async', 'const topListFailed = '),
      fn('const loadTopTracks = async', 'const resolveTopArtistImages = async'),
      fn('const loadTopAlbums = async', 'const pickHistorySource = '),
      fn('const gatherNewReleasesArtists = async', '// Shuffle each source'),
      fn('const gatherConcertsArtists = async', '// Interleave sources so each gets fair representation\n    const maxArtists = 40;'),
    ];
    for (const body of own) {
      expect(body.length).toBeGreaterThan(100);
      expect(body).not.toMatch(/ws\.audioscrobbler\.com|api\.listenbrainz\.org|metaServiceConfigs\.(lastfm|listenbrainz)/);
    }
    expect(app).not.toMatch(/const loadLastfmHistory|const loadListenbrainzHistory/);
  });

  test('top lists come from one source, recent listens from all of them', () => {
    expect(fn('const loadTopTracks = async', 'const loadTopArtists')).toContain('const source = historyTopSource();');
    expect(fn('const loadListeningHistory = async', 'const topListFailed = ')).toContain('await askEach(sources, (p) => askRecentListens(p.id, { limit: 50 }));');
    expect(app).toContain("const historySourcesFor = () => signedInSources(similarProvidersFor('listeningHistory'), metaServiceConfigsRef.current || {});");
  });

  test('the page names its sources and offers a Source menu, never a service by name', () => {
    expect(page).not.toMatch(/'lastfm'|'listenbrainz'|metaServiceConfigs/);
    expect(page).toContain("`Your listening activity from ${signedIn.map(c => c.label).join(' & ')}`");
    expect(page).toContain('onChange: (v) => pickHistorySource(v),');
    // Every "Connect …" offer lists the plug-ins that keep history.
    expect(page.match(/historyErrorState\(/g)).toHaveLength(4);
    expect(page.match(/, services\)\n/g)).toHaveLength(4);
  });

  test('a friend\'s listening comes from their plug-in, never a service by name (#1539 step 5)', () => {
    for (const [start, end] of [
      ['const fetchFriendRecentTrack = async', '\n  };\n'],
      ['const fetchFriendWeeklyStats = async', '\n  };\n'],
      ['const fetchTransientFriendNowPlaying = async', '\n  };\n'],
      ['const loadFriendRecentTracks = async', '\n  };\n'],
      ['const fetchFriendTopTracksList = async', '\n  };\n'],
      ['const loadFriendTopArtists = async', '\n  };\n'],
      ['const loadFriendTopAlbums = async', '\n  };\n'],
    ]) {
      const body = fn(start, end);
      expect([start, body.length > 100]).toEqual([start, true]);
      expect([start, /ws\.audioscrobbler\.com|api\.listenbrainz\.org|service === '(lastfm|listenbrainz)'/.test(body)]).toEqual([start, false]);
      expect([start, body.includes('askFriend(')]).toEqual([start, true]);
    }
    expect(app).toContain("const out = await resolverLoaderRef.current[method](friend.service, { ...query, user: friend.username }, await configForSimilar(friend.service));");
  });
});

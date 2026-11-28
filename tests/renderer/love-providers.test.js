/**
 * lib/love-providers.js: loves as a plug-in capability (parachord#1559 step
 * 2). The manifest field, the registry, which plug-ins are love providers,
 * the page shape the import reads, and Last.fm's and ListenBrainz's
 * providers over their scrobblers.
 */

const LP = require('../../src/renderer/lib/love-providers');
const LoveImport = require('../../src/renderer/lib/love-import');

const MBID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

afterEach(() => LP.clearLoveProviders());

describe('the manifest field', () => {
  test('a valid one, trimmed, canImport only when true', () => {
    expect(LP.loveDescriptor({ contract: 1, verb: ' Love ', needs: 'mbid', canImport: true }))
      .toEqual({ contract: 1, verb: 'Love', needs: 'mbid', canImport: true, pageSize: null });
    expect(LP.loveDescriptor({ contract: 1, verb: 'Like', needs: 'serviceId' }).canImport).toBe(false);
  });

  test('an unknown contract, a missing verb or an unknown needs is no field at all', () => {
    expect(LP.loveDescriptor({ contract: 2, verb: 'Love', needs: 'name' })).toBeNull();
    expect(LP.loveDescriptor({ contract: '1', verb: 'Love', needs: 'name' })).toBeNull();
    expect(LP.loveDescriptor({ contract: 1, verb: ' ', needs: 'name' })).toBeNull();
    expect(LP.loveDescriptor({ contract: 1, verb: 'Love', needs: 'isrc' })).toBeNull();
    expect(LP.loveDescriptor(null)).toBeNull();
    expect(LP.loveDescriptor(true)).toBeNull();
  });

  test('Last.fm and ListenBrainz declare it', () => {
    expect(LP.loveDescriptor(require('../../plugins-src/lastfm/manifest.json').loves))
      .toEqual({ contract: 1, verb: 'Love', needs: 'name', canImport: true, pageSize: null });
    expect(LP.loveDescriptor(require('../../plugins-src/listenbrainz/manifest.json').loves))
      .toEqual({ contract: 1, verb: 'Love', needs: 'mbid', canImport: true, pageSize: null });
    // Libre.fm scrobbles but has no loves.
    expect(require('../../plugins-src/librefm/manifest.json').loves).toBeUndefined();
  });
});

describe('which plug-ins are love providers', () => {
  const provider = (id, over = {}) => ({ id, isSignedIn: async () => true, loveTrack: async () => ({ ok: true }), ...over });

  test('a declared plug-in with a registered provider, in the plug-ins\' order', () => {
    LP.registerLoveProvider(provider('b'));
    LP.registerLoveProvider(provider('a'));
    const services = [
      { id: 'a', loves: { contract: 1, verb: 'Love', needs: 'name', canImport: true } },
      { id: 'c', loves: { contract: 1, verb: 'Love', needs: 'name' } }, // no provider
      { id: 'b', loves: { contract: 1, verb: 'Like', needs: 'serviceId' } },
    ];
    expect(LP.loveProviderIds(services)).toEqual(['a', 'b']);
    expect(LP.lovesOf(services[2]).verb).toBe('Like');
  });

  test('a plug-in installed before the field ships still loves, through the provider\'s own description', () => {
    LP.registerLoveProvider(provider('lastfm', { getLovedPage: async () => ({ items: [], next: null }), defaultLoves: { contract: 1, verb: 'Love', needs: 'name', canImport: true } }));
    expect(LP.lovesOf({ id: 'lastfm', capabilities: { lovedTracks: true } })).toEqual({ contract: 1, verb: 'Love', needs: 'name', canImport: true, pageSize: null });
    // Without lovedTracks, and without a provider, nothing.
    expect(LP.lovesOf({ id: 'lastfm', capabilities: {} })).toBeNull();
    expect(LP.lovesOf({ id: 'other', capabilities: { lovedTracks: true } })).toBeNull();
  });

  test('a provider without its methods is refused', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    LP.registerLoveProvider({ id: 'x', isSignedIn: async () => true });
    expect(LP.getLoveProvider('x')).toBeNull();
  });
});

describe('a page, as the import reads it', () => {
  test('names each love for its service, looks up a nameless MBID, skips the unnameable', () => {
    const page = LP.lovedPageForImport({
      items: [
        { artist: ' A ', title: 'T', album: 'Al', lovedAt: 100.4 },
        { mbid: MBID, lovedAt: 99 },
        { artist: 'Only artist', lovedAt: 98 },
        { artist: 'B', title: 'U', mbid: 'not-an-mbid', lovedAt: 0, source: { id: 's1' } },
      ],
      skipped: 2,
      total: 40,
      next: 'p2',
    }, 'svc');
    expect(page.loves).toEqual([
      { artist: 'A', title: 'T', album: 'Al', mbid: null, lovedAt: 100, service: 'svc' },
      { artist: '', title: '', album: '', mbid: MBID, lovedAt: 99, service: 'svc', needsLookup: true },
      { artist: 'B', title: 'U', album: '', mbid: null, lovedAt: null, service: 'svc', source: { id: 's1' } },
    ]);
    expect(page.skipped).toBe(3);
    expect(page.total).toBe(40);
    expect(page.returned).toBe(4);
    expect(page.next).toBe('p2');
    expect(LP.lovedPageForImport({ items: [] }, 'svc').next).toBeNull();
  });
});

describe('Last.fm\'s provider', () => {
  const scrobbler = () => ({
    id: 'lastfm',
    isSignedIn: jest.fn(async () => true),
    loveTrack: jest.fn(async () => true),
    getLovedTracksPage: jest.fn(async ({ page }) => ({
      lovedtracks: {
        '@attr': { total: '3', totalPages: '2' },
        track: page === 1
          ? [{ name: 'T1', artist: { name: 'A' }, date: { uts: '300' } }, { name: 'T2', artist: { name: 'A' }, date: { uts: '200' } }]
          : [{ name: 'T3', artist: { name: 'A' }, date: { uts: '100' } }],
      },
    })),
  });

  test('loves by name, with a valid MBID riding along', async () => {
    const s = scrobbler();
    const p = LP.lastfmLoveProvider(s);
    await expect(p.loveTrack({ artist: 'A', title: 'T', mbid: 'junk' })).resolves.toEqual({ ok: true });
    expect(s.loveTrack).toHaveBeenLastCalledWith({ artist: 'A', title: 'T', mbid: undefined });
    await p.loveTrack({ artist: 'A', title: 'T', mbid: MBID });
    expect(s.loveTrack).toHaveBeenLastCalledWith({ artist: 'A', title: 'T', mbid: MBID });
  });

  test('a refused love throws, so it is never read as done', async () => {
    const s = scrobbler();
    s.loveTrack.mockRejectedValue(new Error('Last.fm 11'));
    await expect(LP.lastfmLoveProvider(s).loveTrack({ artist: 'A', title: 'T' })).rejects.toThrow('Last.fm 11');
  });

  test('pages by page number for the account given, and says when it was the last', async () => {
    const s = scrobbler();
    const p = LP.lastfmLoveProvider(s);
    const one = await p.getLovedPage({ cursor: null, account: 'someone' });
    expect(s.getLovedTracksPage).toHaveBeenLastCalledWith({ page: 1, count: 200, username: 'someone' });
    expect(one).toMatchObject({ total: 3, returned: 2, next: 2 });
    expect(one.items.map((i) => i.title)).toEqual(['T1', 'T2']);
    const two = await p.getLovedPage({ cursor: one.next, account: 'someone' });
    expect(s.getLovedTracksPage).toHaveBeenLastCalledWith({ page: 2, count: 200, username: 'someone' });
    expect(two.next).toBeNull();
  });
});

describe('ListenBrainz\'s provider', () => {
  const scrobbler = (pages) => ({
    id: 'listenbrainz',
    isSignedIn: jest.fn(async () => true),
    loveTrack: jest.fn(async () => true),
    getLovedTracksPage: jest.fn(async ({ offset }) => pages[offset]),
  });

  test('finds the recording MBID itself, and a track it can\'t place is no-match, not a guess', async () => {
    const s = scrobbler({});
    const resolveMbid = jest.fn(async (t) => (t.title === 'Known' ? MBID : null));
    const p = LP.listenbrainzLoveProvider(s, { resolveMbid });
    await expect(p.loveTrack({ artist: 'A', title: 'Known' })).resolves.toEqual({ ok: true, ref: MBID });
    expect(s.loveTrack).toHaveBeenCalledWith({ artist: 'A', title: 'Known', mbid: MBID });
    await expect(p.loveTrack({ artist: 'A', title: 'Unknown' })).resolves.toEqual({ ok: false, reason: 'no-match' });
    expect(s.loveTrack).toHaveBeenCalledTimes(1);
  });

  test('pages by offset, advanced by what came back, until the total', async () => {
    const fb = (n, created) => ({ recording_mbid: MBID, created, track_metadata: { artist_name: 'A', track_name: `T${n}` } });
    const s = scrobbler({ 0: { feedback: [fb(1, 30), fb(2, 20)], total_count: 3 }, 2: { feedback: [fb(3, 10)], total_count: 3 } });
    const p = LP.listenbrainzLoveProvider(s, { resolveMbid: async () => null });
    const one = await p.getLovedPage({ cursor: null, account: 'u' });
    expect(s.getLovedTracksPage).toHaveBeenLastCalledWith({ offset: 0, count: 100, username: 'u' });
    expect(one.next).toBe(2);
    const two = await p.getLovedPage({ cursor: 2, account: 'u' });
    expect(two.next).toBeNull();
    expect(two.items[0]).toMatchObject({ title: 'T3', mbid: MBID, lovedAt: 10 });
  });
});

describe('the built-in registration', () => {
  test('wraps the two scrobblers on window, and ListenBrainz\'s MBID comes from resolveMbidForLove', async () => {
    const lb = { id: 'listenbrainz', isSignedIn: async () => true, loveTrack: jest.fn(async () => true) };
    const win = {
      lastfmScrobbler: { id: 'lastfm', isSignedIn: async () => true, loveTrack: async () => true },
      listenbrainzScrobbler: lb,
      resolveMbidForLove: jest.fn(async () => MBID),
    };
    LP.registerBuiltInLoveProviders(win);
    expect(LP.getLoveProvider('lastfm').defaultLoves.needs).toBe('name');
    await LP.getLoveProvider('listenbrainz').loveTrack({ artist: 'A', title: 'T' });
    expect(win.resolveMbidForLove).toHaveBeenCalled();
    expect(lb.loveTrack).toHaveBeenCalledWith({ artist: 'A', title: 'T', mbid: MBID });
  });
});

describe('the import walk follows a page cursor', () => {
  test('each page is asked with the last one\'s next, and a null next ends the walk', async () => {
    const asked = [];
    const pages = { start: { items: [{ artist: 'A', title: '1', lovedAt: 3 }], next: 'p2' }, p2: { items: [{ artist: 'A', title: '2', lovedAt: 2 }], next: null } };
    const out = await LoveImport.collectLoves({
      fetchPage: async ({ pageCursor }) => { asked.push(pageCursor); return pages[pageCursor || 'start']; },
      parse: (page) => LP.lovedPageForImport(page, 'svc'),
      pageGapMs: 0,
    });
    expect(asked).toEqual([null, 'p2']);
    expect(out.loves.map((l) => l.title)).toEqual(['1', '2']);
    expect(out.complete).toBe(true);
  });
});

describe('a plug-in\'s own loves (#1559 step 3)', () => {
  const plugin = (over = {}) => ({
    id: 'myserver',
    loves: { contract: 1, verb: 'Love', needs: 'serviceId', canImport: true },
    isConfigured: (c) => !!(c && c.serverUrl),
    loveTrack: jest.fn(async (track) => ({ ok: true, ref: track.sources.myserver.songId })),
    getLovedPage: jest.fn(async () => ({ items: [], next: null })),
    search: jest.fn(async () => [{ songId: 'found', artist: 'A', title: 'T' }]),
    ...over,
  });

  test('a plug-in with loveTrack is a provider with no registration; without getLovedPage it can\'t import', () => {
    expect(LP.lovesOf(plugin())).toMatchObject({ needs: 'serviceId', canImport: true });
    expect(LP.lovesOf(plugin({ getLovedPage: undefined })).canImport).toBe(false);
    expect(LP.lovesOf(plugin({ loveTrack: undefined }))).toBeNull();
    expect(LP.lovesOf(plugin({ loves: null }))).toBeNull();
    expect(LP.loveProviderIds([plugin(), { id: 'other' }])).toEqual(['myserver']);
  });

  test('its verified source is used as is; no search', async () => {
    const p = plugin();
    const provider = LP.loveProviderFor(p, { getConfig: async () => ({ serverUrl: 'x' }) });
    await expect(provider.loveTrack({ artist: 'A', title: 'T', sources: { myserver: { songId: 'mine', confidence: 0.9 } } }))
      .resolves.toEqual({ ok: true, ref: 'mine' });
    expect(p.search).not.toHaveBeenCalled();
    expect(p.loveTrack.mock.calls[0][1]).toEqual({ serverUrl: 'x' });
  });

  test('a source under the confidence floor, or a noMatch marker, is searched again and picked', async () => {
    for (const weak of [{ songId: 'weak', confidence: 0.5 }, { noMatch: true }]) {
      const p = plugin();
      const provider = LP.loveProviderFor(p, { getConfig: async () => ({}) });
      await expect(provider.loveTrack({ artist: 'A', title: 'T', sources: { myserver: weak } })).resolves.toEqual({ ok: true, ref: 'found' });
      expect(p.search).toHaveBeenCalledWith('A T', {});
    }
  });

  test('a plug-in answering anything but ok is no-match', async () => {
    const provider = LP.loveProviderFor(plugin({ loveTrack: async () => false }), { getConfig: async () => ({}) });
    await expect(provider.loveTrack({ artist: 'A', title: 'T', sources: { myserver: { songId: 's' } } })).resolves.toEqual({ ok: false, reason: 'no-match' });
  });

  test('its rows read set up from its own isConfigured', () => {
    expect(LP.loveRowState(plugin(), { name: 'My Server', pluginConfig: { serverUrl: 'x' } })).toMatchObject({ signedIn: true, importReady: true });
    expect(LP.loveRowState(plugin(), { name: 'My Server', pluginConfig: {} })).toMatchObject({ signedIn: false, importReady: false, signedOutHint: 'Set up My Server first' });
  });

  test('the manifest\'s pageSize is the provider\'s; absent or absurd means 500', () => {
    const sized = LP.loveProviderFor(plugin({ loves: { contract: 1, verb: 'Love', needs: 'serviceId', canImport: true, pageSize: 50 } }), { getConfig: async () => ({}) });
    expect(sized.pageSize).toBe(50);
    expect(LP.loveProviderFor(plugin(), { getConfig: async () => ({}) }).pageSize).toBe(500);
    expect(LP.loveDescriptor({ contract: 1, verb: 'Love', needs: 'name', canImport: true, pageSize: 'many' }).pageSize).toBeNull();
    expect(LP.loveDescriptor({ contract: 1, verb: 'Love', needs: 'name', canImport: true, pageSize: 9999 }).pageSize).toBeNull();
  });
});

describe('a plug-in that signs in itself (its own isSignedIn — Amazon Music)', () => {
  const sessionPlugin = (over = {}) => ({
    id: 'amazonmusic',
    loves: { contract: 1, verb: 'Like', needs: 'serviceId', canImport: true },
    isSignedIn: jest.fn(async () => true),
    loveTrack: jest.fn(async () => ({ ok: true })),
    getLovedPage: jest.fn(async () => ({ items: [], next: null })),
    ...over,
  });

  test('its sign-in is its own isSignedIn, not its config (it has none that says)', async () => {
    const p = sessionPlugin({ isSignedIn: jest.fn(async () => false) });
    const provider = LP.loveProviderFor(p, { getConfig: async () => ({}) });
    await expect(provider.isSignedIn()).resolves.toBe(false);
    expect(p.isSignedIn).toHaveBeenCalledWith({});
    const signedIn = LP.loveProviderFor(sessionPlugin(), { getConfig: async () => ({}) });
    await expect(signedIn.isSignedIn()).resolves.toBe(true);
    // Whose loves: its own account, never a config username (Amazon's list is
    // the session's own — there is no public by-username list).
    await expect(signedIn.importAccount()).resolves.toBe('amazonmusic');
  });

  test('a plug-in without isSignedIn falls back to configured (Subsonic)', async () => {
    const p = sessionPlugin({ isSignedIn: undefined, isConfigured: (c) => !!(c && c.ready) });
    const provider = LP.loveProviderFor(p, { getConfig: async () => ({ ready: true }) });
    await expect(provider.isSignedIn()).resolves.toBe(true);
    const providerOff = LP.loveProviderFor(p, { getConfig: async () => ({}) });
    await expect(providerOff.isSignedIn()).resolves.toBe(false);
  });

  test('its rows read the sign-in the app knows: signed in means the import can read', () => {
    expect(LP.loveRowState(sessionPlugin(), { name: 'Amazon Music', signedIn: true }))
      .toMatchObject({ signedIn: true, importReady: true });
    expect(LP.loveRowState(sessionPlugin(), { name: 'Amazon Music', signedIn: false }))
      .toMatchObject({ signedIn: false, importReady: false, signedOutHint: 'Sign in to Amazon Music first' });
  });
});

describe('the words a verb makes', () => {
  test('Love, Star, and a verb it doesn\'t know', () => {
    expect(LP.loveWords('Love')).toEqual({ verb: 'Love', plural: 'loves', past: 'loved', tracksNoun: 'loved tracks' });
    expect(LP.loveWords('Star')).toMatchObject({ plural: 'stars', past: 'starred', tracksNoun: 'starred tracks' });
    expect(LP.loveWords('Heart')).toMatchObject({ verb: 'Heart', plural: 'hearts', past: 'hearted' });
    expect(LP.loveWords(undefined).verb).toBe('Love');
  });
});

describe('an imported love keeps the source it came with', () => {
  test('its row plays from that service straight away; a love without one has none', () => {
    const plan = LoveImport.planLoveImport([
      { artist: 'A', title: 'T', album: '', mbid: null, lovedAt: 100, service: 'myserver', source: { subsonicId: 's1', title: 'T', artist: 'A' } },
      { artist: 'B', title: 'U', album: '', mbid: null, lovedAt: 99, service: 'lastfm' },
    ], [], {});
    expect(plan.add[0].sources).toEqual({ myserver: { subsonicId: 's1', title: 'T', artist: 'A' } });
    expect(plan.add[1].sources).toEqual({});
  });
});

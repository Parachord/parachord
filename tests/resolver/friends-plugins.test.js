/**
 * The friends capability (#1539 step 5, part 2): finding a person, the
 * people you follow, and following or unfollowing, moved out of app.js into
 * the Last.fm and ListenBrainz plug-ins. Loads the built plug-ins.
 */
const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');

const load = (id) => {
  const axe = JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins/${id}.axe`), 'utf8'));
  const fns = {};
  for (const name of ['findUser', 'getFollowing', 'follow', 'unfollow']) {
    if (axe.implementation[name]) fns[name] = new Function('return ' + axe.implementation[name])();
  }
  return { axe, ...fns };
};
const lastfm = load('lastfm');
const listenbrainz = load('listenbrainz');

const KEY = 'secret-key-123';
let calls;
const reply = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });
const mockFetch = (handler) => {
  calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
};
afterEach(() => { delete global.fetch; });

test('both declare friends; only ListenBrainz can follow (Last.fm\'s friend writes are gone)', () => {
  expect(lastfm.axe.capabilities.friends).toBe(true);
  expect(listenbrainz.axe.capabilities.friends).toBe(true);
  expect(typeof lastfm.findUser).toBe('function');
  expect(typeof lastfm.getFollowing).toBe('function');
  expect(lastfm.follow).toBeUndefined();
  expect(lastfm.unfollow).toBeUndefined();
  expect(typeof listenbrainz.follow).toBe('function');
  expect(typeof listenbrainz.unfollow).toBe('function');
});

describe('Last.fm', () => {
  test('findUser: a name or a last.fm link; another service\'s link is null without a request', async () => {
    mockFetch(() => reply({ user: { name: 'RJ', realname: ' Richard ', image: [{}, {}, { '#text': 'a.jpg' }] } }));
    await expect(lastfm.findUser({ query: 'rj' }, { apiKey: KEY })).resolves.toEqual({ username: 'RJ', displayName: 'Richard', avatarUrl: 'a.jpg' });
    expect(new URL(calls[0].url).searchParams.get('method')).toBe('user.getinfo');
    await lastfm.findUser({ query: 'https://www.last.fm/user/Some%20One?x=1' }, { apiKey: KEY });
    expect(new URL(calls[1].url).searchParams.get('user')).toBe('Some One');
    mockFetch(() => reply({}));
    await expect(lastfm.findUser({ query: 'https://listenbrainz.org/user/rob' }, { apiKey: KEY })).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('findUser: no such user is null; a failure throws', async () => {
    mockFetch(() => reply({ error: 6, message: 'User not found' }));
    await expect(lastfm.findUser({ query: 'nobody' }, { apiKey: KEY })).resolves.toBeNull();
    mockFetch(() => reply(null, { ok: false, status: 404 }));
    await expect(lastfm.findUser({ query: 'nobody' }, { apiKey: KEY })).resolves.toBeNull();
    mockFetch(() => reply(null, { ok: false, status: 500 }));
    await expect(lastfm.findUser({ query: 'x' }, { apiKey: KEY })).rejects.toThrow('500');
  });

  test('getFollowing: every page of user.getfriends, for the signed-in user', async () => {
    const page = (n, count) => ({ friends: { '@attr': { totalPages: '2' }, user: Array.from({ length: count }, (_, i) => ({ name: `u${n}-${i}`, realname: '' })) } });
    mockFetch((url) => reply(new URL(url).searchParams.get('page') === '1' ? page(1, 200) : page(2, 3)));
    const out = await lastfm.getFollowing({}, { apiKey: KEY, username: 'me' });
    expect(out).toHaveLength(203);
    expect(out[0]).toEqual({ username: 'u1-0', displayName: 'u1-0', avatarUrl: undefined });
    expect(calls.map((c) => new URL(c.url).searchParams.get('user'))).toEqual(['me', 'me']);
  });

  test('getFollowing: no user is null; a failed first page throws, a later one ends the list', async () => {
    mockFetch(() => reply({}));
    await expect(lastfm.getFollowing({}, { apiKey: KEY })).resolves.toBeNull();
    mockFetch(() => reply(null, { ok: false, status: 503 }));
    await expect(lastfm.getFollowing({}, { apiKey: KEY, username: 'me' })).rejects.toThrow('503');
    mockFetch((url) => (new URL(url).searchParams.get('page') === '1'
      ? reply({ friends: { '@attr': { totalPages: '3' }, user: Array.from({ length: 200 }, (_, i) => ({ name: `u${i}` })) } })
      : reply(null, { ok: false, status: 500 })));
    await expect(lastfm.getFollowing({}, { apiKey: KEY, username: 'me' })).resolves.toHaveLength(200);
  });
});

describe('ListenBrainz', () => {
  test('findUser: the listen count says the user exists; no avatars', async () => {
    mockFetch(() => reply({ payload: { count: 12 } }));
    await expect(listenbrainz.findUser({ query: 'https://listenbrainz.org/user/rob/' }, {})).resolves.toEqual({ username: 'rob', displayName: 'rob' });
    expect(calls[0].url).toBe('https://api.listenbrainz.org/1/user/rob/listen-count');
    mockFetch(() => reply(null, { ok: false, status: 404 }));
    await expect(listenbrainz.findUser({ query: 'nobody' }, {})).resolves.toBeNull();
    mockFetch(() => reply({}));
    await expect(listenbrainz.findUser({ query: 'https://www.last.fm/user/rj' }, {})).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('getFollowing: plain names or objects', async () => {
    mockFetch(() => reply({ following: ['a', { musicbrainz_id: 'b' }, { user_name: 'c' }, {}] }));
    await expect(listenbrainz.getFollowing({}, { username: 'me' })).resolves.toEqual([
      { username: 'a', displayName: 'a' }, { username: 'b', displayName: 'b' }, { username: 'c', displayName: 'c' },
    ]);
    expect(calls[0].url).toBe('https://api.listenbrainz.org/1/user/me/following');
  });

  test('follow and unfollow need the token; an unfollow of a gone account counts as done', async () => {
    mockFetch(() => reply({}));
    await expect(listenbrainz.follow({ user: 'x' }, {})).resolves.toBe(false);
    expect(calls).toHaveLength(0);
    await expect(listenbrainz.follow({ user: 'x' }, { userToken: 'tok' })).resolves.toBe(true);
    expect(calls[0]).toMatchObject({ url: 'https://api.listenbrainz.org/1/user/x/follow', options: { method: 'POST', headers: { Authorization: 'Token tok' } } });
    mockFetch(() => reply(null, { ok: false, status: 404 }));
    await expect(listenbrainz.unfollow({ user: 'x' }, { userToken: 'tok' })).resolves.toBe(true);
    expect(calls[0].options.method).toBe('DELETE');
    mockFetch(() => reply(null, { ok: false, status: 401 }));
    await expect(listenbrainz.follow({ user: 'x' }, { userToken: 'tok' })).rejects.toThrow('401');
  });
});

describe('resolver-loader', () => {
  const loader = new ResolverLoader();
  beforeEach(() => loader.resolvers.clear());
  const register = (id, impl, capabilities = { friends: true }) => loader.resolvers.set(id, { id, capabilities, config: {}, ...impl });

  test('lists plug-ins with the capability, findUser and getFollowing', () => {
    register('a', { findUser: async () => null, getFollowing: async () => [] });
    register('b', { findUser: async () => null });
    register('c', { findUser: async () => null, getFollowing: async () => [] }, {});
    expect(loader.getFriendsResolvers().map((r) => r.id)).toEqual(['a']);
  });

  test('findUser and getFollowing check their answers; a throw rejects', async () => {
    register('a', {
      findUser: async (q) => (q.query === 'x' ? { username: 'X' } : { username: '' }),
      getFollowing: async () => [{ username: 'p' }, { username: ' ' }, null],
    });
    await expect(loader.findUser('a', { query: 'x' })).resolves.toEqual({ username: 'X' });
    await expect(loader.findUser('a', { query: 'y' })).resolves.toBeNull();
    await expect(loader.getFollowing('a', {})).resolves.toEqual([{ username: 'p' }]);
    register('b', { findUser: async () => { throw new Error('down'); }, getFollowing: async () => [] });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loader.findUser('b', { query: 'x' })).rejects.toThrow('down');
    spy.mockRestore();
  });

  test('setFollowing: null without the method (pull-only), true or false from it', async () => {
    register('a', { findUser: async () => null, getFollowing: async () => [], follow: async () => true, unfollow: async () => false });
    register('b', { findUser: async () => null, getFollowing: async () => [] });
    await expect(loader.setFollowing('a', 'follow', { user: 'x' })).resolves.toBe(true);
    await expect(loader.setFollowing('a', 'unfollow', { user: 'x' })).resolves.toBe(false);
    await expect(loader.setFollowing('b', 'follow', { user: 'x' })).resolves.toBeNull();
    await expect(loader.setFollowing('a', 'delete', { user: 'x' })).resolves.toBeNull();
  });
});

describe('app.js asks the plug-ins', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const fn = (start) => app.slice(app.indexOf(start), app.indexOf('\n  };\n', app.indexOf(start)));

  test('no friend lookup, sync, follow or unfollow by service name', () => {
    for (const start of ['const followOnService = async', 'const unfollowOnService = async', 'const syncFriendsFromServices = async', 'const addFriendCore = async', 'const addFriend = async']) {
      const body = fn(start);
      expect([start, body.length > 100]).toEqual([start, true]);
      expect([start, /ws\.audioscrobbler\.com|api\.listenbrainz\.org|service === '(lastfm|listenbrainz)'|metaServiceConfigs\.(lastfm|listenbrainz)/.test(body)]).toEqual([start, false]);
    }
    expect(app).not.toMatch(/const (parseFriendInput|fetchLastfmUserInfo|fetchListenbrainzUserInfo) =|FRIEND_SERVICES/);
  });

  test('Add Friend asks the services you\'re signed in to first, then the rest', () => {
    const body = fn('const addFriend = async');
    expect(body).toContain('const ordered = [...providers.filter(r => signedIn.has(r.id)), ...providers.filter(r => !signedIn.has(r.id))];');
    expect(body).toContain('await askInTurn(ordered, (p) => findFriendOn(p.id, query));');
  });

  test('both meta-service load gates include friends', () => {
    expect(app.match(/axe\.capabilities\?\.friends && axe\.implementation\?\.findUser/g)).toHaveLength(2);
  });
});

/**
 * Last.fm getSimilarUsers: friends-of-friends candidates (top 40 by mutual
 * count), scored by a binary cosine over their 6-month top-artist name sets.
 * Loads the built plugin (plugins/lastfm.axe, produced by
 * scripts/build-axes.js) the way the app materializes it: new Function.
 */
const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/lastfm.axe'), 'utf8'));
const getSimilarUsers = axe.implementation.getSimilarUsers
  ? new Function('return ' + axe.implementation.getSimilarUsers)()
  : null;

const KEY = 'secret-key-123';
const img = (n) => [
  { '#text': `https://img/${n}-s.png`, size: 'small' },
  { '#text': `https://img/${n}-xl.png`, size: 'extralarge' },
  { '#text': `https://img/${n}-m.png`, size: 'medium' }
];
const friendsBody = (names) => ({ friends: { user: names.map((n) => ({ name: n, image: img(n) })) } });
const artistsBody = (names) => ({ topartists: { artist: names.map((n, i) => ({ name: n, '@attr': { rank: String(i + 1) } })) } });

// friends: { user: [names] }, artists: { user: [artist names] } (the 6-month
// list, and the 1-month one unless `recent` has the user); unknown users
// answer error 6. `recentStatus` fails a user's 1-month request.
let calls;
const mock = ({ friends = {}, artists = {}, recent = {}, status = {}, recentStatus = {} } = {}) => {
  calls = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    const method = u.searchParams.get('method');
    const user = u.searchParams.get('user');
    const period = u.searchParams.get('period');
    calls.push({ method, user, period, t: Date.now(), url });
    if (status[user]) return { ok: false, status: status[user], json: async () => ({ error: 29, message: 'rate' }) };
    if (period === '1month' && recentStatus[user]) return { ok: false, status: recentStatus[user], json: async () => ({ error: 8, message: 'down' }) };
    const table = method === 'user.getfriends' ? friends : (period === '1month' && user in recent ? recent : artists);
    if (!(user in table)) return { ok: true, status: 200, json: async () => ({ error: 6, message: 'User not found' }) };
    const body = method === 'user.getfriends' ? friendsBody(table[user]) : artistsBody(table[user]);
    return { ok: true, status: 200, json: async () => body };
  };
};

// Fake timers: advance until the call resolves.
const runPaced = async (config) => {
  const p = getSimilarUsers(config);
  let done = false; let out; let err;
  p.then((v) => { done = true; out = v; }, (e) => { done = true; err = e; });
  while (!done) { await jest.advanceTimersByTimeAsync(250); }
  if (err) throw err;
  return out;
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

const cfg = (extra) => ({ username: 'me', apiKey: KEY, ...extra });

test('no username or apiKey: [] with no request', async () => {
  mock();
  expect(await getSimilarUsers({ username: 'me' })).toEqual([]);
  expect(await getSimilarUsers({ apiKey: KEY })).toEqual([]);
  expect(calls).toHaveLength(0);
});

test('candidates are friends of friends ranked by mutual count, top 40 scored', async () => {
  const friends = { me: ['f1', 'f2', 'f3'], f1: [], f2: [], f3: [] };
  const artists = { me: ['a'] };
  // 45 candidates; c0 is known by all three friends, c1 by two, the rest by one.
  for (let i = 0; i < 45; i++) { artists['c' + i] = ['a']; }
  friends.f1 = ['c0', 'c1', ...Array.from({ length: 22 }, (_, i) => 'c' + (i + 2))];
  friends.f2 = ['c0', 'c1', ...Array.from({ length: 21 }, (_, i) => 'c' + (i + 24))];
  friends.f3 = ['c0'];
  mock({ friends, artists });
  const out = await runPaced(cfg());
  const scoredUsers = calls.filter((c) => c.method === 'user.gettopartists' && c.period === '6month' && c.user !== 'me').map((c) => c.user);
  expect(scoredUsers).toHaveLength(40);
  expect(scoredUsers.slice(0, 2)).toEqual(['c0', 'c1']);
  expect(out).toHaveLength(40);
  expect(out[0].similarity).toBeCloseTo(1, 5);
});

test('reads at most 20 friends lists', async () => {
  const names = Array.from({ length: 25 }, (_, i) => 'f' + i);
  const friends = { me: names };
  names.forEach((n) => { friends[n] = ['c1']; });
  mock({ friends, artists: { me: ['a'], c1: ['a'] } });
  await runPaced(cfg());
  const fofCalls = calls.filter((c) => c.method === 'user.getfriends' && c.user !== 'me');
  expect(fofCalls).toHaveLength(20);
});

test('drops self, your Last.fm friends and excludeUsernames', async () => {
  mock({
    friends: { me: ['f1', 'f2'], f1: ['Me', 'f2', 'Skip', 'keep'], f2: ['f1'] },
    artists: { me: ['a'], keep: ['a'], skip: ['a'] }
  });
  const out = await runPaced(cfg({ excludeUsernames: ['skip'] }));
  expect(out.map((u) => u.username)).toEqual(['keep']);
});

test('binary cosine over the top-artist name sets: identical 1, disjoint 0, cutoff 0.06', async () => {
  // shared / sqrt(|a| * |b|), names lowercased, no rank weight: where an
  // artist sits in either list does not matter.
  const fifty = (prefix) => Array.from({ length: 50 }, (_, i) => prefix + i);
  const mine = fifty('x');
  // "three" shares 3 of 50 (3/50 = 0.06, kept); "two" shares 2 of 50 (0.04,
  // dropped). The shared ones sit at the BOTTOM of their lists: a rank weight
  // would have scored them near zero.
  const withShared = (n) => [...fifty('n' + n + '_').slice(0, 50 - n), ...mine.slice(50 - n)];
  mock({
    friends: { me: ['f1'], f1: ['same', 'disjoint', 'three', 'two'] },
    artists: {
      me: mine,
      same: mine.map((a) => a.toUpperCase()).reverse(),
      disjoint: fifty('q'),
      three: withShared(3),
      two: withShared(2)
    }
  });
  const out = await runPaced(cfg());
  const by = Object.fromEntries(out.map((u) => [u.username, u.similarity]));
  expect(by.same).toBeCloseTo(1, 10);
  expect(by.disjoint).toBeUndefined();
  expect(by.three).toBeCloseTo(0.06, 10);
  expect(by.two).toBeUndefined();
  expect(out.map((u) => u.username)).toEqual(['same', 'three']);

  // Unequal list sizes: mine has 4 artists, theirs 2, both shared:
  // 2 / sqrt(4 * 2).
  mock({
    friends: { me: ['f1'], f1: ['partial'] },
    artists: { me: ['a', 'b', 'c', 'd'], partial: ['b', 'A'] }
  });
  const [partial] = await runPaced(cfg());
  expect(partial.similarity).toBeCloseTo(2 / Math.sqrt(8), 10);
});

test('avatar is the largest image', async () => {
  mock({ friends: { me: ['f1'], f1: ['pal'] }, artists: { me: ['a'], pal: ['a'] } });
  const out = await runPaced(cfg());
  expect(out[0].avatarUrl).toBe('https://img/pal-xl.png');
});

test('a single friend as an object rather than an array still parses', async () => {
  calls = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    calls.push(u.searchParams.get('method') + ':' + u.searchParams.get('user'));
    const m = u.searchParams.get('method');
    const user = u.searchParams.get('user');
    const body = m === 'user.getfriends'
      ? (user === 'me' ? { friends: { user: { name: 'f1', image: [] } } } : { friends: { user: { name: 'solo', image: [] } } })
      : artistsBody(['a']);
    return { ok: true, status: 200, json: async () => body };
  };
  const out = await runPaced(cfg());
  expect(out.map((u) => u.username)).toEqual(['solo']);
  expect(out[0].avatarUrl).toBeNull();
});

test('no friends: [] after one request', async () => {
  mock({ friends: { me: [] } });
  expect(await runPaced(cfg())).toEqual([]);
  expect(calls).toHaveLength(1);
  mock({}); // error body for the user's own friends
  expect(await runPaced(cfg())).toEqual([]);
  expect(calls).toHaveLength(1);
});

test('a 429 throws', async () => {
  mock({ friends: { me: ['f1'], f1: ['c'] }, artists: { me: ['a'] }, status: { f1: 429 } });
  await expect(runPaced(cfg())).rejects.toThrow(/429/);
});

test('an error body with HTTP 200 throws', async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ error: 29, message: 'Rate limit exceeded' }) });
  await expect(runPaced(cfg())).rejects.toThrow(/29/);
});

test('never more than 4 requests in any 1000ms', async () => {
  const names = Array.from({ length: 10 }, (_, i) => 'f' + i);
  const friends = { me: names };
  names.forEach((n) => { friends[n] = ['c1', 'c2']; });
  mock({ friends, artists: { me: ['a'], c1: ['a'], c2: ['a'] } });
  await runPaced(cfg());
  expect(calls.length).toBeGreaterThan(8);
  const times = calls.map((c) => c.t);
  for (let i = 4; i < times.length; i++) {
    expect(times[i] - times[i - 4]).toBeGreaterThanOrEqual(1000);
  }
});

test('the API key never reaches console output or an error', async () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((k) => jest.spyOn(console, k).mockImplementation(() => {}));
  mock({ friends: { me: ['f1'], f1: ['c'] }, artists: { me: ['a'], c: ['a'] } });
  await runPaced(cfg());
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  let message = '';
  try { await runPaced(cfg()); } catch (e) { message = e.message; }
  expect(message).not.toContain(KEY);
  for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(KEY);
});

test('only people who played something in the last month are kept, with its top 3 artists', async () => {
  mock({
    friends: { me: ['f1'], f1: ['monthly', 'quiet', 'flaky', 'dropped'] },
    artists: {
      me: ['A', 'B', 'C', 'D'],
      monthly: ['A', 'B', 'C', 'D'],
      quiet: ['A', 'B', 'X', 'Y'],
      flaky: ['A', 'Z', 'W', 'V'],
      dropped: ['Q']
    },
    recent: { monthly: ['New 1', 'New 2', 'New 3', 'New 4'], quiet: [] },
    recentStatus: { flaky: 500 }
  });
  const out = await runPaced(cfg());
  const by = Object.fromEntries(out.map((u) => [u.username, u.topArtists]));
  expect(by.monthly).toEqual(['New 1', 'New 2', 'New 3']);
  // Nothing in the last month: inactive, dropped.
  expect(out.map((u) => u.username)).not.toContain('quiet');
  // A failed 1-month request is not "inactive": kept, with the 6-month top 3.
  expect(by.flaky).toEqual(['A', 'Z', 'W']);
  // Under the similarity cutoff: never checked.
  expect(out.map((u) => u.username)).not.toContain('dropped');
  const monthly = calls.filter((c) => c.period === '1month').map((c) => c.user).sort();
  expect(monthly).toEqual(['flaky', 'monthly', 'quiet']);
  expect(calls.find((c) => c.period === '1month').url).toContain('&limit=3');
  for (const u of out) expect(u).not.toHaveProperty('sixMonth');
});

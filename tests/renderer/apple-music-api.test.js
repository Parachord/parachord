/**
 * lib/apple-music-api.js: the Apple Music account calls the app makes for
 * its plug-in. appleMusicUserFetch (one user-scoped request, with the
 * developer token and the app's user token of record, adopting another token
 * Apple still accepts once) and favoriteSong (the loves' personal rating of
 * 1, #1559 step 5). Pure: fetch and the tokens are passed in.
 */

const { appleMusicUserFetch, favoriteSong, isCatalogSongId } = require('../../src/renderer/lib/apple-music-api');

const response = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function deps({ developerToken = 'dev', userToken = 'user-1', statuses = [200], recheck = { verdict: 'unknown', token: null } } = {}) {
  const calls = [];
  const queue = [...statuses];
  return {
    calls,
    fetch: jest.fn(async (url, init) => { calls.push({ url, init }); return response(queue.length > 1 ? queue.shift() : queue[0]); }),
    getDeveloperToken: jest.fn(async () => developerToken),
    getUserToken: jest.fn(() => userToken),
    recheckUserToken: jest.fn(async () => recheck),
  };
}

describe('appleMusicUserFetch', () => {
  test('sends the developer token and the user token, keeping the caller\'s method, headers and body', async () => {
    const d = deps();
    const res = await appleMusicUserFetch(d, 'https://api.music.apple.com/v1/me/x', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    expect(d.calls[0].init).toEqual({
      method: 'PUT', body: '{}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dev', 'Music-User-Token': 'user-1' },
    });
  });

  test('no developer token, or no user token, is notReady and asks nothing', async () => {
    await expect(appleMusicUserFetch(deps({ developerToken: null }), 'u')).rejects.toMatchObject({ notReady: true, code: 'no-developer-token' });
    const d = deps({ userToken: null });
    await expect(appleMusicUserFetch(d, 'u')).rejects.toMatchObject({ notReady: true, code: 'not-signed-in' });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  test('a refusal adopts another token Apple accepts, once', async () => {
    const d = deps({ statuses: [403, 200], recheck: { verdict: 'ok', token: 'user-2' } });
    const res = await appleMusicUserFetch(d, 'u');
    expect(res.status).toBe(200);
    expect(d.calls.map((c) => c.init.headers['Music-User-Token'])).toEqual(['user-1', 'user-2']);
    expect(d.recheckUserToken).toHaveBeenCalledWith('dev');
  });

  test('a refusal with no other token, the same token, or a second refusal is notReady', async () => {
    await expect(appleMusicUserFetch(deps({ statuses: [401] }), 'u')).rejects.toMatchObject({ code: 'token-refused' });
    await expect(appleMusicUserFetch(deps({ statuses: [403], recheck: { verdict: 'ok', token: 'user-1' } }), 'u')).rejects.toMatchObject({ code: 'token-refused' });
    await expect(appleMusicUserFetch(deps({ statuses: [403, 403], recheck: { verdict: 'ok', token: 'user-2' } }), 'u')).rejects.toMatchObject({ code: 'token-refused' });
  });

  test('any other status is the caller\'s to read', async () => {
    const res = await appleMusicUserFetch(deps({ statuses: [500] }), 'u');
    expect(res.status).toBe(500);
  });
});

describe('favoriteSong', () => {
  test('a personal rating of 1 on the catalog song, by PUT', async () => {
    const d = deps();
    await expect(favoriteSong(d, '907242702')).resolves.toEqual({ ok: true });
    expect(d.calls[0].url).toBe('https://api.music.apple.com/v1/me/ratings/songs/907242702');
    expect(d.calls[0].init.method).toBe('PUT');
    expect(JSON.parse(d.calls[0].init.body)).toEqual({ type: 'rating', attributes: { value: 1 } });
  });

  test('a library id or anything not a catalog id is refused without asking', async () => {
    const d = deps();
    await expect(favoriteSong(d, 'i.7PJNN4mfXlD68R')).resolves.toEqual({ ok: false, reason: 'not-catalog' });
    await expect(favoriteSong(d, '../me/library')).resolves.toEqual({ ok: false, reason: 'not-catalog' });
    expect(d.fetch).not.toHaveBeenCalled();
    expect(isCatalogSongId('123')).toBe(true);
    expect(isCatalogSongId('')).toBe(false);
  });

  test('a song Apple doesn\'t have is no match; any other failure throws (the push retries)', async () => {
    await expect(favoriteSong(deps({ statuses: [404] }), '1')).resolves.toEqual({ ok: false, reason: 'not-found' });
    await expect(favoriteSong(deps({ statuses: [500] }), '1')).rejects.toThrow('Apple Music favorite failed: HTTP 500');
    await expect(favoriteSong(deps({ statuses: [403] }), '1')).rejects.toMatchObject({ notReady: true });
  });

  test('never a dislike or a removal', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/lib/apple-music-api.js'), 'utf8');
    expect(src).not.toMatch(/value: -1|method: 'DELETE'/);
  });
});

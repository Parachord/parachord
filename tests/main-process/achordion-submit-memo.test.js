const { playlistLinksFingerprint, createSubmitMemo, STORE_KEY, REFRESH_MS } = require('../../main-process/achordion-submit-memo');
const fs = require('fs');
const path = require('path');

const pl = (over = {}) => ({
  title: 'Weekly',
  creator: null,
  tracks: [1, 2, 3],
  syncedTo: { listenbrainz: { externalId: 'mbid-1' }, spotify: { externalId: 'sp' } },
  ...over,
});

const fakeStore = (init = {}) => {
  const data = { ...init };
  return { data, get: (k) => data[k], set: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); } };
};

describe('playlistLinksFingerprint', () => {
  test('none without a ListenBrainz anchor', () => {
    expect(playlistLinksFingerprint(pl({ syncedTo: { spotify: { externalId: 'sp' } } }))).toBe(null);
    expect(playlistLinksFingerprint(null)).toBe(null);
  });
  test('an imported ListenBrainz playlist is anchored by syncedFrom', () => {
    expect(playlistLinksFingerprint(pl({ syncedTo: {}, syncedFrom: { resolver: 'listenbrainz', externalId: 'mbid-2' } }))).not.toBe(null);
  });
  test('same playlist, same fingerprint; a new mirror, name or track count changes it', () => {
    const base = playlistLinksFingerprint(pl());
    expect(playlistLinksFingerprint(pl())).toBe(base);
    expect(playlistLinksFingerprint(pl({ syncedTo: { listenbrainz: { externalId: 'mbid-1' }, spotify: { externalId: 'sp' }, applemusic: { externalId: 'p.x' } } }))).not.toBe(base);
    expect(playlistLinksFingerprint(pl({ title: 'Renamed' }))).not.toBe(base);
    expect(playlistLinksFingerprint(pl({ tracks: [1, 2] }))).not.toBe(base);
  });
});

describe('createSubmitMemo', () => {
  test('unchanged only after remember, and saved across a restart', () => {
    const store = fakeStore();
    const memo = createSubmitMemo(store);
    expect(memo.unchanged('mbid-1', 'fp')).toBe(false);
    memo.remember('mbid-1', 'fp');
    expect(memo.unchanged('mbid-1', 'fp')).toBe(true);
    expect(memo.unchanged('mbid-1', 'other')).toBe(false);
    expect(store.data[STORE_KEY]['mbid-1'].fp).toBe('fp');
    expect(createSubmitMemo(store).unchanged('mbid-1', 'fp')).toBe(true);
  });
  test('an unchanged playlist is sent again before Achordion\'s 90-day entry can expire', () => {
    let t = 1000;
    const memo = createSubmitMemo(fakeStore(), () => t);
    memo.remember('mbid-1', 'fp');
    t += REFRESH_MS - 1;
    expect(memo.unchanged('mbid-1', 'fp')).toBe(true);
    t += 2;
    expect(memo.unchanged('mbid-1', 'fp')).toBe(false);
    expect(REFRESH_MS).toBeLessThan(90 * 24 * 60 * 60 * 1000);
  });
  test('a store that throws still works for the session', () => {
    const memo = createSubmitMemo({ get() { throw new Error('x'); }, set() { throw new Error('x'); } });
    memo.remember('m', 'f');
    expect(memo.unchanged('m', 'f')).toBe(true);
  });
});

test('main.js skips an unchanged submit before any network call, and remembers only an accepted one', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const fn = main.slice(main.indexOf('async function pushPlaylistLinksToAchordion('), main.indexOf('// Build a localPlaylist-shaped object for pushPlaylistLinksToAchordion'));
  const skip = fn.indexOf('achordionSubmitMemo.unchanged(');
  expect(skip).toBeGreaterThan(-1);
  expect(skip).toBeLessThan(fn.indexOf('fetchAppleMusicPublicPlaylistUrl('));
  const remember = fn.indexOf('achordionSubmitMemo.remember(');
  expect(remember).toBeGreaterThan(fn.indexOf('if (res && !res.ok)'));
});

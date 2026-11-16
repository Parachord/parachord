// sync-engine/collection-id.js and collection-id-migration.js (#1401):
// non-Latin names get real ids, every Latin id stays byte-identical, and the
// one-time migration moves stored rows and their love marks.
const fs = require('fs');
const path = require('path');
const ids = require('../../sync-engine/collection-id');
const { migrateCollectionIds } = require('../../sync-engine/collection-id-migration');
const { trackSlug } = require('../../sync-engine/track-slug');

const {
  normalizeForId, generateTrackId, generateAlbumId, generateArtistId,
  legacyNormalizeForId, legacyGenerateTrackId, legacyGenerateAlbumId,
} = ids;

describe('the id formula', () => {
  // Pinned: real ids from before #1401 must not move.
  test.each([
    ['AC/DC', 'ac-dc'],
    ["The B-52's", 'the-b-52-s'],
    ['Beyoncé', 'beyonc'],
    ['Motörhead', 'mot-rhead'],
    ['Sigur Rós', 'sigur-r-s'],
    ['Björk', 'bj-rk'],
    ['!!!', ''],
    ['', ''],
    ['Song™ (Remix) [feat. X]', 'song-remix-feat-x'],
    ['Café del Mar — Vol. 1', 'caf-del-mar-vol-1'],
    ['N.W.A', 'n-w-a'],
  ])('a Latin name keeps its old id: %s', (name, id) => {
    expect(normalizeForId(name)).toBe(id);
    expect(normalizeForId(name)).toBe(legacyNormalizeForId(name));
  });

  test('every ASCII string gives the old id', () => {
    const chars = 'abcXYZ019 -_./\'&!?()[]#@';
    for (let i = 0; i < 2000; i++) {
      let str = '';
      const len = (i % 17) + 1;
      for (let j = 0; j < len; j++) str += chars[(i * 31 + j * 7 + j * j) % chars.length];
      expect(normalizeForId(str)).toBe(legacyNormalizeForId(str));
    }
  });

  test("the issue's examples get real, distinct ids", () => {
    expect(generateAlbumId('坂本龍一', '音楽図鑑')).toBe('坂本龍一-音楽図鑑');
    expect(generateAlbumId('Король и Шут', 'Акустический альбом')).toBe('король-и-шут-акустический-альбом');
    expect(generateTrackId('宇多田ヒカル', '光')).toBe('宇多田ヒカル-光-noalbum');
    expect(generateTrackId('BTS', 'First Love')).not.toBe(generateTrackId('宇多田ヒカル', 'First Love'));
    // Two all-non-Latin albums no longer share "-".
    expect(generateAlbumId('坂本龍一', '音楽図鑑')).not.toBe(generateAlbumId('Король и Шут', 'Акустический альбом'));
  });

  test('marks that tell letters apart are kept (ガ is not カ, й is not и)', () => {
    expect(normalizeForId('ガイ')).not.toBe(normalizeForId('カイ'));
    expect(normalizeForId('Мой')).not.toBe(normalizeForId('Мои'));
  });

  test('a name the old formula emptied though it has letters takes the new path (full-width)', () => {
    expect(normalizeForId('Ｂｊｏｒｋ')).toBe('bjork');
  });

  test('the artist id and the renderer re-export are the same functions', () => {
    expect(generateArtistId('Король и Шут')).toBe('король-и-шут');
    const renderer = require('../../src/renderer/lib/collection-ids');
    expect(renderer.generateTrackId).toBe(generateTrackId);
    expect(renderer.normalizeForId).toBe(normalizeForId);
  });

  test('the sync providers use the shared normalize, not copies', () => {
    for (const f of ['sync-providers/spotify.js', 'sync-providers/applemusic.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      expect([f, /const normalizeForId = \(str\) =>/.test(src)]).toEqual([f, false]);
      expect(src).toContain("require('../sync-engine/collection-id')");
    }
  });
});

describe('the migration', () => {
  const latin = {
    tracks: [{ id: legacyGenerateTrackId('Daft Punk', 'One More Time', 'Discovery'), artist: 'Daft Punk', title: 'One More Time', album: 'Discovery' }],
    albums: [{ id: legacyGenerateAlbumId('Beyoncé', 'Lemonade'), artist: 'Beyoncé', title: 'Lemonade' }],
    artists: [{ id: 'mot-rhead', name: 'Motörhead' }],
  };

  test('a Latin-only profile changes nothing and gets the same objects back', () => {
    const love = { [latin.tracks[0].id]: { lastfm: 1 } };
    const out = migrateCollectionIds(latin, love);
    expect(out.collection).toBe(latin);
    expect(out.lovePushedKeys).toBe(love);
    expect(out.changed).toEqual({ tracks: 0, albums: 0, artists: 0, loveKeysMoved: 0, loveKeysDropped: 0 });
  });

  test('non-Latin albums and artists move to their new ids', () => {
    const collection = {
      tracks: [],
      albums: [{ id: '-', artist: '坂本龍一', title: '音楽図鑑' }],
      artists: [{ id: '', name: 'Король и Шут' }],
    };
    const out = migrateCollectionIds(collection, {});
    expect(out.collection.albums[0].id).toBe('坂本龍一-音楽図鑑');
    expect(out.collection.artists[0].id).toBe('король-и-шут');
    expect(out.changed.albums).toBe(1);
    expect(out.changed.artists).toBe(1);
  });

  test("a Spotify album, id'd by its first artist and stored with all of them", () => {
    // spotify.js: id from artists[0], artist field "A, B".
    // Both artist strings collapse to the same old id, so the row's sync
    // source decides; the next Spotify sync then builds this same id.
    const row = { id: `${legacyNormalizeForId('Король и Шут')}-${legacyNormalizeForId('Лесник')}`, artist: 'Король и Шут, Князь', title: 'Лесник', syncSources: { spotify: {} } };
    const out = migrateCollectionIds({ tracks: [], albums: [row], artists: [] }, {});
    expect(out.collection.albums[0].id).toBe('король-и-шут-лесник');
    // A row saved in the app keeps the whole artist field, as addAlbumToCollection builds it.
    const local = { ...row, syncSources: undefined };
    expect(migrateCollectionIds({ tracks: [], albums: [local], artists: [] }, {}).collection.albums[0].id).toBe(generateAlbumId('Король и Шут, Князь', 'Лесник'));
  });

  test("a provider's track id (no fallbacks) keeps its shape", () => {
    const row = { id: `${legacyNormalizeForId('宇多田ヒカル')}-${legacyNormalizeForId('光')}-${legacyNormalizeForId('')}`, artist: '宇多田ヒカル', title: '光', album: '' };
    expect(row.id).toBe('--');
    const out = migrateCollectionIds({ tracks: [row], albums: [], artists: [] }, {});
    expect(out.collection.tracks[0].id).toBe('宇多田ヒカル-光-');
  });

  test("a love-import row saved under trackSlug gets the id loveRowId now gives it", () => {
    const row = { id: trackSlug('宇多田ヒカル', '光', 'Deep River'), artist: '宇多田ヒカル', title: '光', album: 'Deep River' };
    const out = migrateCollectionIds({ tracks: [row], albums: [], artists: [] }, {});
    expect(out.collection.tracks[0].id).toBe(generateTrackId('宇多田ヒカル', '光', 'Deep River'));
  });

  test('a love mark follows its row; a mark several rows shared is dropped', () => {
    const one = { id: legacyGenerateTrackId('Сплин', 'Выхода нет', 'Гранатовый альбом'), artist: 'Сплин', title: 'Выхода нет', album: 'Гранатовый альбом' };
    // Two different songs that both collapsed to "--noalbum".
    const a = { id: '--noalbum', artist: '宇多田ヒカル', title: '光', album: '' };
    const b = { id: '--noalbum', artist: 'Король и Шут', title: 'Лесник', album: '' };
    const love = { [one.id]: { listenbrainz: 5 }, '--noalbum': { lastfm: 7 }, 'unrelated-id': { lastfm: 1 } };
    const out = migrateCollectionIds({ tracks: [one, a, b], albums: [], artists: [] }, love);
    const [m1, ma, mb] = out.collection.tracks;
    expect(ma.id).not.toBe(mb.id);
    expect(out.lovePushedKeys[m1.id]).toEqual({ listenbrainz: 5 });
    expect(out.lovePushedKeys[one.id]).toBeUndefined();
    expect(out.lovePushedKeys['--noalbum']).toBeUndefined();
    expect(out.lovePushedKeys['unrelated-id']).toEqual({ lastfm: 1 });
    expect(out.changed).toMatchObject({ tracks: 3, loveKeysMoved: 1, loveKeysDropped: 1 });
    // The inputs are untouched.
    expect(one.id).toBe(legacyGenerateTrackId('Сплин', 'Выхода нет', 'Гранатовый альбом'));
    expect(love['--noalbum']).toEqual({ lastfm: 7 });
  });

  test("an id the app didn't build from the row is never touched", () => {
    const rows = [
      { id: 'listenbrainz-abc123', artist: 'Король и Шут', title: 'Лесник', album: '' },
      { id: 'custom', artist: '坂本龍一', title: '音楽図鑑', album: 'x' },
    ];
    const out = migrateCollectionIds({ tracks: rows, albums: [], artists: [] }, {});
    expect(out.collection.tracks.map((t) => t.id)).toEqual(['listenbrainz-abc123', 'custom']);
  });

  test('running it twice changes nothing the second time', () => {
    const collection = {
      tracks: [{ id: '--noalbum', artist: '宇多田ヒカル', title: '光', album: '' }],
      albums: [{ id: '-', artist: '坂本龍一', title: '音楽図鑑' }],
      artists: [{ id: '', name: 'Король и Шут' }],
    };
    const first = migrateCollectionIds(collection, {});
    const second = migrateCollectionIds(first.collection, first.lovePushedKeys);
    expect(second.changed).toEqual({ tracks: 0, albums: 0, artists: 0, loveKeysMoved: 0, loveKeysDropped: 0 });
    expect(second.collection).toBe(first.collection);
  });
});

describe('main.js runs it once, before the window', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  test('awaited before createWindow in the startup block, versioned, with a backup', () => {
    const run = main.indexOf('await runCollectionIdMigration();');
    expect(run).toBeGreaterThan(-1);
    expect(main.indexOf('createWindow();', run)).toBeGreaterThan(run);
    expect(main).toMatch(/store\.get\('collection_id_version'\)/);
    expect(main).toMatch(/store\.set\('collection_id_version', COLLECTION_ID_VERSION\)/);
    expect(main).toMatch(/\.pre-id-v2\.bak/);
  });
});

/**
 * Local-file lookups for names with no Latin letters. normalize() used to strip
 * every non-ASCII character, so "光" and "宇多田ヒカル" were stored and searched
 * as nothing, and matched every row. Run against a real SQLite file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const LocalFilesDatabase = require('../../local-files/database');
const { pickTrackMatch } = require('../../sync-providers/track-match');

let dir;
let db;

const track = (over) => ({
  filePath: `/music/${Math.random().toString(36).slice(2)}.mp3`,
  title: 'Untitled',
  artist: 'Radiohead',
  album: 'Amnesiac',
  albumArtist: null,
  trackNumber: 1,
  discNumber: 1,
  year: 2001,
  duration: 200,
  ...over,
});

const titles = (rows) => rows.map((r) => r.title);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parachord-lf-nonlatin-'));
  db = new LocalFilesDatabase(dir).init();
});

afterEach(() => {
  if (db) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('search', () => {
  beforeEach(() => {
    db.insertTrack(track({ title: 'Pyramid Song' }));
    db.insertTrack(track({ title: 'First Love', artist: '宇多田ヒカル', album: 'First Love' }));
    db.insertTrack(track({ title: '光', artist: '宇多田ヒカル', album: 'Deep River' }));
    db.insertTrack(track({ title: 'Группа крови', artist: 'Кино', album: 'Группа крови' }));
    db.insertTrack(track({ title: '좋은 날', artist: '아이유', album: 'Real' }));
  });

  test('"artist title" finds the track, and only that track', () => {
    const rows = db.search('宇多田ヒカル 光');

    expect(titles(rows)).toEqual(['光']);
    expect(pickTrackMatch(rows, '宇多田ヒカル', '光')).toBeTruthy();
  });

  test('one word finds only the rows that hold it', () => {
    expect(titles(db.search('光'))).toEqual(['光']);
    expect(titles(db.search('宇多田')).sort()).toEqual(['First Love', '光'].sort());
    expect(titles(db.search('좋은'))).toEqual(['좋은 날']);
  });

  test('case folds outside ASCII', () => {
    expect(titles(db.search('КИНО'))).toEqual(['Группа крови']);
    expect(titles(db.search('кино группа крови'))).toEqual(['Группа крови']);
  });

  test('a name with no match finds nothing', () => {
    expect(db.search('椎名林檎')).toEqual([]);
    expect(db.search('椎名林檎 光')).toEqual([]);
  });
});

describe('accents', () => {
  test('an accented name matches its plain spelling, as pickTrackMatch does', () => {
    db.insertTrack(track({ title: 'Jóga', artist: 'Björk', album: 'Homogenic' }));

    for (const query of ['Björk Jóga', 'bjork joga', 'BJÖRK']) {
      expect(titles(db.search(query))).toEqual(['Jóga']);
    }
    expect(pickTrackMatch(db.search('Bjork Joga'), 'Bjork', 'Joga')).toBeTruthy();
  });

  test('decomposed tags match a composed query', () => {
    db.insertTrack(track({ title: 'Jóga', artist: 'Björk', album: 'Homogenic' }));

    expect(db.search('Björk Jóga')).toHaveLength(1);
  });
});

describe('a query with nothing to search for', () => {
  beforeEach(() => {
    db.insertTrack(track({ title: 'Pyramid Song' }));
    db.insertTrack(track({ title: '光', artist: '宇多田ヒカル' }));
  });

  test('search returns nothing, not every row', () => {
    for (const query of ['!!!', '🎵', '! !', '   ', '']) {
      expect(db.search(query)).toEqual([]);
    }
  });

  test('resolve returns nothing, not every row', () => {
    expect(db.resolve('Radiohead', '!!!')).toEqual([]);
    expect(db.resolve('!!!', '🎵')).toEqual([]);
  });
});

describe('resolve', () => {
  test('finds only the named track', () => {
    db.insertTrack(track({ title: 'Pyramid Song' }));
    db.insertTrack(track({ title: 'First Love', artist: '宇多田ヒカル' }));
    db.insertTrack(track({ title: '光', artist: '宇多田ヒカル' }));

    expect(titles(db.resolve('宇多田ヒカル', '光'))).toEqual(['光']);
  });
});

describe('albums', () => {
  beforeEach(() => {
    db.insertTrack(track({ title: '光', artist: '宇多田ヒカル', album: 'Deep River' }));
    db.insertTrack(track({ title: 'Звезда', artist: 'Кино', album: 'Звезда по имени Солнце' }));
    db.insertTrack(track({ title: 'Группа крови', artist: 'Кино', album: 'Группа крови' }));
    db.insertTrack(track({ title: '좋은 날', artist: '아이유', album: '리얼' }));
  });

  test('two albums with non-Latin names stay two albums', () => {
    const rows = db.searchAlbums('крови');

    expect(rows).toHaveLength(1);
    expect(rows[0].album).toBe('Группа крови');
    expect(rows[0].track_count).toBe(1);
  });

  test('getAlbumTracks returns that album alone', () => {
    expect(titles(db.getAlbumTracks('Группа крови', 'Кино'))).toEqual(['Группа крови']);
    expect(titles(db.getAlbumTracks('리얼', '아이유'))).toEqual(['좋은 날']);
  });
});

describe('what Latin searches had', () => {
  test('punctuation still drops out on both sides', () => {
    db.insertTrack(track({ title: 'T.N.T.', artist: 'AC/DC', album: 'High Voltage' }));
    db.insertTrack(track({ title: 'Tik Tok', artist: 'Ke$ha', album: 'Animal' }));

    expect(titles(db.search('acdc'))).toEqual(['T.N.T.']);
    expect(titles(db.search('AC/DC TNT'))).toEqual(['T.N.T.']);
    expect(titles(db.search('Ke$ha'))).toEqual(['Tik Tok']);
  });

  test('a dash between words no longer hides a phrase', () => {
    db.insertTrack(track({ title: 'Roads - Live', artist: 'Portishead', album: 'PNYC' }));

    expect(titles(db.search('roads live'))).toEqual(['Roads - Live']);
    expect(db.search('Portishead Roads - Live')[0].title).toBe('Roads - Live');
  });
});

describe('existing libraries', () => {
  // What the old normalize() stored, for a database scanned before this fix.
  const oldNormalize = (s) => (s ? s.toLowerCase().trim().replace(/[^\w\s]/g, '') : '');

  const seedOldDatabase = (rows) => {
    for (const row of rows) db.insertTrack(track(row));
    db.close();
    db = null;
    const raw = new Database(path.join(dir, 'local-files.db'));
    const update = raw.prepare(
      'UPDATE tracks SET title_normalized = ?, artist_normalized = ?, album_normalized = ? WHERE id = ?'
    );
    for (const r of raw.prepare('SELECT id, title, artist, album FROM tracks').all()) {
      update.run(oldNormalize(r.title), oldNormalize(r.artist), oldNormalize(r.album), r.id);
    }
    raw.pragma('user_version = 0');
    raw.close();
  };

  test('rows scanned before the fix are found after the next start', () => {
    seedOldDatabase([
      { title: '光', artist: '宇多田ヒカル', album: 'Deep River' },
      { title: 'Pyramid Song' },
    ]);

    db = new LocalFilesDatabase(dir).init();

    expect(titles(db.search('宇多田ヒカル 光'))).toEqual(['光']);
    expect(titles(db.search('pyramid'))).toEqual(['Pyramid Song']);
  });

  test('a row with no artist or album is still written cleanly', () => {
    seedOldDatabase([{ title: '光', artist: null, album: null }]);

    db = new LocalFilesDatabase(dir).init();

    expect(titles(db.search('光'))).toEqual(['光']);
  });

  test('the rewrite runs once', () => {
    seedOldDatabase([{ title: '光', artist: '宇多田ヒカル' }]);
    db = new LocalFilesDatabase(dir).init();
    db.db.prepare("UPDATE tracks SET title_normalized = 'marker'").run();
    db.close();

    db = new LocalFilesDatabase(dir).init();

    expect(db.db.prepare('SELECT title_normalized AS t FROM tracks').get().t).toBe('marker');
  });

  test('a rewrite that fails leaves the library usable and runs again next start', () => {
    seedOldDatabase([
      { title: 'Pyramid Song' },
      { title: '光', artist: '宇多田ヒカル' },
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const failing = new LocalFilesDatabase(dir);
    failing.normalize = () => { throw new Error('boom'); };
    expect(() => failing.init()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    failing.close();
    warn.mockRestore();

    db = new LocalFilesDatabase(dir).init();

    expect(titles(db.search('宇多田ヒカル 光'))).toEqual(['光']);
  });
});

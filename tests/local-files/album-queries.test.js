/**
 * Album search and an album's tracks (LocalFilesDatabase.searchAlbums /
 * getAlbumTracks), behind the Local Files plugin's searchAlbums / lookupAlbum
 * for the album-page catalog fallback. Run against a real SQLite file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const LocalFilesDatabase = require('../../local-files/database');

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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parachord-lf-albums-'));
  db = new LocalFilesDatabase(dir).init();
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('searchAlbums', () => {
  test('one row per album and album artist, with its track count', () => {
    db.insertTrack(track({ title: 'Pyramid Song', trackNumber: 2 }));
    db.insertTrack(track({ title: 'Packt Like Sardines', trackNumber: 1 }));
    db.insertTrack(track({ title: 'Everything In Its Right Place', album: 'Kid A', year: 2000 }));
    const rows = db.searchAlbums('amnesiac');
    expect(rows).toEqual([{ album: 'Amnesiac', album_artist_name: 'Radiohead', year: 2001, track_count: 2 }]);
  });

  test('a compilation groups under its album artist, not each track artist', () => {
    db.insertTrack(track({ title: 'A', artist: 'One', album: 'Mixtape', albumArtist: 'Various Artists' }));
    db.insertTrack(track({ title: 'B', artist: 'Two', album: 'Mixtape', albumArtist: 'Various Artists' }));
    expect(db.searchAlbums('mixtape')).toEqual([
      expect.objectContaining({ album: 'Mixtape', album_artist_name: 'Various Artists', track_count: 2 }),
    ]);
  });

  test('tracks without an album are not albums', () => {
    db.insertTrack(track({ title: 'Loose', album: '' }));
    db.insertTrack(track({ title: 'Loose 2', album: null }));
    expect(db.searchAlbums('loose')).toEqual([]);
    expect(db.searchAlbums('')).toEqual([]);
  });

  test('LIKE wildcards in the query are plain text after normalizing', () => {
    db.insertTrack(track({ title: 'x', album: 'Amnesiac' }));
    // normalize strips % and _ is a word char; neither turns into "match all"
    expect(db.searchAlbums('%')).toEqual([]);
  });
});

describe('getAlbumTracks', () => {
  test('every track on the album in disc and track order, not just the first 50', () => {
    for (let i = 60; i >= 1; i--) db.insertTrack(track({ title: `Track ${i}`, album: 'Box Set', trackNumber: i, discNumber: i > 30 ? 2 : 1 }));
    const rows = db.getAlbumTracks('Box Set', 'Radiohead');
    expect(rows).toHaveLength(60);
    expect(rows[0].title).toBe('Track 1');
    expect(rows[29].title).toBe('Track 30');
    expect(rows[30].title).toBe('Track 31');
  });

  test('matches the album artist, else the track artist, case- and punctuation-insensitively', () => {
    db.insertTrack(track({ title: 'Yes', album: 'Hits', artist: 'AC/DC' }));
    db.insertTrack(track({ title: 'No', album: 'Hits', artist: 'Someone Else' }));
    expect(db.getAlbumTracks('hits', 'acdc').map(r => r.title)).toEqual(['Yes']);
    db.insertTrack(track({ title: 'Comp', album: 'Hits', artist: 'Guest', albumArtist: 'AC/DC' }));
    expect(db.getAlbumTracks('Hits', 'AC/DC').map(r => r.title).sort()).toEqual(['Comp', 'Yes']);
  });

  test('an unknown album is empty', () => {
    expect(db.getAlbumTracks('Nothing', 'Nobody')).toEqual([]);
    expect(db.getAlbumTracks('', 'Nobody')).toEqual([]);
  });
});

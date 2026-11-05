/**
 * LocalFilesDatabase.search with a query that names more than one field.
 * parachord://play?artist=X&title=Y, the AI play tool, chat links and MCP all
 * search for "X Y", and a track that exists only as a local file has to be
 * found by that string. Run against a real SQLite file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parachord-lf-search-'));
  db = new LocalFilesDatabase(dir).init();
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a query that combines fields', () => {
  test('"artist title" finds the track, and pickTrackMatch accepts it', () => {
    db.insertTrack(track({ title: 'Zzq No Album Song', artist: 'Zzqart Testband', album: null }));

    const rows = db.search('Zzqart Testband Zzq No Album Song');

    expect(titles(rows)).toEqual(['Zzq No Album Song']);
    expect(pickTrackMatch(rows, 'Zzqart Testband', 'Zzq No Album Song')).toBeTruthy();
  });

  test('"artist title" survives punctuation in the tags', () => {
    db.insertTrack(track({ title: 'Help!', artist: 'The Beatles', album: 'Help!' }));
    db.insertTrack(track({ title: 'T.N.T.', artist: 'AC/DC', album: 'High Voltage' }));

    expect(titles(db.search('The Beatles Help!'))).toEqual(['Help!']);
    expect(titles(db.search('AC/DC T.N.T.'))).toEqual(['T.N.T.']);
  });

  test('the words can name any of the fields, in any order', () => {
    db.insertTrack(track({ title: 'Pyramid Song' }));

    expect(titles(db.search('radiohead amnesiac'))).toEqual(['Pyramid Song']);
    expect(titles(db.search('pyramid song radiohead'))).toEqual(['Pyramid Song']);
  });

  test('the exact "artist title" ranks first, however many other rows also match', () => {
    // Sorted by artist, these 60 would otherwise fill the 50-row limit.
    for (let i = 0; i < 60; i++) {
      db.insertTrack(track({ title: `Blue Sky ${i}`, artist: 'Aaa', album: 'Blue Sky' }));
    }
    db.insertTrack(track({ title: 'Sky', artist: 'Blue', album: 'Weather' }));

    const rows = db.search('Blue Sky');

    expect(rows[0].title).toBe('Sky');
    expect(rows[0].artist).toBe('Blue');
  });
});

describe('what the query does not match', () => {
  test('every word has to be there', () => {
    db.insertTrack(track({ title: 'Pyramid Song' }));

    expect(db.search('radiohead creep')).toEqual([]);
  });

  test('words match whole words, not parts of other words', () => {
    // "go it" must not pull in Gorillaz "Sit Down": this search also serves
    // the artist + album cover lookup, which takes a result with art.
    db.insertTrack(track({ title: 'Sit Down', artist: 'Gorillaz', album: 'Demon Days' }));

    expect(db.search('go it')).toEqual([]);
  });

  test('a query of very many words still runs', () => {
    db.insertTrack(track({ title: 'Pyramid Song' }));
    const words = Array.from({ length: 1500 }, () => 'radiohead').join(' ');

    expect(titles(db.search(words))).toEqual(['Pyramid Song']);
  });
});

describe('the search box keeps what it had', () => {
  beforeEach(() => {
    db.insertTrack(track({ title: 'Sky Song', artist: 'Radiohead', album: 'Amnesiac' }));
    db.insertTrack(track({ title: 'Other', artist: 'Sky Band', album: 'Amnesiac' }));
    db.insertTrack(track({ title: 'Third', artist: 'Radiohead', album: 'Sky Album' }));
  });

  test('one word still matches inside a word', () => {
    expect(titles(db.search('rad'))).toEqual(['Sky Song', 'Third']);
    expect(titles(db.search('mnesia'))).toEqual(['Sky Song', 'Other']);
  });

  test('title matches, then artist, then album', () => {
    expect(titles(db.search('sky'))).toEqual(['Sky Song', 'Other', 'Third']);
  });

  test('a phrase still matches a part of a word at either end', () => {
    expect(titles(db.search('ky so'))).toEqual(['Sky Song']);
  });

  test('a phrase match ranks above words scattered across the fields', () => {
    db.insertTrack(track({ title: 'Song', artist: 'Sky', album: 'Aaa' }));
    db.insertTrack(track({ title: 'Song Sky', artist: 'Bbb', album: 'Aaa' }));
    db.insertTrack(track({ title: 'Song', artist: 'Aaa', album: 'Sky' }));

    const rows = db.search('Sky Song');

    // "Sky" + "Song" is the exact artist and title, then the phrase in a
    // title, then the rows that only hold both words.
    expect(rows[0]).toMatchObject({ artist: 'Sky', title: 'Song' });
    expect(rows[1]).toMatchObject({ artist: 'Radiohead', title: 'Sky Song' });
    expect(rows.slice(2).map((r) => r.artist).sort()).toEqual(['Aaa', 'Bbb']);
  });
});

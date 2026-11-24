/**
 * local_playlists kept as one file per playlist (main-process/playlist-store.js,
 * #801). The single 15 MB file made every playlist save re-read, re-parse and
 * rewrite all of it on the main thread (~260 ms, measured 2026-11-22); a save
 * now writes its own playlist.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPlaylistStore, fileNameFor } = require('../../main-process/playlist-store');

let dir;
const open = (opts = {}) => createPlaylistStore({ dir, log: () => {}, now: () => 1000, ...opts });
const files = () => fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
const readIndex = () => JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));

beforeEach(() => { dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'playlist-store-')), 'playlists'); });
afterEach(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));

const pl = (id, titles = ['a'], extra = {}) => ({ id, title: id, tracks: titles.map((t) => ({ artist: 'x', title: t })), ...extra });

describe('the array surface (every existing store caller)', () => {
  test('nothing stored reads as undefined, and has() is false', () => {
    const s = open();
    expect(s.get()).toBeUndefined();
    expect(s.has()).toBe(false);
  });

  test('set then get round-trips the list in order, one file per playlist', () => {
    const s = open();
    s.set([pl('b'), pl('a'), pl('c')]);
    expect(s.get().map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(files()).toHaveLength(3);
    expect(readIndex().order).toEqual(['b', 'a', 'c']);
    expect(open().get().map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  test('get returns a private copy', () => {
    const s = open();
    s.set([pl('a')]);
    const got = s.get();
    got[0].title = 'changed';
    got.push(pl('b'));
    expect(s.get()).toEqual([expect.objectContaining({ id: 'a', title: 'a' })]);
  });

  test('set writes only the playlists that changed, and removes the ones that went', () => {
    const s = open();
    s.set([pl('a'), pl('b'), pl('c')]);
    const fileOf = (id) => path.join(dir, fileNameFor(id));
    fs.utimesSync(fileOf('a'), new Date(0), new Date(0));
    fs.utimesSync(fileOf('c'), new Date(0), new Date(0));

    const list = s.get();
    list[1] = { ...list[1], title: 'renamed' };
    s.set([list[0], list[1]]);

    expect(fs.statSync(fileOf('a')).mtimeMs).toBe(0);
    expect(fs.existsSync(fileOf('c'))).toBe(false);
    expect(open().get().map((p) => p.title)).toEqual(['a', 'renamed']);
  });

  test('a duplicate id in the list is kept, as the single file kept it', () => {
    const s = open();
    s.set([pl('a', ['1']), pl('a', ['2'])]);
    expect(open().get().map((p) => p.tracks[0].title)).toEqual(['1', '2']);
  });

  test('a record with no id is kept too', () => {
    const s = open();
    s.set([{ title: 'no id', tracks: [] }, pl('a')]);
    expect(open().get().map((p) => p.title)).toEqual(['no id', 'a']);
  });

  test('ids that are not safe file names still get a file of their own', () => {
    const s = open();
    s.set([pl('../escape'), pl('a/b'), pl('CON'), pl('a:b')]);
    expect(files().every((f) => !f.includes('/') && !f.includes('..'))).toBe(true);
    expect(new Set(files()).size).toBe(4);
    expect(open().get().map((p) => p.id)).toEqual(['../escape', 'a/b', 'CON', 'a:b']);
  });

  test('delete removes every playlist file and the index', () => {
    const s = open();
    s.set([pl('a'), pl('b')]);
    s.delete();
    expect(s.get()).toBeUndefined();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test('setting an empty list is stored (an empty library is not "nothing stored")', () => {
    const s = open();
    s.set([pl('a')]);
    s.set([]);
    expect(s.get()).toEqual([]);
    expect(open().get()).toEqual([]);
  });
});

describe('savePlaylist (the playlists-save hot path)', () => {
  test('replaces one playlist in place and writes only its file', () => {
    const s = open();
    s.set([pl('a'), pl('b')]);
    const other = path.join(dir, fileNameFor('a'));
    fs.utimesSync(other, new Date(0), new Date(0));

    s.savePlaylist({ ...pl('b'), title: 'new title' });

    expect(fs.statSync(other).mtimeMs).toBe(0);
    expect(open().get().map((p) => p.title)).toEqual(['a', 'new title']);
  });

  test('a new playlist goes on the end', () => {
    const s = open();
    s.set([pl('a')]);
    s.savePlaylist(pl('b'));
    expect(open().get().map((p) => p.id)).toEqual(['a', 'b']);
  });

  test('getPlaylist reads one stored record, as a copy', () => {
    const s = open();
    s.set([pl('a'), pl('b')]);
    const b = s.getPlaylist('b');
    expect(b.id).toBe('b');
    b.title = 'mutated';
    expect(s.getPlaylist('b').title).toBe('b');
    expect(s.getPlaylist('missing')).toBeNull();
  });
});

describe('freshness stamps (playlist-freshness.js) on every write', () => {
  test('a tracks change through set is stamped; a rename is not', () => {
    let t = 1000;
    const s = open({ now: () => t });
    s.set([pl('a', ['1'])]);
    t = 2000;
    s.set([{ ...s.get()[0], title: 'renamed' }]);
    expect(s.get()[0].tracksChangedAt).toBe(1000);
    t = 3000;
    s.set([pl('a', ['1', '2'])]);
    expect(s.get()[0]).toMatchObject({ tracksChangedAt: 3000, lastChangeAdded: 1 });
  });

  test('savePlaylist stamps against the stored version', () => {
    let t = 1000;
    const s = open({ now: () => t });
    s.set([pl('a', ['1'])]);
    t = 5000;
    s.savePlaylist(pl('a', ['1', '2', '3']));
    expect(s.getPlaylist('a')).toMatchObject({ tracksChangedAt: 5000, lastChangeAdded: 2 });
  });
});

describe('crash safety', () => {
  test('a playlist file written before the index (a crash between them) is still read', () => {
    const s = open();
    s.set([pl('a')]);
    // What a crash after the record write but before the index leaves.
    fs.writeFileSync(path.join(dir, fileNameFor('b')), JSON.stringify(pl('b')));
    expect(open().get().map((p) => p.id)).toEqual(['a', 'b']);
  });

  test('a half-written temp file is ignored', () => {
    const s = open();
    s.set([pl('a')]);
    fs.writeFileSync(path.join(dir, `${fileNameFor('a')}.tmp`), '{"id":"a","tit');
    expect(open().get().map((p) => p.title)).toEqual(['a']);
  });

  test('an unreadable playlist file is skipped with a log, never the whole list', () => {
    const s = open();
    s.set([pl('a'), pl('b')]);
    fs.writeFileSync(path.join(dir, fileNameFor('a')), '{not json');
    const logs = [];
    expect(open({ log: (m) => logs.push(m) }).get().map((p) => p.id)).toEqual(['b']);
    expect(logs.join('\n')).toMatch(/couldn.t be read/i);
  });
});

describe('the first get after loading', () => {
  test('is a private copy too, and a write in between is seen', () => {
    open().set([pl('a')]);
    const s = open();
    const first = s.get();
    first[0].title = 'mutated';
    expect(s.get()[0].title).toBe('a');

    const t = open();
    t.has();
    t.savePlaylist({ ...pl('a'), title: 'saved' });
    expect(t.get()[0].title).toBe('saved');
  });
});

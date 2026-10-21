/**
 * Large-library load cost (#784), main-process side.
 *
 * 1. getAllTracks used to make 2-3 synchronous fs.existsSync calls per track
 *    to find album art: 300k+ blocking syscalls for a 150k-track library on
 *    every reload. buildArtIndex answers the same questions with one readdir
 *    of the art cache and one memoized check per other path. These tests pin
 *    that the answers are identical to the per-file checks and that the
 *    check count stays per-folder, not per-track.
 * 2. The background poll used to report 'poll-complete' after every 5-minute
 *    scan, and the renderer reloads the whole library on it. It now reports
 *    only when the scan changed something.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LocalFilesService = require('../../local-files/index');
const FileWatcher = require('../../local-files/watcher');

describe('LocalFilesService art index', () => {
  let root;
  let cacheDir;
  let service;
  let rows;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'art-index-'));
    cacheDir = path.join(root, 'cache');
    fs.mkdirSync(cacheDir);
    const embeddedPng = path.join(root, 'b', 'two.flac');
    const pngHash = crypto.createHash('md5').update(embeddedPng).digest('hex');
    fs.writeFileSync(path.join(cacheDir, `embedded-${pngHash}.png`), '');
    const embeddedJpg = path.join(root, 'c', 'three.flac');
    const jpgHash = crypto.createHash('md5').update(embeddedJpg).digest('hex');
    fs.writeFileSync(path.join(cacheDir, `embedded-${jpgHash}.jpg`), '');
    fs.writeFileSync(path.join(cacheDir, 'caa-rel1.jpg'), '');
    fs.mkdirSync(path.join(root, 'a'));
    fs.writeFileSync(path.join(root, 'a', 'cover.jpg'), '');

    let id = 0;
    const row = (file, extra) => ({ id: ++id, file_path: file, title: 't', artist: 'a', album: 'b', ...extra });
    rows = [
      // folder art: present, shared by three tracks in one folder
      row(path.join(root, 'a', '1.flac'), { folder_art_path: path.join(root, 'a', 'cover.jpg') }),
      row(path.join(root, 'a', '2.flac'), { folder_art_path: path.join(root, 'a', 'cover.jpg') }),
      row(path.join(root, 'a', '3.flac'), { folder_art_path: path.join(root, 'a', 'cover.jpg') }),
      // folder art recorded but since deleted
      row(path.join(root, 'gone', '1.flac'), { folder_art_path: path.join(root, 'gone', 'cover.jpg') }),
      // embedded art, extracted as png / as jpg / never extracted
      row(embeddedPng, { has_embedded_art: 1 }),
      row(embeddedJpg, { has_embedded_art: 1 }),
      row(path.join(root, 'd', 'cold.flac'), { has_embedded_art: 1 }),
      // MusicBrainz art cached to disk / pruned from disk / a remote URL
      row(path.join(root, 'e', '1.flac'), { musicbrainz_art_url: `file://${path.join(cacheDir, 'caa-rel1.jpg')}` }),
      row(path.join(root, 'e', '2.flac'), { musicbrainz_art_url: `file://${path.join(cacheDir, 'caa-pruned.jpg')}` }),
      row(path.join(root, 'e', '3.flac'), { musicbrainz_art_url: 'https://coverartarchive.org/release/x/front' }),
    ];
    service = Object.create(LocalFilesService.prototype);
    service.albumArt = { cacheDir };
    service.db = { getAllTracks: () => rows };
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test('a whole-library load finds exactly the art the per-file checks find', () => {
    const batched = service.getAllTracks().map((t) => t.albumArt || null);
    const perFile = rows.map((r) => service.formatTrackForRenderer(r).albumArt || null);
    expect(batched).toEqual(perFile);
    expect(batched).toEqual([
      `file://${path.join(root, 'a', 'cover.jpg')}`,
      `file://${path.join(root, 'a', 'cover.jpg')}`,
      `file://${path.join(root, 'a', 'cover.jpg')}`,
      null,
      expect.stringMatching(/embedded-[0-9a-f]+\.png$/),
      expect.stringMatching(/embedded-[0-9a-f]+\.jpg$/),
      null,
      `file://${path.join(cacheDir, 'caa-rel1.jpg')}`,
      null,
      'https://coverartarchive.org/release/x/front',
    ]);
  });

  test('cache files cost one readdir, and a folder cover is checked once per folder', () => {
    const spy = jest.spyOn(fs, 'existsSync');
    const readdir = jest.spyOn(fs, 'readdirSync');
    try {
      service.getAllTracks();
      const checked = spy.mock.calls.map(([p]) => p);
      // Only the two folder covers; the embedded and caa files come from the
      // single cache listing.
      expect(checked.sort()).toEqual([path.join(root, 'a', 'cover.jpg'), path.join(root, 'gone', 'cover.jpg')].sort());
      expect(readdir).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      readdir.mockRestore();
    }
  });

  test('an unreadable cache dir falls back to per-file checks', () => {
    const missing = Object.create(LocalFilesService.prototype);
    missing.albumArt = { cacheDir: path.join(root, 'no-such-cache') };
    missing.db = { getAllTracks: () => rows };
    expect(() => missing.getAllTracks()).not.toThrow();
  });
});

describe('FileWatcher background poll', () => {
  function watcherWith(results) {
    const db = { getWatchFolders: () => [{ path: '/m1', enabled: 1 }, { path: '/m2', enabled: 1 }, { path: '/off', enabled: 0 }] };
    let i = 0;
    const scanner = { scanFolder: async () => results[i++] };
    const watcher = new FileWatcher(db, scanner);
    const events = [];
    watcher.onLibraryChanged = (e) => events.push(e);
    return { watcher, events };
  }

  test('a poll that changed nothing reports nothing', async () => {
    const { watcher, events } = watcherWith([
      { processed: 10, added: 0, updated: 0, removed: 0 },
      { processed: 0, added: 0, updated: 0, removed: 0, skipped: 'unreadable' },
    ]);
    await watcher.pollForChanges();
    expect(events).toEqual([]);
  });

  test('a poll that changed something reports the totals', async () => {
    const { watcher, events } = watcherWith([
      { processed: 10, added: 2, updated: 0, removed: 1 },
      { processed: 5, added: 0, updated: 3, removed: 0 },
    ]);
    await watcher.pollForChanges();
    expect(events).toEqual([[{ action: 'poll-complete', added: 2, updated: 3, removed: 1 }]]);
  });
});

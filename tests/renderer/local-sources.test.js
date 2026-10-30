/**
 * Stale local-file sources (parachord#1002). A track that resolved to a local
 * file kept `sources.localfiles` after the file left the library, so the
 * collection still showed it as local and play tried a file that was gone.
 * src/renderer/lib/local-sources.js decides what is stale; app.js strips it
 * after every successful library load. Also covers the service's
 * fileStatus, which tells a failed play "missing" from "won't decode".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  libraryFilePaths,
  isStaleLocalSource,
  withoutStaleLocalSource,
  trackWithoutStaleLocalSource,
  tracksWithoutStaleLocalSources,
} = require('../../src/renderer/lib/local-sources');

const LIB = [
  { id: 'local-1', filePath: '/music/a.flac' },
  { id: 'local-2', sources: { localfiles: { filePath: '/music/b.mp3' } } },
  { id: 'local-3' },
];
const paths = libraryFilePaths(LIB);
const gone = { id: 'local-9', filePath: '/music/gone.flac', confidence: 1 };
const here = { id: 'local-1', filePath: '/music/a.flac', confidence: 1 };
const spotify = { id: 'spotify-x', spotifyId: 'x', confidence: 0.95 };

describe('libraryFilePaths', () => {
  test('collects top-level and source file paths, skipping tracks without one', () => {
    expect([...paths].sort()).toEqual(['/music/a.flac', '/music/b.mp3']);
    expect(libraryFilePaths(null).size).toBe(0);
  });
});

describe('isStaleLocalSource', () => {
  test('a file missing from a known library is stale', () => {
    expect(isStaleLocalSource(gone, paths)).toBe(true);
    expect(isStaleLocalSource(here, paths)).toBe(false);
  });

  test('an unknown library (no successful load yet) never strips anything', () => {
    // A failed DB read must not look like "every file is gone".
    expect(isStaleLocalSource(gone, null)).toBe(false);
    expect(isStaleLocalSource(gone, undefined)).toBe(false);
  });

  test('an empty library that loaded fine makes every local source stale', () => {
    expect(isStaleLocalSource(here, new Set())).toBe(true);
  });

  test('noMatch sentinels and sources without a path are left alone', () => {
    expect(isStaleLocalSource({ noMatch: true }, paths)).toBe(false);
    expect(isStaleLocalSource({ id: 'local-x' }, paths)).toBe(false);
    expect(isStaleLocalSource(null, paths)).toBe(false);
  });
});

describe('withoutStaleLocalSource', () => {
  test('drops only the stale localfiles entry', () => {
    expect(withoutStaleLocalSource({ localfiles: gone, spotify }, paths)).toEqual({ spotify });
  });

  test('returns the same object when nothing is stale, so callers can skip a state update', () => {
    const live = { localfiles: here, spotify };
    expect(withoutStaleLocalSource(live, paths)).toBe(live);
    const noLocal = { spotify };
    expect(withoutStaleLocalSource(noLocal, paths)).toBe(noLocal);
    expect(withoutStaleLocalSource(undefined, paths)).toBeUndefined();
  });
});

describe('track helpers', () => {
  test('a track keeps its identity unless its sources change', () => {
    const live = { id: 't1', sources: { localfiles: here } };
    expect(trackWithoutStaleLocalSource(live, paths)).toBe(live);
    const stale = { id: 't2', title: 'Song', sources: { localfiles: gone, spotify } };
    expect(trackWithoutStaleLocalSource(stale, paths)).toEqual({ id: 't2', title: 'Song', sources: { spotify } });
  });

  test('a track list keeps its identity unless a track changed', () => {
    const list = [{ id: 't1', sources: { localfiles: here } }, { id: 't3' }];
    expect(tracksWithoutStaleLocalSources(list, paths)).toBe(list);
    const mixed = [...list, { id: 't2', sources: { localfiles: gone } }];
    const cleaned = tracksWithoutStaleLocalSources(mixed, paths);
    expect(cleaned).not.toBe(mixed);
    expect(cleaned[0]).toBe(mixed[0]);
    expect(cleaned[2].sources).toEqual({});
  });
});

describe('LocalFilesService.fileStatus', () => {
  const LocalFilesService = require('../../local-files/index');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-status-'));
  const present = path.join(dir, 'here.flac');
  fs.writeFileSync(present, 'x');
  const missing = path.join(dir, 'gone.flac');
  const known = new Set([present, missing]);
  const fakeService = { db: { getTrackByPath: (p) => (known.has(p) ? { file_path: p } : null) } };
  const fileStatus = (p) => LocalFilesService.prototype.fileStatus.call(fakeService, p);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('present / missing for files the library knows', async () => {
    await expect(fileStatus(present)).resolves.toBe('present');
    await expect(fileStatus(missing)).resolves.toBe('missing');
  });

  test('unknown for paths outside the library, so the renderer cannot probe arbitrary files', async () => {
    await expect(fileStatus('/etc/hosts')).resolves.toBe('unknown');
    await expect(fileStatus('')).resolves.toBe('unknown');
    await expect(fileStatus(null)).resolves.toBe('unknown');
  });
});

describe('app.js wiring', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8') +
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');

  test('the library paths come only from a successful load', () => {
    // The catch path and a null IPC result also call setLibrary([]); building
    // the path set there would strip every local source on a DB read error.
    expect(app).toMatch(/if \(Array\.isArray\(localTracks\)\) \{\n\s+libraryFilePathsRef\.current = libraryFilePaths\(localTracks\);/);
    expect((app.match(/libraryFilePathsRef\.current = /g) || []).length).toBe(1);
  });

  test('the reconcile waits for the cache and the collection, and reruns on every load', () => {
    expect(app).toMatch(/if \(!paths \|\| !cacheLoaded \|\| collectionLoading\) return;/);
    expect(app).toMatch(/\}, \[libraryPathsVersion, cacheLoaded, collectionLoading\]\);/);
  });

  test('resolution ignores a stale local source, persisted or cached', () => {
    expect(app).toMatch(/resolverId === 'localfiles' && isStaleLocalSource\(sourceData, libraryFilePathsRef\.current\)/);
    expect(app).toMatch(/isStaleLocalSource\(cachedData\.sources\.localfiles, libraryFilePathsRef\.current\)/);
  });

  test('a local play checks the file is still there before handing it to the audio element', () => {
    expect(app).toMatch(/await window\.electron\.localFiles\.fileStatus\(localPath\)/);
    expect(app).toMatch(/title: 'File Not Found'/);
  });
});

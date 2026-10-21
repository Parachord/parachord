/**
 * Large-library behaviour in the renderer (#784, part 2).
 *
 * - A local-files watcher change is applied by fetching just the changed
 *   rows (src/renderer/lib/library-changes.js), not by reloading the whole
 *   library; bulk events still reload in full.
 * - The local-art pass looks up one track per album, once per session, with
 *   no MusicBrainz ISRC fallback, and the 10k-track cutoff is gone.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  classifyLibraryChanges,
  applyLibraryPatch,
  albumArtGroupKey,
  MAX_INCREMENTAL_PATHS,
} = require('../../src/renderer/lib/library-changes');

describe('classifyLibraryChanges', () => {
  test('per-file watcher results are incremental', () => {
    const plan = classifyLibraryChanges([
      { action: 'added', track: { filePath: '/m/a.flac', title: 'A' } },
      { action: 'updated', track: { filePath: '/m/b.flac' } },
      { action: 'removed', filePath: '/m/c.flac' },
      { action: 'error', error: 'bad tag' },
    ]);
    expect(plan).toEqual({ incremental: true, upsertPaths: ['/m/a.flac', '/m/b.flac'], removedPaths: ['/m/c.flac'] });
  });

  test("the ID3 editor's single update object is incremental too", () => {
    expect(classifyLibraryChanges({ type: 'update', filePath: '/m/a.flac', tags: {} }))
      .toEqual({ incremental: true, upsertPaths: ['/m/a.flac'], removedPaths: [] });
  });

  test('a later change to the same path wins', () => {
    expect(classifyLibraryChanges([
      { action: 'removed', filePath: '/m/a.flac' },
      { action: 'added', track: { filePath: '/m/a.flac' } },
    ])).toEqual({ incremental: true, upsertPaths: ['/m/a.flac'], removedPaths: [] });
  });

  test('bulk events reload in full', () => {
    for (const change of [
      { action: 'scan-complete', folder: '/m', added: 3 },
      { action: 'rescan-complete', results: [] },
      { action: 'folder-removed', folder: '/m' },
      { action: 'missing-removed', count: 4 },
      { action: 'poll-complete', added: 1, updated: 0, removed: 0 },
    ]) {
      expect(classifyLibraryChanges([change]).incremental).toBe(false);
    }
    // One bulk event in a batch makes the whole batch a full reload.
    expect(classifyLibraryChanges([{ action: 'added', track: { filePath: '/m/a' } }, { action: 'scan-complete' }]).incremental).toBe(false);
  });

  test('malformed changes, and too many paths, reload in full', () => {
    expect(classifyLibraryChanges([{ action: 'added', track: {} }]).incremental).toBe(false);
    expect(classifyLibraryChanges([null]).incremental).toBe(false);
    const many = Array.from({ length: MAX_INCREMENTAL_PATHS + 1 }, (_, i) => ({ action: 'removed', filePath: `/m/${i}` }));
    expect(classifyLibraryChanges(many).incremental).toBe(false);
  });

  test('errors only: incremental with nothing to do', () => {
    expect(classifyLibraryChanges([{ action: 'error', error: 'x' }])).toEqual({ incremental: true, upsertPaths: [], removedPaths: [] });
  });
});

describe('applyLibraryPatch', () => {
  const lib = [
    { id: 'local-1', filePath: '/m/a.flac', title: 'A' },
    { id: 'local-2', filePath: '/m/b.flac', title: 'B' },
    { id: 'local-3', filePath: '/m/c.flac', title: 'C' },
  ];

  test('removes, replaces by path (a re-indexed file gets a new id) and appends', () => {
    const out = applyLibraryPatch(lib,
      { upsertPaths: ['/m/b.flac', '/m/d.flac'], removedPaths: ['/m/c.flac'] },
      [{ id: 'local-9', filePath: '/m/b.flac', title: 'B (retagged)' }, { id: 'local-10', filePath: '/m/d.flac', title: 'D' }]);
    expect(out.map((t) => t.id)).toEqual(['local-1', 'local-9', 'local-10']);
    expect(out[0]).toBe(lib[0]); // untouched rows keep their identity
  });

  test('an upserted path with no row anymore (removed meanwhile) just disappears', () => {
    const out = applyLibraryPatch(lib, { upsertPaths: ['/m/a.flac'], removedPaths: [] }, []);
    expect(out.map((t) => t.id)).toEqual(['local-2', 'local-3']);
  });

  test('returns the same array when nothing changes', () => {
    expect(applyLibraryPatch(lib, { upsertPaths: [], removedPaths: [] }, [])).toBe(lib);
    expect(applyLibraryPatch(lib, { upsertPaths: [], removedPaths: ['/m/zzz'] }, [])).toBe(lib);
  });
});

describe('albumArtGroupKey', () => {
  test('tracks of one album share a key, case and spacing aside', () => {
    expect(albumArtGroupKey({ artist: 'Radiohead', album: 'Kid A', filePath: '/1' }))
      .toBe(albumArtGroupKey({ artist: ' radiohead', album: 'KID A ', filePath: '/2' }));
  });

  test('the album artist wins over the track artist (compilations stay one album)', () => {
    expect(albumArtGroupKey({ artist: 'Feat. Someone', albumArtist: 'Various', album: 'Mix', filePath: '/1' }))
      .toBe(albumArtGroupKey({ artist: 'Other', albumArtist: 'Various', album: 'Mix', filePath: '/2' }));
  });

  test('album-less tracks never share a key', () => {
    expect(albumArtGroupKey({ artist: 'X', album: '', filePath: '/1' }))
      .not.toBe(albumArtGroupKey({ artist: 'X', album: '', filePath: '/2' }));
  });
});

describe('app.js wiring', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

  test('library changes are applied incrementally, with a full-reload fallback', () => {
    expect(app).toMatch(/const plan = classifyLibraryChanges\(changes\);/);
    expect(app).toMatch(/await window\.electron\.localFiles\.getTracksByPaths\(plan\.upsertPaths\)/);
    expect(app).toMatch(/setLibrary\(prev => applyLibraryPatch\(prev, plan, fetched\)\);/);
    expect(app).not.toMatch(/console\.log\('📚 Library changed, reloading\.\.\.', changes\);\n\s+loadLocalFilesLibrary\(\);\n\s+setLocalLibraryVersion/);
  });

  test('the 10k-track enrichment cutoff is gone and the pass is per album, once per session', () => {
    expect(app).not.toMatch(/localTracks\.length > 10000/);
    const start = app.indexOf('const enrichLocalTracksWithArtwork = async (tracks) => {');
    const body = app.slice(start, app.indexOf('\n  };', start));
    expect(body).toMatch(/albumArtGroupKey\(track\)/);
    expect(body).toMatch(/localArtAttemptedRef\.current/);
    expect(body).toMatch(/skipIsrcFallback: true/);
    // Publishes onto the current rows by path rather than mutating.
    expect(body).toMatch(/setLibrary\(prev => \{/);
    expect(body).not.toMatch(/\bt\.albumArt = /);
  });

  test('enrichTrackWithMbid honours skipIsrcFallback before the MusicBrainz call', () => {
    const start = app.indexOf('const enrichTrackWithMbid = async (track, opts = {}) => {');
    const body = app.slice(start, app.indexOf('\n  };', start));
    expect(body.indexOf('if (opts.skipIsrcFallback) return;')).toBeGreaterThan(-1);
    expect(body.indexOf('if (opts.skipIsrcFallback) return;')).toBeLessThan(body.indexOf('window.resolveMbidViaIsrc(isrc'));
  });
});

describe('LocalFilesService.getTracksByPaths', () => {
  const LocalFilesService = require('../../local-files/index');
  test('returns formatted rows for the paths that still have one', () => {
    const svc = Object.create(LocalFilesService.prototype);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'by-paths-'));
    svc.albumArt = { cacheDir: dir };
    const rows = { '/m/a.flac': { id: 7, file_path: '/m/a.flac', title: 'A' } };
    svc.db = { getTrackByPath: (p) => rows[p] || null };
    const out = svc.getTracksByPaths(['/m/a.flac', '/m/gone.flac', 42]);
    expect(out.map((t) => [t.id, t.filePath])).toEqual([['local-7', '/m/a.flac']]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

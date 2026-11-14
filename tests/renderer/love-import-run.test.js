/**
 * Loved-tracks IMPORT (parachord#1071): the page walk (collectLoves), the
 * cursor and the no-loop marks, plus the runner wiring source-markers.
 * Plan: docs/plans/2026-11-06-import-loved-tracks.md, Task 4.
 *
 * collectLoves is pure over an injected fetchPage, so these tests need no
 * React and no window.
 */

const fs = require('fs');
const path = require('path');

const {
  parseLastfmLovedPage,
  collectLoves,
  nextLoveCursor,
  withLovesPushed,
} = require('../../src/renderer/lib/love-import');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

// A fake service: `pages` is an array of arrays of loved-at seconds per page
// (newest first), or an array of Error/thrown values.
const makeFetchPage = (pages) => {
  let call = 0;
  const seen = [];
  const fetchPage = async () => {
    const page = pages[Math.min(call, pages.length - 1)];
    call++;
    if (page instanceof Error) {
      seen.push(page.message);
      throw page;
    }
    seen.push([...page]);
    return { lovedtracks: { '@attr': { total: '1000', totalPages: '50' }, track: page.map((lovedAt) => ({ name: `T${lovedAt}`, artist: { name: 'A' }, date: { uts: String(lovedAt) } })) } };
  };
  fetchPage.calls = seen;
  return fetchPage;
};

const noProgress = () => {};
const fast = { retryDelays: [], pageGapMs: 0 };

describe('collectLoves', () => {
  test('walks pages until the cursor cut, and KEEPS loves equal to the cursor', async () => {
    const fetchPage = makeFetchPage([[2000, 1500], [1500, 1000], [900]]);
    const { loves, complete, error } = await collectLoves({
      fetchPage, parse: parseLastfmLovedPage, cursor: 1500, pageSize: 2, onProgress: noProgress, ...fast,
    });
    expect(complete).toBe(true);
    expect(error).toBeNull();
    expect(fetchPage.calls).toHaveLength(2); // the 1000 on page 2 ends the walk
    expect(loves.map((l) => l.lovedAt)).toEqual([2000, 1500, 1500]); // equal is kept
  });

  test('stops when a page comes back empty, and reports progress per page', async () => {
    const fetchPage = makeFetchPage([[2000], []]);
    const progress = [];
    const { loves, complete } = await collectLoves({
      fetchPage, parse: parseLastfmLovedPage, cursor: 0, pageSize: 1,
      onProgress: (done, total) => progress.push([done, total]),
      ...fast,
    });
    expect(complete).toBe(true);
    expect(loves.map((l) => l.lovedAt)).toEqual([2000]);
    expect(progress).toEqual([[1, 1000], [1, 1000]]);
  });

  test('a short page is not terminal (a service may return fewer than asked): the walk reads on to the empty page', async () => {
    const fetchPage = makeFetchPage([[2000, 1500], []]);
    const { loves, complete } = await collectLoves({
      fetchPage, parse: parseLastfmLovedPage, cursor: 0, pageSize: 10, onProgress: noProgress, ...fast,
    });
    expect(complete).toBe(true);
    expect(fetchPage.calls).toHaveLength(2);
    expect(loves).toHaveLength(2);
  });

  test('stops once everything has been read (seen reaches the remote total)', async () => {
    let call = 0;
    const fetchPage = async () => {
      call++;
      if (call === 1) {
        return { lovedtracks: { '@attr': { total: '2', totalPages: '50' }, track: [
          { name: 'A', artist: { name: 'X' }, date: { uts: '2000' } },
          { name: 'B', artist: { name: 'X' }, date: { uts: '1000' } },
        ] } };
      }
      return { lovedtracks: { '@attr': { total: '2', totalPages: '50' }, track: [] } };
    };
    const { loves, complete } = await collectLoves({
      fetchPage, parse: parseLastfmLovedPage, cursor: 0, pageSize: 10, onProgress: noProgress, ...fast,
    });
    expect(complete).toBe(true);
    expect(call).toBe(1); // the total was already read; no empty request
    expect(loves).toHaveLength(2);
  });

  test('a rejected page after retries returns what was read with complete: false and the error, without throwing', async () => {
    const fetchPage = makeFetchPage([[2000], new Error('boom')]);
    const { loves, complete, error } = await collectLoves({
      fetchPage, parse: parseLastfmLovedPage, cursor: 0, pageSize: 1, onProgress: noProgress, ...fast,
    });
    expect(complete).toBe(false);
    expect(error).toBe('boom');
    expect(loves.map((l) => l.lovedAt)).toEqual([2000]);
  });

  test('a rejected page is retried with the backoff delays before giving up', async () => {
    let attempts = 0;
    const fetchPage = async () => {
      attempts++;
      if (attempts <= 2) throw new Error('429');
      return { lovedtracks: { '@attr': { total: '1', totalPages: '1' }, track: [{ name: 'T', artist: { name: 'A' }, date: { uts: '2000' } }] } };
    };
    const { loves, complete, error } = await collectLoves({
      fetchPage, parse: parseLastfmLovedPage, cursor: 0, pageSize: 2, onProgress: noProgress,
      retryDelays: [0, 0], pageGapMs: 0,
    });
    expect(complete).toBe(true);
    expect(error).toBeNull();
    expect(loves).toHaveLength(1);
    expect(attempts).toBe(3); // 1 try + 2 retries
  });

  test('advances ListenBrainz-style by returned rows, so a short page still walks on', async () => {
    // Page 1 returns 2 of 3 asked (LB shape: offset += returned).
    const pages = [
      { count: 2, offset: 0, total_count: 3, feedback: [
        { created: 3000, recording_mbid: '9bd9f6a2-2c27-4d3c-b1d9-6e56a5ee72c2', track_metadata: { artist_name: 'A', track_name: 'T3' } },
        { created: 2000, recording_mbid: '1e7b2ec1-6fab-4846-b25e-3dcb4a9f61a9', track_metadata: { artist_name: 'A', track_name: 'T2' } },
      ] },
      { count: 1, offset: 2, total_count: 3, feedback: [
        { created: 1000, recording_mbid: 'b6d7ec1f-62f6-43dc-a67c-8367f4047d0e', track_metadata: { artist_name: 'A', track_name: 'T1' } },
      ] },
    ];
    let call = 0;
    const offsets = [];
    const fetchPage = async ({ offset }) => {
      offsets.push(offset);
      const page = pages[call++];
      return page;
    };
    const { parseListenbrainzFeedbackPage } = require('../../src/renderer/lib/love-import');
    const { loves, complete } = await collectLoves({
      fetchPage, parse: parseListenbrainzFeedbackPage, cursor: 0, pageSize: 3, onProgress: noProgress, ...fast,
    });
    expect(offsets).toEqual([0, 2]);
    expect(complete).toBe(true);
    expect(loves.map((l) => l.lovedAt)).toEqual([3000, 2000, 1000]);
  });

  test('stops at the remote totalPages (no last empty request), and a natural finish is not capped', async () => {
    let call = 0;
    const fetchPage = async () => {
      call++;
      return { lovedtracks: { '@attr': { total: '50', totalPages: '1' }, track: [
        { name: 'A', artist: { name: 'X' }, date: { uts: '2000' } },
        { name: 'B', artist: { name: 'X' }, date: { uts: '1000' } },
      ] } };
    };
    const { loves, complete, capped } = await collectLoves({
      fetchPage, parse: parseLastfmLovedPage, cursor: 0, pageSize: 10, onProgress: noProgress, ...fast,
    });
    expect(complete).toBe(true);
    expect(call).toBe(1); // totalPages: 1 — the walk never asks for page 2
    expect(capped).toBe(false); // total 50 > seen: only totalPages ended it
    expect(loves).toHaveLength(2);
  });

  test('an account that ends exactly at the page cap finished naturally, so capped is false', async () => {
    // total 2, pageSize 1, maxPages 2: page 2 reads the last love, the total
    // is reached, nothing remained — no cap note in the summary.
    let call = 0;
    const fetchPage = async ({ page }) => {
      call++;
      return { lovedtracks: { '@attr': { total: '2', totalPages: '50' }, track: [
        { name: 'A', artist: { name: 'X' }, date: { uts: String(2000 - page) } },
      ] } };
    };
    const { capped, complete } = await collectLoves({
      fetchPage, parse: parseLastfmLovedPage, cursor: 0, pageSize: 1, onProgress: noProgress, maxPages: 2, ...fast,
    });
    expect(complete).toBe(true);
    expect(call).toBe(2);
    expect(capped).toBe(false);
  });

  test('the page cap ends the walk with capped: true (the toast says so)', async () => {
    const fetchPage = makeFetchPage([[2000], [1500]]);
    const { capped, complete } = await collectLoves({
      fetchPage, parse: parseLastfmLovedPage, cursor: 0, pageSize: 1, onProgress: noProgress, maxPages: 2, ...fast,
    });
    expect(complete).toBe(true);
    expect(capped).toBe(true);
  });

  test('permanent errors fail fast: no backoff for Not connected / User not found', async () => {
    let attempts = 0;
    const fetchPage = async () => { attempts++; throw new Error('Not connected'); };
    const started = Date.now();
    const { complete, error } = await collectLoves({
      fetchPage, parse: parseLastfmLovedPage, cursor: 0, pageSize: 2, onProgress: noProgress,
      retryDelays: [5000, 5000], pageGapMs: 0,
    });
    expect(complete).toBe(false);
    expect(error).toBe('Not connected');
    expect(attempts).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('nextLoveCursor', () => {
  test('an incomplete walk never advances, even with newer loves in hand (review focus 2)', () => {
    const loves = [{ lovedAt: 5000 }];
    expect(nextLoveCursor(1000, loves, false)).toBe(1000);
    expect(nextLoveCursor(undefined, loves, false)).toBe(0);
  });

  test('a complete walk advances to the newest lovedAt and never moves backwards', () => {
    const loves = [{ lovedAt: 5000 }, { lovedAt: 4000 }, { lovedAt: null }];
    expect(nextLoveCursor(1000, loves, true)).toBe(5000);
    expect(nextLoveCursor(6000, loves, true)).toBe(6000);
    expect(nextLoveCursor(0, [], true)).toBe(0);
  });
});

describe('withLovesPushed', () => {
  test('marks every id for the service, keeps the others, and returns a new object', () => {
    const before = { 'existing-track': { lastfm: 5 } };
    const after = withLovesPushed(before, ['t1', 't2', null], 'lastfm', 99);
    expect(after.t1).toEqual({ lastfm: 99 });
    expect(after.t2).toEqual({ lastfm: 99 });
    expect(after['existing-track']).toEqual({ lastfm: 5 });
    expect(before.t1).toBeUndefined();
    const other = withLovesPushed(after, ['t1'], 'listenbrainz', 100);
    expect(other.t1).toEqual({ lastfm: 99, listenbrainz: 100 });
    expect(after.t1).toEqual({ lastfm: 99 });
  });
});

describe('wiring (source markers)', () => {
  const app = read('src/renderer/app.js');

  test('the import never routes through the live add or push paths (review focus 3)', () => {
    const start = app.indexOf('const runLoveImport = useCallback');
    const end = app.indexOf('// Remove track from collection', start);
    const body = app.slice(start, end);
    expect(body).not.toContain('addTrackToCollection(');
    expect(body).not.toContain('pushLoveToScrobblers(');
  });

  test('the cross-service push goes through the restricted backfill, not the toggle path', () => {
    const start = app.indexOf('const runLoveImport = useCallback');
    const end = app.indexOf('// Remove track from collection', start);
    const body = app.slice(start, end);
    expect(body).toContain('runLoveBackfill(otherService, { onlyIds: new Set(writeBox.addedIds) })');
  });

  test('runLoveBackfill filters by onlyIds when given', () => {
    expect(app).toContain("const runLoveBackfill = useCallback(async (service, { onlyIds } = {}) => {");
    expect(app).toContain('(!onlyIds || onlyIds.has(t.id))');
  });

  test('the pre-ship-removals heuristic only applies where no tombstone entry exists (the date rule governs the rest)', () => {
    expect(app).toContain('loveTombstoneAt(now, love) == null');
    expect(app).toContain('LoveImport.isOrphanedLovePush(orphanPushedIds, row)');
  });

  test('the cross-service confirmation is wired for cancel, backdrop and supersede, and only offers a connected service', () => {
    expect(app).toContain('const superseded = pendingConfirmCancelRef.current;');
    expect(app).toContain('if (superseded) superseded();');
    // Cancel button and backdrop dismiss consume-and-fire; OK consumes without.
    expect(app).toContain('const fn = closeConfirmDialog();');
    expect(app).toContain('onConfirm: () => resolve(true),');
    expect(app).toContain('onCancel: () => resolve(false),');
    // Connected, not just toggled.
    expect(app).toContain('otherConnected = await otherScrobbler.isEnabled();');
  });

  test('a failed tombstone read stops the run', () => {
    expect(app).toContain("Couldn't read your removed-tracks list, so nothing was imported");
  });

  test('only confirmed adds are marked pushed (a failed save must not leave orphan marks)', () => {
    expect(app).toContain("...(saveOk ? writeBox.addedIds : [])");
  });

  test('the running flag is taken synchronously, before the first await (a fast double click)', () => {
    const runStart = app.indexOf('const runLoveImport = useCallback');
    const tryAt = app.indexOf('try {', runStart);
    const flagAt = app.indexOf('loveImportRunningRef.current = { ...loveImportRunningRef.current, [service]: true };', runStart);
    expect(tryAt).toBeGreaterThan(-1);
    expect(flagAt).toBeGreaterThan(-1);
    expect(flagAt).toBeLessThan(tryAt);
  });

  test('the live heart push opts out of the collection re-check (the row is being added as the push starts)', () => {
    expect(app).toContain("pushLoveToScrobblers({ ...track, id: trackId }, { justAdded: true })");
  });

  test('the love-push re-check drops gone tracks from the retry queue (unique to pushLoveToScrobblers, not the backfill walk)', () => {
    const pushStart = app.indexOf('const pushLoveToScrobblers = useCallback');
    const pushEnd = app.indexOf('const markLovePushed = useCallback', pushStart);
    const pushBody = app.slice(pushStart, pushEnd);
    expect(pushBody).toContain("pushLoveToScrobblers = useCallback(async (track, { justAdded = false } = {}) => {");
    expect(pushBody).toContain('removed from the collection since the love was queued');
    expect(pushBody).toContain('loveRetryQueueRef.current.delete(track.id);');
  });

  test('a removal mid-run drops queued love-pushes (the push must not land after the removal)', () => {
    expect(app).toContain('loveRetryQueueRef.current.delete(matchId);');
    expect(app).toContain('if (!stillThere) { removedMidRun++; continue; }');
    expect(app).toContain('const stillThere = (collectionDataRef.current?.tracks || []).some((t) => t && t.id === track.id);');
  });

  test('a removal deletes the removed row\'s love-push mark (a post-ship removal has its own name tombstone)', () => {
    expect(app).toContain('delete without[matchId];');
  });

  test('the cross-service push is gated on the confirmed save', () => {
    expect(app).toContain('if (crossConfirm && saveOk &&');
  });

  test('love_import_cursor is in the bulk-load list', () => {
    expect(app).toContain("'love_import_cursor'");
  });
});

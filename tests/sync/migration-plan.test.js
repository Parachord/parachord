/**
 * Migration preview shaping (parachord#911): shadow output → render model, and
 * render model → GitHub-issue report.
 */

const { summarizeMigrationPlan, buildMigrationReport } = require('../../migration-plan');

const wouldPush = (localId, displayName, perTarget) => ({ status: 'would-push', localId, displayName, perTarget });

describe('summarizeMigrationPlan', () => {
  test('all-noop fleet: nothing changed, nothing protected', () => {
    const s = summarizeMigrationPlan({ results: [], cycles: 20, errors: [] });
    expect(s.hasChanges).toBe(false);
    expect(s.hasRemoves).toBe(false);
    expect(s.noopCount).toBe(20);
    expect(s.totalAdds).toBe(0);
    expect(s.totalRemoves).toBe(0);
  });

  test('classifies adds, removes, and tallies totals', () => {
    const s = summarizeMigrationPlan({
      cycles: 3,
      results: [
        wouldPush('spotify-a', 'Road trip', [
          { providerId: 'spotify', addKeys: 2, removeKeys: 0,
            addTracks: [{ artist: 'A', title: 'x' }, { artist: 'B', title: 'y' }], removeTracks: [] },
        ]),
        wouldPush('applemusic-b', 'Chill mix', [
          { providerId: 'applemusic', addKeys: 0, removeKeys: 1,
            addTracks: [], removeTracks: [{ artist: 'K', title: 'z' }] },
        ]),
      ],
    });
    expect(s.hasChanges).toBe(true);
    expect(s.changed).toHaveLength(2);
    expect(s.totalAdds).toBe(2);
    expect(s.totalRemoves).toBe(1);
    expect(s.hasRemoves).toBe(true);
    expect(s.noopCount).toBe(1); // 3 cycles - 2 non-noop results
    expect(s.changed[0].providers[0].adds).toHaveLength(2);
    expect(s.changed[1].providers[0].removes[0]).toEqual({ artist: 'K', title: 'z' });
  });

  test('a would-push whose every target diff is empty is NOT counted as a change', () => {
    const s = summarizeMigrationPlan({
      cycles: 1,
      results: [wouldPush('spotify-a', 'Empty diff', [{ providerId: 'spotify', addTracks: [], removeTracks: [] }])],
    });
    expect(s.hasChanges).toBe(false);
    expect(s.changed).toHaveLength(0);
  });

  test('surfaces safety aborts as protected (not as changes)', () => {
    const s = summarizeMigrationPlan({
      cycles: 2,
      results: [
        { status: 'total-wipe-abort', localId: 'spotify-w', displayName: 'Liked songs' },
        { status: 'partial-abort', localId: 'applemusic-p', displayName: 'Deep cuts' },
      ],
    });
    expect(s.hasChanges).toBe(false);
    expect(s.protected).toHaveLength(2);
    expect(s.protected[0]).toEqual({ localId: 'spotify-w', displayName: 'Liked songs', reason: 'total-wipe' });
    expect(s.protected[1].reason).toBe('partial');
  });

  test('counts errors from the shadow output', () => {
    const s = summarizeMigrationPlan({ results: [], cycles: 1, errors: [{ localId: 'x', error: 'boom' }] });
    expect(s.errorCount).toBe(1);
  });
});

describe('buildMigrationReport', () => {
  const summary = {
    changed: [{ displayName: 'Chill mix', providers: [{ providerId: 'applemusic', adds: [], removes: [{ artist: 'Khruangbin', title: 'May ninth' }] }] }],
    protected: [], totalAdds: 0, totalRemoves: 1, hasRemoves: true, hasChanges: true,
  };

  test('builds a titled, labeled GitHub new-issue URL with the diff in the body', () => {
    const { title, body, githubUrl } = buildMigrationReport(summary, { appVersion: '1.2.3' });
    expect(title).toContain('1 remove');
    expect(title).toContain('1.2.3');
    expect(body).toContain('Khruangbin — May ninth');
    expect(body).toContain('App version: 1.2.3');
    expect(githubUrl.startsWith('https://github.com/Parachord/parachord/issues/new?')).toBe(true);
    expect(githubUrl).toContain(`title=${encodeURIComponent(title)}`);
    expect(githubUrl).toContain('labels=sync');
    expect(decodeURIComponent(githubUrl)).toContain('Khruangbin — May ninth');
  });

  test('tolerates missing appVersion + empty summary', () => {
    const { body, githubUrl } = buildMigrationReport({}, {});
    expect(body).toContain('App version: unknown');
    expect(githubUrl.startsWith('https://github.com/')).toBe(true);
  });
});

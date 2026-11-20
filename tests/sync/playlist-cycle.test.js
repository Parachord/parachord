// Which playlists a sync cycle works on (sync-engine/playlist-cycle.js), with
// the real short-circuit and stagger. Every selected playlist's snapshot is
// compared each cycle; the batch caps only the ones that need work, and a
// playlist whose source changed goes first. Daily Brew's 5:18 am rebuild
// waited until an 11:07 Sync Now because the stagger chose 15 of 177 to
// compare at all (2026-11-20).

const { planPlaylistCycle } = require('../../sync-engine/playlist-cycle');
const { canShortCircuitPlaylistUpdate, staggerPlaylistsForCycle } = require('../../sync-engine');
const { tracksFingerprint } = require('../../sync-engine/auto-pull');

const P = 'spotify';
const TRACKS = [{ title: 'T', artist: 'A' }];

// An import from Spotify, last checked at `checkedAt`, at snapshot `snap`.
const imported = (id, { snap = 's1', checkedAt = 1000, ...over } = {}) => ({
  id: `spotify-${id}`,
  title: id,
  creator: 'me',
  source: 'spotify-sync',
  tracks: TRACKS,
  syncedFrom: { resolver: P, externalId: id, snapshotId: snap, ownerId: 'me', isCollaborator: false, tracksFingerprint: tracksFingerprint(TRACKS) },
  syncSources: { [P]: { syncedAt: checkedAt } },
  lastModified: 1,
  hasUpdates: false,
  ...over,
});
// A playlist made elsewhere and pushed to Spotify: never short-circuits.
const mirror = (id, checkedAt) => ({
  id: `local-${id}`,
  title: id,
  tracks: TRACKS,
  syncedTo: { [P]: { externalId: id } },
  syncSources: { [P]: { syncedAt: checkedAt } },
  lastModified: 1,
});
const remote = (id, snap = 's1') => ({ id: `spotify-${id}`, externalId: id, name: id, snapshotId: snap, ownerId: 'me', isCollaborator: false });

function plan(locals, remotes, opts = {}) {
  const byExt = new Map();
  for (const l of locals) {
    if (l.syncedFrom) byExt.set(l.syncedFrom.externalId, l);
    if (l.syncedTo && l.syncedTo[P]) byExt.set(l.syncedTo[P].externalId, l);
  }
  return planPlaylistCycle({
    selectedRemote: remotes,
    localFor: (r) => byExt.get(r.externalId),
    localPlaylists: locals,
    providerId: P,
    canShortCircuit: canShortCircuitPlaylistUpdate,
    stagger: staggerPlaylistsForCycle,
    ...opts,
  });
}

describe('planPlaylistCycle', () => {
  test('Daily Brew: 176 unchanged are marked checked, and its rebuild is checked this cycle though it was checked most recently', () => {
    const locals = [];
    const remotes = [];
    for (let i = 0; i < 176; i++) {
      locals.push(imported(`p${i}`, { checkedAt: 1000 + i }));
      remotes.push(remote(`p${i}`));
    }
    locals.push(imported('dailybrew', { snap: 'yesterday', checkedAt: 99999 }));
    remotes.push(remote('dailybrew', 'today'));
    const out = plan(locals, remotes);
    expect(out.unchanged).toHaveLength(176);
    expect(out.toProcess.map((r) => r.externalId)).toEqual(['dailybrew']);
    expect(out.waiting).toBe(0);
  });

  test('a changed import goes ahead of older mirrors that need the full branch', () => {
    const locals = [];
    const remotes = [];
    for (let i = 0; i < 20; i++) {
      locals.push(mirror(`m${i}`, 10 + i));
      remotes.push(remote(`m${i}`));
    }
    locals.push(imported('dailybrew', { snap: 'yesterday', checkedAt: 99999 }));
    remotes.push(remote('dailybrew', 'today'));
    const out = plan(locals, remotes);
    expect(out.toProcess[0].externalId).toBe('dailybrew');
    expect(out.toProcess).toHaveLength(15);
    expect(out.waiting).toBe(6);
  });

  test('a conflict already flagged does not jump the queue (parachord#835)', () => {
    const locals = [
      imported('conflict', { snap: 'pinned', checkedAt: 99999, hasUpdates: true }),
      mirror('old', 5),
    ];
    const out = plan(locals, [remote('conflict', 'moved'), remote('old')]);
    expect(out.toProcess.map((r) => r.externalId)).toEqual(['old', 'conflict']);
  });

  test('changed imports go oldest check first among themselves, and the batch caps only work', () => {
    const locals = [];
    const remotes = [];
    for (let i = 0; i < 20; i++) {
      locals.push(imported(`c${i}`, { snap: 'old', checkedAt: 500 - i }));
      remotes.push(remote(`c${i}`, 'new'));
    }
    const out = plan(locals, remotes, { batchSize: 5 });
    expect(out.toProcess.map((r) => r.externalId)).toEqual(['c19', 'c18', 'c17', 'c16', 'c15']);
    expect(out.waiting).toBe(15);
  });

  test('a new playlist (no local copy) is work, ahead of other non-urgent work', () => {
    const out = plan([mirror('m', 5)], [remote('m'), remote('brand-new')]);
    expect(out.toProcess.map((r) => r.externalId)).toEqual(['brand-new', 'm']);
  });

  test('a full sync processes every playlist that needs work', () => {
    const locals = [];
    const remotes = [];
    for (let i = 0; i < 30; i++) {
      locals.push(mirror(`m${i}`, i));
      remotes.push(remote(`m${i}`));
    }
    const out = plan(locals, remotes, { fullSync: true });
    expect(out.toProcess).toHaveLength(30);
    expect(out.waiting).toBe(0);
  });

  test('an import from before the fingerprint is seeded before its check', () => {
    const legacy = imported('legacy');
    delete legacy.syncedFrom.tracksFingerprint;
    const out = plan([legacy], [remote('legacy')]);
    expect(out.unchanged).toHaveLength(1);
    expect(out.unchanged[0].playlist.syncedFrom.tracksFingerprint).toBe(tracksFingerprint(TRACKS));
  });
});

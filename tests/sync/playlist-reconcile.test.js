/**
 * N-way Layer-A reconcile — the no-false-drop harness
 * (Parachord/parachord#911, Step 2 / PR-4a). Ports NwayMaterializeTest's
 * end-to-end cases (22-34) against an in-memory harness: a FakeProvider with a
 * REAL in-memory remote (native-id round-trip via `nid:<mbid>`), an in-memory
 * negative cache, in-memory sync state, and in-memory write-back effects.
 *
 * Every case asserts the governing invariant from a different angle —
 * propagation never drops a track without positive deletion evidence:
 *   #1 un-hydratable add never drops existing remote
 *   #2 incremental convergence (the baseline-lag re-detection)
 *   #4b/#4c/#4d one provider failing never aborts the playlist / dead-link heal
 *   #5/#6 capability-dispatched removal; Unsupported keeps
 *   #7 total-wipe blocked, large non-empty drop allowed
 *   #9 remaster-drift identity bridge — no churn
 *   #10 hydration cooldown
 */

const { reconcilePlaylist } = require('../../sync-engine/playlist-reconcile');
const { createHydrationCache } = require('../../sync-engine/nway-hydration-cache');
const { createHydrationCoordinator } = require('../../sync-engine/hydration-coordinator');
const { buildBaselineTiers } = require('../../sync-engine/playlist-sync-state');

const CAPS = {
  ByNativeId: { trackRemoveMode: 'ByNativeId', canReorder: true, supportsPlaylistDelete: true, supportsPlaylistRename: true },
  ByPosition: { trackRemoveMode: 'ByPosition', canReorder: false, supportsPlaylistDelete: true, supportsPlaylistRename: true },
  Unsupported: { trackRemoveMode: 'Unsupported', canReorder: false, supportsPlaylistDelete: false, supportsPlaylistRename: false },
};

// Track factory. A real recordingMbid → mbid tier dominates (distinct title/
// artist keep norm from accidentally bridging). A null mbid → norm-keyed, and
// nativeIdOf returns null so it must be HYDRATED (searched) to materialize.
const mk = (mbid, extra = {}) => ({
  recordingMbid: mbid || null,
  title: extra.title != null ? extra.title : `title-${mbid}`,
  artist: extra.artist != null ? extra.artist : `artist-${mbid}`,
  ...extra,
});
const noMbid = (title, artist = 'artist-x') => ({ recordingMbid: null, title, artist });
const mbidsOf = (tracks) => new Set(tracks.map((t) => t.recordingMbid));

class FakeProvider {
  constructor(id, mode, { hydrate = () => null, remoteExists = true, throwOnWrite = false, throwOnSnapshot = false } = {}) {
    this.id = id;
    this.capabilities = CAPS[mode];
    this.hydrate = hydrate;
    this.remoteExists = remoteExists;
    this.throwOnWrite = throwOnWrite;
    this.throwOnSnapshot = throwOnSnapshot;
    // When set, fetchPlaylistTracks returns only the first N rows (a TRUNCATED
    // page) while the harness still reports the full trackCount — modelling a
    // silently-short fetch the PARTIAL-FETCH FLOOR must treat as fill, not delete.
    this.truncateFetchTo = null;
    this.remote = [];
    this.snap = 0;
    this.searchCalls = 0;
    this.resetRecorders();
  }
  resetRecorders() {
    this.addCalls = [];
    this.removeByNativeIdCalls = [];
    this.removeByPositionCalls = [];
    this.replaceCalls = [];
  }
  nativeIdOf(track) {
    if (!track) return null;
    const m = track.recordingMbid || track.mbid;
    return m ? `nid:${m}` : null;
  }
  _recon(nid) {
    const s = String(nid);
    const mbid = s.startsWith('nid:') ? s.slice(4) : s;
    return { recordingMbid: mbid, title: `recon-${mbid}`, artist: `recon-${mbid}` };
  }
  async fetchPlaylistTracks() {
    const rows = this.truncateFetchTo != null ? this.remote.slice(0, this.truncateFetchTo) : this.remote;
    return rows.map((t) => ({ ...t }));
  }
  async addPlaylistTracks(_ext, nativeIds) {
    if (this.throwOnWrite) throw new Error(`${this.id} add throwOnWrite`);
    this.addCalls.push(nativeIds.slice());
    for (const nid of nativeIds) this.remote.push(this._recon(nid));
    this.snap += 1;
  }
  async removePlaylistTracksByNativeId(_ext, nativeIds) {
    if (this.capabilities.trackRemoveMode !== 'ByNativeId') throw new Error('wrong removeMode ByNativeId');
    if (this.throwOnWrite) throw new Error('remove throwOnWrite');
    this.removeByNativeIdCalls.push(nativeIds.slice());
    const drop = new Set(nativeIds);
    this.remote = this.remote.filter((t) => !drop.has(this.nativeIdOf(t)));
    this.snap += 1;
  }
  async removePlaylistTracksByPosition(_ext, positions) {
    if (this.capabilities.trackRemoveMode !== 'ByPosition') throw new Error('wrong removeMode ByPosition');
    if (this.throwOnWrite) throw new Error('remove throwOnWrite');
    this.removeByPositionCalls.push(positions.slice());
    const drop = new Set(positions);
    this.remote = this.remote.filter((_, i) => !drop.has(i));
    this.snap += 1;
  }
  async replacePlaylistTracks(_ext, nativeIds) {
    if (this.throwOnWrite) throw new Error('replace throwOnWrite');
    this.replaceCalls.push(nativeIds.slice());
    this.remote = nativeIds.map((nid) => this._recon(nid));
    this.snap += 1;
  }
  async getPlaylistSnapshot() {
    if (this.throwOnSnapshot) throw new Error(`${this.id} getPlaylistSnapshot failed`);
    return `snap-${this.id}-${this.snap}`;
  }
  async remotePlaylistExists() {
    return this.remoteExists;
  }
  async searchForTrackId(title, artist, album, isrc) {
    this.searchCalls += 1;
    return this.hydrate({ title, artist, album, isrc });
  }
}

class Harness {
  constructor(localId = 'pl-1') {
    this.localId = localId;
    this.providers = [];
    this.mirrors = {};
    this.time = 1000;
    this.cache = createHydrationCache();
    this.pullSource = null;
    this.removedLinks = [];
    this.playlist = { tracks: [], locallyModified: false, lastModified: 0, writable: true };
    this.state = { baseline: { localPlaylistId: localId, tracks: [], baselineSyncedAt: this.time }, providers: {} };
  }
  add(provider, externalId) {
    provider._ext = externalId || `ext-${provider.id}`;
    this.providers.push(provider);
    this.mirrors[provider.id] = provider._ext;
    return provider;
  }
  // Seed every mirror + local + baseline + token to a steady, unchanged state.
  seed(tracks) {
    this.playlist.tracks = tracks.map((t) => ({ ...t }));
    for (const p of this.providers) {
      p.remote = tracks.map((t) => ({ ...t }));
      p.snap = 0;
      this.state.providers[p.id] = { changeToken: `snap-${p.id}-0`, editedAt: 0 };
    }
    this.state.baseline.tracks = buildBaselineTiers(tracks);
    this.state.baseline.baselineSyncedAt = this.time;
  }
  // External drift on a mirror (bumps its snapshot so change-detection fires).
  drift(provider, tracks) {
    provider.remote = tracks.map((t) => ({ ...t }));
    provider.snap += 1;
  }
  editLocal(tracks) {
    this.time += 1000;
    this.playlist.tracks = tracks.map((t) => ({ ...t }));
    this.playlist.locallyModified = true;
    this.playlist.lastModified = this.time;
  }
  _remoteLists() {
    const out = {};
    for (const p of this.providers) {
      out[p.id] = { [p._ext]: { snapshotId: `snap-${p.id}-${p.snap}`, trackCount: p.remote.length } };
    }
    return out;
  }
  _effects() {
    const self = this;
    return {
      replaceAllLocalTracks(_id, tracks) { self.playlist.tracks = tracks.map((t) => ({ ...t })); },
      setProviderToken(_id, pid, token, now) { self.state.providers[pid] = { changeToken: token, editedAt: now }; },
      removeSyncLink(_id, pid) { delete self.mirrors[pid]; self.removedLinks.push(pid); },
      removeProviderState(_id, pid) { delete self.state.providers[pid]; },
      setBaseline(_id, tiers, now) { self.state.baseline.tracks = tiers; self.state.baseline.baselineSyncedAt = now; },
      clearLocallyModified() { self.playlist.locallyModified = false; },
    };
  }
  cycle(opts = {}) {
    return reconcilePlaylist({
      baseline: this.state.baseline,
      playlist: this.playlist,
      mirrors: this.mirrors,
      providers: this.providers,
      remoteLists: this._remoteLists(),
      storedTokens: this.state.providers,
      pullSource: this.pullSource,
      coordinator: createHydrationCoordinator({ cache: this.cache, clock: () => this.time }),
      cache: this.cache,
      now: this.time,
      dryRun: !!opts.dryRun,
      effects: this._effects(),
      log: { info() {}, warn() {} },
    });
  }
  provider(id) {
    return this.providers.find((p) => p.id === id);
  }
  // Mark a track as already-materialized on a provider (non-null resolvedId),
  // so isProviderPendingForKey returns false — i.e. defeat the augmentation
  // guard, isolating whether a LATER guard catches a transient absence.
  warmCache(providerId, mbid) {
    this.cache.upsert(`mbid-${mbid}`, providerId, `nid:${mbid}`, this.time, 1);
  }
}

describe('reconcile Group 4 — end-to-end no-false-drop (cases 22-34)', () => {
  test('22 (#1) un-hydratable add never drops existing remote; baseline still advances', async () => {
    const h = new Harness();
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition', { hydrate: () => null }));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.editLocal([mk('m0'), mk('m1'), mk('m2'), noMbid('New Song')]);
    await h.cycle();
    expect(lb.remote.length).toBe(3); // un-hydratable add NOT forced onto remote
    expect(lb.removeByPositionCalls).toEqual([]); // nothing removed
    expect(lb.addCalls).toEqual([]); // nothing added (pending)
    expect(h.playlist.tracks.length).toBe(4); // local keeps it
    expect(h.state.baseline.tracks.length).toBe(4); // baseline advances
  });

  test('23 (#2) incremental convergence — the baseline-lag re-detection', async () => {
    const h = new Harness();
    let findable = false;
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId', {
      hydrate: ({ title }) => (findable && title === 'New Song' ? 'nid:mbid-new' : null),
    }));
    h.seed([mk('m0'), mk('m1')]);
    h.editLocal([mk('m0'), mk('m1'), noMbid('New Song')]);

    await h.cycle(); // CYCLE 1 — un-hydratable, pending
    expect(sp.remote.length).toBe(2);
    expect(sp.addCalls).toEqual([]);
    expect(h.state.baseline.tracks.length).toBe(3); // baseline ran ahead of the mirror

    // The track becomes findable; cache cleared; local re-marked.
    h.cache.deleteForProvider('spotify');
    findable = true;
    h.editLocal([mk('m0'), mk('m1'), noMbid('New Song')]);

    await h.cycle(); // CYCLE 2 — lag re-detected, add now lands
    expect(sp.remote.length).toBe(3);
    expect(sp.addCalls.length).toBe(1);
    expect(sp.replaceCalls).toEqual([]); // incremental, never replace
  });

  test('24 (#3) add-heavy churn (80%) — incremental add + remove, never replace', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId', { hydrate: ({ title }) => `nid:${title}` }));
    h.seed([mk('local-0-0'), mk('local-0-1'), mk('local-0-2'), mk('local-0-3'), mk('local-0-4')]);
    h.editLocal([mk('local-0-0'), mk('fresh-1'), mk('fresh-2'), mk('fresh-3'), mk('fresh-4')]);
    await h.cycle();
    expect(mbidsOf(sp.remote)).toEqual(new Set(['local-0-0', 'fresh-1', 'fresh-2', 'fresh-3', 'fresh-4']));
    expect(sp.replaceCalls).toEqual([]);
    expect(sp.addCalls.length).toBe(1); // batched 4 adds
    expect(sp.removeByNativeIdCalls.length).toBe(1); // batched 4 removes
  });

  test('25 (#4) multi-master — both providers converge', async () => {
    const h = new Harness();
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('local-0-0'), mk('local-0-1'), mk('local-0-2')]);
    h.editLocal([mk('local-0-1'), mk('local-0-2'), mk('added')]);
    await h.cycle();
    const want = new Set(['local-0-1', 'local-0-2', 'added']);
    expect(mbidsOf(lb.remote)).toEqual(want);
    expect(mbidsOf(sp.remote)).toEqual(want);
    expect(lb.removeByPositionCalls.length).toBe(1);
    expect(sp.removeByNativeIdCalls.length).toBe(1);
  });

  test('26 (#4b) one provider throwing does not abort the playlist', async () => {
    const h = new Harness();
    const am = h.add(new FakeProvider('applemusic', 'Unsupported', { throwOnWrite: true })); // listed FIRST
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('m0'), mk('m1')]);
    h.editLocal([mk('m0'), mk('m1'), mk('added')]);
    await expect(h.cycle()).resolves.toBeTruthy(); // must NOT throw
    expect(mbidsOf(sp.remote)).toEqual(new Set(['m0', 'm1', 'added']));
    expect(sp.addCalls.length).toBe(1);
    expect(am.remote.length).toBe(2); // untouched
    expect(am.addCalls).toEqual([]);
  });

  test('27 (#4c) failure on a GONE mirror clears the dead link', async () => {
    const h = new Harness();
    h.add(new FakeProvider('applemusic', 'Unsupported', { throwOnWrite: true, remoteExists: false }));
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('m0'), mk('m1')]);
    h.editLocal([mk('m0'), mk('m1'), mk('added')]);
    await h.cycle();
    expect(h.mirrors.applemusic).toBeUndefined(); // link cleared
    expect(h.state.providers.applemusic).toBeUndefined();
    expect(h.removedLinks).toContain('applemusic');
    expect(mbidsOf(sp.remote)).toEqual(new Set(['m0', 'm1', 'added']));
  });

  test('28 (#4d) failure on a STILL-PRESENT mirror does NOT clear the link', async () => {
    const h = new Harness();
    h.add(new FakeProvider('applemusic', 'Unsupported', { throwOnWrite: true, remoteExists: true }));
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('m0'), mk('m1')]);
    h.editLocal([mk('m0'), mk('m1'), mk('added')]);
    await h.cycle();
    expect(h.mirrors.applemusic).toBeDefined(); // link kept
    expect(mbidsOf(sp.remote)).toEqual(new Set(['m0', 'm1', 'added']));
  });

  test('29 (#5) removal propagates on ByNativeId/ByPosition; Unsupported keeps', async () => {
    const h = new Harness();
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    const am = h.add(new FakeProvider('applemusic', 'Unsupported'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.editLocal([mk('m0'), mk('m2')]); // remove index 1
    await h.cycle();
    expect(lb.remote.length).toBe(2);
    expect(sp.remote.length).toBe(2);
    expect(am.remote.length).toBe(3); // Unsupported can't remove — keeps
  });

  test('30 (#6) capability dispatch — each removeMode its own path, never replace', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    const am = h.add(new FakeProvider('applemusic', 'Unsupported'));
    h.seed([mk('m0'), mk('m1')]);
    h.editLocal([mk('m1')]); // remove first
    await h.cycle();
    expect(sp.removeByNativeIdCalls.length).toBe(1);
    expect(sp.removeByPositionCalls).toEqual([]);
    expect(lb.removeByPositionCalls.length).toBe(1);
    expect(lb.removeByNativeIdCalls).toEqual([]);
    for (const p of [sp, lb, am]) expect(p.replaceCalls).toEqual([]);
  });

  test('31 (#7) total-wipe blocked, large non-empty drop allowed', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('m0'), mk('m1'), mk('m2'), mk('m3'), mk('m4'), mk('m5'), mk('m6'), mk('m7')]);

    h.editLocal([]); // clear everything → TOTAL WIPE, must abort
    const r = await h.cycle();
    expect(r.status).toBe('total-wipe-abort');
    expect(sp.remote.length).toBe(8);
    expect(sp.removeByNativeIdCalls).toEqual([]);

    h.editLocal([mk('m0'), mk('m1')]); // drop to 2 of 8 (75%) → ALLOWED
    await h.cycle();
    expect(sp.remote.length).toBe(2);
  });

  test('32 (#8) idempotent no-op on the second cycle', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.editLocal([mk('m0'), mk('m1'), mk('m2'), mk('extra')]);
    await h.cycle();
    expect(sp.remote.length).toBe(4);

    sp.resetRecorders();
    const r = await h.cycle(); // nothing changed
    expect(sp.addCalls).toEqual([]);
    expect(sp.removeByNativeIdCalls).toEqual([]);
    expect(sp.replaceCalls).toEqual([]);
    expect(sp.remote.length).toBe(4);
    expect(r).toBeNull(); // pure no-op
  });

  test('33 (#9) identity diff — remaster drift produces no churn', async () => {
    const h = new Harness();
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition', { hydrate: () => null }));
    h.seed([mk('local-clarity', { title: 'Clarity', artist: 'Zedd' })]);
    // Remote drifts to a different recording-MBID + remaster title (snapshot bumps).
    h.drift(lb, [mk('remote-clarity-remaster', { title: 'Clarity - 2025 Remastered', artist: 'Zedd' })]);
    h.editLocal([mk('local-clarity', { title: 'Clarity', artist: 'Zedd' })]);
    await h.cycle();
    expect(lb.addCalls).toEqual([]); // norm-bridge: same recording, no add
    expect(lb.removeByPositionCalls).toEqual([]); // …and no remove
    expect(lb.remote.length).toBe(1);
  });

  test('34 (#10) hydration cooldown — no re-search within the window', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId', { hydrate: () => null }));
    h.seed([mk('m0'), mk('m1')]);
    h.editLocal([mk('m0'), mk('m1'), noMbid('Ghost')]);

    await h.cycle(); // CYCLE 1 — searches once, caches the miss
    const afterFirst = sp.searchCalls;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    h.editLocal([mk('m0'), mk('m1'), noMbid('Ghost')]);
    await h.cycle(); // CYCLE 2 — cooldown suppresses the re-search
    expect(sp.searchCalls).toBe(afterFirst);
    expect(sp.remote.length).toBe(2); // never emptied
  });
});

describe('reconcile — adversarial-review regressions (PB-1, PB-2)', () => {
  test('PB-1 truncated NON-EMPTY fetch on a changed mirror never drops a healthy mirror', async () => {
    const h = new Harness();
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('m0'), mk('m1'), mk('m2'), mk('m3'), mk('m4')]);
    // Defeat the augmentation guard: m3/m4 are "already materialized" on Spotify.
    h.warmCache('spotify', 'm3');
    h.warmCache('spotify', 'm4');
    // Spotify drifts (snapshot bumps → changed) but its fetch is TRUNCATED to
    // 3 of 5, while the honest trackCount stays 5. WITHOUT the partial-fetch
    // floor this diffs m3/m4 as deletions and removes them from ListenBrainz.
    sp.snap += 1;
    sp.truncateFetchTo = 3;
    await h.cycle();
    expect(lb.removeByPositionCalls).toEqual([]); // healthy mirror untouched
    expect(lb.remote.length).toBe(5);
    expect(h.state.baseline.tracks.length).toBe(5); // baseline not truncated
  });

  test('PB-2 a failed post-push getPlaylistSnapshot does NOT clobber the stored token with null', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId', { throwOnSnapshot: true }));
    h.seed([mk('m0'), mk('m1')]);
    const tokenBefore = h.state.providers.spotify.changeToken;
    h.editLocal([mk('m0'), mk('m1'), mk('added')]); // a real push happens
    await h.cycle();
    // The snapshot read threw — the prior token must survive, NOT become null.
    expect(h.state.providers.spotify.changeToken).not.toBeNull();
    expect(h.state.providers.spotify.changeToken).toBe(tokenBefore);
    expect(mbidsOf(sp.remote)).toEqual(new Set(['m0', 'm1', 'added'])); // push still landed
  });
});

describe('reconcile — missingStreak gate (shared-root fix)', () => {
  test('read-only authoritative source: single transient omission protected, sustained one propagates', async () => {
    const h = new Harness('spotify-pl');
    h.playlist.writable = false; // read-only imported source
    h.pullSource = { providerId: 'spotify', externalId: 'ext-spotify' };
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'), 'ext-spotify');
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.warmCache('spotify', 'm2'); // m2 was materialized on the source

    // CYCLE 1 — the source's complete fetch transiently omits m2 (streak 1).
    h.drift(sp, [mk('m0'), mk('m1')]);
    await h.cycle();
    expect(lb.remote.length).toBe(3); // m2 NOT dropped — single omission is transient
    expect(lb.removeByPositionCalls).toEqual([]);
    expect(h.state.baseline.tracks.length).toBe(3);

    // CYCLE 2 — the source still omits m2 (streak 2 → escalates → real delete).
    await h.cycle();
    expect(mbidsOf(lb.remote)).toEqual(new Set(['m0', 'm1'])); // delete propagated
    expect(lb.removeByPositionCalls.length).toBe(1);
    expect(h.state.baseline.tracks.length).toBe(2);
  });

  test('cache recordSeen resets the streak; recordMissing increments it', () => {
    const c = createHydrationCache();
    c.upsert('mbid-x', 'spotify', 'nid:x', 100, 1);
    expect(c.select('mbid-x', 'spotify').missingStreak).toBe(0);
    c.recordMissing('mbid-x', 'spotify');
    c.recordMissing('mbid-x', 'spotify');
    expect(c.select('mbid-x', 'spotify').missingStreak).toBe(2);
    c.recordSeen('mbid-x', 'spotify', 200);
    expect(c.select('mbid-x', 'spotify').missingStreak).toBe(0);
    // No-op on a never-materialized key (protected by resolvedId===null anyway).
    c.recordMissing('mbid-ghost', 'spotify');
    expect(c.select('mbid-ghost', 'spotify')).toBeNull();
  });
});

describe('reconcile — shadow (dryRun) mode', () => {
  test('computes the would-push plan without any write or baseline advance', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('m0'), mk('m1')]);
    h.editLocal([mk('m0'), mk('m1'), mk('added')]);
    const baselineBefore = h.state.baseline.tracks.length;
    const r = await h.cycle({ dryRun: true });
    expect(r.status).toBe('would-push');
    expect(r.mergedSize).toBe(3);
    expect(r.pushTargets).toEqual(['spotify']);
    expect(r.perTarget[0]).toMatchObject({ providerId: 'spotify', addKeys: 1, removeKeys: 0 });
    // No side effects: remote, local, baseline all untouched.
    expect(sp.remote.length).toBe(2);
    expect(sp.addCalls).toEqual([]);
    expect(h.state.baseline.tracks.length).toBe(baselineBefore);
  });
});

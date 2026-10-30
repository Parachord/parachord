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

const { reconcilePlaylist, NWAY_HELD_TOKEN } = require('../../sync-engine/playlist-reconcile');
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
    // Recording mbids whose add the provider ACCEPTS but never stores: an add
    // that resolved to a native id yet never landed (a hydrated id is not proof
    // the track is on the playlist).
    this.dropAddsFor = new Set();
    // Runs before every fetchPlaylistTracks with its 1-based call number, so a
    // test can change the remote between the reconcile's fetches (a user edit
    // landing mid-cycle).
    this.beforeFetch = null;
    this.fetchCount = 0;
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
    this.fetchCount += 1;
    if (this.beforeFetch) this.beforeFetch(this.fetchCount);
    const rows = this.truncateFetchTo != null ? this.remote.slice(0, this.truncateFetchTo) : this.remote;
    return rows.map((t) => ({ ...t }));
  }
  async addPlaylistTracks(_ext, nativeIds) {
    if (this.throwOnWrite) throw new Error(`${this.id} add throwOnWrite`);
    this.addCalls.push(nativeIds.slice());
    for (const nid of nativeIds) {
      const track = this._recon(nid);
      if (!this.dropAddsFor.has(track.recordingMbid)) this.remote.push(track);
    }
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
    this.mirrorOnly = false;
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
      mirrorOnly: this.mirrorOnly,
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
  // Mark a track as already-materialized on a provider — a past fetch has
  // SEEN it there (lastSeenAt), with `missingStreak` omissions already
  // recorded — so isProviderPendingForKey consults its streak. Models a track a
  // past cycle observed on the provider; a test that starts from a fresh link
  // must warm it to make it droppable. Mirrors mobile's Harness.warmCache.
  warmCache(providerId, mbid, missingStreak = 0) {
    const key = `mbid-${mbid}`;
    this.cache.upsert(key, providerId, `nid:${mbid}`, this.time, 1);
    this.cache.recordSeen(key, providerId, this.time);
    for (let i = 0; i < missingStreak; i++) this.cache.recordMissing(key, providerId);
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

describe('reconcile — source-authority split (missingStreak gate scoped to OWNED sources)', () => {
  // Set up a source-mirrored playlist: Spotify is the pull source, LB the mirror.
  function setupSourceMirror(localId, { writable }) {
    const h = new Harness(localId);
    h.playlist.writable = writable;
    h.pullSource = { providerId: 'spotify', externalId: 'ext-spotify' };
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'), 'ext-spotify');
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    return { h, sp, lb };
  }

  test('V8 — followed (read-only) source rotate-out drops IMMEDIATELY (one-way mirror, no gate)', async () => {
    const { h, sp, lb } = setupSourceMirror('spotify-pl', { writable: false });
    // NO warmCache: the immediate-authority path bypasses the hydration cache.
    h.drift(sp, [mk('m0'), mk('m1')]); // ONE complete fetch rotates m2 out
    await h.cycle();
    expect(mbidsOf(lb.remote)).toEqual(new Set(['m0', 'm1'])); // dropped in ONE cycle
    expect(lb.removeByPositionCalls.length).toBe(1);
    expect(h.state.baseline.tracks.length).toBe(2);
    expect(mbidsOf(h.playlist.tracks)).toEqual(new Set(['m0', 'm1']));
  });

  test('V8b — a TRUNCATED followed-source fetch does NOT drop (partial-fetch floor before immediate authority)', async () => {
    const { h, sp, lb } = setupSourceMirror('spotify-pl', { writable: false });
    h.drift(sp, [mk('m0'), mk('m1')]); // remote DECLARES 2 (changed vs baseline 3)…
    sp.truncateFetchTo = 1; // …but the FETCH returns only 1 (truncated)
    await h.cycle();
    expect(mbidsOf(h.playlist.tracks)).toEqual(new Set(['m0', 'm1', 'm2'])); // all 3 retained
    expect(h.state.baseline.tracks.length).toBe(3);
    expect(lb.remote.length).toBe(3);
    expect(lb.removeByPositionCalls).toEqual([]);
  });

  test('owned source single transient omission is gate-protected (not dropped)', async () => {
    const { h } = setupSourceMirror('spotify-pl', { writable: true }); // OWNED source
    h.warmCache('spotify', 'm2'); // materialized → the gate consults its streak
    h.drift(h.provider('spotify'), [mk('m0'), mk('m1')]); // ONE omission
    await h.cycle();
    expect(mbidsOf(h.playlist.tracks)).toEqual(new Set(['m0', 'm1', 'm2'])); // PROTECTED — m2 retained
    expect(h.state.baseline.tracks.length).toBe(3);
    expect(h.cache.select('mbid-m2', 'spotify').missingStreak).toBe(1); // stepped, not yet escalated
  });

  test('V9 — mirrorOnly flag forces an immediate one-way drop on an OWNED source despite streak 0', async () => {
    const { h, lb } = setupSourceMirror('spotify-pl', { writable: true }); // OWNED…
    h.mirrorOnly = true; // …but user-flagged one-way
    h.drift(h.provider('spotify'), [mk('m0'), mk('m1')]);
    await h.cycle();
    expect(mbidsOf(lb.remote)).toEqual(new Set(['m0', 'm1'])); // drops in ONE cycle, no gate
    expect(h.state.baseline.tracks.length).toBe(2);
    expect(mbidsOf(h.playlist.tracks)).toEqual(new Set(['m0', 'm1']));
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
    // The migration preview (#911) needs track NAMES, not just counts.
    expect(r.perTarget[0].addTracks).toEqual([{ artist: 'artist-added', title: 'title-added' }]);
    expect(r.perTarget[0].removeTracks).toEqual([]);
    // No side effects: remote, local, baseline all untouched.
    expect(sp.remote.length).toBe(2);
    expect(sp.addCalls).toEqual([]);
    expect(h.state.baseline.tracks.length).toBe(baselineBefore);
  });

  test('would-push names REMOVED tracks even from an unchanged mirror (the preview\'s danger signal)', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('m0'), mk('m1')]);
    // Local removes m1; spotify's snapshot is UNCHANGED, so its A1 copy is built
    // tracks:[] — the name must come from the preview's fresh fetch.
    h.editLocal([mk('m0')]);
    const r = await h.cycle({ dryRun: true });
    expect(r.status).toBe('would-push');
    expect(r.perTarget[0]).toMatchObject({ providerId: 'spotify', addKeys: 0, removeKeys: 1 });
    expect(r.perTarget[0].removeTracks).toEqual([{ artist: 'artist-m1', title: 'title-m1' }]);
    expect(r.perTarget[0].addTracks).toEqual([]);
    // Still a dry run: nothing written to the remote.
    expect(sp.removeByNativeIdCalls).toEqual([]);
    expect(sp.remote.length).toBe(2);
  });

  // V6 (Refinement A, parachord#956 audit §2a) — a non-removal-capable PULL
  // SOURCE (Apple Music) can never prove a deletion. Even after a materialized
  // track is OMITTED from AM's complete fetch for >= the missingStreak threshold,
  // its absence must NOT propagate a real delete to the writable mirrors — the
  // AM source copy is augment-all. Pre-fix this dropped the track fleet-wide.
  test('V6 AM-add-only-source-declined-augment-all — AM source omission never deletes a mirror track', async () => {
    const h = new Harness('applemusic-pl');
    const am = h.add(new FakeProvider('applemusic', 'Unsupported'));
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.pullSource = { providerId: 'applemusic', externalId: am._ext };
    h.seed([mk('m1'), mk('m2'), mk('m3')]);
    h.warmCache('applemusic', 'm2'); // m2 materialized on AM (resolvedId set → streak gate would fire)

    // Two consecutive COMPLETE AM fetches that OMIT m2 (rotate-out / AM fetch
    // flakiness). Each bumps missingStreak; at 2 the streak gate would normally
    // stop protecting it.
    h.drift(am, [mk('m1'), mk('m3')]);
    await h.cycle(); // cycle 1 → missingStreak('applemusic', m2) = 1
    h.drift(am, [mk('m1'), mk('m3')]);
    await h.cycle(); // cycle 2 → missingStreak = 2 (pre-fix: m2 dropped fleet-wide here)

    expect(lb.removeByPositionCalls).toEqual([]);     // NO delete propagated to the writable mirror
    expect(mbidsOf(lb.remote).has('m2')).toBe(true);  // m2 survives on LB
    expect(h.state.baseline.tracks.length).toBe(3);   // baseline did NOT shrink (residue kept)
  });

  // Counter-case: a REMOVAL-CAPABLE source (Spotify, followed → immediate
  // authority) DOES propagate its drop — confirms augment-all is scoped to
  // non-removal-capable sources, not all pull sources.
  test('V6b removal-capable source still deletes (augment-all is non-removal-capable-only)', async () => {
    const h = new Harness('spotify-pl');
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.pullSource = { providerId: 'spotify', externalId: sp._ext };
    h.playlist.writable = false; // a followed source is immediate-authority (rotate-out drops at once)
    h.seed([mk('m1'), mk('m2'), mk('m3')]);
    h.drift(sp, [mk('m1'), mk('m3')]); // Spotify (the source) genuinely drops m2
    await h.cycle();
    expect(lb.removeByPositionCalls.length).toBe(1);  // a real source delete DOES propagate
    expect(mbidsOf(lb.remote).has('m2')).toBe(false);
  });
});

// parachord#1163 (port of parachord-mobile#469, the shared NwaySourceAuthorityTest
// vectors). The cycle that counts an omission must NOT put the track back on that
// provider, or the streak never grows; "materialized" means a fetch SAW the track
// there (lastSeenAt), never that a search resolved its id.
describe('reconcile — the missingStreak gate reaches its threshold (#1163)', () => {
  test('mirror deletion is held one cycle then propagates — never re-added', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.warmCache('spotify', 'm2');

    h.drift(sp, [mk('m0'), mk('m1')]); // the user deletes m2 on Spotify
    sp.resetRecorders();
    await h.cycle();
    expect(mbidsOf(sp.remote)).toEqual(new Set(['m0', 'm1'])); // held: NOT re-added
    expect(sp.addCalls).toEqual([]);
    expect(h.playlist.tracks.length).toBe(3); // still protected locally
    expect(lb.remote.length).toBe(3); // LB untouched
    expect(h.cache.select('mbid-m2', 'spotify').missingStreak).toBe(1);
    expect(h.state.providers.spotify.changeToken).toBe(NWAY_HELD_TOKEN); // re-fetch next cycle

    await h.cycle(); // streak 2 → a real deletion
    expect(mbidsOf(h.playlist.tracks)).toEqual(new Set(['m0', 'm1']));
    expect(mbidsOf(lb.remote)).toEqual(new Set(['m0', 'm1']));
    expect(mbidsOf(sp.remote)).toEqual(new Set(['m0', 'm1']));
    expect(h.state.providers.spotify.changeToken).not.toBe(NWAY_HELD_TOKEN);

    await h.cycle();
    await h.cycle();
    expect(h.playlist.tracks.length).toBe(2); // stable: nothing resurrects m2
    expect(sp.remote.length).toBe(2);
    expect(lb.remote.length).toBe(2);
  });

  test('a held track put back mid-cycle is never removed by the materialize', async () => {
    // Spotify omits m2 (held) while a local add makes Spotify a push target the
    // same cycle. Between the change fetch and the push-loop fetch the user puts
    // m2 back on Spotify. The executor must diff against the FULL canonical.
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.warmCache('spotify', 'm2');
    h.drift(sp, [mk('m0'), mk('m1')]);
    h.editLocal([mk('m0'), mk('m1'), mk('m2'), mk('x')]);
    sp.fetchCount = 0;
    sp.beforeFetch = (call) => {
      if (call === 2) sp.remote = [mk('m0'), mk('m1'), mk('m2')];
    };
    sp.resetRecorders();
    await h.cycle();
    expect(sp.removeByNativeIdCalls).toEqual([]);
    expect(mbidsOf(sp.remote)).toEqual(new Set(['m0', 'm1', 'm2', 'x']));
    expect(h.playlist.tracks.length).toBe(4);
  });

  test('transient mirror omission that recovers next cycle drops nothing', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.warmCache('spotify', 'm2');

    h.drift(sp, [mk('m0'), mk('m1')]);
    await h.cycle();
    h.drift(sp, [mk('m0'), mk('m1'), mk('m2')]); // a region filter / API hiccup, not a delete
    await h.cycle();
    await h.cycle();

    expect(h.playlist.tracks.length).toBe(3);
    expect(lb.remote.length).toBe(3);
    expect(sp.remote.length).toBe(3); // m2 exactly once (no duplicate re-add)
    expect(h.cache.select('mbid-m2', 'spotify').missingStreak).toBe(0);
    expect(h.state.providers.spotify.changeToken).not.toBe(NWAY_HELD_TOKEN);
  });

  test('owned pull source deletion propagates once the source copy has been observed', async () => {
    // No pre-warmed cache. The user first ADDS on Spotify: that complete fetch
    // is the reconcile's first look at the source and records every track it
    // holds. Later the user removes m2 there: held one cycle, then dropped.
    const h = new Harness('spotify-pl');
    h.playlist.writable = true; // OWNED source
    h.pullSource = { providerId: 'spotify', externalId: 'ext-spotify' };
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'), 'ext-spotify');
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);

    h.drift(sp, [mk('m0'), mk('m1'), mk('m2'), mk('new3')]);
    await h.cycle();
    expect(h.playlist.tracks.length).toBe(4); // the Spotify add was pulled

    h.drift(sp, [mk('m0'), mk('m1'), mk('new3')]);
    sp.resetRecorders();
    await h.cycle();
    expect(sp.addCalls).toEqual([]); // held: m2 not pushed back to the source
    expect(h.playlist.tracks.length).toBe(4); // held: still in canonical

    await h.cycle();
    expect(mbidsOf(h.playlist.tracks)).toEqual(new Set(['m0', 'm1', 'new3']));
    expect(mbidsOf(lb.remote)).toEqual(new Set(['m0', 'm1', 'new3']));
    expect(sp.remote.length).toBe(3);
  });

  test('a track Parachord added to a mirror can later be deleted there', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);

    h.editLocal([mk('m0'), mk('m1'), mk('m2'), mk('x')]);
    await h.cycle();
    expect(sp.remote.length).toBe(4);
    expect(lb.remote.length).toBe(4);

    h.drift(sp, [mk('m0'), mk('m1'), mk('m2')]); // the user removes x on Spotify
    await h.cycle();
    await h.cycle();
    await h.cycle();

    expect(h.playlist.tracks.length).toBe(3);
    expect(mbidsOf(h.playlist.tracks).has('x')).toBe(false);
    expect(lb.remote.length).toBe(3);
    expect(sp.remote.length).toBe(3); // not re-added
  });

  test('an add that resolved but never landed is never treated as a deletion', async () => {
    // The add has no native id on the row, so the coordinator SEARCHES and
    // caches a resolvedId; Spotify accepts the add but never stores it. Its
    // absence must stay PENDING, never escalate into deleting the user's own
    // local add (pre-fix this dropped it on the third cycle).
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId', {
      hydrate: ({ title }) => (title === 'X Song' ? 'nid:x' : null),
    }));
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    sp.dropAddsFor = new Set(['x']);

    h.editLocal([mk('m0'), mk('m1'), mk('m2'), noMbid('X Song')]);
    for (let i = 0; i < 4; i++) await h.cycle();

    // The search DID resolve an id (the evidence the old gate trusted)…
    const resolved = [...h.cache.entries().values()].filter((e) => e.resolvedId === 'nid:x');
    expect(resolved.length).toBe(1);
    expect(resolved[0].lastSeenAt).toBeUndefined(); // …but no fetch ever saw it
    expect(h.playlist.tracks.map((t) => t.title)).toContain('X Song');
    expect(h.playlist.tracks.length).toBe(4);
    expect(lb.removeByPositionCalls).toEqual([]);
    expect(sp.removeByNativeIdCalls).toEqual([]);
  });

  test('add-only pull source omission never deletes (augment-all, Refinement A)', async () => {
    // Even a track SEEN on Apple Music and omitted for many cycles stays.
    const h = new Harness('applemusic-pl');
    const am = h.add(new FakeProvider('applemusic', 'Unsupported'));
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.pullSource = { providerId: 'applemusic', externalId: am._ext };
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.warmCache('applemusic', 'm2');

    for (let i = 0; i < 4; i++) {
      h.drift(am, [mk('m0'), mk('m1')]);
      await h.cycle();
    }

    expect(h.playlist.tracks.length).toBe(3);
    expect(sp.remote.length).toBe(3);
  });

  test('hosted XSPF mirror deletion is restored from the XSPF, never propagated', async () => {
    const h = new Harness();
    h.playlist.sourceUrl = 'https://example.com/p.xspf';
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.warmCache('spotify', 'm2');

    h.drift(sp, [mk('m0'), mk('m1')]);
    for (let i = 0; i < 3; i++) await h.cycle();

    expect(h.playlist.tracks.length).toBe(3);
    expect(lb.remote.length).toBe(3);
    expect(sp.remote.length).toBe(3); // the mirror is restored
  });

  test('followed source mirror deletion is restored, never propagated', async () => {
    const h = new Harness('spotify-pl');
    h.playlist.writable = false; // FOLLOWED (read-only) source → one-way
    h.pullSource = { providerId: 'spotify', externalId: 'ext-spotify' };
    h.add(new FakeProvider('spotify', 'ByNativeId'), 'ext-spotify');
    const lb = h.add(new FakeProvider('listenbrainz', 'ByPosition'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.warmCache('listenbrainz', 'm2');

    h.drift(lb, [mk('m0'), mk('m1')]);
    // Checked EVERY cycle: a wrong drop self-heals the cycle after (the followed
    // source re-asserts m2), so an end-state check alone would miss it.
    for (let i = 0; i < 3; i++) {
      await h.cycle();
      expect(h.playlist.tracks.length).toBe(3);
    }
    expect(lb.remote.length).toBe(3); // the mirror is restored
  });

  test('the migration preview never lists a held track as an add', async () => {
    const h = new Harness();
    const sp = h.add(new FakeProvider('spotify', 'ByNativeId'));
    h.seed([mk('m0'), mk('m1'), mk('m2')]);
    h.warmCache('spotify', 'm2');
    h.drift(sp, [mk('m0'), mk('m1')]); // m2 held on Spotify
    h.editLocal([mk('m0'), mk('m1'), mk('m2'), mk('x')]); // …while a local add targets it
    const r = await h.cycle({ dryRun: true });
    const spotify = r.perTarget.find((p) => p.providerId === 'spotify');
    expect(spotify.addTracks).toEqual([{ artist: 'artist-x', title: 'title-x' }]);
    expect(spotify.removeTracks).toEqual([]);
    expect(h.state.providers.spotify.changeToken).toBe('snap-spotify-0'); // dry run writes no token
  });

  test('cache recordPresent creates a seen entry, fills a missing id, never overwrites one', () => {
    const c = createHydrationCache();
    c.recordPresent('mbid-new', 'spotify', 'sp:new', 7);
    expect(c.select('mbid-new', 'spotify')).toMatchObject({ lastSeenAt: 7, resolvedId: 'sp:new', lastAttemptAt: 0, missingStreak: 0 });

    // A prior hydration MISS (null id, streak stepped) that a fetch now shows.
    c.upsert('mbid-miss', 'spotify', null, 5, 2);
    c.recordMissing('mbid-miss', 'spotify');
    c.recordPresent('mbid-miss', 'spotify', 'sp:miss', 9);
    expect(c.select('mbid-miss', 'spotify')).toMatchObject({ resolvedId: 'sp:miss', missingStreak: 0, lastSeenAt: 9, attempts: 2 });

    c.recordPresent('mbid-new', 'spotify', 'sp:other', 11);
    expect(c.select('mbid-new', 'spotify').resolvedId).toBe('sp:new');
  });
});

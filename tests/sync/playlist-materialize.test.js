/**
 * N-way incremental materialize executor — Layer B (Parachord/parachord#911,
 * Step 2). Ports the Kotlin PlaylistMaterializeExecutorTest +
 * PlaylistMaterializeDiffTest vectors 1:1 against a desktop FakeProvider.
 *
 * The pure executor + diff are testable in complete isolation — no real
 * provider, no baseline, no driver. The full Layer-A reconcile harness
 * (NwayMaterializeTest) lands with the driver PR.
 */

const { materializeToProvider, computeMaterializeDiff } = require('../../sync-engine/playlist-materialize');

// Track factory: distinct title+artist so `norm` never unions; mbid strongest
// so the representative is `mbid-<id>`. Matches the Kotlin Fake's `t(id)`.
const t = (id) => ({ playlistId: 'p', position: 0, title: `title-${id}`, artist: `artist-${id}`, recordingMbid: id });

function features(mode, canReorder = false) {
  return { trackRemoveMode: mode, canReorder, supportsPlaylistDelete: true, supportsPlaylistRename: true };
}

// FakeProvider records every write call; the two remove variants THROW when
// invoked outside their declared mode so a mis-dispatch is loud.
class FakeProvider {
  constructor(capabilities, nullNativeIdFor = new Set()) {
    this.capabilities = capabilities;
    this.nullNativeIdFor = nullNativeIdFor;
    this.addCalls = [];
    this.removeByNativeIdCalls = [];
    this.removeByPositionCalls = [];
    this.replaceCalls = [];
  }
  nativeIdOf(track) {
    return this.nullNativeIdFor.has(track.recordingMbid) ? null : track.recordingMbid;
  }
  async addPlaylistTracks(_externalId, ids) {
    this.addCalls.push(ids);
  }
  async removePlaylistTracksByNativeId(_externalId, ids) {
    if (this.capabilities.trackRemoveMode !== 'ByNativeId') throw new Error('wrong removeMode: ByNativeId');
    this.removeByNativeIdCalls.push(ids);
  }
  async removePlaylistTracksByPosition(_externalId, positions) {
    if (this.capabilities.trackRemoveMode !== 'ByPosition') throw new Error('wrong removeMode: ByPosition');
    this.removeByPositionCalls.push(positions);
  }
  async replacePlaylistTracks(_externalId, ids) {
    this.replaceCalls.push(ids);
  }
}

// Hydration resolver closures (for ADDS).
const resolverFor = (idSet) => async (track) => (idSet.has(track.recordingMbid) ? track.recordingMbid : null);
const resolveAll = async (track) => track.recordingMbid;

const run = (provider, canonical, remote, resolveNativeId) =>
  materializeToProvider({ provider, externalId: 'ext', canonical, remote, resolveNativeId });

describe('materializeToProvider — capability-dispatched executor (Group 1)', () => {
  test('1. ByNativeId — adds appended, removes target remote native ids', async () => {
    const p = new FakeProvider(features('ByNativeId'));
    const r = await run(p, [t('a'), t('b'), t('c')], [t('a'), t('x')], resolveAll);
    expect(p.addCalls.length).toBe(1);
    expect(new Set(p.addCalls[0])).toEqual(new Set(['b', 'c']));
    expect(p.removeByNativeIdCalls).toEqual([['x']]);
    expect(r).toEqual({ added: 2, removed: 1, pendingAdds: 0, unsupportedRemoves: 0 });
  });

  test('2. ByPosition — removes dispatch as DISTINCT positions', async () => {
    const p = new FakeProvider(features('ByPosition'));
    const r = await run(p, [t('a'), t('c')], [t('a'), t('b'), t('c'), t('d')], resolveAll);
    expect(p.removeByPositionCalls.length).toBe(1);
    const positions = p.removeByPositionCalls[0];
    expect(new Set(positions)).toEqual(new Set([1, 3]));
    expect(positions.length).toBe(new Set(positions).size); // distinct
    expect(p.addCalls).toEqual([]);
    expect(p.removeByNativeIdCalls).toEqual([]);
    expect(r).toMatchObject({ removed: 2, added: 0 });
  });

  test('3. Unsupported — removes skipped+counted, adds still applied', async () => {
    const p = new FakeProvider(features('Unsupported'));
    const r = await run(p, [t('a'), t('b')], [t('a'), t('x')], resolveAll);
    expect(r.unsupportedRemoves).toBe(1);
    expect(p.removeByNativeIdCalls).toEqual([]);
    expect(p.removeByPositionCalls).toEqual([]);
    expect(p.addCalls).toEqual([['b']]);
    expect(r).toMatchObject({ added: 1, removed: 0 });
  });

  test('4. ReplaceOnly — full coverage replaces (SUB1); partial degrades additive (SUB2)', async () => {
    // SUB1: full coverage -> replace in canonical order.
    const p1 = new FakeProvider(features('ReplaceOnly'));
    const r1 = await run(p1, [t('a'), t('b')], [t('a'), t('x')], resolverFor(new Set(['a', 'b'])));
    expect(p1.replaceCalls).toEqual([['a', 'b']]);
    expect(p1.addCalls).toEqual([]);
    expect(r1).toEqual({ removed: 1, added: 1, pendingAdds: 0, unsupportedRemoves: 0 });

    // SUB2: c unresolvable -> no replace, degrade to add-only.
    const p2 = new FakeProvider(features('ReplaceOnly'));
    const r2 = await run(p2, [t('a'), t('b'), t('c')], [t('a'), t('x')], resolverFor(new Set(['a', 'b'])));
    expect(p2.replaceCalls).toEqual([]);
    expect(p2.addCalls).toEqual([['b']]);
    expect(r2).toEqual({ added: 1, pendingAdds: 1, unsupportedRemoves: 1, removed: 0 });
  });

  test('5. ReplaceOnly — existing canonical track w/ null native id degrades additive (I1 regression)', async () => {
    const p = new FakeProvider(features('ReplaceOnly'), new Set(['a']));
    const r = await run(p, [t('a'), t('b')], [t('a'), t('x')], resolverFor(new Set(['a', 'b'])));
    expect(p.replaceCalls).toEqual([]); // no shrinking replace
    expect(p.addCalls).toEqual([['b']]);
    expect(r).toEqual({ added: 1, removed: 0, unsupportedRemoves: 1, pendingAdds: 0 });
  });

  test('6. Unresolvable add left pending, never drops existing remote', async () => {
    const p = new FakeProvider(features('ByNativeId'));
    const r = await run(p, [t('a'), t('b')], [t('a')], resolverFor(new Set()));
    expect(r).toMatchObject({ pendingAdds: 1, added: 0, removed: 0 });
    expect(p.addCalls).toEqual([]);
    expect(p.removeByNativeIdCalls).toEqual([]);
  });

  test('7. No resolved adds — addPlaylistTracks NOT called', async () => {
    const p = new FakeProvider(features('ByNativeId'));
    await run(p, [t('a'), t('b')], [t('a')], resolverFor(new Set()));
    expect(p.addCalls).toEqual([]);
  });

  test('8. Idempotent — canonical equals remote -> zero ops', async () => {
    const p = new FakeProvider(features('ByNativeId', true));
    const same = [t('a'), t('b'), t('c')];
    const r = await run(p, same, [t('a'), t('b'), t('c')], resolveAll);
    expect(p.addCalls).toEqual([]);
    expect(p.removeByNativeIdCalls).toEqual([]);
    expect(p.removeByPositionCalls).toEqual([]);
    expect(p.replaceCalls).toEqual([]);
    expect(r).toEqual({ added: 0, removed: 0, pendingAdds: 0, unsupportedRemoves: 0 });
  });
});

describe('computeMaterializeDiff — identity diff (Group 2)', () => {
  test('9. add-only', () => {
    const d = computeMaterializeDiff([t('a'), t('b')], [t('a')]);
    expect(d.addKeys).toEqual(['mbid-b']);
    expect(d.removeKeys).toEqual([]);
    expect(d.canonicalKeys.length).toBe(2); // 1:1 length contract
    expect(d.remoteKeys.length).toBe(1);
  });

  test('10. remove', () => {
    const d = computeMaterializeDiff([t('a')], [t('a'), t('b')]);
    expect(d.removeKeys.length).toBe(1);
    expect(d.addKeys).toEqual([]);
  });

  test('11. norm-bridged remaster — neither add nor remove', () => {
    const canonical = [{ title: 'Zombie', artist: 'X', recordingMbid: 'm1' }];
    const remote = [{ title: 'Zombie - 2025 Remaster', artist: 'X', recordingMbid: 'm2' }];
    const d = computeMaterializeDiff(canonical, remote);
    expect(d.addKeys).toEqual([]);
    expect(d.removeKeys).toEqual([]);
  });

  test('12. isrc-bridged (different mbid AND norm) + negative control', () => {
    const canonical = [{ title: 'Zombie', artist: 'The Cranberries', recordingMbid: 'm1', isrc: 'USABC1234567' }];
    const remote = [{ title: 'Zombie', artist: 'Cranberries', recordingMbid: 'm2', isrc: 'USABC1234567' }];
    const d = computeMaterializeDiff(canonical, remote);
    expect(d.addKeys).toEqual([]);
    expect(d.removeKeys).toEqual([]);

    // NEGATIVE CONTROL: different ISRCs (and different mbid + norm) -> no bridge.
    const canonicalN = [{ title: 'Zombie', artist: 'The Cranberries', recordingMbid: 'm1', isrc: 'USXYZ9999999' }];
    const remoteN = [{ title: 'Zombie', artist: 'Cranberries', recordingMbid: 'm2', isrc: 'GBABC0000001' }];
    const dn = computeMaterializeDiff(canonicalN, remoteN);
    expect(dn.addKeys.length).toBe(1);
    expect(dn.removeKeys.length).toBe(1);
  });

  test('13. idempotent equal sets', () => {
    const d = computeMaterializeDiff([t('a'), t('b')], [t('a'), t('b')]);
    expect(d.addKeys).toEqual([]);
    expect(d.removeKeys).toEqual([]);
    expect(d.reorderNeeded).toBe(false);
  });

  test('14. reorder flagged', () => {
    const d = computeMaterializeDiff([t('a'), t('b')], [t('b'), t('a')]);
    expect(d.addKeys).toEqual([]);
    expect(d.removeKeys).toEqual([]);
    expect(d.reorderNeeded).toBe(true);
  });

  test('15. duplicate identity in canonical -> single add', () => {
    const d = computeMaterializeDiff([t('a'), t('a')], []);
    expect(d.addKeys).toEqual(['mbid-a']);
  });

  test('16. duplicate identity in remote -> single remove', () => {
    const d = computeMaterializeDiff([], [t('a'), t('a')]);
    expect(d.removeKeys).toEqual(['mbid-a']);
    expect(d.addKeys).toEqual([]);
  });

  test('17. empty + empty', () => {
    const d = computeMaterializeDiff([], []);
    expect(d.addKeys).toEqual([]);
    expect(d.removeKeys).toEqual([]);
    expect(d.reorderNeeded).toBe(false);
  });

  test('18. empty remote — every canonical is an add', () => {
    const d = computeMaterializeDiff([t('a'), t('b')], []);
    expect(d.addKeys.length).toBe(2);
    expect(d.removeKeys).toEqual([]);
  });
});

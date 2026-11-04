// widevine-shaka-adaptation.test.js — vendor-pinned regression tests for the
// ABR candidate set (#1243: "Amazon: does adaptive at Max ever reach FLAC?").
//
// These drive the ACTUAL vendored bundle (vendor/shaka-player.compiled.js —
// UMD, loadable under plain Node) because the behavior they pin lives in
// minified vendor code, not in anything we own:
//
//   1. shaka.media.AdaptationSet (the object the choice criteria's create()
//      returns) rejects variants whose `groupId` differs from the anchor's.
//      With manifest.enableAudioGroups:true (the default), the DASH parser
//      stamps every stream with its AdaptationSet's id as groupId — and
//      Amazon puts each codec family in its own AdaptationSet. The set is
//      therefore ONE family, anchored on the first variant in manifest order
//      (an opus rung): with group ids present, the ABR candidate set NEVER
//      contains FLAC, whatever the bandwidth estimate. This is why adaptive
//      at Max settled on opus 326k while locked plays crossed families fine
//      (selectVariantTrack crosses adaptation sets directly).
//   2. With enableAudioGroups:false (what widevine-player configures before
//      load), DASH assigns no groupId and — on a smooth-codec-switch
//      platform (SourceBuffer.changeType, present in Electron) — the set
//      spans the stereo families. The 6-channel ec-3 and channel-less
//      mha/mhm spatial rungs stay excluded by AdaptationSet's channel
//      guard, so the spatial opt-in keeps its own locked path.
//   3. The SimpleAbrManager over the spanning set: estimate windows pick
//      FLAC on a good link, top opus on a weak one, and the tier ceilings
//      hold — the corridor behavior the quality setting promises.
//
// If a shaka upgrade changes any of this, these tests fail and force a
// re-read of the new vendor's adaptation-set handling before the fix
// silently regresses.

'use strict';

// Fake a smooth-codec-switch platform BEFORE the bundle loads: the default
// codecSwitchingStrategy (and the AdaptationSet strict flag) keys on
// SourceBuffer.prototype.changeType, which Node lacks. Electron has it —
// this is what the renderer actually runs on.
globalThis.SourceBuffer = globalThis.SourceBuffer || function SourceBuffer() {};
if (!globalThis.SourceBuffer.prototype.changeType) {
  globalThis.SourceBuffer.prototype.changeType = function changeType() {};
}

const shaka = require('../../vendor/shaka-player.compiled.js');
const { shakaPlaybackConfig } = require('../../src/renderer/lib/widevine-quality');

// The live variant table observed 2026-10 for an HD-tier account (Get Lucky)
// — tests/resolver/amazon-music-logic.test.js LIVE_REPS. Stereo families
// only for the ABR set (the spatial rungs are here to prove they stay OUT).
function amazonVariant(id, codecs, bandwidth, channels, groupId) {
  return {
    id, bandwidth, primary: true, language: 'und', roles: [],
    allowedByApplication: true, allowedByKeySystem: true,
    audio: { codecs, channelsCount: channels, roles: [], language: 'und', bandwidth, spatialAudio: false, mimeType: 'audio/mp4', groupId },
    video: null
  };
}
const GROUPED = (id, codecs, bandwidth, channels, group) => amazonVariant(id, codecs, bandwidth, channels, `set-${group}`);
const UNGROUPED = (id, codecs, bandwidth, channels) => amazonVariant(id, codecs, bandwidth, channels, null);

// What the manifest produces today: one AdaptationSet per codec family
// ("three opus plus two FLAC renditions across five adaptation sets"), the
// opus set listed first.
const ROSTER_WITH_GROUP_IDS = [
  GROUPED(1, 'opus', 53059, 2, 'opus'),
  GROUPED(2, 'opus', 197343, 2, 'opus'),
  GROUPED(3, 'opus', 325595, 2, 'opus'),
  GROUPED(4, 'opus', 53059, 2, 'opus'),
  GROUPED(5, 'opus', 165280, 2, 'opus'),
  GROUPED(6, 'flac', 1062133, 2, 'flac'),
  GROUPED(7, 'flac', 1902230, 2, 'flac'),
  GROUPED(8, 'ec-3', 768000, 6, 'ec3'),
  GROUPED(9, 'mha1.0x0e', 1612557, null, 'mpegh')
];
// enableAudioGroups:false — DASH assigns no groupId.
const ROSTER_WITHOUT_GROUP_IDS = [
  UNGROUPED(1, 'opus', 53059, 2),
  UNGROUPED(2, 'opus', 197343, 2),
  UNGROUPED(3, 'opus', 325595, 2),
  UNGROUPED(4, 'opus', 53059, 2),
  UNGROUPED(5, 'opus', 165280, 2),
  UNGROUPED(6, 'flac', 1062133, 2),
  UNGROUPED(7, 'flac', 1902230, 2),
  UNGROUPED(8, 'ec-3', 768000, 6),
  UNGROUPED(9, 'mha1.0x0e', 1612557, null)
];

// The choice criteria, configured exactly the way the vendor's load path
// does (fresh criteria from the default factory, wide audio fields).
function freshCriteria() {
  const cfg = shaka.util.PlayerConfiguration.createDefault();
  const crit = cfg.adaptationSetCriteriaFactory();
  crit.configure({
    language: cfg.preferredAudioLanguage, role: cfg.preferredAudioRole, videoRole: cfg.preferredVideoRole,
    channelCount: 0, hdrLevel: cfg.preferredVideoHdrLevel, spatialAudio: cfg.preferSpatialAudio,
    videoLayout: cfg.preferredVideoLayout, audioLabel: cfg.preferredAudioLabel, videoLabel: cfg.preferredVideoLabel,
    codecSwitchingStrategy: cfg.mediaSource.codecSwitchingStrategy,
    audioCodec: '', activeAudioCodec: '', activeAudioChannelCount: 0,
    preferredAudioCodecs: cfg.preferredAudioCodecs, preferredAudioChannelCount: cfg.preferredAudioChannelCount
  });
  return { crit, cfg };
}

const familiesOf = (roster) => Array.from(new Set(roster.map((v) => v.audio.codecs)));

describe('the ABR candidate set (vendored shaka 4.16.55)', () => {
  test('the platform fake holds: smooth codec switching is on (Electron parity)', () => {
    const { cfg } = freshCriteria();
    expect(cfg.mediaSource.codecSwitchingStrategy).toBe('smooth');
  });

  test('with group ids (enableAudioGroups:true — the #1243 shape): the set is ONE family, opus — FLAC never enters, no matter the estimate', () => {
    const { crit } = freshCriteria();
    const set = Array.from(crit.create(ROSTER_WITH_GROUP_IDS).values());
    expect(familiesOf(set)).toEqual(['opus']);
  });

  test('without group ids (enableAudioGroups:false): the set spans the stereo families and keeps the spatial rungs out', () => {
    const { crit } = freshCriteria();
    const set = Array.from(crit.create(ROSTER_WITHOUT_GROUP_IDS).values());
    expect(familiesOf(set).sort()).toEqual(['flac', 'opus']);
    // The 6-channel ec-3 and channel-less mha1 rungs are rejected by the
    // channel guard — spatial stays a locked, opt-in path.
    expect(set.map((v) => v.audio.codecs)).not.toContain('ec-3');
    expect(set.map((v) => v.audio.codecs)).not.toContain('mha1.0x0e');
  });

  test('a selectVariantTrack-narrowed criteria (audioCodec) still confines to the selected family — why the re-anchor exists', () => {
    const { crit, cfg } = freshCriteria();
    // The vendor's selectVariantTrack re-configures the criteria onto the
    // selected rung's codec; this is the shape that leaves behind.
    crit.configure({
      language: 'und', role: '', videoRole: '', channelCount: 2, hdrLevel: 'AUTO',
      spatialAudio: false, videoLayout: '', audioLabel: '', videoLabel: '',
      codecSwitchingStrategy: cfg.mediaSource.codecSwitchingStrategy,
      audioCodec: 'opus', activeAudioCodec: 'opus', activeAudioChannelCount: 2,
      preferredAudioCodecs: [], preferredAudioChannelCount: 2
    });
    const set = Array.from(crit.create(ROSTER_WITHOUT_GROUP_IDS).values());
    expect(familiesOf(set)).toEqual(['opus']);
  });
});

describe('the ABR manager over the spanning set (tier corridors, real SimpleAbrManager)', () => {
  const { crit, cfg } = freshCriteria();
  const set = Array.from(crit.create(ROSTER_WITHOUT_GROUP_IDS).values());

  // Stream `rounds` × 4s segments of the active rung at linkMbps with a
  // 100ms round trip, letting the manager choose between rounds — the
  // vendor's segmentDownloaded → Gg tick, minus the timer.
  function settle({ linkMbps, ceiling, seed }) {
    const mgr = new shaka.abr.SimpleAbrManager();
    const abr = structuredClone(cfg.abr);
    abr.restrictions = Object.assign(structuredClone(cfg.abr.restrictions), { maxBandwidth: ceiling });
    if (seed != null) abr.defaultBandwidthEstimate = seed;
    mgr.configure(abr);
    mgr.init(() => {});
    mgr.enable();
    mgr.setVariants(set);
    let active = mgr.chooseVariant(true);
    for (let i = 0; i < 12; i++) {
      const bytes = (active.bandwidth / 8) * 4;
      const elapsed = (bytes * 8) / (linkMbps * 1e6) * 1000 + 100; // wire time + RTT
      if (elapsed >= abr.cacheLoadThreshold) mgr.segmentDownloaded(elapsed, bytes, true);
      const next = mgr.chooseVariant();
      if (next && next !== active) active = next;
    }
    return { active, estimate: mgr.getBandwidthEstimate() };
  }

  test('max + adaptive on a 10 Mbps link reaches FLAC Ultra (#1243)', () => {
    const { active } = settle({ linkMbps: 10, ceiling: Infinity });
    expect(active.audio.codecs).toBe('flac');
    expect(active.bandwidth).toBe(1902230);
  });

  test('max + adaptive on a weak link degrades to top opus — never a forced lossless rung', () => {
    const { active } = settle({ linkMbps: 0.6, ceiling: Infinity });
    expect(active.audio.codecs).toBe('opus');
    expect(active.bandwidth).toBe(325595);
  });

  test('tier ceilings hold over the spanning set: high 326k, standard 197k, saver 51k', () => {
    expect(settle({ linkMbps: 10, ceiling: 500000 }).active.bandwidth).toBe(325595);
    expect(settle({ linkMbps: 10, ceiling: 200000 }).active.bandwidth).toBe(197343);
    expect(settle({ linkMbps: 10, ceiling: 100000 }).active.bandwidth).toBe(53059);
  });

  test('the seed lands ON the tier rung: shakaPlaybackConfig seeds rung/0.95, and the chooser window floor is rung/0.95', () => {
    const config = shakaPlaybackConfig(
      ROSTER_WITHOUT_GROUP_IDS.map((v) => ({ id: v.id, codecs: v.audio.codecs, bandwidth: v.bandwidth })),
      'max',
      true
    );
    expect(config.seedBandwidth).toBe(Math.ceil(1902230 / 0.95));
    const mgr = new shaka.abr.SimpleAbrManager();
    const abr = structuredClone(cfg.abr);
    abr.defaultBandwidthEstimate = config.seedBandwidth;
    mgr.configure(abr);
    mgr.init(() => {});
    mgr.setVariants(set);
    const firstPick = mgr.chooseVariant(true);
    expect(firstPick.audio.codecs).toBe('flac');
    expect(firstPick.bandwidth).toBe(1902230); // ON the tier rung, not one below
  });
});

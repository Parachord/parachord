/**
 * The played track keeps the track record's MBID identity. The MBID Mapper
 * batch enrichment writes `mbid` / `releaseMbid` / `artistMbids` on the
 * queue/collection/playlist track record, but the playback engine builds the
 * played track from `...sourceToPlay` plus named identity fields — so those
 * MBIDs were dropped on every play, and no ListenBrainz listen carried
 * recording_mbid / release_mbid / artist_mbids, and no Last.fm scrobble
 * carried mbid, even when the mapper had already resolved the track.
 *
 * use-playback-engine.js spreads `...mbidIdentity(trackOrSource)` into every
 * trackToSet build to carry them; this ratchet keeps every build doing so,
 * and keeps the helper copying only the three MBID fields.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'),
  'utf8'
);

describe("the played track carries the track record's MBID identity", () => {
  test('mbidIdentity copies exactly the three MBID fields', () => {
    expect(source).toMatch(/const mbidIdentity = \(track\) => \{\n\s*const out = \{\};\n\s*if \(track\) \{\n\s*if \(track\.mbid\) out\.mbid = track\.mbid;\n\s*if \(track\.releaseMbid\) out\.releaseMbid = track\.releaseMbid;\n\s*if \(Array\.isArray\(track\.artistMbids\)\) out\.artistMbids = track\.artistMbids;/);
  });

  test('every trackToSet build carries it', () => {
    const builds = source.match(/trackToSet = trackOrSource\.sources \?/g) || [];
    expect(builds.length).toBeGreaterThanOrEqual(1);
    const carried = source.match(/\.\.\.mbidIdentity\(trackOrSource\),/g) || [];
    expect(carried.length).toBe(builds.length);
  });

  test("the spread comes after ...sourceToPlay, so the track record's identity wins", () => {
    const pattern = /\.\.\.sourceToPlay,\n\s*\.\.\.mbidIdentity\(trackOrSource\),/g;
    const pairs = source.match(pattern) || [];
    expect(pairs.length).toBe((source.match(/\.\.\.mbidIdentity\(trackOrSource\),/g) || []).length);
  });
});

/**
 * A play that fails and stops on its track (no auto-skip) leaves that track in
 * the playbar, paused, for Play to load again through handlePlay (#1295).
 * Before this, Play fell through to whatever engine the stale
 * `_activeResolver` named, or to the no-resolver branch, and did nothing
 * (reproduced live: "No Source Found", OK, Play: no log, no sound).
 */

const fs = require('fs');
const path = require('path');

const { trackToHoldAfterFailure, isDeviceOffline, OFFLINE_PLAY_MESSAGE } = require('../../src/renderer/lib/playback-helpers');

describe('trackToHoldAfterFailure', () => {
  test('drops the markers of the attempt that failed, so Play starts over', () => {
    const held = trackToHoldAfterFailure({
      id: 'radiohead-airbag-ok-computer',
      artist: 'Radiohead',
      title: 'Airbag',
      album: 'OK Computer',
      sources: { spotify: { id: 'x' }, subsonic: { id: 'y' } },
      status: 'resolving',
      _activeResolver: 'subsonic',
      _streamOwner: 'subsonic',
      _spotifyFallback: true,
      _appleMusicFallback: true,
      _playbackContext: { type: 'album', id: 'ok' },
    });
    expect(held).toEqual({
      id: 'radiohead-airbag-ok-computer',
      artist: 'Radiohead',
      title: 'Airbag',
      album: 'OK Computer',
      sources: { spotify: { id: 'x' }, subsonic: { id: 'y' } },
      _playbackContext: { type: 'album', id: 'ok' },
    });
  });

  test('keeps a single-source pick as it is (a manual pick plays the same source again)', () => {
    const pick = { id: 'sc-1', artist: 'A', title: 'T', resolver: 'soundcloud', url: 'https://soundcloud.com/a/t' };
    expect(trackToHoldAfterFailure(pick)).toEqual(pick);
  });

  test('nothing to hold for a missing track', () => {
    expect(trackToHoldAfterFailure(null)).toBeNull();
    expect(trackToHoldAfterFailure(undefined)).toBeNull();
  });
});

describe('handlePlay and the shared element hold a failed track for Play (#1295)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');

  const bodyOf = (marker, endMarker) => {
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf(endMarker, start + marker.length);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  test("handlePlay's failure helper holds the track whenever it does not skip", () => {
    const helper = bodyOf('const autoSkipIfAdvancing = (reason, { needsNetwork = true } = {}) => {', '\n    };');
    const notAdvancing = helper.indexOf('if (!(isAdvancingTrackRef.current || spinoffModeRef.current))');
    expect(notAdvancing).toBeGreaterThan(-1);
    const branch = helper.slice(notAdvancing, helper.indexOf('return false;', notAdvancing));
    expect(branch).toMatch(/holdFailedTrack\(\)/);
  });

  test("the hold is generation-checked, so a superseded play can't take over the playbar", () => {
    const hold = bodyOf('const holdFailedTrack = () => {', '\n    };');
    expect(hold).toMatch(/playbackGenerationRef\.current !== thisGeneration\) return/);
    expect(hold).toMatch(/holdTrackForPlay\(/);
  });

  test('the shared element error listener holds the track when it does not skip', () => {
    const listener = bodyOf("audio.addEventListener('error', (e) => {", '\n    });');
    // Both arms (local file, html5 stream) show a dialog after the skip check;
    // each holds the track first.
    const dialogs = listener.split('showConfirmDialog(').length - 1;
    expect(dialogs).toBe(2);
    // ...and the stream arm's offline stop (#1297) holds it too.
    expect(listener.split('holdElementTrack(').length - 1).toBe(dialogs + 1);
  });

  test('holdTrackForPlay leaves the track paused and marked to load on Play', () => {
    const hold = bodyOf('const holdTrackForPlay = (track) => {', '\n  };');
    expect(hold).toMatch(/trackToHoldAfterFailure\(track\)/);
    expect(hold).toMatch(/setCurrentTrack\(/);
    expect(hold).toMatch(/setIsPlaying\(false\)/);
    expect(hold).toMatch(/trackNeedsExplicitStart\.current = true/);
  });

  test('anything that starts playing clears the mark, so a later pause and resume never restarts a track', () => {
    expect(src).toMatch(/React\.useEffect\(\(\) => \{\s*if \(isPlaying\) trackNeedsExplicitStart\.current = false;\s*\}, \[isPlaying\]\);/);
  });

  test("Play's load-on-Play check still runs before any engine branch", () => {
    const pp = bodyOf('const handlePlayPause = async () => {', '\n  };');
    const check = pp.indexOf('if (!isPlaying && trackNeedsExplicitStart.current && !trackLoading)');
    expect(check).toBeGreaterThan(-1);
    for (const engine of ['browserPlaybackActive && extensionConnected', 'embedPlayerKind(', 'usesSharedAudio(', 'isSpotifyTrack && spotifyToken', 'if (!audioContext) return;']) {
      expect(pp.indexOf(engine)).toBeGreaterThan(check);
    }
  });
});

// #1297: offline, a failed play stops on its track (with the connection
// message) instead of skipping, falling back or force-re-resolving. The
// behaviour is exercised in no-match-sentinels.test.js; these pin the paths
// that harness doesn't reach.
describe('isDeviceOffline', () => {
  test("only the OS's no-network answer counts", () => {
    expect(isDeviceOffline({ onLine: false })).toBe(true);
    expect(isDeviceOffline({ onLine: true })).toBe(false);
    // no navigator, or one without onLine (plain Node): not offline
    expect(isDeviceOffline(null)).toBe(false);
    expect(isDeviceOffline({})).toBe(false);
  });

  test('says what to do, matching mobile', () => {
    expect(OFFLINE_PLAY_MESSAGE).toBe("Couldn't start playing. Check your connection and try again.");
  });
});

describe('every failure path stops on the track when offline (#1297)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');
  const bodyOf = (marker, endMarker) => {
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf(endMarker, start + marker.length);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  test('the skip helper asks first, before it can skip', () => {
    const helper = bodyOf('const autoSkipIfAdvancing = (reason, { needsNetwork = true } = {}) => {', '\n    };');
    const offline = helper.indexOf('if (stopIfOffline({ needsNetwork })) return true;');
    expect(offline).toBeGreaterThan(-1);
    expect(offline).toBeLessThan(helper.indexOf('handleNextRef.current()'));
  });

  test('the stop is generation-checked and holds the track for Play', () => {
    const stop = bodyOf('const stopIfOffline = ({ needsNetwork = true } = {}) => {', '\n    };');
    expect(stop).toMatch(/if \(!needsNetwork \|\| !deviceOffline\(\)\) return false;/);
    expect(stop).toMatch(/playbackGenerationRef\.current !== thisGeneration\) return true/);
    expect(stop).toMatch(/holdFailedTrack\(\)/);
    expect(stop).toMatch(/announceOfflineStop\(/);
  });

  test("a local file is never stopped for being offline (the next local file plays)", () => {
    expect(src).toContain('autoSkipIfAdvancing(`local file missing: ${localPath}`, { needsNetwork: false })');
    expect(src).toContain('autoSkipIfAdvancing(`local file playback: ${errorMessage}`, { needsNetwork: false })');
  });

  test('a refused or thrown play stops before any retry, fallback or forced re-resolve', () => {
    const offlineCheck = "if (stopIfOffline({ needsNetwork: resolverId !== 'localfiles' })) return;";
    const refused = bodyOf('if (!success) {', "\n    } catch (error) {");
    expect(refused.indexOf(offlineCheck)).toBeGreaterThan(-1);
    for (const later of ["resolverId === 'spotify' && !sourceToPlay._spotifyRetried", "resolverId === 'applemusic' && !trackOrSource._appleMusicFallback", 'forceRefresh: true']) {
      expect(refused.indexOf(later)).toBeGreaterThan(refused.indexOf(offlineCheck));
    }
    const thrown = bodyOf("console.error(`❌ Error playing with ${resolver.name}:`, error);", '\n  };');
    expect(thrown.indexOf(offlineCheck)).toBeGreaterThan(-1);
    expect(thrown.indexOf('forceRefresh: true')).toBeGreaterThan(thrown.indexOf(offlineCheck));
  });

  test("an embedded player's failure doesn't fall back to another source offline", () => {
    const embed = bodyOf("console.warn(`🎵 ${serviceName} can't play", "showToast(`${serviceName} can't play this track here.");
    expect(embed).toContain('if (stopIfOffline()) return;');
  });

  test('the shared element stops a failed stream offline, but not a local file', () => {
    const listener = bodyOf("audio.addEventListener('error', (e) => {", '\n    });');
    const streamArm = listener.slice(listener.indexOf('isHtml5StreamResolver(owner)'));
    const localArm = listener.slice(0, listener.indexOf('isHtml5StreamResolver(owner)'));
    expect(localArm).not.toContain('deviceOffline()');
    const offline = streamArm.indexOf('if (deviceOffline()) {');
    expect(offline).toBeGreaterThan(-1);
    expect(offline).toBeLessThan(streamArm.indexOf('skipIfAdvancing('));
    expect(streamArm.slice(offline, streamArm.indexOf('skipIfAdvancing('))).toMatch(/holdElementTrack\([\s\S]*announceOfflineStop\(/);
  });
});

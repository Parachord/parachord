/**
 * The playbar's play/pause state follows the engine, and a start that is on
 * its way shows.
 *
 * 1. An engine resumed outside handlePlayPause (MusicKit JS by its own
 *    handler, the Spotify app or the native Apple Music helper by a Mac media
 *    key, the shared <audio> element) played under a button that still said
 *    Play. The engines' own signals now reconcile isPlaying.
 * 2. Play on a paused track, or on a restored queue after a restart, could
 *    take a couple of clicks: a resume the engine refused (Spotify's idle
 *    device, a helper that lost its queue, a rejected play()) did nothing, and
 *    a second click during a slow start reached an engine with nothing
 *    loaded. A refused resume now starts the track again where it was, a
 *    click during a start waits for it, and the title and artist shimmer
 *    until the track plays.
 */

const fs = require('fs');
const path = require('path');
const {
  reconcileEnginePlayState,
  musicKitStatePlaying,
  musicKitWebHoldsTrack,
  playStartPending,
  PLAY_START_PATIENCE_MS,
  restartPositionForResume,
  nativeAppleMusicPlaying,
  spotifyPlayingTrack,
  EXTERNAL_RESUME_POLL_MS,
} = require('../../src/renderer/lib/play-state');

const track = { id: 'swapmeet-i-know', artist: 'Swapmeet', title: 'I Know!', album: 'Mount Zero', appleMusicId: '1440', spotifyUri: 'spotify:track:abc' };

describe('reconcileEnginePlayState', () => {
  test('an engine that starts playing the track on screen turns the button to Pause', () => {
    expect(reconcileEnginePlayState({ enginePlaying: true, engineOwnsTrack: true, isPlaying: false })).toBe(true);
  });

  test('an engine that pauses on its own turns it to Play', () => {
    expect(reconcileEnginePlayState({ enginePlaying: false, engineOwnsTrack: true, isPlaying: true })).toBe(false);
  });

  test('a signal that matches the button changes nothing', () => {
    expect(reconcileEnginePlayState({ enginePlaying: true, engineOwnsTrack: true, isPlaying: true })).toBeNull();
    expect(reconcileEnginePlayState({ enginePlaying: false, engineOwnsTrack: true, isPlaying: false })).toBeNull();
  });

  test('an engine a newer play left behind changes nothing', () => {
    expect(reconcileEnginePlayState({ enginePlaying: true, engineOwnsTrack: false, isPlaying: false })).toBeNull();
    expect(reconcileEnginePlayState({ enginePlaying: false, engineOwnsTrack: false, isPlaying: true })).toBeNull();
  });

  test('the pause Parachord makes on the way to another track, or at the end of one, is not a pause', () => {
    expect(reconcileEnginePlayState({ enginePlaying: false, engineOwnsTrack: true, isPlaying: true, parachordStopped: true })).toBeNull();
    expect(reconcileEnginePlayState({ enginePlaying: false, engineOwnsTrack: true, isPlaying: true, ended: true })).toBeNull();
  });
});

describe('MusicKit JS state', () => {
  test('playing and paused map; states on the way somewhere change nothing', () => {
    expect(musicKitStatePlaying(2)).toBe(true);
    for (const state of [3, 4, 5, 10]) expect(musicKitStatePlaying(state)).toBe(false);
    for (const state of [0, 1, 6, 8, 9, undefined]) expect(musicKitStatePlaying(state)).toBeNull();
  });

  test('MusicKit JS holds the track when its now-playing item is the song and it has not stopped', () => {
    expect(musicKitWebHoldsTrack({ nowPlayingItem: { id: '1440' }, playbackState: 3 }, track)).toBe(true);
    expect(musicKitWebHoldsTrack({ nowPlayingItem: { id: 1440 }, playbackState: 2 }, track)).toBe(true);
  });

  test('not when it plays another song, has stopped, or there is none', () => {
    expect(musicKitWebHoldsTrack({ nowPlayingItem: { id: '9' }, playbackState: 3 }, track)).toBe(false);
    for (const state of [0, 4, 5, 10]) expect(musicKitWebHoldsTrack({ nowPlayingItem: { id: '1440' }, playbackState: state }, track)).toBe(false);
    expect(musicKitWebHoldsTrack({ nowPlayingItem: null, playbackState: 3 }, track)).toBe(false);
    expect(musicKitWebHoldsTrack(null, track)).toBe(false);
    expect(musicKitWebHoldsTrack({ nowPlayingItem: { id: '1440' }, playbackState: 3 }, { ...track, appleMusicId: undefined })).toBe(false);
  });
});

describe('engines outside the renderer resumed without Parachord', () => {
  test('the native helper playing the song on screen', () => {
    expect(nativeAppleMusicPlaying({ success: true, status: 'playing', songId: '1440' }, track)).toBe(true);
    // An older helper reply without the song id: the status decides.
    expect(nativeAppleMusicPlaying({ success: true, status: 'playing' }, track)).toBe(true);
  });

  test('not paused, failed, or another song', () => {
    expect(nativeAppleMusicPlaying({ success: true, status: 'paused', songId: '1440' }, track)).toBe(false);
    expect(nativeAppleMusicPlaying({ success: false, error: 'not running' }, track)).toBe(false);
    expect(nativeAppleMusicPlaying({ success: true, status: 'playing', songId: '77' }, track)).toBe(false);
    expect(nativeAppleMusicPlaying(null, track)).toBe(false);
  });

  test('Spotify playing the track on screen, or its relinked original', () => {
    expect(spotifyPlayingTrack({ is_playing: true, item: { uri: 'spotify:track:abc' } }, track)).toBe(true);
    expect(spotifyPlayingTrack({ is_playing: true, item: { uri: 'spotify:track:other', linked_from: { uri: 'spotify:track:abc' } } }, track)).toBe(true);
    expect(spotifyPlayingTrack({ is_playing: true, item: { uri: 'spotify:track:abc' } }, { id: 'x', sources: { spotify: { spotifyUri: 'spotify:track:abc' } } })).toBe(true);
    expect(spotifyPlayingTrack({ is_playing: true, item: { uri: 'spotify:track:abc' } }, { id: 'x', spotifyId: 'abc' })).toBe(true);
  });

  test('not paused, another track, or nothing to compare', () => {
    expect(spotifyPlayingTrack({ is_playing: false, item: { uri: 'spotify:track:abc' } }, track)).toBe(false);
    expect(spotifyPlayingTrack({ is_playing: true, item: { uri: 'spotify:track:zzz' } }, track)).toBe(false);
    expect(spotifyPlayingTrack({ is_playing: true, item: null }, track)).toBe(false);
    expect(spotifyPlayingTrack({ is_playing: true, item: { uri: 'spotify:track:abc' } }, { id: 'x' })).toBe(false);
  });

  test('asked every 5 s while paused', () => {
    expect(EXTERNAL_RESUME_POLL_MS).toBe(5000);
  });
});

describe('playStartPending', () => {
  test('a resume waiting on its engine', () => {
    expect(playStartPending({ currentTrack: track, isPlaying: false, trackLoading: false, loadingTrack: null, resumePending: true })).toBe(true);
  });

  test('handlePlay loading the track on screen (Play after a restart or a failed play)', () => {
    expect(playStartPending({ currentTrack: track, isPlaying: false, trackLoading: true, loadingTrack: { ...track, sources: {} }, resumePending: false })).toBe(true);
  });

  test('not a load of another track, which has its own skeleton', () => {
    expect(playStartPending({ currentTrack: track, isPlaying: false, trackLoading: true, loadingTrack: { id: 'other', title: 'O', artist: 'A' }, resumePending: false })).toBe(false);
    expect(playStartPending({ currentTrack: track, isPlaying: false, trackLoading: true, loadingTrack: null, resumePending: false })).toBe(false);
  });

  test('not once it plays, and not with no track', () => {
    expect(playStartPending({ currentTrack: track, isPlaying: true, trackLoading: true, loadingTrack: track, resumePending: true })).toBe(false);
    expect(playStartPending({ currentTrack: null, isPlaying: false, trackLoading: true, loadingTrack: track, resumePending: true })).toBe(false);
  });

  test('a start that never finishes holds Play for 20 s, not forever', () => {
    expect(PLAY_START_PATIENCE_MS).toBe(20000);
  });
});

describe('restartPositionForResume', () => {
  test('starts the track again where it was', () => {
    expect(restartPositionForResume(track, 83.4, false)).toEqual({ trackKey: 'swapmeet-i-know', position: 83.4 });
  });

  test("keeps the scrobbler's record that this listen was submitted", () => {
    expect(restartPositionForResume(track, 200, true)).toEqual({ trackKey: 'swapmeet-i-know', position: 200, scrobbled: true });
  });

  test('nothing to keep at 0:00 or for a track with no key', () => {
    expect(restartPositionForResume(track, 0, false)).toBeNull();
    expect(restartPositionForResume(track, NaN, false)).toBeNull();
    expect(restartPositionForResume({ title: 'T' }, 30, false)).toBeNull();
  });
});

describe('wiring in the playback engine', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');
  const bodyOf = (marker, endMarker) => {
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf(endMarker, start + marker.length);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };
  const playPause = bodyOf('const handlePlayPause = async () => {', '\n  const wakeSpotifyApp');

  test("the shared element's play and pause events reconcile the button, for the track on screen only", () => {
    expect(src).toContain("audio.addEventListener('playing', () => syncElementPlayState(true));");
    expect(src).toContain("audio.addEventListener('pause', () => syncElementPlayState(false));");
    const sync = bodyOf('const syncElementPlayState = (playing) => {', '\n    };');
    expect(sync).toContain('isSameTrack(html5AudioTrackRef.current, track)');
    expect(sync).toContain('usesSharedAudio(track._activeResolver)');
    expect(sync).toContain('reconcileEnginePlayState(');
  });

  test("Parachord's own pause on the way to another track is marked, so it doesn't flip the button", () => {
    const stop = bodyOf('const stopAllLocalAudio = () => {', '\n  };');
    expect(stop).toContain('pauseSharedElementForSwitch(audioRef.current);');
    expect(stop).not.toContain('audioRef.current.pause();');
    const mark = bodyOf('const pauseSharedElementForSwitch = (el) => {', '\n  };');
    expect(mark).toMatch(/if \(!el\.paused\) el\.__parachordStopping = true;\s*el\.pause\(\);/);
  });

  test('MusicKit JS state events reconcile the button, and its pause before another track is marked', () => {
    expect(src).toContain("window.addEventListener('musickit-playback-state', onMusicKitState);");
    expect(src).toContain('if (musicKitWeb.musicKit && musicKitWeb.musicKit.playbackState === 2) musicKitWeb.__parachordStopping = true;');
  });

  test('a paused Spotify or native Apple Music track asks its engine whether it was resumed elsewhere', () => {
    const effect = bodyOf('const watchSpotify = resolverId', 'EXTERNAL_RESUME_POLL_MS);');
    expect(effect).toContain('spotifyPlayingTrack(await response.json(), track)');
    expect(effect).toContain('nativeAppleMusicPlaying(await window.electron.musicKit.getPlaybackState(), track)');
    expect(effect).toContain('trackNeedsExplicitStart.current');
    expect(effect).toContain("startAutoAdvancePolling('spotify', track, { token: spotifyToken });");
  });

  test('a click while this track is starting waits for it, before any engine arm', () => {
    const guard = playPause.indexOf('if (playStartPending({ currentTrack, isPlaying, trackLoading, loadingTrack, resumePending: resumePendingRef.current })) {');
    expect(guard).toBeGreaterThan(-1);
    for (const later of ['trackNeedsExplicitStart.current && !trackLoading', 'usesSharedAudio(currentTrack?._activeResolver)', 'isSpotifyTrack && spotifyToken', 'if (!audioContext) return;']) {
      expect(playPause.indexOf(later)).toBeGreaterThan(guard);
    }
    expect(playPause).toContain('Date.now() - playStartRequestedAtRef.current < PLAY_START_PATIENCE_MS');
  });

  test('every engine resume shows as pending and starts the track again when refused', () => {
    expect(playPause.match(/const attempt = beginResume\(\);/g)).toHaveLength(3);
    expect(playPause).toContain("restartAfterRefusedResume(attempt.track, attempt.generation, 'The audio element');");
    expect(playPause).toContain("restartAfterRefusedResume(attempt.track, attempt.generation, 'Apple Music');");
    expect(playPause).toContain("restartAfterRefusedResume(attempt.track, attempt.generation, 'Spotify');");
    const restart = bodyOf('const restartAfterRefusedResume = (track, generation, label) => {', '\n  };');
    expect(restart).toContain('if (playbackGenerationRef.current !== generation) return;');
    expect(restart).toContain('restartPositionForResume(shown, progressRef.current, scrobbled)');
    expect(restart).toContain('handlePlay(trackToHoldAfterFailure(shown) || shown);');
  });

  test('the shared element turns to Pause when it plays, not before', () => {
    const arm = playPause.slice(playPause.indexOf('if (audioRef.current && usesSharedAudio(currentTrack?._activeResolver)) {'));
    const resume = arm.slice(arm.indexOf('} else {'), arm.indexOf('\n      return;\n'));
    expect(resume).toContain('audioRef.current.play().then(() => {');
    expect(resume.indexOf('setIsPlaying(true)')).toBeGreaterThan(resume.indexOf('.then('));
  });

  test('Apple Music pauses and resumes the engine that holds the track', () => {
    expect(playPause).toContain('const webEngine = musicKitWebHoldsTrack(musicKitWeb?.musicKit, currentTrack);');
    expect(playPause).toContain('await musicKitWeb.pause();');
    expect(playPause).toContain('await musicKitWeb.resume();');
    expect(playPause).toContain("resumed = !reply || reply.success !== false;");
  });

  test('a Spotify resume starts the end-of-track poller again (the pause stopped it)', () => {
    const resumed = playPause.slice(playPause.indexOf("console.log('Resumed Spotify playback');"));
    expect(resumed.slice(0, 600)).toContain("startAutoAdvancePolling('spotify', currentTrack, { token });");
  });

  test('a new play ends a pending resume, and every play records when it was asked for', () => {
    const start = bodyOf('setLoadingTrack(trackOrSource);', 'stopAllLocalAudio();');
    expect(start).toContain('playStartRequestedAtRef.current = Date.now();');
    expect(start).toContain('if (resumePendingRef.current) setResumePending(false);');
  });
});

describe('the playbar shows a pending start', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

  test('the title and artist shimmer while a start of this track is pending', () => {
    expect(app).toContain("className: `text-sm font-medium text-white truncate${startPending ? ' now-playing-pending' : ''}`");
    expect(app).toMatch(/className: `truncate hover:text-white hover:underline transition-colors cursor-pointer no-drag\$\{playStartPending\(\{ currentTrack, isPlaying, trackLoading, loadingTrack, resumePending \}\) \? ' now-playing-pending' : ''\}`/);
  });

  test('the shimmer is theme variables on the always-dark playbar, in both themes, with reduced motion respected', () => {
    const rule = html.slice(html.indexOf('.now-playing-pending {'), html.indexOf('}', html.indexOf('.now-playing-pending {')));
    expect(rule).toContain('var(--now-playing-pending-base)');
    expect(rule).toContain('var(--now-playing-pending-highlight)');
    expect(rule).toContain('animation: shimmer');
    expect(html.match(/--now-playing-pending-base:/g)).toHaveLength(2);
    expect(html.match(/--now-playing-pending-highlight:/g)).toHaveLength(2);
    expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.now-playing-pending \{ animation: none;/);
  });
});

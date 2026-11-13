// src/renderer/lib/play-state.js: keeping the playbar's play/pause state on
// what the engine is actually doing, and showing a start that is on its way.
//
// isPlaying used to change only when Parachord's own code paused or resumed
// an engine. An engine resumed some other way (MusicKit JS by its own media
// session handler, the Spotify app or the native Apple Music helper by a Mac
// media key that macOS routes to them, the shared <audio> element by
// Chromium) played with the button still on Play. The engines' own play and
// pause signals now reconcile it.

const { isSameTrack, trackPositionKey } = require('./playback-helpers');

// What an engine's own play or pause signal means for isPlaying: true or
// false to set, null to leave it. `engineOwnsTrack`: the engine that sent it
// is the one playing the track on screen (a signal from an engine a newer play
// left behind changes nothing). `parachordStopped`: Parachord paused it itself
// on the way to another track, so the play that follows sets the state.
// `ended`: the end of a track pauses the element, and the advance sets the
// state.
function reconcileEnginePlayState({ enginePlaying, engineOwnsTrack, isPlaying, parachordStopped = false, ended = false }) {
  if (!engineOwnsTrack) return null;
  if (enginePlaying) return isPlaying ? null : true;
  if (ended || parachordStopped) return null;
  return isPlaying ? false : null;
}

// MusicKit JS PlaybackStates: 2 playing, 3 paused, 4 stopped, 5 ended,
// 10 completed. Loading, seeking, waiting and stalled (1, 6, 8, 9) are on the
// way somewhere and change nothing.
function musicKitStatePlaying(state) {
  if (state === 2) return true;
  if (state === 3 || state === 4 || state === 5 || state === 10) return false;
  return null;
}

// Whether MusicKit JS (not the native helper) holds the track on screen: its
// now-playing item is the track's Apple Music song and it hasn't stopped.
// handlePlayPause pauses and resumes that engine, and its state events
// reconcile the button.
function musicKitWebHoldsTrack(musicKit, track) {
  if (!musicKit || !track || !track.appleMusicId) return false;
  const item = musicKit.nowPlayingItem;
  if (!item || item.id == null) return false;
  const state = musicKit.playbackState;
  if (state === 0 || state === 4 || state === 5 || state === 10) return false;
  return String(item.id) === String(track.appleMusicId);
}

// A start of the track on screen that hasn't begun playing: a resume waiting
// on its engine (resumePending), or handlePlay loading the same track (Play
// after a restart, after a failed play, or after the engine was stopped). The
// playbar's title and artist shimmer meanwhile, and another Play click is
// ignored instead of reaching an engine that has nothing loaded.
// How long a pending start holds Play before a click may start the track again.
// Longer than a slow on-demand resolve across every resolver
// (RESOLVE_BUDGET_MS, then the source's own start), shorter than someone waits
// before deciding the button is broken.
const PLAY_START_PATIENCE_MS = 20000;

function playStartPending({ currentTrack, isPlaying, trackLoading, loadingTrack, resumePending }) {
  if (!currentTrack || isPlaying) return false;
  if (resumePending) return true;
  return !!trackLoading && isSameTrack(loadingTrack, currentTrack);
}

// Where a refused resume starts the track again through handlePlay: where it
// was, keeping the scrobbler's record that this listen was already submitted.
function restartPositionForResume(track, positionSeconds, scrobbled) {
  const trackKey = trackPositionKey(track);
  if (!trackKey) return null;
  const position = Number(positionSeconds);
  if (!Number.isFinite(position) || position <= 0) return null;
  return { trackKey, position, ...(scrobbled ? { scrobbled: true } : {}) };
}

// How often a paused Spotify or native Apple Music track asks its engine
// whether something outside Parachord resumed it.
const EXTERNAL_RESUME_POLL_MS = 5000;

// The native Apple Music helper's state reply (`musickit:get-playback-state`)
// says it is playing the track on screen: a media key or Control Center
// resumed it without Parachord.
function nativeAppleMusicPlaying(reply, track) {
  if (!reply || reply.success === false || reply.status !== 'playing') return false;
  if (!track || !track.appleMusicId) return false;
  return reply.songId == null || String(reply.songId) === String(track.appleMusicId);
}

// The Spotify player state (`GET /v1/me/player`) says it is playing the track
// on screen (the requested URI or its relinked original).
function spotifyPlayingTrack(data, track) {
  if (!data || !data.is_playing || !data.item || !track) return false;
  const uri = track.spotifyUri || (track.sources && track.sources.spotify && track.sources.spotify.spotifyUri)
    || (track.spotifyId ? `spotify:track:${track.spotifyId}` : null);
  if (!uri) return false;
  return data.item.uri === uri || !!(data.item.linked_from && data.item.linked_from.uri === uri);
}

module.exports = {
  reconcileEnginePlayState,
  musicKitStatePlaying,
  musicKitWebHoldsTrack,
  playStartPending,
  PLAY_START_PATIENCE_MS,
  restartPositionForResume,
  nativeAppleMusicPlaying,
  EXTERNAL_RESUME_POLL_MS,
  spotifyPlayingTrack,
};

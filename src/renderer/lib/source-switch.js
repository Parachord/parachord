// src/renderer/lib/source-switch.js: a Play from pick that can't start leaves
// the playback as it was (#1607).
//
// The playbar's Play from menu plays the track on screen from another source
// (handlePlay(track, { sourceSwitch: true }) with the pick as
// preferredResolver). handlePlay stops every engine before it tries the pick,
// so a pick that couldn't start (a plug-in manifest past its budget, a plan
// refusal, a refused embed, a licence denial) used to fall back to a third
// source or show an error, and the person lost the playback they had, often
// mid-song, when all they asked for was another source. Now the engine hands
// it back: the track plays again from its own source where it was (or, if it
// was paused, waits there for Play), nothing records a failure, and a toast
// says what happened. A play a newer play replaced says nothing.
//
// Mobile has the same rule (parachord-mobile SourceSwitch.kt, #773); there it
// can also resume an engine it only paused, which desktop's handlePlay, which
// stops every engine up front, cannot.

const { isSameTrack, trackToHoldAfterFailure } = require('./playback-helpers');

let lastSwitchId = 0;

// The switch a Play from pick opens, or null when it isn't one: the pick must
// be another source of the track that is playing (or paused) on a source.
// The marker rides on the track handlePlay was given, so every fallback that
// re-enters handlePlay with `{ ...trackOrSource, sources }` carries it, and
// its id says which switch it belongs to (a stale marker matches none).
function sourceSwitchMarker({ track, current, position, wasPlaying }) {
  if (!track || !current) return null;
  const to = track.preferredResolver;
  const from = current._activeResolver;
  if (!to || !from || to === from || !isSameTrack(track, current)) return null;
  const at = Number(position);
  lastSwitchId += 1;
  return {
    id: lastSwitchId,
    to,
    from,
    track: current,
    position: Number.isFinite(at) && at > 0 ? at : 0,
    wasPlaying: !!wasPlaying,
  };
}

// What the toast says. The names are the plug-ins' (window.resolverLabelById).
function switchFailedMessage({ pickedName, currentName, wasPlaying }) {
  return wasPlaying
    ? `Couldn’t play from ${pickedName}. Still playing from ${currentName}.`
    : `Couldn’t play from ${pickedName}. Staying on ${currentName}.`;
}

// The track to play again when it was playing: the track as it was on screen,
// without the playing-state fields a failed play's hold drops, preferring its
// own source.
function replayTrackForSwitch(marker) {
  return { ...(trackToHoldAfterFailure(marker.track) || marker.track), preferredResolver: marker.from };
}

// The track to put back on screen when it was paused: as it was, still
// showing its source, preferring that source when Play starts it.
function heldTrackForSwitch(marker) {
  return { ...marker.track, preferredResolver: marker.from };
}

module.exports = {
  sourceSwitchMarker,
  switchFailedMessage,
  replayTrackForSwitch,
  heldTrackForSwitch,
};

// src/renderer/lib/playbar-art.js: when the playbar may keep showing the previous
// track's cover.
//
// Holding it through a track change avoids flashing a placeholder while the new
// cover loads. Holding it unconditionally kept the wrong cover for a track that
// never gets one, since "still loading" and "there isn't one" looked the same.
// So it holds only while something is still on the way.

const { isSameTrack } = require('./playback-helpers');

function trackArtKey(track) {
  return `${(track && track.artist) || ''}|${(track && track.album) || ''}`;
}

// `missKey` is the trackArtKey of the last album the lookup found no cover for.
function holdPreviousPlaybarArt(track, missKey) {
  if (!track) return true;
  // A loading placeholder isn't the real track yet.
  if (track._protocolLoading || track.status === 'resolving' || track.status === 'loading') return true;
  // getAlbumArt needs both, so no lookup is coming.
  if (!track.artist || !track.album) return false;
  return trackArtKey(track) !== missKey;
}

// Whether the playbar shows the current track's cover, title and artist (else
// the loading skeleton). While a play loads, the skeleton stands in so the
// previous track's cover and title don't sit there for the new one. A play of
// the track already on screen keeps it: Play after a restart, after a failed
// play, or after the engine was stopped goes back through handlePlay, and
// swapping the same cover and title out and back in looked like a reload.
// `loadingTrack` is the track handlePlay is starting; null when a click
// flagged the load before handlePlay ran, which is always another track.
function playbarShowsTrack(currentTrack, trackLoading, loadingTrack) {
  if (!currentTrack) return false;
  if (!trackLoading) return true;
  return isSameTrack(loadingTrack, currentTrack);
}

module.exports = { holdPreviousPlaybarArt, trackArtKey, playbarShowsTrack };

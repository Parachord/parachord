// src/renderer/lib/playbar-art.js: when the playbar may keep showing the previous
// track's cover.
//
// Holding it through a track change avoids flashing a placeholder while the new
// cover loads. Holding it unconditionally kept the wrong cover for a track that
// never gets one, since "still loading" and "there isn't one" looked the same.
// So it holds only while something is still on the way.

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

module.exports = { holdPreviousPlaybarArt, trackArtKey };

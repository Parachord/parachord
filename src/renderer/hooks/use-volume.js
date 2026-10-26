// src/renderer/hooks/use-volume.js — the volume state domain, extracted from
// app.js (Track 2b slice 1: presentational split done, state domains as
// hooks; parachord#1098).
//
// Owns: volume/isMuted state + their refs, the pre-mute capture, per-resolver
// dB normalization offsets + per-track adjustments, the effective-volume
// math, the Spotify/Amazon debounced write paths, and the volume-adjacent
// IPC effects (embed set-volume bridge, macOS system volume/mute monitor).
//
// Extracted VERBATIM — every function body + effect body below is a byte-for-
// byte move out of Parachord. Preserve order and semantics on any edit, and
// see the latency note in useSpotifyVolumeDispatch below (one stale-closure
// behavior is deliberately preserved; fixing it is a separate change).
//
// Rules for this file (the extracted-module rule for hooks):
//   - React.-qualified hooks only (React.useState etc.) — never bare
//     destructured hooks; the app.js module-scope destructure masks bare
//     hooks in the esbuild bundle but they throw under plain Node/jest.
//   - No window access at module import time (the render-smoke test requires
//     this file under plain Node).
//   - Inputs arrive as refs/parameters, never component-state closures.

/**
 * Pure effective-volume math: base volume + resolver offset + per-track
 * offset (both in dB), converted to a linear multiplier and clamped 0-100.
 * Exported for tests; the hook's getEffectiveVolume wraps it with its state
 * (resolverVolumeOffsets state + trackVolumeAdjustments ref contents).
 */
function computeEffectiveVolume(baseVolume, resolverId, trackId, resolverVolumeOffsets, trackVolumeAdjustments) {
  // Get resolver offset (dB)
  const resolverOffset = resolverVolumeOffsets[resolverId] || 0;
  // Get per-track adjustment (dB)
  const trackOffset = trackId ? (trackVolumeAdjustments[trackId] || 0) : 0;
  // Total dB adjustment
  const totalOffsetDb = resolverOffset + trackOffset;
  // Convert dB to linear multiplier: 10^(dB/20)
  const multiplier = Math.pow(10, totalOffsetDb / 20);
  // Apply to base volume and clamp to 0-100
  const effectiveVolume = Math.max(0, Math.min(100, baseVolume * multiplier));
  return effectiveVolume;
}

/** @internal  Track-volume defaults shared with the state initializer. */
function defaultResolverVolumeOffsets() {
  // Per-resolver volume offsets (dB adjustment, applied to base volume)
  // Default offsets: Spotify is normalized at -14 LUFS, others may be louder
  return {
    spotify: 0,      // Spotify is already normalized
    applemusic: 0,   // Apple Music is already normalized
    amazonmusic: 0,  // Amazon Music app has its own volume pipeline
    localfiles: 0,   // Local files vary, start neutral
    soundcloud: 0,   // SoundCloud varies, start neutral
    subsonic: 0,     // Subsonic streams whatever the file is — start neutral
    bandcamp: -3,    // Bandcamp tends to be slightly louder
    youtube: -6      // YouTube videos are often much louder
  };
}

function useVolume({
  cacheLoaded,
  activeResolversRef,
  resolverOrderRef,
  spotifyTokenRef,
  audioRef,
  currentTrackRef,
  isPlayingRef,
  usesSharedAudio,
}) {
  const [volume, setVolume] = React.useState(30);
  const [isMuted, setIsMuted] = React.useState(false);
  const preMuteVolumeRef = React.useRef(30); // Remember volume before muting
  const isMutedRef = React.useRef(false); // Ref for mute state to avoid stale closures
  const spotifyVolumeTimeoutRef = React.useRef(null); // Debounce Spotify volume API calls
  const amazonMusicVolumeTimeoutRef = React.useRef(null); // Debounce Amazon Music setVolume calls

  const [resolverVolumeOffsets, setResolverVolumeOffsets] = React.useState(
    defaultResolverVolumeOffsets,
  );
  const resolverVolumeOffsetsRef = React.useRef(resolverVolumeOffsets);  // Ref to avoid stale closure in save
  // Per-track volume adjustments (trackId -> dB offset from resolver default)
  const trackVolumeAdjustments = React.useRef({});

  const volumeRef = React.useRef(30);

  // Helper to determine resolver ID from track properties
  const determineResolverIdFromTrack = (track) => {
    if (!track) return null;
    // First check if we have an explicitly set active resolver (set during playback)
    if (track._activeResolver) return track._activeResolver;

    // Fall back to checking resolver-specific properties, but only for active resolvers
    const active = activeResolversRef.current || [];

    // Check sources object first (most reliable) - prefer active resolvers
    if (track.sources && typeof track.sources === 'object') {
      const availableSources = Object.keys(track.sources).filter(resId => active.includes(resId) && !track.sources[resId]?.noMatch);
      if (availableSources.length > 0) {
        // Return the highest priority active resolver
        const resolverOrder = resolverOrderRef.current || [];
        availableSources.sort((a, b) => {
          const aIdx = resolverOrder.indexOf(a);
          const bIdx = resolverOrder.indexOf(b);
          return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
        });
        return availableSources[0];
      }
    }

    // Fall back to checking top-level properties (for older track formats)
    if ((track.spotifyUri || track.spotifyId) && active.includes('spotify')) return 'spotify';
    if (track.amazonAsin && active.includes('amazonmusic')) return 'amazonmusic';
    if (track.bandcampUrl && active.includes('bandcamp')) return 'bandcamp';
    if ((track.youtubeUrl || track.youtubeId) && active.includes('youtube')) return 'youtube';
    if (track.subsonicId && active.includes('subsonic')) return 'subsonic';
    if ((track.filePath || track.fileUrl) && active.includes('localfiles')) return 'localfiles';

    // Last resort: return any resolver from sources (even if disabled) for display purposes
    if (track.sources && typeof track.sources === 'object') {
      const allSources = Object.keys(track.sources).filter(id => !track.sources[id]?.noMatch);
      if (allSources.length > 0) return allSources[0];
    }
    if (track.spotifyUri || track.spotifyId || track.sources?.spotify) return 'spotify';
    if (track.amazonAsin || track.sources?.amazonmusic) return 'amazonmusic';
    if (track.bandcampUrl || track.sources?.bandcamp) return 'bandcamp';
    if (track.youtubeUrl || track.youtubeId || track.sources?.youtube) return 'youtube';
    if (track.filePath || track.fileUrl || track.sources?.localfiles) return 'localfiles';

    return null;
  };

  // Calculate effective volume with resolver offset and per-track adjustment
  // Returns volume as 0-100 percentage
  // Math lives in the exported pure computeEffectiveVolume; this wrapper
  // passes the current state + track-adjustments ref contents.
  const getEffectiveVolume = (baseVolume, resolverId, trackId) =>
    computeEffectiveVolume(baseVolume, resolverId, trackId, resolverVolumeOffsets, trackVolumeAdjustments.current);

  // Set Spotify playback volume via API (with normalization)
  const setSpotifyVolume = async (volumePercent, applyNormalization = true) => {
    if (!spotifyTokenRef.current) return;
    try {
      // Apply normalization if enabled
      let effectiveVolume = volumePercent;
      if (applyNormalization && currentTrackRef.current) {
        effectiveVolume = getEffectiveVolume(volumePercent, 'spotify', currentTrackRef.current.id);
      }
      const response = await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(effectiveVolume)}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${spotifyTokenRef.current}`
        }
      });
      if (!response.ok && response.status !== 204) {
        console.error('Failed to set Spotify volume:', response.status);
      }
    } catch (error) {
      console.error('Error setting Spotify volume:', error);
    }
  };

  // Debounced version for slider dragging (prevents rate limiting)
  const setSpotifyVolumeDebounced = (volumePercent, applyNormalization = true) => {
    if (spotifyVolumeTimeoutRef.current) {
      clearTimeout(spotifyVolumeTimeoutRef.current);
    }
    spotifyVolumeTimeoutRef.current = setTimeout(() => {
      setSpotifyVolume(volumePercent, applyNormalization);
    }, 150); // 150ms debounce
  };

  // Apply normalized volume for HTML5 audio playback (local files and SoundCloud)
  const applyLocalFileVolume = (baseVolume, trackId, resolverId = 'localfiles') => {
    if (!audioRef.current) return;
    const effectiveVolume = getEffectiveVolume(baseVolume, resolverId, trackId);
    audioRef.current.volume = effectiveVolume / 100;
  };

  // Keep refs in sync with state
  React.useEffect(() => {
    isMutedRef.current = isMuted;
    window._parachordVolume = isMuted ? 0 : volumeRef.current;
  }, [isMuted]);
  React.useEffect(() => {
    volumeRef.current = volume;
    window._parachordVolume = isMutedRef.current ? 0 : volume;
    // Persist volume to disk so it survives restarts
    if (cacheLoaded && window.electron?.store) {
      window.electron.store.set('saved_volume', volume);
    }
  }, [volume]);

  // Keep volume offsets ref in sync, persist on change, and re-apply to current playback
  React.useEffect(() => {
    resolverVolumeOffsetsRef.current = resolverVolumeOffsets;
    if (cacheLoaded && window.electron?.store) {
      window.electron.store.set('resolver_volume_offsets', resolverVolumeOffsets);
    }
    // Re-apply volume to current playback when offsets change
    if (cacheLoaded && currentTrackRef.current && !isMutedRef.current) {
      const resolverId = determineResolverIdFromTrack(currentTrackRef.current);
      const currentVol = volumeRef.current;
      const trackId = currentTrackRef.current?.id;
      const effectiveVolume = getEffectiveVolume(currentVol, resolverId, trackId);
      if (usesSharedAudio(resolverId) && audioRef.current) {
        audioRef.current.volume = effectiveVolume / 100;
      }
      if (resolverId === 'spotify') {
        setSpotifyVolumeDebounced(currentVol, true);
      }
      if (resolverId === 'applemusic' && window._appleMusicPreviewAudio) {
        window._appleMusicPreviewAudio.volume = effectiveVolume / 100;
      }
    }
  }, [resolverVolumeOffsets, cacheLoaded]);

  // Handle volume requests from embed players. NOTE (preserved latency):
  // this registration has an empty dep array, matching app.js today — the
  // handler closes over the FIRST render's setSpotifyVolumeDebounced →
  // getEffectiveVolume closures, so a resolver-offsets change in Settings is
  // not picked up by this dispatch path until restart. The same staleness
  // reaches the system-volume monitor below. The offsets-reapply effect
  // above covers the current-track compensation; do NOT "fix" this as part
  // of the extraction — a fresh-reference fix changes runtime behavior and
  // belongs in its own PR with verification.
  React.useEffect(() => {
    if (!window.electron?.embed?.onSetVolume) return;
    // Handle volume requests from embed
    window.electron.embed.onSetVolume(({ volume: newVolume }) => {
      console.log('🔊 Embed volume request:', newVolume);
      if (typeof newVolume === 'number') {
        setVolume(newVolume);
        setIsMuted(newVolume === 0);
        const resolverId = determineResolverIdFromTrack(currentTrackRef.current);
        const trackId = currentTrackRef.current?.id;
        const effectiveVolume = getEffectiveVolume(newVolume, resolverId, trackId);
        if (usesSharedAudio(resolverId) && audioRef.current) {
          audioRef.current.volume = effectiveVolume / 100;
        }
        if (resolverId === 'spotify') {
          setSpotifyVolumeDebounced(newVolume, true);
        }
        if (resolverId === 'applemusic' && window._appleMusicPreviewAudio) {
          window._appleMusicPreviewAudio.volume = effectiveVolume / 100;
        }
      }
    });
  }, []);

  // System volume/mute monitoring (macOS)
  // When the user mutes the system, pause Apple Music native playback and mute audio elements.
  // When unmuted, restore previous state. This is a separate layer from Parachord's own mute.
  React.useEffect(() => {
    if (!window.electron?.system?.onVolumeChanged) return;

    console.log('[SystemVolume] Registered system volume change listener');
    let systemMuted = false;
    let wasPlayingBeforeMute = false;

    // (_volume: main reports the system level; we only act on `muted` and
    // read our own volumeRef — the underscore keeps the strict tier clean.)
    window.electron.system.onVolumeChanged(({ volume: _volume, muted }) => {
      if (muted && !systemMuted) {
        // System just muted
        systemMuted = true;
        console.log('[SystemVolume] System muted - pausing audio');

        // Mute HTML5 audio elements (local files, SoundCloud, Apple Music preview)
        if (audioRef.current) {
          audioRef.current.volume = 0;
        }
        if (window._appleMusicPreviewAudio) {
          window._appleMusicPreviewAudio.volume = 0;
        }

        // Pause Apple Music native playback (separate process, can't control volume)
        const track = currentTrackRef.current;
        if (track?._activeResolver === 'applemusic' && isPlayingRef.current) {
          // isPlayingRef is an input (engine-owned), not hook state.
          // (Kept as a ref read; identical to the pre-extraction effect.)
          wasPlayingBeforeMute = true;
          if (window.electron?.musicKit?.pause) {
            window.electron.musicKit.pause();
          }
        }

        // Mute Spotify
        if (track?._activeResolver === 'spotify') {
          setSpotifyVolumeDebounced(0, false);
        }
      } else if (!muted && systemMuted) {
        // System just unmuted
        systemMuted = false;
        console.log('[SystemVolume] System unmuted - restoring audio');

        // Only restore if Parachord itself isn't muted
        if (!isMutedRef.current) {
          const currentVol = volumeRef.current;
          const track = currentTrackRef.current;
          const resolverId = track ? determineResolverIdFromTrack(track) : null;

          // Restore HTML5 audio volume
          if (usesSharedAudio(resolverId) && audioRef.current) {
            applyLocalFileVolume(currentVol, track?.id, resolverId);
          }
          if (resolverId === 'applemusic' && window._appleMusicPreviewAudio) {
            const effectiveVol = getEffectiveVolume(currentVol, 'applemusic', track?.id);
            window._appleMusicPreviewAudio.volume = effectiveVol / 100;
          }

          // Resume Apple Music native if it was playing before mute
          if (wasPlayingBeforeMute) {
            wasPlayingBeforeMute = false;
            if (window.electron?.musicKit?.resume) {
              window.electron.musicKit.resume();
            }
          }

          // Restore Spotify volume
          if (resolverId === 'spotify') {
            setSpotifyVolumeDebounced(currentVol, true);
          }
        }
      }
    });
  }, []);

  return {
    volume,
    setVolume,
    isMuted,
    setIsMuted,
    volumeRef,
    isMutedRef,
    preMuteVolumeRef,
    resolverVolumeOffsets,
    setResolverVolumeOffsets,
    resolverVolumeOffsetsRef,
    trackVolumeAdjustments,
    spotifyVolumeTimeoutRef,
    amazonMusicVolumeTimeoutRef,
    getEffectiveVolume,
    setSpotifyVolume,
    setSpotifyVolumeDebounced,
    applyLocalFileVolume,
    determineResolverIdFromTrack,
  };
}

module.exports = { useVolume, computeEffectiveVolume };

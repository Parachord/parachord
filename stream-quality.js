/**
 * Stream quality (codec / bitrate / sample rate) contract.
 *
 * A resolver that knows the technical parameters of the stream a track plays
 * through it attaches a `streamQuality` record to its own entry in
 * `track.sources` — the same cross-cutting-source-record pattern as `isrc`
 * (see the Resolver Result Shape section in CLAUDE.md):
 *
 *   track.sources[resolverId].streamQuality = {
 *     codec: 'flac' | 'MPEG 1 Layer III' | 'AAC' | ...  // raw, as captured
 *     container: 'flac' | 'm4a' | ...   // container / extension fallback
 *     bitrate: 902,                      // kbps (average for VBR, nominal for CBR)
 *     sampleRate: 44100,                  // Hz
 *     bitDepth: 16,                       // bits, lossless/PCM only
 *     channels: 2,                         // optional; stereo is the default
 *     origin: 'measured'  // 'measured' (read from the actual stream/file) |
 *                        // 'claimed' (resolver's documented tier)
 *   }
 *
 * All fields are optional. Presence of the record IS the capability — a
 * resolver that can't know (e.g. Spotify Connect, where the target device
 * decides) simply doesn't attach one, and the UI renders exactly as before.
 *
 * Stream quality describes the stream the PLAYING resolver delivers, so
 * consumers must key off the resolver actually playing the track, never just
 * "any source on the track" — a Spotify-played track with a localfiles
 * source attached is streaming through Spotify, and a localfiles-played
 * track with a Spotify id is streaming from disk.
 *
 * Currently populated by: localfiles (exact, from the file scan).
 * Loaded by index.html for the renderer and require()d by the tests.
 */
(function () {
  /**
   * Pick the streamQuality record for the resolver actually playing the
   * track. `playingResolverId` should be the active resolver
   * (track._activeResolver / determineResolverIdFromTrack), not a
   * preferred one.
   */
  function pickStreamQuality(track, playingResolverId) {
    if (!playingResolverId) return null;
    const src = track && track.sources ? track.sources[playingResolverId] : null;
    if (!src || src.noMatch) return null;
    const q = src.streamQuality;
    return (q && typeof q === 'object') ? q : null;
  }

  /** Short display label for the codec, with container/extension fallback. */
  function streamQualityCodecLabel(streamQuality) {
    const raw = String((streamQuality && streamQuality.codec) || '').toLowerCase();
    if (raw) {
      if (raw === 'flac') return 'FLAC';
      if (raw === 'alac') return 'ALAC';
      if (raw === 'pcm') return 'WAV';
      // music-metadata emits 'MPEG 1 Layer 3' (older versions 'Layer III')
      if (raw.includes('layer 3') || raw.includes('layer iii') || raw === 'mp3') return 'MP3';
      if (raw === 'aac' || raw === 'mp4a' || raw.includes('aac')) return 'AAC';
    }
    // No codec label captured (e.g. a row indexed before the `codec` column
    // existed) — fall back to the container/extension.
    const container = String((streamQuality && streamQuality.container) || '').toLowerCase();
    if (!container) return null;
    if (container === 'm4a') return 'M4A';
    return container.toUpperCase();
  }

  /** One-line display form, e.g. 'FLAC · 44.1 kHz · 16-bit · 847 kbps'. */
  function formatStreamQuality(streamQuality) {
    if (!streamQuality || typeof streamQuality !== 'object') return '';
    const parts = [];
    const codec = streamQualityCodecLabel(streamQuality);
    if (codec) parts.push(codec);
    if (streamQuality.sampleRate && streamQuality.sampleRate > 0) {
      const kHz = streamQuality.sampleRate / 1000;
      parts.push((Number.isInteger(kHz) ? kHz.toString() : kHz.toFixed(1)) + ' kHz');
    }
    if (streamQuality.bitDepth) parts.push(streamQuality.bitDepth + '-bit');
    if (streamQuality.bitrate) parts.push(streamQuality.bitrate + ' kbps');
    return parts.join(' · ');
  }

  const api = { pickStreamQuality, streamQualityCodecLabel, formatStreamQuality };
  if (typeof window !== 'undefined') {
    window.pickStreamQuality = pickStreamQuality;
    window.streamQualityCodecLabel = streamQualityCodecLabel;
    window.formatStreamQuality = formatStreamQuality;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

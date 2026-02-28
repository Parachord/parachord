/**
 * Playback state machine
 * States: idle → loading → playing → paused → idle
 *
 * The server is the source of truth. Clients are audio renderers
 * that receive "play this" commands and report progress back.
 */
class PlaybackService {
  constructor({ queueService, resolverService, authService, wsManager }) {
    this.queue = queueService;
    this.resolver = resolverService;
    this.auth = authService;
    this.ws = wsManager;

    this.state = 'idle'; // idle | loading | playing | paused
    this.currentTrack = null;
    this.position = 0;
    this.duration = 0;

    // Listen for client events
    this.ws.on('client:track-ended', () => this.next());
    this.ws.on('client:progress', (payload) => this._onProgress(payload));
    this.ws.on('client:error', (payload) => this._onClientError(payload));
  }

  /**
   * Play a specific track (resolve + send to clients)
   */
  async play(track) {
    this._setState('loading');
    this.currentTrack = track;

    try {
      // Resolve the track to get a playable URL
      const resolved = await this.resolver.resolve(track);
      if (!resolved) {
        this._setState('idle');
        throw new Error(`Could not resolve track: ${track.title} by ${track.artist}`);
      }

      // Attach credentials if needed
      let credentials = null;
      if (track.resolverId === 'spotify') {
        const tokenResult = await this.auth.getToken('spotify');
        if (tokenResult) credentials = { spotifyToken: tokenResult.token };
      } else if (track.resolverId === 'soundcloud') {
        const tokenResult = await this.auth.getToken('soundcloud');
        if (tokenResult) credentials = { soundcloudToken: tokenResult.token };
      }

      this._setState('playing');
      this.position = 0;
      this.duration = track.duration || 0;

      // Send play command to all connected clients
      this.ws.broadcast('playback:play', {
        track,
        source: track.resolverId,
        credentials,
        streamUrl: resolved.streamUrl || resolved.url,
        resolved
      });

      // Pre-resolve upcoming tracks in background
      this._preResolve();

      return { success: true, track, resolved };
    } catch (err) {
      this._setState('idle');
      throw err;
    }
  }

  /**
   * Play a track from the queue by index, or the current queue track
   */
  async playFromQueue(index) {
    const track = index !== undefined
      ? this.queue.jumpTo(index)
      : this.queue.getState().currentTrack;

    if (!track) throw new Error('No track to play');
    return this.play(track);
  }

  pause() {
    if (this.state !== 'playing') return;
    this._setState('paused');
    this.ws.broadcast('playback:pause', {});
  }

  resume() {
    if (this.state !== 'paused') return;
    this._setState('playing');
    this.ws.broadcast('playback:resume', {});
  }

  stop() {
    this._setState('idle');
    this.currentTrack = null;
    this.position = 0;
    this.duration = 0;
    this.ws.broadcast('playback:stop', {});
  }

  async next() {
    const track = this.queue.next();
    if (track) {
      return this.play(track);
    }
    this.stop();
    return null;
  }

  async previous() {
    const track = this.queue.previous();
    if (track) {
      return this.play(track);
    }
    return null;
  }

  async seek(position) {
    this.position = position;
    this.ws.broadcast('playback:seek', { position });
  }

  getState() {
    return {
      state: this.state,
      currentTrack: this.currentTrack,
      position: this.position,
      duration: this.duration
    };
  }

  // --- Private ---

  _setState(newState) {
    this.state = newState;
    this.ws.broadcast('playback:state-changed', {
      state: newState,
      currentTrack: this.currentTrack,
      position: this.position,
      duration: this.duration
    });
  }

  _onProgress({ position, duration }) {
    this.position = position || this.position;
    this.duration = duration || this.duration;
  }

  _onClientError({ error }) {
    console.error('[PlaybackService] Client error:', error);
    // Try next track on client error
    this.next().catch(err => {
      console.error('[PlaybackService] Failed to advance after error:', err.message);
    });
  }

  async _preResolve() {
    const upcoming = this.queue.getUpcoming(2);
    for (const track of upcoming) {
      try {
        await this.resolver.resolve(track);
      } catch {
        // Pre-resolution failures are non-fatal
      }
    }
  }
}

module.exports = PlaybackService;

/**
 * MusicKit JS Integration for Apple Music
 *
 * Provides full Apple Music streaming via MusicKit JS in the renderer process.
 * Requires a MusicKit Developer Token (JWT) from Apple Developer account.
 */

class MusicKitWeb {
  constructor() {
    this.musicKit = null;
    this.isConfigured = false;
    this.isAuthorized = false;
    this.developerToken = null;
    this.loadPromise = null;
  }

  /**
   * Load MusicKit JS library from Apple's CDN
   */
  async loadLibrary() {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    if (window.MusicKit) {
      console.log('[MusicKitWeb] Library already loaded');
      return true;
    }

    this.loadPromise = new Promise((resolve, reject) => {
      console.log('[MusicKitWeb] Loading MusicKit JS library...');

      const script = document.createElement('script');
      script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
      script.async = true;
      script.crossOrigin = 'anonymous';

      script.onload = () => {
        console.log('[MusicKitWeb] Library loaded successfully');
        resolve(true);
      };

      script.onerror = (error) => {
        console.error('[MusicKitWeb] Failed to load library:', error);
        this.loadPromise = null;
        reject(new Error('Failed to load MusicKit JS'));
      };

      document.head.appendChild(script);
    });

    return this.loadPromise;
  }

  /**
   * Configure MusicKit with developer token
   */
  async configure(developerToken, appName = 'Parachord', appBuild = '1.0.0') {
    if (!developerToken) {
      throw new Error('Developer token is required');
    }

    this.developerToken = developerToken;

    // Load library if not loaded
    await this.loadLibrary();

    if (!window.MusicKit) {
      throw new Error('MusicKit JS not available');
    }

    try {
      // Build configuration object with explicit app name
      const musicKitConfig = {
        developerToken: developerToken,
        app: {
          name: 'Parachord',
          build: '1.0.0',
        },
        sourceType: 24, // Web player source type
      };

      // Debug: Log the full configuration to verify app name is correct
      console.log('[MusicKitWeb] Configuring MusicKit with config:', JSON.stringify({
        ...musicKitConfig,
        developerToken: musicKitConfig.developerToken.substring(0, 20) + '...' // Truncate token for privacy
      }, null, 2));

      this.musicKit = await window.MusicKit.configure(musicKitConfig);

      this.isConfigured = true;
      this.isAuthorized = this.musicKit.isAuthorized;

      console.log('[MusicKitWeb] Configured successfully, authorized:', this.isAuthorized);

      // Set up event listeners
      this.setupEventListeners();

      return true;
    } catch (error) {
      console.error('[MusicKitWeb] Configuration failed:', error);
      throw error;
    }
  }

  /**
   * Set up MusicKit event listeners
   */
  setupEventListeners() {
    if (!this.musicKit) return;

    // Authorization status change
    this.musicKit.addEventListener('authorizationStatusDidChange', (event) => {
      this.isAuthorized = this.musicKit.isAuthorized;
      console.log('[MusicKitWeb] Authorization status changed:', this.isAuthorized);
      window.dispatchEvent(new CustomEvent('musickit-auth-change', {
        detail: { authorized: this.isAuthorized }
      }));
    });

    // Playback state changes
    this.musicKit.addEventListener('playbackStateDidChange', (event) => {
      const state = this.musicKit.playbackState;
      console.log('[MusicKitWeb] Playback state changed:', state);
      window.dispatchEvent(new CustomEvent('musickit-playback-state', {
        detail: { state }
      }));
    });

    // Now playing item changed
    this.musicKit.addEventListener('nowPlayingItemDidChange', (event) => {
      const item = this.musicKit.nowPlayingItem;
      console.log('[MusicKitWeb] Now playing changed:', item?.title);
      window.dispatchEvent(new CustomEvent('musickit-now-playing', {
        detail: { item }
      }));
    });

    // Playback time changed
    this.musicKit.addEventListener('playbackTimeDidChange', (event) => {
      window.dispatchEvent(new CustomEvent('musickit-time-update', {
        detail: {
          currentTime: this.musicKit.currentPlaybackTime,
          duration: this.musicKit.currentPlaybackDuration
        }
      }));
    });

    // Playback ended
    this.musicKit.addEventListener('mediaItemDidEndPlaying', (event) => {
      console.log('[MusicKitWeb] Track ended');
      window.dispatchEvent(new CustomEvent('musickit-track-ended'));
    });
  }

  /**
   * Request user authorization (Apple ID sign-in)
   */
  async authorize() {
    if (!this.musicKit) {
      throw new Error('MusicKit not configured');
    }

    try {
      console.log('[MusicKitWeb] Requesting authorization...');
      const musicUserToken = await this.musicKit.authorize();
      this.isAuthorized = true;
      console.log('[MusicKitWeb] Authorization successful');
      return { authorized: true, userToken: musicUserToken };
    } catch (error) {
      console.error('[MusicKitWeb] Authorization failed:', error);
      throw error;
    }
  }

  /**
   * Sign out
   */
  async unauthorize() {
    if (!this.musicKit) return;

    try {
      await this.musicKit.unauthorize();
      this.isAuthorized = false;
      console.log('[MusicKitWeb] Signed out');
    } catch (error) {
      console.error('[MusicKitWeb] Sign out failed:', error);
    }
  }

  /**
   * Check authorization status
   */
  getAuthStatus() {
    return {
      configured: this.isConfigured,
      authorized: this.isAuthorized,
      hasDeveloperToken: !!this.developerToken
    };
  }

  /**
   * Play a song by Apple Music catalog ID
   */
  async play(songId) {
    if (!this.musicKit) {
      throw new Error('MusicKit not configured');
    }

    if (!this.isAuthorized) {
      throw new Error('Not authorized - call authorize() first');
    }

    try {
      console.log('[MusicKitWeb] Playing song:', songId);

      // Set the queue to the song
      await this.musicKit.setQueue({
        song: songId,
        startPlaying: true
      });

      return { playing: true, songId };
    } catch (error) {
      console.error('[MusicKitWeb] Play failed:', error);
      throw error;
    }
  }

  /**
   * Play multiple songs (queue)
   */
  async playQueue(songIds, startIndex = 0) {
    if (!this.musicKit) {
      throw new Error('MusicKit not configured');
    }

    if (!this.isAuthorized) {
      throw new Error('Not authorized');
    }

    try {
      console.log('[MusicKitWeb] Setting queue with', songIds.length, 'songs');

      await this.musicKit.setQueue({
        songs: songIds,
        startWith: startIndex,
        startPlaying: true
      });

      return { playing: true, queueLength: songIds.length };
    } catch (error) {
      console.error('[MusicKitWeb] Play queue failed:', error);
      throw error;
    }
  }

  /**
   * Pause playback
   */
  async pause() {
    if (!this.musicKit) return;

    try {
      await this.musicKit.pause();
      return { paused: true };
    } catch (error) {
      console.error('[MusicKitWeb] Pause failed:', error);
      throw error;
    }
  }

  /**
   * Resume playback
   */
  async resume() {
    if (!this.musicKit) return;

    try {
      await this.musicKit.play();
      return { playing: true };
    } catch (error) {
      console.error('[MusicKitWeb] Resume failed:', error);
      throw error;
    }
  }

  /**
   * Stop playback
   */
  async stop() {
    if (!this.musicKit) return;

    try {
      await this.musicKit.stop();
      return { stopped: true };
    } catch (error) {
      console.error('[MusicKitWeb] Stop failed:', error);
      throw error;
    }
  }

  /**
   * Skip to next track
   */
  async skipToNext() {
    if (!this.musicKit) return;

    try {
      await this.musicKit.skipToNextItem();
      return { skipped: 'next' };
    } catch (error) {
      console.error('[MusicKitWeb] Skip next failed:', error);
      throw error;
    }
  }

  /**
   * Skip to previous track
   */
  async skipToPrevious() {
    if (!this.musicKit) return;

    try {
      await this.musicKit.skipToPreviousItem();
      return { skipped: 'previous' };
    } catch (error) {
      console.error('[MusicKitWeb] Skip previous failed:', error);
      throw error;
    }
  }

  /**
   * Seek to position (in seconds)
   */
  async seek(position) {
    if (!this.musicKit) return;

    try {
      await this.musicKit.seekToTime(position);
      return { position };
    } catch (error) {
      console.error('[MusicKitWeb] Seek failed:', error);
      throw error;
    }
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(volume) {
    if (!this.musicKit) return;

    this.musicKit.volume = Math.max(0, Math.min(1, volume));
    return { volume: this.musicKit.volume };
  }

  /**
   * Get current playback state
   */
  getPlaybackState() {
    if (!this.musicKit) {
      return { state: 'none', position: 0, duration: 0 };
    }

    const stateMap = {
      0: 'none',
      1: 'loading',
      2: 'playing',
      3: 'paused',
      4: 'stopped',
      5: 'ended',
      6: 'seeking',
      7: 'waiting',
      8: 'stalled',
      9: 'completed'
    };

    return {
      state: stateMap[this.musicKit.playbackState] || 'unknown',
      position: this.musicKit.currentPlaybackTime || 0,
      duration: this.musicKit.currentPlaybackDuration || 0,
      volume: this.musicKit.volume
    };
  }

  /**
   * Get now playing info
   */
  getNowPlaying() {
    if (!this.musicKit || !this.musicKit.nowPlayingItem) {
      return null;
    }

    const item = this.musicKit.nowPlayingItem;
    return {
      id: item.id,
      title: item.title,
      artist: item.artistName,
      album: item.albumName,
      duration: item.playbackDuration,
      artworkUrl: item.artwork?.url?.replace('{w}', '500').replace('{h}', '500')
    };
  }

  /**
   * Search Apple Music catalog
   */
  async search(query, limit = 25) {
    if (!this.musicKit) {
      throw new Error('MusicKit not configured');
    }

    try {
      const results = await this.musicKit.api.music(`/v1/catalog/us/search`, {
        term: query,
        types: 'songs',
        limit: limit
      });

      const songs = results.data.results.songs?.data || [];

      return songs.map(song => ({
        id: song.id,
        title: song.attributes.name,
        artist: song.attributes.artistName,
        album: song.attributes.albumName,
        duration: Math.floor(song.attributes.durationInMillis / 1000),
        artworkUrl: song.attributes.artwork?.url?.replace('{w}', '500').replace('{h}', '500'),
        isrc: song.attributes.isrc
      }));
    } catch (error) {
      console.error('[MusicKitWeb] Search failed:', error);
      throw error;
    }
  }

  /**
   * Search for an artist and return their image URL
   * Returns { url, name } or null if not found
   */
  async getArtistImage(artistName, size = 500) {
    if (!this.musicKit) {
      return null;
    }

    try {
      const results = await this.musicKit.api.music(`/v1/catalog/us/search`, {
        term: artistName,
        types: 'artists',
        limit: 5
      });

      const artists = results.data.results.artists?.data || [];
      if (artists.length === 0) {
        return null;
      }

      // Find exact match (case-insensitive) or use first result
      const exactMatch = artists.find(a =>
        a.attributes.name.toLowerCase() === artistName.toLowerCase()
      );
      const artist = exactMatch || artists[0];

      const artwork = artist.attributes.artwork;
      if (!artwork?.url) {
        return null;
      }

      // Replace {w} and {h} placeholders with actual size
      const imageUrl = artwork.url
        .replace('{w}', String(size))
        .replace('{h}', String(size));

      return {
        url: imageUrl,
        name: artist.attributes.name,
        id: artist.id
      };
    } catch (error) {
      console.error('[MusicKitWeb] Artist search failed:', error);
      return null;
    }
  }
}

// Singleton instance
let musicKitWebInstance = null;

function getMusicKitWeb() {
  if (!musicKitWebInstance) {
    musicKitWebInstance = new MusicKitWeb();
  }
  return musicKitWebInstance;
}

// Export for use in app
if (typeof window !== 'undefined') {
  window.MusicKitWeb = MusicKitWeb;
  window.getMusicKitWeb = getMusicKitWeb;
}

// For module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MusicKitWeb, getMusicKitWeb };
}

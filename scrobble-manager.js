// scrobble-manager.js
// Manages scrobbling state and dispatches to enabled scrobbler plugins

class ScrobbleManager {
  constructor() {
    this.plugins = new Map(); // pluginId -> plugin instance
    this.currentTrack = null;
    this.trackStartTime = null;
    this.scrobbleSubmitted = false;
    this.nowPlayingSent = false;
    this.progressCheckInterval = null;
    this.onScrobbleCallback = null; // Callback for when scrobble is submitted
  }

  // Set callback to be notified when a scrobble is submitted
  setOnScrobbleCallback(callback) {
    this.onScrobbleCallback = callback;
  }

  // Register a scrobbler plugin
  registerPlugin(plugin) {
    if (!plugin.id || !plugin.scrobble || !plugin.updateNowPlaying) {
      console.error('[ScrobbleManager] Invalid plugin:', plugin);
      return;
    }
    this.plugins.set(plugin.id, plugin);
    console.log(`[ScrobbleManager] Registered plugin: ${plugin.id}`);
  }

  // Unregister a plugin
  unregisterPlugin(pluginId) {
    this.plugins.delete(pluginId);
    console.log(`[ScrobbleManager] Unregistered plugin: ${pluginId}`);
  }

  // Get all registered plugins
  getPlugins() {
    return Array.from(this.plugins.values());
  }

  // Get enabled plugins only
  async getEnabledPlugins() {
    const enabled = [];
    for (const plugin of this.plugins.values()) {
      if (await plugin.isEnabled()) {
        enabled.push(plugin);
      }
    }
    return enabled;
  }

  // Called when a new track starts playing
  async onTrackStart(track) {
    // Reset state for new track
    this.currentTrack = track;
    this.trackStartTime = Date.now();
    this.scrobbleSubmitted = false;
    this.nowPlayingSent = false;

    // Validate track has required fields
    if (!track.title || !track.artist) {
      console.log('[ScrobbleManager] Track missing required fields, skipping');
      return;
    }

    // Skip tracks under 30 seconds
    if (track.duration && track.duration < 30) {
      console.log('[ScrobbleManager] Track under 30s, skipping');
      return;
    }

    // Send "Now Playing" to all enabled plugins
    const enabledPlugins = await this.getEnabledPlugins();
    for (const plugin of enabledPlugins) {
      try {
        await plugin.updateNowPlaying(track);
        console.log(`[ScrobbleManager] Now Playing sent to ${plugin.id}`);
      } catch (error) {
        console.error(`[ScrobbleManager] Now Playing failed for ${plugin.id}:`, error);
      }
    }
    this.nowPlayingSent = true;
  }

  // Called periodically with current playback progress (in seconds)
  async onProgressUpdate(progressSeconds) {
    if (!this.currentTrack || this.scrobbleSubmitted) {
      return;
    }

    const track = this.currentTrack;
    const duration = track.duration;

    if (!duration || duration < 30) {
      return;
    }

    // Scrobble threshold per Last.fm/ListenBrainz spec:
    // - At least 30 seconds of listening
    // - At least 50% of track OR 4 minutes, whichever is earlier
    const halfDuration = duration / 2;
    const fourMinutes = 240;
    const minListenTime = 30;
    const threshold = Math.max(minListenTime, Math.min(halfDuration, fourMinutes));

    if (progressSeconds >= threshold) {
      await this.submitScrobble();
    }
  }

  // Submit scrobble to all enabled plugins
  async submitScrobble() {
    if (this.scrobbleSubmitted || !this.currentTrack) {
      return;
    }

    this.scrobbleSubmitted = true;
    const track = this.currentTrack;
    const timestamp = Math.floor(this.trackStartTime / 1000); // Unix timestamp

    console.log(`[ScrobbleManager] Submitting scrobble: ${track.artist} - ${track.title}`);

    const enabledPlugins = await this.getEnabledPlugins();
    let anySuccess = false;
    for (const plugin of enabledPlugins) {
      try {
        await plugin.scrobble(track, timestamp);
        console.log(`[ScrobbleManager] Scrobble submitted to ${plugin.id}`);
        anySuccess = true;
      } catch (error) {
        console.error(`[ScrobbleManager] Scrobble failed for ${plugin.id}:`, error);
        // Don't queue auth errors — they're permanent failures until user re-authenticates
        if (!error.authError) {
          await this.queueFailedScrobble(plugin.id, track, timestamp, error.message);
        }
      }
    }

    // Notify callback if any scrobble succeeded
    if (anySuccess && this.onScrobbleCallback) {
      try {
        this.onScrobbleCallback(track, timestamp);
      } catch (error) {
        console.error('[ScrobbleManager] onScrobbleCallback error:', error);
      }
    }
  }

  // Called when track ends or is skipped
  onTrackEnd() {
    this.currentTrack = null;
    this.trackStartTime = null;
  }

  // Queue failed scrobble for retry
  async queueFailedScrobble(pluginId, track, timestamp, error) {
    try {
      const queue = await window.electron.store.get('scrobble-failed-queue') || [];
      queue.push({
        pluginId,
        track: {
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          mbid: track.mbid || null,
          artistMbids: track.artistMbids || [],
          releaseMbid: track.releaseMbid || null
        },
        timestamp,
        error,
        attempts: 1,
        queuedAt: Date.now()
      });
      // Keep only last 500 failed scrobbles
      if (queue.length > 500) {
        queue.splice(0, queue.length - 500);
      }
      await window.electron.store.set('scrobble-failed-queue', queue);
      console.log(`[ScrobbleManager] Queued failed scrobble for retry`);
    } catch (err) {
      console.error('[ScrobbleManager] Failed to queue scrobble:', err);
    }
  }

  // Retry failed scrobbles (call periodically or on app start)
  async retryFailedScrobbles() {
    const queue = await window.electron.store.get('scrobble-failed-queue') || [];
    if (queue.length === 0) return;

    console.log(`[ScrobbleManager] Retrying ${queue.length} failed scrobbles`);
    const remaining = [];
    const failedPlugins = new Set(); // Skip remaining items after auth error for a plugin

    // Pre-check which plugins are enabled (one check per plugin, not per item)
    const pluginEnabled = new Map();
    for (const item of queue) {
      if (!pluginEnabled.has(item.pluginId)) {
        const plugin = this.plugins.get(item.pluginId);
        pluginEnabled.set(item.pluginId, plugin && await plugin.isEnabled());
      }
    }

    for (const item of queue) {
      // Drop items older than 14 days
      if ((Date.now() - item.queuedAt) >= 14 * 24 * 60 * 60 * 1000) {
        console.log(`[ScrobbleManager] Dropping expired scrobble: ${item.track?.artist} - ${item.track?.title}`);
        continue;
      }

      // Drop items for plugins that no longer exist
      if (!this.plugins.has(item.pluginId)) {
        continue;
      }

      // Skip disabled plugins — keep items for when user re-authenticates
      if (!pluginEnabled.get(item.pluginId)) {
        remaining.push(item);
        continue;
      }

      // Skip plugin entirely if an earlier retry hit an auth error
      if (failedPlugins.has(item.pluginId)) {
        remaining.push(item);
        continue;
      }

      try {
        await this.plugins.get(item.pluginId).scrobble(item.track, item.timestamp);
        console.log(`[ScrobbleManager] Retry successful for ${item.pluginId}`);
      } catch (error) {
        // Auth errors: stop retrying this plugin (session is dead)
        if (error.authError) {
          failedPlugins.add(item.pluginId);
          remaining.push(item);
          continue;
        }
        item.attempts++;
        item.error = error.message;
        if (item.attempts < 10) {
          remaining.push(item);
        } else {
          console.log(`[ScrobbleManager] Dropping scrobble after ${item.attempts} attempts`);
        }
      }
    }

    await window.electron.store.set('scrobble-failed-queue', remaining);
    if (remaining.length > 0) {
      console.log(`[ScrobbleManager] ${queue.length - remaining.length} retried/dropped, ${remaining.length} remaining`);
    }
  }
}

// Export singleton instance
const scrobbleManager = new ScrobbleManager();
export default scrobbleManager;

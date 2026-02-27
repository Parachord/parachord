/**
 * MusicKit Bridge - Electron side
 *
 * Communicates with the native Swift MusicKit helper via stdin/stdout JSON
 */

const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class MusicKitBridge extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.isReady = false;
    this.buffer = '';

    // Authorization caching
    this._authStatus = null;      // { authorized: boolean, status: string }
    this._authCheckedAt = 0;      // Timestamp of last check
    this._authCacheTTL = 60000;   // Cache valid for 60 seconds

    // Last error from helper (captured from id:"error" responses before crash)
    this._lastHelperError = null;
  }

  /**
   * Get cached authorization status (synchronous)
   * Returns null if not cached or cache expired
   */
  getCachedAuthStatus() {
    if (!this._authStatus) return null;
    if (Date.now() - this._authCheckedAt > this._authCacheTTL) return null;
    return this._authStatus;
  }

  /**
   * Check if cached auth shows authorized
   */
  isCachedAuthorized() {
    const cached = this.getCachedAuthStatus();
    return cached?.authorized === true;
  }

  /**
   * Invalidate auth cache (call after failures)
   */
  invalidateAuthCache() {
    this._authStatus = null;
    this._authCheckedAt = 0;
  }

  /**
   * Clear auth state: invalidate cache and stop the helper process.
   * Cannot programmatically revoke macOS system keychain auth, but this
   * ensures the app won't treat the user as connected on next launch.
   */
  unauthorize() {
    this.invalidateAuthCache();
    this.stop();
  }

  /**
   * Reject all pending requests (e.g. when the helper crashes or is stopped)
   */
  rejectAllPending(reason) {
    if (this.pendingRequests.size === 0) return;
    console.log(`[MusicKit] Rejecting ${this.pendingRequests.size} pending request(s): ${reason}`);
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  /**
   * Get the path to the MusicKit helper executable (inside .app bundle)
   */
  getHelperPath() {
    // Look for .app bundle first (required for MusicKit entitlements)
    // The executable is inside: MusicKitHelper.app/Contents/MacOS/MusicKitHelper
    const appBundlePaths = [
      // Development: use Swift build output .app bundle
      path.join(__dirname, 'native', 'musickit-helper', '.build', 'release', 'MusicKitHelper.app'),
      // Resources directory
      path.join(__dirname, 'resources', 'bin', 'darwin', 'MusicKitHelper.app'),
      // Production path (inside Electron app bundle)
      path.join(process.resourcesPath || __dirname, 'bin', 'darwin', 'MusicKitHelper.app'),
    ];

    for (const appPath of appBundlePaths) {
      const execPath = path.join(appPath, 'Contents', 'MacOS', 'MusicKitHelper');
      if (fs.existsSync(execPath)) {
        console.log('[MusicKit] Found app bundle at:', appPath);
        return execPath;
      }
    }

    // Fallback to old CLI binary (won't have MusicKit playback, but might work for search)
    const fallbackPaths = [
      path.join(__dirname, 'native', 'musickit-helper', '.build', 'release', 'musickit-helper'),
      path.join(__dirname, 'resources', 'bin', 'darwin', 'musickit-helper'),
      path.join(process.resourcesPath || __dirname, 'bin', 'darwin', 'musickit-helper'),
    ];

    for (const p of fallbackPaths) {
      if (fs.existsSync(p)) {
        console.log('[MusicKit] Warning: Using fallback CLI binary (no playback support):', p);
        return p;
      }
    }

    return null;
  }

  /**
   * Check if MusicKit helper is available (macOS only)
   */
  isAvailable() {
    if (process.platform !== 'darwin') {
      return false;
    }
    return this.getHelperPath() !== null;
  }

  /**
   * Start the MusicKit helper process
   */
  async start() {
    if (this.process) {
      console.log('[MusicKit] Already running');
      return true;
    }

    if (process.platform !== 'darwin') {
      console.log('[MusicKit] Only available on macOS');
      return false;
    }

    const helperPath = this.getHelperPath();
    if (!helperPath) {
      console.log('[MusicKit] Helper binary not found');
      console.log('[MusicKit] Build it with: cd native/musickit-helper && ./build.sh');
      return false;
    }

    console.log('[MusicKit] Starting helper:', helperPath);
    console.log('[MusicKit] Helper exists:', fs.existsSync(helperPath));
    console.log('[MusicKit] Helper stats:', fs.statSync(helperPath).mode.toString(8));

    // Remove macOS quarantine xattr from the helper app bundle.
    // When the user downloads the DMG, macOS sets com.apple.quarantine on
    // everything inside. The main Parachord.app passes Gatekeeper (signed +
    // notarized), but the quarantine xattr propagates to nested binaries.
    // Removing it from the bundled helper is safe — the parent app was already
    // verified by Gatekeeper.
    const appBundlePath = path.dirname(path.dirname(path.dirname(helperPath))); // up from Contents/MacOS/MusicKitHelper
    try {
      execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appBundlePath], { timeout: 5000 });
      console.log('[MusicKit] Cleared quarantine xattr from:', appBundlePath);
    } catch (e) {
      // Ignore — xattr may not exist (no quarantine) or we lack permission
      console.log('[MusicKit] Could not clear quarantine (may not be set):', e.message);
    }

    return new Promise((resolve) => {
      try {
        this.process = spawn(helperPath, [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env }
        });
        console.log('[MusicKit] Process spawned, PID:', this.process.pid);
      } catch (spawnError) {
        console.error('[MusicKit] Spawn error:', spawnError);
        resolve(false);
        return;
      }

      this.process.stdout.on('data', (data) => {
        console.log('[MusicKit] stdout raw:', data.toString());
        this.handleData(data);
      });

      this.process.stderr.on('data', (data) => {
        console.error('[MusicKit] stderr:', data.toString());
      });

      this.process.on('error', (error) => {
        console.error('[MusicKit] Process error:', error);
        this.process = null;
        this.isReady = false;
        resolve(false);
      });

      this.process.on('close', (code, signal) => {
        console.log('[MusicKit] Process closed with code:', code, 'signal:', signal);
        this.process = null;
        this.isReady = false;
        // If the helper's uncaught exception handler already sent an error
        // (id:"error" response handled in handleData), pending requests are
        // already rejected with the real error.  Only reject stragglers here.
        if (this.pendingRequests.size > 0) {
          const reason = this._lastHelperError
            || `MusicKit helper exited (code: ${code}, signal: ${signal})`;
          this.rejectAllPending(reason);
        }
        this._lastHelperError = null;
        this.emit('close', code);
      });

      this.process.on('exit', (code, signal) => {
        console.log('[MusicKit] Process exit with code:', code, 'signal:', signal);
      });

      // Wait for ready signal, or resolve early if the process dies
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimeout);
        resolve(value);
      };

      const readyTimeout = setTimeout(() => {
        if (!this.isReady) {
          console.log('[MusicKit] Timeout waiting for ready signal');
          console.log('[MusicKit] Buffer contents:', this.buffer);
          console.log('[MusicKit] Process still alive:', this.process && !this.process.killed);
          this.stop();
          settle(false);
        }
      }, 10000);

      this.once('ready', () => {
        console.log('[MusicKit] Helper ready');
        settle(true);
      });

      // If the process crashes during startup (before "ready"), resolve
      // immediately instead of waiting for the 10-second timeout.
      this.once('close', () => {
        if (!this.isReady) {
          console.log('[MusicKit] Helper died during startup');
          settle(false);
        }
      });
    });
  }

  /**
   * Handle incoming data from the helper
   */
  handleData(data) {
    this.buffer += data.toString();
    console.log('[MusicKit] handleData, buffer now:', this.buffer.substring(0, 200));

    // Process complete JSON lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // Keep incomplete line in buffer
    console.log('[MusicKit] Lines to process:', lines.length);

    for (const line of lines) {
      if (!line.trim()) continue;
      console.log('[MusicKit] Processing line:', line.substring(0, 100));

      try {
        const response = JSON.parse(line);
        console.log('[MusicKit] Parsed response id:', response.id);

        // Check for ready signal
        if (response.id === 'ready') {
          console.log('[MusicKit] Got ready signal!');
          this.isReady = true;
          this.emit('ready', response.data);
          continue;
        }

        // Handle error responses from the helper's uncaught exception handler.
        // These have id "error" and don't match any pending request, but they
        // contain the real error message (e.g. MusicKit SIGABRT reason).
        // The helper is about to crash, so reject all pending requests with the
        // actual error instead of the generic "MusicKit helper exited" message.
        if (response.id === 'error' && !response.success) {
          const errorMsg = response.error || 'MusicKit internal error';
          console.error('[MusicKit] Helper reported fatal error:', errorMsg);
          this._lastHelperError = errorMsg;
          this.rejectAllPending(errorMsg);
          continue;
        }

        // Resolve pending request
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.success) {
            pending.resolve(response.data);
          } else {
            pending.reject(new Error(response.error || 'Unknown error'));
          }
        }
      } catch (error) {
        console.error('[MusicKit] Parse error:', error, 'Line:', line);
      }
    }
  }

  /**
   * Send a command to the helper.
   * If the helper crashes mid-request, waits briefly then retries once.
   */
  async send(action, params = {}, timeoutMs = 30000) {
    return this._sendOnce(action, params, timeoutMs).catch(async (error) => {
      // Retry once if the helper died mid-request (not for timeouts or app errors)
      if (error.message && (
        error.message.includes('MusicKit helper exited') ||
        error.message.includes('MusicKit internal error')
      )) {
        console.log(`[MusicKit] Retrying ${action} after helper crash`);
        // Small delay before retry — gives macOS subsystems (TCC, XPC) time to settle
        await new Promise(r => setTimeout(r, 1500));
        return this._sendOnce(action, params, timeoutMs);
      }
      throw error;
    });
  }

  async _sendOnce(action, params = {}, timeoutMs = 30000) {
    if (!this.process || !this.isReady) {
      // Try to start if not running
      const started = await this.start();
      if (!started) {
        throw new Error('MusicKit helper not available');
      }
    }

    return new Promise((resolve, reject) => {
      const id = `req_${++this.requestId}`;
      const request = {
        id,
        action,
        params
      };

      // Store pending request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${action}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      // Send request
      const json = JSON.stringify(request) + '\n';
      this.process.stdin.write(json);
    });
  }

  /**
   * Stop the helper process
   */
  stop() {
    if (this.process) {
      console.log('[MusicKit] Stopping helper');
      try {
        this.process.stdin.write(JSON.stringify({ id: 'quit', action: 'quit', params: {} }) + '\n');
      } catch (e) {
        // Ignore write errors
      }
      setTimeout(() => {
        if (this.process) {
          this.process.kill();
          this.process = null;
        }
      }, 500);
    }
    this.isReady = false;
    this.rejectAllPending('MusicKit helper stopped');
  }

  // High-level API methods

  /**
   * Check authorization status (updates cache)
   */
  async checkAuthStatus() {
    const result = await this.send('checkAuthStatus');
    // Update cache
    this._authStatus = result;
    this._authCheckedAt = Date.now();
    this.emit('authStatusChanged', result);
    return result;
  }

  /**
   * Get authorization status, using cache if valid
   * @param {boolean} forceRefresh - Force a fresh check even if cached
   */
  async getAuthStatus(forceRefresh = false) {
    // Return cached if valid and not forcing refresh
    if (!forceRefresh) {
      const cached = this.getCachedAuthStatus();
      if (cached) {
        console.log('[MusicKit] Using cached auth status:', cached);
        return cached;
      }
    }
    // Otherwise fetch fresh
    return this.checkAuthStatus();
  }

  /**
   * Request authorization (updates cache).
   * Authorization is the most crash-prone MusicKit operation (the system
   * dialog can trigger AppKit/XPC assertions in the headless helper), so
   * we add an extra retry on top of send()'s built-in single retry.
   */
  async authorize() {
    // Use a longer timeout for authorize since it requires user interaction
    // (Apple ID sign-in dialog with potential 2FA)
    const attempt = async () => {
      const result = await this.send('authorize', {}, 300000);
      this._authStatus = result;
      this._authCheckedAt = Date.now();
      this.emit('authStatusChanged', result);
      return result;
    };

    try {
      return await attempt();
    } catch (firstError) {
      // send() already retried once.  For authorize specifically, try one
      // more time with a longer settle delay — the activation-policy change
      // that triggers the crash is transient and often works on a second
      // cold start of the helper.
      if (firstError.message && (
        firstError.message.includes('MusicKit helper exited') ||
        firstError.message.includes('MusicKit internal error') ||
        firstError.message.includes('MusicKit helper not available')
      )) {
        console.log('[MusicKit] Authorization crashed twice, final retry after longer delay');
        await new Promise(r => setTimeout(r, 3000));
        try {
          return await attempt();
        } catch (secondError) {
          // Wrap with a user-friendly message while preserving the original
          const detail = secondError.message || 'unknown error';
          throw new Error(
            `Apple Music authorization failed after multiple attempts. ` +
            `You can enable access manually: open System Settings \u2192 ` +
            `Privacy & Security \u2192 Media & Apple Music, toggle Parachord on, ` +
            `then click Connect again. (${detail})`
          );
        }
      }
      throw firstError;
    }
  }

  async fetchUserToken(developerToken) {
    // User token fetch may require authorization, use longer timeout
    return this.send('fetchUserToken', { developerToken }, 300000);
  }

  async search(query, limit = 25) {
    return this.send('search', { query, limit });
  }

  async resolve(artist, title, album = null) {
    return this.send('resolve', { artist, title, album });
  }

  async play(songId) {
    try {
      const result = await this.send('play', { songId });
      return result;
    } catch (error) {
      // If play fails, invalidate auth cache so next call re-checks
      // This handles cases where auth was revoked mid-session
      console.log('[MusicKit] Play failed, invalidating auth cache:', error.message);
      this.invalidateAuthCache();
      throw error;
    }
  }

  async pause() {
    return this.send('pause');
  }

  async resume() {
    return this.send('resume');
  }

  async stop_playback() {
    return this.send('stop');
  }

  async skipToNext() {
    return this.send('skipToNext');
  }

  async skipToPrevious() {
    return this.send('skipToPrevious');
  }

  async seek(position) {
    // Ensure position serializes as a JSON float, not an integer.
    // Swift's AnyCodable decodes "30" as Int, and `as? Double` fails,
    // so whole-number positions silently fail.  Adding a tiny epsilon
    // forces JSON.stringify to emit a decimal (e.g. "30.0000001").
    const safePosition = Number.isInteger(position) ? position + 1e-7 : position;
    return this.send('seek', { position: safePosition });
  }

  async getPlaybackState() {
    return this.send('getPlaybackState');
  }

  async getNowPlaying() {
    return this.send('getNowPlaying');
  }

  async addToQueue(songId) {
    try {
      return await this.send('addToQueue', { songId });
    } catch (error) {
      console.log('[MusicKit] addToQueue failed, invalidating auth cache:', error.message);
      this.invalidateAuthCache();
      throw error;
    }
  }

  async setVolume(volume) {
    return this.send('setVolume', { volume });
  }

  async ping() {
    return this.send('ping');
  }
}

// Singleton instance
let instance = null;

function getMusicKitBridge() {
  if (!instance) {
    instance = new MusicKitBridge();
  }
  return instance;
}

module.exports = { MusicKitBridge, getMusicKitBridge };

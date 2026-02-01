/**
 * MusicKit Bridge - Electron side
 *
 * Communicates with the native Swift MusicKit helper via stdin/stdout JSON
 */

const { spawn } = require('child_process');
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
  }

  /**
   * Get the path to the MusicKit helper binary
   */
  getHelperPath() {
    const isDev = process.env.NODE_ENV === 'development' || !process.resourcesPath;

    // Try multiple locations - prioritize build directory during development
    // (the ad-hoc signed binary works, but re-signed with developer cert gets killed by macOS)
    const possiblePaths = [
      // Development: use Swift build output directly (ad-hoc signed, works)
      path.join(__dirname, 'native', 'musickit-helper', '.build', 'release', 'musickit-helper'),
      // Fallback to resources
      path.join(__dirname, 'resources', 'bin', 'darwin', 'musickit-helper'),
      // Production path (inside app bundle)
      path.join(process.resourcesPath || __dirname, 'bin', 'darwin', 'musickit-helper'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
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
        this.emit('close', code);
      });

      this.process.on('exit', (code, signal) => {
        console.log('[MusicKit] Process exit with code:', code, 'signal:', signal);
      });

      // Wait for ready signal
      const readyTimeout = setTimeout(() => {
        if (!this.isReady) {
          console.log('[MusicKit] Timeout waiting for ready signal');
          console.log('[MusicKit] Buffer contents:', this.buffer);
          console.log('[MusicKit] Process still alive:', this.process && !this.process.killed);
          this.stop();
          resolve(false);
        }
      }, 10000);

      this.once('ready', () => {
        clearTimeout(readyTimeout);
        console.log('[MusicKit] Helper ready');
        resolve(true);
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
   * Send a command to the helper
   */
  async send(action, params = {}) {
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
      }, 30000);

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
    this.pendingRequests.clear();
  }

  // High-level API methods

  async checkAuthStatus() {
    return this.send('checkAuthStatus');
  }

  async authorize() {
    return this.send('authorize');
  }

  async search(query, limit = 25) {
    return this.send('search', { query, limit });
  }

  async resolve(artist, title, album = null) {
    return this.send('resolve', { artist, title, album });
  }

  async play(songId) {
    return this.send('play', { songId });
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
    return this.send('seek', { position });
  }

  async getPlaybackState() {
    return this.send('getPlaybackState');
  }

  async getNowPlaying() {
    return this.send('getNowPlaying');
  }

  async addToQueue(songId) {
    return this.send('addToQueue', { songId });
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

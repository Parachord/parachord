const fs = require('fs');
const path = require('path');

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = new Map();
    this._writeTimer = null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        for (const [key, value] of Object.entries(parsed)) {
          this.data.set(key, value);
        }
      }
    } catch (err) {
      console.error('[Store] Failed to load:', err.message);
    }
  }

  _scheduleWrite() {
    if (this._writeTimer) return;
    this._writeTimer = setTimeout(() => {
      this._writeTimer = null;
      this._flush();
    }, 200);
  }

  _flush() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const obj = Object.fromEntries(this.data);
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2));
    } catch (err) {
      console.error('[Store] Failed to write:', err.message);
    }
  }

  get(key, defaultValue = undefined) {
    return this.data.has(key) ? this.data.get(key) : defaultValue;
  }

  set(key, value) {
    this.data.set(key, value);
    this._scheduleWrite();
  }

  delete(key) {
    this.data.delete(key);
    this._scheduleWrite();
  }

  has(key) {
    return this.data.has(key);
  }

  clear() {
    this.data.clear();
    this._scheduleWrite();
  }

  /**
   * Force an immediate sync write (useful before shutdown)
   */
  flushSync() {
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
    this._flush();
  }
}

module.exports = Store;

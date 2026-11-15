// main-process/ipc/public-fetch.js: the renderer's door to
// main-process/public-fetch.js. It takes a profile NAME
// ('hosted-playlist', 'protocol-tracklist', 'soundcloud-short') and never
// limits, so the renderer can't widen the caps or allow private hops.
// Optional request headers are passed through as plain strings only.

const { fetchPublic, PROFILES } = require('../public-fetch');

// A desktop browser's UA: some hosts refuse Node's default one.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

function plainHeaders(input) {
  const out = { 'User-Agent': USER_AGENT };
  if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      if (typeof key === 'string' && typeof value === 'string') out[key] = value;
    }
  }
  return out;
}

function registerPublicFetchIpc({ ipcMain, fetchImpl = (...args) => fetch(...args) }) {
  ipcMain.handle('public-fetch', async (_event, url, profileName, options = {}) => {
    const profile = typeof profileName === 'string' && Object.prototype.hasOwnProperty.call(PROFILES, profileName)
      ? PROFILES[profileName]
      : null;
    if (!profile) return { success: false, error: 'Unknown fetch profile' };
    try {
      const result = await fetchPublic(url, { ...profile, headers: plainHeaders(options && options.headers), fetchImpl });
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: (error && error.message) || 'Fetch failed' };
    }
  });
}

module.exports = { registerPublicFetchIpc };

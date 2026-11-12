/**
 * Apple Music while iTunes is refusing (2026-11-12): the host's iTunes
 * fallback throws instead of answering "no results" (an empty answer is
 * cached as Apple Music having no match), and the plugin's per-album search
 * cache lets go of a failed search so the album's other tracks ask again.
 */
const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/applemusic.axe'), 'utf8'));
const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

function instantiate(axeContent) {
  const { manifest, capabilities, implementation } = axeContent;
  const resolver = {
    id: manifest.id,
    name: manifest.name,
    capabilities,
    ...Object.fromEntries(
      Object.entries(implementation).map(([k, src]) => [k, new Function('return ' + src)()])
    )
  };
  for (const key of Object.keys(implementation)) {
    const original = resolver[key];
    resolver[key] = function (...args) { return original.call(resolver, ...args); };
  }
  return resolver;
}

describe('Apple Music fails fast while iTunes refuses', () => {
  afterEach(() => { delete global.window; });

  test('the host iTunes fallback throws on a non-OK answer, never returns "no results"', () => {
    const fn = app.slice(app.indexOf('window.appleMusicSearchWithMusicKit = '), app.indexOf('window.appleMusicLookupSong = '));
    const fallback = fn.slice(fn.indexOf('// 3. Fall back to iTunes Search API'));
    const notOk = fallback.slice(fallback.indexOf('if (!response.ok) {'), fallback.indexOf('const data = await response.json();'));
    expect(notOk).toContain("err.name = 'AppleMusicSearchUnavailable';");
    expect(notOk).toContain('throw err;');
    expect(notOk).not.toContain('return [];');
  });

  test('the iTunes queue is the circuit-breaking module', () => {
    expect(app).toContain("window.iTunesRateLimiter = require('./lib/itunes-rate-limiter').createITunesRateLimiter();");
  });

  test('a failed album search leaves the pending map, and the next track on the album asks again', async () => {
    let calls = 0;
    const refused = Object.assign(new Error('iTunes search failed: 403'), { name: 'AppleMusicSearchUnavailable' });
    global.window = {
      appleMusicSearchWithMusicKit: async (query) => {
        calls++;
        if (calls <= 1) throw refused;
        return [{ id: 'applemusic-1', title: 'Uprising', artist: 'Muse', album: 'The Resistance' }];
      }
    };
    const resolver = instantiate(axe);
    await expect(resolver.resolve('Muse', 'Uprising', 'The Resistance', {})).rejects.toBe(refused);
    expect(Object.keys(global.window._amAlbumPending)).toHaveLength(0);
    // The next resolve on the album searches again (not the dead promise).
    const hit = await resolver.resolve('Muse', 'Uprising', 'The Resistance', {});
    expect(hit).toMatchObject({ title: 'Uprising', artist: 'Muse' });
    expect(calls).toBe(2);
  });

  test('search rethrows instead of answering "no results", on the host path and the plugin\'s own iTunes fallback', async () => {
    const refused = Object.assign(new Error('iTunes search failed: 403'), { name: 'AppleMusicSearchUnavailable' });
    global.window = { appleMusicSearchWithMusicKit: async () => { throw refused; } };
    await expect(instantiate(axe).search('Muse Uprising', {})).rejects.toBe(refused);

    global.window = { iTunesRateLimiter: { fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }) } };
    await expect(instantiate(axe).search('Muse Uprising', {})).rejects.toMatchObject({ name: 'AppleMusicSearchUnavailable', status: 403 });
  });

  test('a real "no results" is still an empty answer', async () => {
    global.window = { appleMusicSearchWithMusicKit: async () => [] };
    await expect(instantiate(axe).search('zzzz qqqq', {})).resolves.toEqual([]);
    await expect(instantiate(axe).resolve('Nobody', 'Nothing', null, {})).resolves.toBeNull();
  });
});

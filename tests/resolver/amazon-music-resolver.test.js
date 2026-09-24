/**
 * Amazon Music resolver tests (parachord#988).
 *
 * Covers the .axe resolver surface:
 *   - structural validity (manifest/capabilities/implementation compile)
 *   - search result mapping (bridge -> resolver track shape)
 *   - resolve() containment matching (best match, not just first result)
 *   - play() app-not-managed flow (manage prompt + retry)
 *   - byte-identical FALLBACK_RESOLVERS copy in app.js (drift guard)
 *   - resolver-limiter skip set includes amazonmusic (local CDP IPC)
 */

const fs = require('fs');
const path = require('path');

const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/amazonmusic.axe'), 'utf8'));

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
  // Bind `this` the way resolver-loader.js does so this.search works inside resolve/play
  for (const key of Object.keys(implementation)) {
    const original = resolver[key];
    resolver[key] = function (...args) { return original.call(resolver, ...args); };
  }
  return resolver;
}

describe('amazonmusic .axe structure', () => {
  test('manifest identifies the resolver', () => {
    expect(axe.manifest.id).toBe('amazonmusic');
    expect(axe.manifest.version).toBe('1.0.0');
  });

  test('declares streaming capabilities without auth', () => {
    expect(axe.capabilities).toEqual(
      expect.objectContaining({ resolve: true, search: true, stream: true })
    );
    expect(axe.settings.requiresAuth).toBe(false);
    expect(axe.urlPatterns).toEqual([]);
  });

  test('implementation functions compile', () => {
    for (const [key, src] of Object.entries(axe.implementation)) {
      expect(() => new Function('return ' + src)()).not.toThrow();
      expect(typeof new Function('return ' + src)()).toBe('function');
    }
    expect(Object.keys(axe.implementation).sort()).toEqual(
      ['cleanup', 'init', 'play', 'resolve', 'search'].sort()
    );
  });
});

describe('amazonmusic search', () => {
  let bridgeResults;

  beforeEach(() => {
    bridgeResults = {
      success: true,
      tracks: [
        { asin: 'B000SNWG5Q', uniqueId: 'ML-abc', title: 'Around the World', artist: 'Daft Punk', album: 'Homework', duration: 430, genre: 'Electronic', explicit: false },
        { asin: 'B07XLSKGGK', uniqueId: 'ML-def', title: 'Master of Puppets (Remastered)', artist: 'Metallica', album: 'Master of Puppets', duration: 515, genre: 'Metal', explicit: false }
      ]
    };
    global.window = {
      electron: {
        amazonMusic: {
          searchTracks: jest.fn().mockResolvedValue(bridgeResults),
          playTrack: jest.fn().mockResolvedValue({ success: true })
        }
      }
    };
  });

  afterEach(() => {
    delete global.window;
  });

  test('maps bridge tracks to the resolver track shape', async () => {
    const resolver = instantiate(axe);
    const results = await resolver.search('daft punk around the world', {});
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({
      id: 'amazonmusic-B000SNWG5Q',
      title: 'Around the World',
      artist: 'Daft Punk',
      album: 'Homework',
      duration: 430,
      sources: ['amazonmusic'],
      amazonAsin: 'B000SNWG5Q',
      amazonUniqueId: 'ML-abc',
      explicit: false
    }));
  });

  test('returns [] when the app is not under management', async () => {
    global.window.electron.amazonMusic.searchTracks.mockResolvedValue({
      success: false, reason: 'app-not-managed'
    });
    const resolver = instantiate(axe);
    expect(await resolver.search('anything', {})).toEqual([]);
  });

  test('returns [] on short queries', async () => {
    const resolver = instantiate(axe);
    expect(await resolver.search('d', {})).toEqual([]);
    expect(global.window.electron.amazonMusic.searchTracks).not.toHaveBeenCalled();
  });
});

describe('amazonmusic resolve', () => {
  beforeEach(() => {
    global.window = {
      electron: {
        amazonMusic: {
          searchTracks: jest.fn().mockResolvedValue({
            success: true,
            tracks: [
              // Deliberately not the target first — resolve must pick by containment
              { asin: 'B1', uniqueId: 'ML-1', title: 'The Game of Love', artist: 'Daft Punk', album: 'RAM', duration: 322 },
              { asin: 'B2', uniqueId: 'ML-2', title: 'Around the World', artist: 'Daft Punk', album: 'Homework', duration: 430 },
              { asin: 'B3', uniqueId: 'ML-3', title: 'Around the World (Live)', artist: 'Some Cover Band', album: 'Covers', duration: 400 }
            ]
          })
        }
      }
    };
  });

  afterEach(() => {
    delete global.window;
  });

  test('picks the first containment match (artist AND title), not just the top hit', async () => {
    const resolver = instantiate(axe);
    const match = await resolver.resolve('Daft Punk', 'Around the World', null, {});
    expect(match).toBeTruthy();
    expect(match.amazonAsin).toBe('B2');
  });

  test('falls back to null when nothing matches', async () => {
    global.window.electron.amazonMusic.searchTracks.mockResolvedValue({ success: true, tracks: [] });
    const resolver = instantiate(axe);
    expect(await resolver.resolve('Nobody', 'Nothing', null, {})).toBeNull();
  });
});

describe('amazonmusic play', () => {
  let managePrompt;

  beforeEach(() => {
    managePrompt = jest.fn().mockResolvedValue(true);
    global.window = {
      electron: {
        amazonMusic: {
          playTrack: jest.fn().mockResolvedValue({ success: true })
        }
      },
      __parachordManageAmazonMusic: managePrompt
    };
  });

  afterEach(() => {
    delete global.window;
  });

  test('plays by ASIN', async () => {
    const resolver = instantiate(axe);
    const ok = await resolver.play({ amazonAsin: 'B000SNWG5Q', title: 'Around the World', artist: 'Daft Punk' }, {});
    expect(ok).toBe(true);
    expect(global.window.electron.amazonMusic.playTrack).toHaveBeenCalledWith({
      asin: 'B000SNWG5Q', title: 'Around the World', artist: 'Daft Punk'
    });
  });

  test('app-not-managed triggers the manage prompt and retries once', async () => {
    global.window.electron.amazonMusic.playTrack
      .mockResolvedValueOnce({ success: false, reason: 'app-not-managed' })
      .mockResolvedValueOnce({ success: true });
    const resolver = instantiate(axe);
    const ok = await resolver.play({ amazonAsin: 'B1', title: 'T', artist: 'A' }, {});
    expect(ok).toBe(true);
    expect(managePrompt).toHaveBeenCalledTimes(1);
    expect(global.window.electron.amazonMusic.playTrack).toHaveBeenCalledTimes(2);
  });

  test('declined manage prompt returns false without retrying', async () => {
    managePrompt.mockResolvedValue(false);
    global.window.electron.amazonMusic.playTrack.mockResolvedValue({ success: false, reason: 'app-not-managed' });
    const resolver = instantiate(axe);
    const ok = await resolver.play({ amazonAsin: 'B1', title: 'T', artist: 'A' }, {});
    expect(ok).toBe(false);
    expect(global.window.electron.amazonMusic.playTrack).toHaveBeenCalledTimes(1);
  });

  test('no ASIN on the track returns false', async () => {
    const resolver = instantiate(axe);
    expect(await resolver.play({ title: 'T', artist: 'A' }, {})).toBe(false);
    expect(global.window.electron.amazonMusic.playTrack).not.toHaveBeenCalled();
  });
});

describe('app.js FALLBACK_RESOLVERS parity', () => {
  test('the inline amazonmusic fallback is byte-identical to plugins/amazonmusic.axe', () => {
    const appSrc = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
    const m = appSrc.match(/\{"manifest":\{"id":"amazonmusic"[\s\S]*?\}\},\n/);
    expect(m).toBeTruthy();
    const fallback = JSON.parse(m[0].replace(/,\n$/, ''));
    expect(fallback).toEqual(axe);
  });

  test('amazonmusic is in the canonical resolver order', () => {
    const appSrc = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
    const m = appSrc.match(/const CANONICAL_RESOLVER_ORDER = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const order = m[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
    expect(order).toContain('amazonmusic');
    // Positioned with the streaming services, before localfiles
    expect(order.indexOf('amazonmusic')).toBeGreaterThan(order.indexOf('applemusic'));
    expect(order.indexOf('amazonmusic')).toBeLessThan(order.indexOf('localfiles'));
  });
});

describe('resolver limiter skip set', () => {
  test('amazonmusic searches are not wrapped by the global resolver limiter (local CDP IPC)', () => {
    const { RESOLVER_LIMITER_SKIP_IDS } = require('../../resolver-limiter');
    expect(RESOLVER_LIMITER_SKIP_IDS.has('amazonmusic')).toBe(true);
  });
});

describe('marketplace manifest entry', () => {
  test('marketplace-manifest.json lists amazonmusic at the matching version', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../marketplace-manifest.json'), 'utf8'));
    const entry = (manifest.plugins || []).find(p => p.id === 'amazonmusic');
    expect(entry).toBeTruthy();
    expect(entry.version).toBe(axe.manifest.version);
    expect(entry.builtin).toBe(true);
  });
});

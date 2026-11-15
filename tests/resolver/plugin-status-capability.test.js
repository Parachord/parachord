/**
 * The plugin-status capability (capabilities.status, #1356): a plugin that
 * can report its own sign-in/playback-limit state implements
 * getStatus(config) -> { signedIn, playbackLimit, statusLabel, statusMessage },
 * and the renderer asks it through the resolver registry — direct,
 * renderer-side, no new IPC. One reply feeds every consumer: the playback
 * limit map (lib/playback-limits.js pluginStatusLimit), the resolver tile
 * (tileStatus) and the Settings sign-in row (pluginStatusRow).
 *
 * The no-throw contract: a plugin whose getStatus throws is logged and
 * treated as NO status, never as a blocked resolver — a status outage must
 * not unplug playback (resolver-loader.js getStatus). No shipped plugin
 * declares the capability yet; Amazon migrates onto it in a later #1356
 * milestone, so nothing here may change behavior for an existing resolver.
 */

const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');
const PlaybackLimits = require('../../src/renderer/lib/playback-limits');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const fake = (id, extra = {}) => ({ id, name: id, capabilities: {}, config: {}, ...extra });
const loaderWith = (resolvers) => {
  const loader = new ResolverLoader();
  for (const r of resolvers) loader.resolvers.set(r.id, r);
  return loader;
};

describe('ResolverLoader status', () => {
  test('getStatusResolvers lists only resolvers that declare and implement it', () => {
    const loader = loaderWith([
      fake('awesomemusic', { capabilities: { status: true }, getStatus: async () => ({ signedIn: true }) }),
      fake('oldplugin', { capabilities: { status: true } }), // the flag without the method
      fake('methodonly', { getStatus: async () => ({ signedIn: true }) }), // the method without the flag
      fake('bandcamp'),
    ]);
    expect(loader.getStatusResolvers().map(r => r.id)).toEqual(['awesomemusic']);
  });

  test('getStatus answers null for a resolver without the capability, and passes the config through', async () => {
    const getStatus = jest.fn(async (config) => ({ signedIn: true, config }));
    const loader = loaderWith([fake('awesomemusic', { capabilities: { status: true }, getStatus })]);
    expect(await loader.getStatus('awesomemusic', { token: 't' })).toEqual({ signedIn: true, config: { token: 't' } });
    expect(getStatus).toHaveBeenCalledWith({ token: 't' });
    // No override: the resolver's stored config.
    loader.getResolver('awesomemusic').config = { stored: true };
    await loader.getStatus('awesomemusic');
    expect(getStatus).toHaveBeenLastCalledWith({ stored: true });
    // A resolver that doesn't declare it (or isn't loaded): no status.
    expect(await loader.getStatus('bandcamp', {})).toBeNull();
    expect(await loader.getStatus('nope', {})).toBeNull();
    const flagOnly = loaderWith([fake('oldplugin', { capabilities: { status: true } })]);
    expect(await flagOnly.getStatus('oldplugin', {})).toBeNull();
  });

  test('an answer that is not an object is no status', async () => {
    for (const answer of [null, 'signed-in', 42]) {
      const loader = loaderWith([fake('awesomemusic', { capabilities: { status: true }, getStatus: async () => answer })]);
      expect(await loader.getStatus('awesomemusic', {})).toBeNull();
    }
  });

  test('a throwing getStatus is logged and answered null — never a blocked resolver', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const loader = loaderWith([fake('awesomemusic', {
        capabilities: { status: true },
        getStatus: async () => { throw new Error('503 from the service'); },
      })]);
      expect(await loader.getStatus('awesomemusic', {})).toBeNull();
      // The message only: a config can carry a token.
      expect(error).toHaveBeenCalledWith('Status error for awesomemusic:', '503 from the service');
      // No status is not a limit: the resolver stays in playback.
      const limits = { awesomemusic: PlaybackLimits.pluginStatusLimit(null) };
      expect(PlaybackLimits.planBlockedIds(limits)).toEqual([]);
      expect(PlaybackLimits.playbackResolverIds(['awesomemusic', 'bandcamp'], [])).toEqual(['awesomemusic', 'bandcamp']);
    } finally {
      error.mockRestore();
    }
  });

  test('a real .axe load: the serialized getStatus runs through the loader like a shipped plugin', async () => {
    // build-axes serializes each method with String(fn); the loader
    // evaluates it. This is the path a shipped plugin takes, which the fake
    // resolvers above bypass. (The serialized method can close over nothing
    // — a real plugin's helpers live on this.lib.)
    const reply = {
      signedIn: true,
      playbackLimit: { blocked: true, planKey: 'free', label: 'Free: no playback', message: 'Playing needs Awesome Premium.', searchesHeldBack: true },
      statusLabel: 'Free plan',
      statusMessage: 'Playing needs Awesome Premium.'
    };
    const loader = new ResolverLoader();
    await loader.loadResolver({
      manifest: { id: 'awesomemusic', name: 'Awesome Music', version: '1.0.0' },
      capabilities: { resolve: true, search: true, status: true },
      implementation: { getStatus: String(async function (config) {
        return {
          signedIn: true,
          playbackLimit: { blocked: true, planKey: 'free', label: 'Free: no playback', message: 'Playing needs Awesome Premium.', searchesHeldBack: true },
          statusLabel: 'Free plan',
          statusMessage: 'Playing needs Awesome Premium.'
        };
      }) }
    });
    expect(loader.getStatusResolvers().map(r => r.id)).toEqual(['awesomemusic']);
    expect(await loader.getStatus('awesomemusic')).toEqual(reply);
  });
});

describe('a status reply feeds the playback limit map and the tile', () => {
  // The app-side aggregation: the per-service mappers plus every
  // plugin-reported status, exactly as app.js builds playbackLimits.
  const aggregate = (pluginStatuses) => ({
    soundcloud: null,
    ...Object.fromEntries(Object.entries(pluginStatuses).map(
      ([id, status]) => [id, PlaybackLimits.pluginStatusLimit(status)]
    )),
  });

  const blockedReply = {
    signedIn: true,
    playbackLimit: {
      blocked: true,
      planKey: 'free',
      label: 'Free: no playback',
      message: 'Awesome Free: Awesome is used for search and links. Playing Awesome tracks in Parachord needs Awesome Premium.',
      searchesHeldBack: true
    },
    statusLabel: 'Free plan',
    statusMessage: 'Playing needs Awesome Premium.'
  };

  test('a blocked reply leaves playback, and says so on the tile and the panel', async () => {
    const getStatus = jest.fn(async () => blockedReply);
    const loader = loaderWith([fake('awesomemusic', { capabilities: { status: true }, getStatus })]);
    const statuses = { awesomemusic: await loader.getStatus('awesomemusic') };
    expect(statuses.awesomemusic).toBe(blockedReply);

    const limits = aggregate(statuses);
    expect(PlaybackLimits.planBlockedIds(limits)).toEqual(['awesomemusic']);
    expect(PlaybackLimits.playbackResolverIds(['awesomemusic', 'bandcamp'], ['awesomemusic'])).toEqual(['bandcamp']);
    expect(PlaybackLimits.tileStatus(limits, 'awesomemusic')).toEqual({
      statusLabel: 'Free: no playback',
      statusTitle: 'Awesome Free: Awesome is used for search and links. Playing Awesome tracks in Parachord needs Awesome Premium.'
    });
    expect(PlaybackLimits.limitMessage(limits, 'awesomemusic')).toMatch(/Awesome Premium/);
    // The upgrade re-search rule reads a plugin reply like any other limit:
    // blocked stays blocked, and blocked with searches held back, then
    // playable, searches again.
    expect(PlaybackLimits.limitTransition('1', limits.awesomemusic)).toEqual({ reresolve: false, store: '1' });
    const upgraded = PlaybackLimits.pluginStatusLimit({ playbackLimit: { blocked: false, planKey: 'premium', searchesHeldBack: true } });
    expect(PlaybackLimits.limitTransition('1', upgraded)).toEqual({ reresolve: true, store: '0' });
  });

  test('a playable reply changes nothing, and an unreported plan is no verdict', async () => {
    const loader = loaderWith([
      fake('awesomemusic', { capabilities: { status: true }, getStatus: async () => ({ signedIn: true, playbackLimit: { blocked: false, planKey: 'premium', searchesHeldBack: false }, statusLabel: 'Premium', statusMessage: null }) }),
    ]);
    const limits = aggregate({ awesomemusic: await loader.getStatus('awesomemusic') });
    expect(PlaybackLimits.planBlockedIds(limits)).toEqual([]);
    // A plugin that answers no limit (signed in, nothing to say): no entry.
    const none = aggregate({ awesomemusic: { signedIn: true, playbackLimit: null, statusLabel: 'Signed in', statusMessage: null } });
    expect(PlaybackLimits.planBlockedIds(none)).toEqual([]);
  });
});

describe('wiring', () => {
  const app = read('src', 'renderer', 'app.js');
  const loader = read('resolver-loader.js');

  // Slice from a needle to the first following end marker (both must exist).
  const between = (src, start, end) => {
    const i = src.indexOf(start);
    expect(i).toBeGreaterThan(-1);
    const j = src.indexOf(end, i + start.length);
    expect(j).toBeGreaterThan(i);
    return src.slice(i, j);
  };

  test('the app asks the registry, direct — no new IPC channel', () => {
    expect(loader).toContain('getStatusResolvers() {');
    expect(loader).toContain('async getStatus(resolverId, configOverride = null) {');
    // The refresh path routes through the loader only; the plugin's reply
    // never crosses the electron bridge (Amazon's own IPC status — untouched
    // by this surface — is the one getStatus that does).
    const readPath = between(app, 'const refreshPluginStatus = (resolverId) => {', '\n  };');
    expect(readPath).not.toMatch(/window\.electron/);
  });

  test('one reply feeds the limit map: plugin entries merge with the per-service mappers', () => {
    const memo = app.slice(app.indexOf('const playbackLimits = useMemo(() => ({'), app.indexOf('}), [amazonMusicStatus'));
    expect(memo).toContain('amazonmusic: PlaybackLimits.amazonPlaybackLimit(amazonMusicStatus)');
    expect(memo).toMatch(/Object\.fromEntries\(Object\.entries\(pluginStatuses\)\.map\(/);
    expect(memo).toContain('PlaybackLimits.pluginStatusLimit(status)');
    // The memo recomputes when a reply lands.
    expect(app).toMatch(/\}\), \[amazonMusicStatus, appleMusicAuthChecked, appleMusicConnected, pluginStatuses\]\);/);
  });

  test('the trigger set is the Amazon status\u2019s own: startup, Settings, the panel, a plan refusal', () => {
    expect(app).toContain('const refreshPluginStatuses = () => {');
    // Startup (including after the resolver registry lands — it races the
    // caches) + Settings open + an enable (the toggle lives in Settings,
    // where the guard passes — Amazon's amazonMusicEnabled dep).
    const effect = between(app, 'const havePluginStatuses =', '}, [cacheLoaded, activeView, havePluginStatuses, loadedResolvers, activeResolvers]);');
    expect(effect).toContain("if (activeView !== 'settings' && havePluginStatuses) return;");
    expect(effect).toContain('refreshPluginStatuses();');
    // The resolver detail panel re-reads the resolver it opens.
    const modal = between(app, "if (!(selectedResolver.capabilities?.status && typeof selectedResolver.getStatus === 'function')) return;", '}, [selectedResolver]);');
    expect(modal).toContain('refreshPluginStatus(selectedResolver.id);');
    // A play refused for the plan re-reads the refusing plugin's status.
    const note = between(app, 'window.__parachordNotePlanRefusal = (resolverId, planKey) => {', '\n  };');
    expect(note).toContain('refreshPluginStatus(resolverId);');
    // Amazon's own status path stays untouched by this surface.
    expect(app).toMatch(/window\.electron\.amazonMusic\.getStatus\(\{ refreshPlan: true \}\)/);
  });

  test('the Settings sign-in row shows for a status-capable resolver, generic and display-only', () => {
    const row = between(app, "A status-capable plugin's sign-in row", '// Authentication section (for services that require it)');
    expect(row).toContain('selectedResolver?.capabilities?.status && typeof selectedResolver.getStatus === \'function\'');
    expect(row).toContain('PlaybackLimits.pluginStatusRow(pluginStatuses[selectedResolver.id])');
    // The capabilities chip is labelled, not a raw id.
    expect(app).toContain("status: 'Status'");
  });

  test('no shipped plugin declares the capability yet — Amazon\u2019s migration flips it', () => {
    const manifests = fs.readdirSync(path.join(ROOT, 'plugins-src'))
      .filter(d => fs.existsSync(path.join(ROOT, 'plugins-src', d, 'manifest.json')));
    expect(manifests.length).toBeGreaterThan(0);
    for (const dir of manifests) {
      const axe = JSON.parse(read('plugins-src', dir, 'manifest.json'));
      expect(`${dir}: ${axe.capabilities?.status}`).toBe(`${dir}: undefined`);
    }
  });
});

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
 * not unplug playback (resolver-loader.js getStatus). Amazon Music declares
 * the capability since #1356 M10 (its reply's mapping is pinned in
 * tests/resolver/amazon-music-plugin-session.test.js); the wiring pins here
 * follow the plugin entries feeding the same map the old per-service mappers
 * fed.
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

  test('an answer that is not an object is a failed read — the marker, not the plugin\u2019s reply', async () => {
    for (const answer of [null, 'signed-in', 42]) {
      const loader = loaderWith([fake('awesomemusic', { capabilities: { status: true }, getStatus: async () => answer })]);
      expect(await loader.getStatus('awesomemusic', {})).toBe(ResolverLoader.STATUS_READ_FAILED);
    }
  });

  test('a throwing getStatus is logged and answered the failed marker — never a blocked resolver', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const loader = loaderWith([fake('awesomemusic', {
        capabilities: { status: true },
        getStatus: async () => { throw new Error('503 from the service'); },
      })]);
      expect(await loader.getStatus('awesomemusic', {})).toBe(ResolverLoader.STATUS_READ_FAILED);
      // The message only: a config can carry a token.
      expect(error).toHaveBeenCalledWith('Status error for awesomemusic:', '503 from the service');
      // A failed read is not a limit: the resolver stays in playback.
      const limits = { awesomemusic: PlaybackLimits.pluginStatusLimit(ResolverLoader.STATUS_READ_FAILED) };
      expect(PlaybackLimits.planBlockedIds(limits)).toEqual([]);
      expect(PlaybackLimits.playbackResolverIds(['awesomemusic', 'bandcamp'], [])).toEqual(['awesomemusic', 'bandcamp']);
    } finally {
      error.mockRestore();
    }
  });

  test('a getStatus that never settles answers the failed marker at the budget, while a sibling that answers lands normally', async () => {
    // One hung read must not stall the batch that read it: the budget races
    // the call (resolver-limiter.js RESOLVE_BUDGET_MS's status-side twin), so
    // the app's Promise.allSettled sweep always lands.
    jest.useFakeTimers();
    try {
      expect(ResolverLoader.STATUS_BUDGET_MS).toBe(8000);
      const reply = { signedIn: true, playbackLimit: { blocked: false, planKey: 'premium', searchesHeldBack: false } };
      const loader = loaderWith([
        fake('hungmusic', { capabilities: { status: true }, getStatus: () => new Promise(() => {}) }),
        fake('awesomemusic', { capabilities: { status: true }, getStatus: async () => reply }),
      ]);
      // The sibling answers well within the budget, untouched by the hang.
      await expect(loader.getStatus('awesomemusic')).resolves.toBe(reply);
      // The hung one: nothing before the budget, the failed marker at it.
      let settled = null;
      loader.getStatus('hungmusic').then((status) => { settled = status; });
      await jest.advanceTimersByTimeAsync(ResolverLoader.STATUS_BUDGET_MS - 1);
      expect(settled).toBeNull();
      await jest.advanceTimersByTimeAsync(1);
      expect(settled).toBe(ResolverLoader.STATUS_READ_FAILED);
      // The marker is a failed read, not a verdict: no limit for the map,
      // the honest error line for the Settings row.
      expect(PlaybackLimits.pluginStatusLimit(settled)).toBeNull();
      expect(PlaybackLimits.pluginStatusRow(settled).label).toBe("Couldn’t check");
    } finally {
      jest.useRealTimers();
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
  // The app-side aggregation, exactly as app.js builds playbackLimits: the
  // per-service mappers (soundcloud: null stands in for "no mapper") plus
  // every plugin-reported status through the null-dropping helper.
  const aggregate = (pluginStatuses) => ({
    soundcloud: null,
    ...PlaybackLimits.pluginStatusLimits(pluginStatuses)
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
    expect(PlaybackLimits.limitTransition('1', limits.awesomemusic)).toEqual({ reresolve: false, purge: false, store: '1' });
    const upgraded = PlaybackLimits.pluginStatusLimit({ playbackLimit: { blocked: false, planKey: 'premium', searchesHeldBack: true } });
    expect(PlaybackLimits.limitTransition('1', upgraded)).toEqual({ reresolve: true, purge: false, store: '0' });
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

  test('a plugin with no verdict never removes a mapper\u2019s own block', async () => {
    // The migration order: a plugin declares capabilities.status for a
    // service whose per-service mapper still feeds the map (Apple Music's
    // appleMusicPlaybackLimit today; Amazon's own mapper died with its IPC
    // status, #1356 M10). The plugin's read gives no verdict — it threw, or
    // answered without a playbackLimit — and the mapper's verdict stays: a
    // resolver the mapper blocks must not go back into playbackResolvers
    // because the plugin's status read is down (#1433 review, finding 1).
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const threw = loaderWith([fake('applemusic', {
        capabilities: { status: true },
        getStatus: async () => { throw new Error('503 from the service'); },
      })]);
      const noVerdict = loaderWith([fake('applemusic', {
        capabilities: { status: true },
        getStatus: async () => ({ signedIn: true, playbackLimit: null, statusLabel: 'Signed in', statusMessage: null }),
      })]);
      for (const loader of [threw, noVerdict]) {
        const reply = await loader.getStatus('applemusic');
        expect(reply).toBeTruthy(); // the reply or the loader's failed marker — a no-verdict entry is dropped, never spread over the mapper
        const limits = {
          applemusic: PlaybackLimits.appleMusicPlaybackLimit({ checked: true, connected: false }),
          ...PlaybackLimits.pluginStatusLimits({ applemusic: reply })
        };
        expect(PlaybackLimits.planBlockedIds(limits)).toEqual(['applemusic']);
        expect(PlaybackLimits.playbackResolverIds(['applemusic', 'spotify'], ['applemusic'])).toEqual(['spotify']);
      }
      // A plugin that DOES give a verdict still wins — the migration order:
      // the plugin is the authority for its service.
      const plugin = loaderWith([fake('applemusic', {
        capabilities: { status: true },
        getStatus: async () => ({ signedIn: true, playbackLimit: { blocked: false, planKey: 'unlimited', searchesHeldBack: true } }),
      })]);
      const limits = {
        applemusic: PlaybackLimits.appleMusicPlaybackLimit({ checked: true, connected: false }),
        ...PlaybackLimits.pluginStatusLimits({ applemusic: await plugin.getStatus('applemusic') })
      };
      expect(PlaybackLimits.planBlockedIds(limits)).toEqual([]);
    } finally {
      error.mockRestore();
    }
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
    // never crosses the electron bridge (no getStatus does anymore —
    // Amazon's IPC status died with #1356 M10).
    const readPath = between(app, 'const refreshPluginStatus = (resolverId) => {', '\n  };');
    expect(readPath).not.toMatch(/window\.electron/);
  });

  test('one reply feeds the limit map: plugin entries merge with the per-service mappers', () => {
    const mapStart = app.indexOf('const playbackLimits = useMemo(() => ({');
    const memo = app.slice(mapStart, app.indexOf('}), [', mapStart));
    expect(memo).not.toMatch(/amazonmusic:/); // Amazon's entry IS its plugin reply now
    // The plugin entries spread AFTER the mappers, through the
    // null-dropping helper: a plugin wins only when it actually gives a
    // verdict (the tests above); a no-verdict entry never lands over a
    // mapper's own.
    expect(memo).toMatch(/\.\.\.PlaybackLimits\.pluginStatusLimits\(pluginStatuses, pluginName, pluginsSignedOut\)/);
    // The memo recomputes when a reply lands.
    expect(app).toMatch(/\}\), \[appleMusicAuthChecked, appleMusicConnected, pluginStatuses, pluginsSignedOut\]\);/);
  });

  test('an uninstall drops the plugin\u2019s status entry', () => {
    const uninstall = between(app, 'const handleUninstallResolver = async (resolverId) => {', "showToast(`Removed ${displayName}`, 'success');");
    expect(uninstall).toMatch(/setPluginStatuses\(prev => \{/);
    expect(uninstall).toMatch(/delete next\[resolverId\];/);
  });

  test('a sweep in flight when an uninstall lands does not write the uninstalled plugin\u2019s entry back', () => {
    // The #1433 review's round-3 note: the batch merge ({ ...prev, ...statuses })
    // would resurrect the entry the uninstall dropped, because the reads
    // started before the uninstall. The drop holds only if the landing
    // re-checks the loaded set — in the .then, when the batch lands, not
    // just the set the sweep fired with.
    const sweep = between(app, 'const refreshPluginStatuses = () => {', '\n  };');
    const landing = between(sweep, 'Promise.allSettled(ids.map(id => loader.getStatus(id))).then((replies) => {', 'setPluginStatuses(prev => ({ ...prev, ...statuses }));');
    expect(landing).toContain('const stillLoaded = new Set((loadedResolversRef.current || []).map(r => r.id));');
    expect(landing).toMatch(/if \(!stillLoaded\.has\(id\)\) return;/);
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
    // Amazon rides this surface since M10: its own IPC status is gone, and
    // nothing else reads a status over the electron bridge.
    expect(app).not.toMatch(/window\.electron\.amazonMusic\.getStatus/);
  });

  test('the Settings sign-in row shows for a status-capable resolver, with the session triggers', () => {
    // #1451 moved the resolver detail panel's markup into its own component;
    // the row moved with the panel, and app.js feeds it the replies.
    const dialog = read('src', 'renderer', 'components', 'plugin-settings-dialog.js');
    const row = between(dialog, "A status-capable plugin's sign-in row", '// The account, for a plug-in the app signs in to itself');
    expect(row).toContain('selectedResolver?.capabilities?.status && typeof selectedResolver.getStatus === \'function\'');
    expect(row).toContain('PlaybackLimits.pluginStatusRow(pluginStatuses[selectedResolver.id])');
    // The signIn/signOut triggers ride the row when the plugin implements
    // the session methods (the web-session surface — Amazon since #1356 M10).
    expect(row).toContain('typeof selectedResolver.signOut === \'function\'');
    expect(row).toContain('typeof selectedResolver.signIn === \'function\'');
    expect(row).toContain('await selectedResolver.signOut()');
    expect(dialog).toContain('pluginStatuses,');
    // app.js feeds the dialog the replies (the call-site block, not the
    // whole file: pluginStatuses reaches several consumers).
    const callSite = between(app, 'React.createElement(PluginSettingsDialog, {', '...pluginSettingsDialogHandlers');
    expect(callSite).toContain('pluginStatuses,');
    // The capabilities chip is labelled, not a raw id (lib/capability-labels.js).
    expect(read('src', 'renderer', 'lib', 'capability-labels.js')).toContain("status: 'Status'");
  });

  test('Amazon Music declares the capability (#1356 M10); no other plugin does', () => {
    const manifests = fs.readdirSync(path.join(ROOT, 'plugins-src'))
      .filter(d => fs.existsSync(path.join(ROOT, 'plugins-src', d, 'manifest.json')));
    expect(manifests.length).toBeGreaterThan(0);
    for (const dir of manifests) {
      const axe = JSON.parse(read('plugins-src', dir, 'manifest.json'));
      expect(`${dir}: ${axe.capabilities?.status}`).toBe(`${dir}: ${dir === 'amazonmusic' ? 'true' : 'undefined'}`);
    }
    // The generated .axe and the fallback copy carry the flag and the methods.
    const shipped = JSON.parse(read('plugins', 'amazonmusic.axe'));
    expect(shipped.capabilities.status).toBe(true);
    expect(shipped.implementation.getStatus).toMatch(/^async function/);
    expect(shipped.implementation.signIn).toMatch(/^async function/);
    expect(shipped.implementation.signOut).toMatch(/^async function/);
  });
});

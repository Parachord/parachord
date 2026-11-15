/**
 * #1220: Amazon plays only on Music Unlimited. The gate itself (the plugin's
 * getPlan / assertPlanPlays / getPlaybackManifest) is behavior-tested in the
 * plugin suites; this file pins the wiring around it that lives in the
 * plugin source, main.js, the preload, and the renderer, where a unit test
 * can't reach. Since #1356 M10 the status read is the plugin's too — the
 * host's getStatus stopgap and its IPC are deleted.
 */

const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const app = read('src/renderer/app.js');
// #1356 M9: the telemetry state machine (createAmazonTelemetry) moved into
// the plugin's _lib with the DRM pair; the resourceType rule reads there.
const telemetry = read('plugins-src/amazonmusic/implementation.js');

const between = (src, start, end) => {
  const i = src.indexOf(start);
  expect(i).toBeGreaterThan(-1);
  const j = src.indexOf(end, i + start.length);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
};

// A plugin method's body: from its `name: async function` line to the exact
// two-space `},` line that closes it (the methods sit at that one indent
// level). A plain indexOf('  },\n') would stop at the first NESTED `},` with
// ≥2 leading spaces and silently truncate the scan — anything after that
// point would go unread — so the terminator is matched at the method's own
// indent, exactly.
const methodBody = (src, method) => {
  const start = src.indexOf(method);
  expect(start).toBeGreaterThan(-1);
  const end = src.slice(start).search(/\n  \},\n/);
  expect(end).toBeGreaterThan(-1);
  return src.slice(start, start + end);
};

describe('main process', () => {
  test('track search checks the plan only when signed in, before searching', () => {
    // #1356 M5: the track search (and with it the plan gate the deleted
    // amazonmusic-search-tracks handler ran) moved into the plugin —
    // plugins-src/amazonmusic/implementation.js drives the session through
    // the webSession bridge, so the ordering pin reads the plugin source.
    const impl = read('plugins-src/amazonmusic/implementation.js');
    const search = between(impl, 'search: async function', 'resolve: async function');
    const signIn = search.indexOf('if (!(await this.isSignedIn()))');
    const plan = search.indexOf('await this.assertPlanPlays();');
    const runner = search.indexOf('await this.specSearch({');
    expect(signIn).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(signIn);   // only when signed in — a signed-out search answers not-signed-in (the prompt)
    expect(plan).toBeLessThan(runner);      // and before searching
    // The refusal reaches the resolver as notReady (never a 30-day noMatch).
    expect(search).toMatch(/reason === 'plan-ineligible'/);
    // The gate is the plugin's own copy of the dmls one: config.json via the
    // webSession bridge, with the 30min/1min TTL cache.
    expect(impl).toMatch(/getPlan: async function/);
    expect(impl).toMatch(/PLAN_TTL_MS = 30 \* 60 \* 1000/);
    expect(impl).toMatch(/PLAN_UNKNOWN_TTL_MS = 60 \* 1000/);
  });

  test('album search, artist photos, lookups and playlist import do not check the plan', () => {
    // #1356 M6/M7: the album catalog flows and the playlist import moved
    // into the plugin, so the pin reads the plugin source — their methods
    // must not touch the plan gate (the plan gate stops playback, not
    // discovery) — and the IPC handlers that used to carry them are gone
    // (the plugin drives the session through the webSession bridge).
    const impl = read('plugins-src/amazonmusic/implementation.js');
    for (const method of ['searchAlbums: async function', 'searchArtistImage: async function', 'lookupAlbumFlow: async function', 'lookupPlaylistFlow: async function']) {
      expect(methodBody(impl, method)).not.toMatch(/assertPlanPlays|getPlan|plan-ineligible/);
    }
    // The handlers are deleted, and the preload no longer exposes them.
    for (const ch of ['amazonmusic-search-albums', 'amazonmusic-search-artist-image', 'amazonmusic-lookup-album', 'amazonmusic-lookup-playlist']) {
      expect(main).not.toContain(`ipcMain.handle('${ch}'`);
      expect(preload).not.toContain(`'${ch}'`);
    }
  });

  test('the plugin\u2019s getStatus reports the plan and its message once signed in; the IPC status is gone', () => {
    const impl = read('plugins-src/amazonmusic/implementation.js');
    const getStatus = between(impl, 'getStatus: async function', 'cdmAvailable: async function');
    expect(getStatus).toMatch(/plan = await this\.getPlan\(\{ refresh: true \}\)/);
    expect(getStatus).toMatch(/playbackLimit: limit/);
    // The mapping (the renderer\u2019s old amazonPlaybackLimit) is the plugin\u2019s
    // _lib copy: the message and the tile labels live next to the gate.
    expect(impl).toMatch(/function amazonPlaybackLimit\(plan\) \{/);
    expect(impl).toMatch(/prime: 'Prime: no playback'/);
    expect(impl).toMatch(/unknown: 'Plan not confirmed'/);
    // The host handlers and their preload exposures are deleted.
    for (const ch of ['amazonmusic-get-status', 'amazonmusic-open-login', 'amazonmusic-sign-out']) {
      expect(main).not.toContain(`ipcMain.handle('${ch}'`);
      expect(preload).not.toContain(`'${ch}'`);
    }
    // #1356 M11: the host-side module is deleted entirely — there is no
    // host-side getPlan to drift back in.
    expect(require('fs').existsSync(path.join(__dirname, '../..', 'amazon-web-player.js'))).toBe(false);
    expect(main).not.toMatch(/async getPlan\(/);
  });

  test('every status read is fresh \u2014 the old Settings/panel refreshPlan is the plugin\u2019s default', () => {
    // The plugin's getPlan skips its TTL cache on { refresh: true }, and
    // getStatus always passes it: the reads run on the settings path (the
    // sweep at startup, Settings open, the panel, a plan refusal), where an
    // upgrade must show at once.
    const impl = read('plugins-src/amazonmusic/implementation.js');
    expect(impl).toMatch(/getPlan: async function \(\{ refresh \} = \{\}\) \{/);
    expect(impl).toMatch(/if \(!refresh && s\) \{/);
    // The renderer asks the plugin through the registry \u2014 no IPC status.
    expect(app).toMatch(/const refreshPluginStatuses = \(\) => \{/);
    expect(app).not.toMatch(/refreshAmazonMusicStatus/);
  });

  test('the plan-change push channel is gone \u2014 the sweep is the refresh path', () => {
    expect(main).not.toContain('amazonmusic-plan-changed');
    expect(preload).not.toContain('amazonmusic-plan-changed');
    // amazon-web-player.js is deleted (#1356 M11) — nothing host-side can
    // re-grow a plan-change listener.
    expect(require('fs').existsSync(path.join(__dirname, '../..', 'amazon-web-player.js'))).toBe(false);
    expect(main).not.toContain('setPlanChangeListener');
    // The renderer re-reads the plugin\u2019s status (startup, Settings, the
    // panel, a plan refusal) and the limitTransition effect re-resolves on an
    // upgrade \u2014 pinned in tests/renderer/playback-limits.test.js.
    expect(app).toMatch(/window\.__parachordNotePlanRefusal = \(resolverId, planKey\) => \{/);
  });

  test('telemetry uses the shared Unlimited rule', () => {
    // #1356 M9: createAmazonTelemetry moved into the plugin's _lib, so the
    // rule and its derivation now share one file — the pin is that the
    // telemetry derives resourceType through isUnlimitedTier and the rule
    // itself is defined exactly once.
    expect(telemetry).toMatch(/resourceType: isUnlimitedTier\(ctx\.tier\)/);
    expect(telemetry.match(/\^UNLIMITED/g)).toHaveLength(1);
  });
});

describe('renderer', () => {
  test('background searches skip the cache but never open the sign-in dialog', () => {
    const fn = between(app, 'window.__parachordNoteAmazonNotReady = (error) => {', '\n  };');
    expect(fn).toMatch(/code === 'plan-ineligible'/);
    expect(fn).not.toMatch(/manageAmazonMusic/);
    // The only non-explicit caller was this one.
    expect(app).not.toMatch(/manageAmazonMusic\(\{ explicit: false/);
  });
  // The playback-limit wiring Amazon shares with Spotify (playbackResolvers,
  // the Settings grid, the upgrade re-search, the engine's refusal) is pinned
  // in tests/renderer/playback-limits.test.js.
});

describe('ResolverCard status label', () => {
  global.React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ResolverCard } = require('../../src/renderer/components/settings-cards');
  const resolver = { id: 'amazonmusic', name: 'Amazon Music', color: '#00A8E1', icon: 'a' };

  test('shows the label with the message as its tooltip', () => {
    const html = renderToStaticMarkup(React.createElement(ResolverCard, {
      resolver, isActive: true, needsConfiguration: false,
      statusLabel: 'Prime: no playback', statusTitle: 'Amazon Prime: needs Music Unlimited.'
    }));
    expect(html).toContain('data-tooltip="Amazon Prime: needs Music Unlimited."');
    expect(html).toContain('>Prime: no playback<');
    expect(html).not.toContain('Setup required');
  });

  test('"Setup required" wins when the resolver still needs setup', () => {
    const html = renderToStaticMarkup(React.createElement(ResolverCard, {
      resolver, isActive: true, needsConfiguration: true, statusLabel: 'Prime: no playback'
    }));
    expect(html).toContain('Setup required');
    expect(html).not.toContain('Prime: no playback');
  });
});

test('an enabled card shows a problem one way: the line under its name, no "!" on the tile', () => {
  global.React = global.React || require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ResolverCard } = require('../../src/renderer/components/settings-cards');
  const resolver = { id: 'applemusic', name: 'Apple Music', color: '#fa243c' };
  const html = renderToStaticMarkup(React.createElement(ResolverCard, { resolver, isActive: true, needsConfiguration: true }));
  expect(html).toContain('>Setup required<');
  expect(html).not.toContain('>!<');
  expect(html).not.toContain('Needs configuration');
});

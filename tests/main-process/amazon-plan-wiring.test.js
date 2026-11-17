/**
 * #1220: Amazon plays only on Music Unlimited. The gate itself (amazon-dmls
 * getPlan / assertPlanPlays / getManifest) is behavior-tested in
 * widevine-amazon-provider.test.js; this file pins the wiring around it that
 * lives in main.js, the preload, and the renderer, where a unit test can't
 * reach.
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

  test('getStatus reports the plan and its message once signed in', () => {
    const handler = between(main, "ipcMain.handle('amazonmusic-get-status'", "ipcMain.handle('amazonmusic-open-login'");
    expect(handler).toMatch(/if \(signedIn\) \{\s*try \{ plan = await amazonWebPlayer\.getPlan\(\{ refresh: !!refreshPlan \}\); \} catch \{ plan = 'unknown'; \}/);
    // The plan read is the host-side stopgap (dying with the status move).
    expect(read('amazon-web-player.js')).toMatch(/async getPlan\(\{ refresh \} = \{\}, now = Date\.now\(\)\) \{/);
    expect(main).toMatch(/ipcMain\.handle\('amazonmusic-get-status', async \(event, \{ refreshPlan \} = \{\}\) => \{/);
    expect(preload).toMatch(/getStatus: \(opts\) => ipcRenderer\.invoke\('amazonmusic-get-status', \{ refreshPlan: !!\(opts && opts\.refreshPlan\) \}\)/);
    expect(handler).toMatch(/planMessage: plan \? amazonPlanMessage\(plan\) : null/);
  });

  test('opening Settings or the Amazon panel reads the plan fresh', () => {
    expect(app).toMatch(/refreshAmazonMusicStatus\(\{ refreshPlan: activeView === 'settings' \}\);/);
    expect(app).toMatch(/window\.electron\.amazonMusic\.getStatus\(\{ refreshPlan: true \}\)/);
  });

  test('a plan change is sent to the renderer, and the renderer drops the plugin plan cache with it', () => {
    expect(main).toMatch(/setPlanChangeListener\(\(\{ plan \}\) => safeSendToRenderer\('amazonmusic-plan-changed', \{ plan \}\)\)/);
    // The plugin's own plan cache (the track-search gate, #1356 M5) cannot
    // hear the event — main's refreshPlan path refreshes only the host-side
    // stopgap copy — so the renderer's plan-changed handler drops the
    // resolver instance's cache alongside refreshing the status: an upgrade
    // unblocks the next search at once instead of after the 1-min refusal TTL.
    const handler = between(app, 'return window.electron.amazonMusic.onPlanChanged(() => {', 'refreshAmazonMusicStatus();');
    expect(handler).toMatch(/_planState = null/);
    expect(preload).toMatch(/ipcRenderer\.on\('amazonmusic-plan-changed', handler\)/);
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

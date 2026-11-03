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
const telemetry = read('main-process/amazon-telemetry.js');

const between = (src, start, end) => {
  const i = src.indexOf(start);
  expect(i).toBeGreaterThan(-1);
  const j = src.indexOf(end, i + start.length);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
};

describe('main process', () => {
  test('track search checks the plan only when signed in, before searching', () => {
    const handler = between(main, "ipcMain.handle('amazonmusic-search-tracks'", "ipcMain.handle('amazonmusic-lookup-playlist'");
    const gate = handler.indexOf('if (await amazonWebPlayer.isSignedIn()) await amazonDmls.assertPlanPlays();');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(handler.indexOf('amazonWebPlayer.searchTracks('));
    // The refusal's reason reaches the resolver verbatim.
    expect(handler).toMatch(/reason: error\.reason/);
  });

  test('album search, artist photos and lookups do not check the plan', () => {
    for (const ch of ['amazonmusic-search-albums', 'amazonmusic-search-artist-image', 'amazonmusic-lookup-album', 'amazonmusic-lookup-playlist']) {
      const start = main.indexOf(`ipcMain.handle('${ch}'`);
      const next = main.indexOf('ipcMain.handle(', start + 10);
      expect(main.slice(start, next)).not.toMatch(/assertPlanPlays|getPlan/);
    }
  });

  test('getStatus reports the plan and its message once signed in', () => {
    const handler = between(main, "ipcMain.handle('amazonmusic-get-status'", "ipcMain.handle('amazonmusic-open-login'");
    expect(handler).toMatch(/if \(signedIn\) \{\s*try \{ plan = await amazonDmls\.getPlan\(\{ refresh: !!refreshPlan \}\); \} catch \{ plan = 'unknown'; \}/);
    expect(main).toMatch(/ipcMain\.handle\('amazonmusic-get-status', async \(event, \{ refreshPlan \} = \{\}\) => \{/);
    expect(preload).toMatch(/getStatus: \(opts\) => ipcRenderer\.invoke\('amazonmusic-get-status', \{ refreshPlan: !!\(opts && opts\.refreshPlan\) \}\)/);
    expect(handler).toMatch(/planMessage: plan \? amazonPlanMessage\(plan\) : null/);
  });

  test('opening Settings or the Amazon panel reads the plan fresh', () => {
    expect(app).toMatch(/refreshAmazonMusicStatus\(\{ refreshPlan: activeView === 'settings' \}\);/);
    expect(app).toMatch(/window\.electron\.amazonMusic\.getStatus\(\{ refreshPlan: true \}\)/);
  });

  test('a plan change is sent to the renderer', () => {
    expect(main).toMatch(/onPlanChange: \(\{ plan \}\) => safeSendToRenderer\('amazonmusic-plan-changed', \{ plan \}\)/);
    expect(preload).toMatch(/ipcRenderer\.on\('amazonmusic-plan-changed', handler\)/);
  });

  test('telemetry uses the shared Unlimited rule', () => {
    expect(telemetry).toMatch(/resourceType: isUnlimitedTier\(ctx\.tier\)/);
    expect(telemetry).not.toMatch(/\/\^UNLIMITED\//);
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
    expect(html).toContain('title="Amazon Prime: needs Music Unlimited."');
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

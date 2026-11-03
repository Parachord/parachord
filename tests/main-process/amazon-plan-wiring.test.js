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
const engine = read('src/renderer/hooks/use-playback-engine.js');
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
    expect(handler).toMatch(/if \(signedIn\) \{\s*try \{ plan = await amazonDmls\.getPlan\(\); \} catch \{ plan = 'unknown'; \}/);
    expect(handler).toMatch(/planMessage: plan \? amazonPlanMessage\(plan\) : null/);
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
  test('a plan refusal never opens the sign-in prompt', () => {
    const fn = between(app, 'window.__parachordNoteAmazonNotReady = (error) => {', '\n  };');
    expect(fn).toMatch(/code === 'plan-ineligible'/);
    expect(fn).toMatch(/if \(code !== 'load-failed' && code !== 'plan-ineligible'\) \{\s*manageAmazonMusic\(/);
  });

  test('an upgrade to Music Unlimited re-resolves Amazon, across restarts', () => {
    const fn = between(app, 'const applyAmazonMusicStatus = (s) => {', 'const refreshAmazonMusicStatus');
    expect(fn).toMatch(/localStorage\.getItem\('amazonmusic_last_plan'\)/);
    expect(fn).toMatch(/plan === 'unlimited' && last && last !== 'unlimited'[^\n]*\n[^\n]*\n\s*window\.__parachordClearAmazonNoMatch\(\);/);
    expect(fn).toMatch(/localStorage\.setItem\('amazonmusic_last_plan', plan\)/);
    // Every status read goes through it, and main's change event triggers one.
    const refresh = between(app, 'const refreshAmazonMusicStatus = () => {', '\n  };');
    expect(refresh).toMatch(/\.then\(\(s\) => applyAmazonMusicStatus\(/);
    expect(app).toMatch(/window\.electron\.amazonMusic\.onPlanChanged\(\(\) => refreshAmazonMusicStatus\(\)\)/);
    expect(app).toMatch(/if \(s && s\.success\) applyAmazonMusicStatus\(s\);/);
    expect(app).not.toMatch(/if \(s && s\.success\) setAmazonMusicStatus\(s\);/);
  });

  test('the tile and the settings panel show the plan message', () => {
    expect(app).toMatch(/statusTitle: amazonPlanLimited \? amazonMusicStatus\.planMessage : null/);
    expect(app).toMatch(/amazonMusicStatus\.plan && amazonMusicStatus\.plan !== 'unlimited' \? \(amazonMusicStatus\.planMessage \|\| ''\)/);
  });

  test('the widevine branch handles a plan refusal before the sign-in path, and after a sign-in retry', () => {
    const branch = between(engine, 'if (isWidevineResolver(resolverId)) {', '// Check if another play request superseded this one while loading');
    const planCheck = branch.indexOf('if (handlePlanRefusal(error)) return;');
    expect(planCheck).toBeGreaterThan(-1);
    expect(planCheck).toBeLessThan(branch.indexOf("error.reason === 'not-signed-in'"));
    expect(branch).toMatch(/if \(handlePlanRefusal\(retryError\)\) return;/);
    const fn = between(branch, 'const handlePlanRefusal = (err) => {', '\n      };');
    expect(fn).toMatch(/err\.reason !== 'plan-ineligible'/);
    // Another enabled source plays, without this one.
    expect(fn).toMatch(/handlePlay\(\{\s*\.\.\.trackOrSource,\s*sources: Object\.fromEntries\(Object\.entries\(trackOrSource\.sources\)\.filter\(\(\[id\]\) => id !== resolverId\)\)/);
    // The fallback toast is explained once per resolver per session.
    expect(fn).toMatch(/if \(!planRefusalExplained\.has\(resolverId\)\)/);
  });
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

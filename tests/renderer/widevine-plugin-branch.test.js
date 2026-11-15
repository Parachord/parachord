// The engine's plugin-mediated DRM branch (#1356 M4): a capabilities.widevine
// resolver that implements getPlaybackManifest + relayLicense supplies the
// manifest renderer-side, and the host stops pre-extracting amazonAsin on
// that path — the plugin digs its own identifier out of the WHOLE track the
// engine hands it. Marker practice for the engine (the same seam
// resume-starts-at-position.test.js and failed-play-hold.test.js use): the
// branch runs inside handlePlay's full app wiring, so the structural facts
// are pinned here and the runtime behaviour (the play/load/relay loop) in
// widevine-player.test.js's playPlugin describes.

const fs = require('fs');
const path = require('path');

const engine = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');
const player = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'renderer', 'lib', 'widevine-player.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, '..', '..', 'main-process', 'widevine-bridge.js'), 'utf8');

describe('the plugin path gate (checked by presence, like every capability gate)', () => {
  test('the branch takes the plugin path only when the resolver implements BOTH methods', () => {
    expect(engine).toContain(
      "const pluginWidevine = typeof resolver.getPlaybackManifest === 'function'\n        && typeof resolver.relayLicense === 'function';"
    );
  });

  test('the host stops pre-extracting the identifier on the plugin path: the asin dig is provider-path-only', () => {
    // The dig lives inside the `if (!pluginWidevine)` guard, nowhere else.
    const dig = engine.indexOf('trackOrSource.sources?.[resolverId]?.amazonAsin');
    expect(dig).toBeGreaterThan(-1);
    const guard = engine.indexOf('if (!pluginWidevine) {');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(dig);
    // And the whole plugin arm extracts nothing: the call passes the whole
    // track, and no amazonAsin/asin dig appears in it (trackContext's
    // albumAsin is telemetry, not the play identifier).
    const armStart = engine.indexOf('if (pluginWidevine) {');
    const arm = engine.slice(armStart, engine.indexOf('} else {', armStart));
    expect(arm).toContain('resolver.getPlaybackManifest({ ...trackOrSource }, pluginConfig)');
    expect(arm).not.toContain('amazonAsin');
    expect(arm).not.toContain('trackOrSource.asin');
  });

  test('the plugin arm passes the WHOLE track (with its sources map) plus the resolver config', () => {
    expect(engine).toContain('const pluginConfig = await getResolverConfig(resolverId);');
    expect(engine).toContain('await resolver.getPlaybackManifest({ ...trackOrSource }, pluginConfig);');
  });

  test('the plugin arm hands the reply to playPlugin with the resolver\'s relayLicense', () => {
    expect(engine).toContain('window.__parachordWidevine.playPlugin(audioRef.current, {\n            resolverId,\n            manifestResult,\n            relayLicense: resolver.relayLicense,\n            startTime: startAt,');
  });

  test('the provider fallback is intact: the provider play call and its entity are unchanged', () => {
    expect(engine).toMatch(/__parachordWidevine\.play\(audioRef\.current, \{\s*resolverId,\s*startTime: startAt,\s*entity: \{ asin \},/);
  });

  test('the plugin rejections route through the shared handlers: plan refusal and the sign-in prompt-retry both key on .reason', () => {
    // The catch below startWidevine is shared by both arms (one try around
    // startWidevine); pin that the plan-refusal and not-signed-in handlers
    // still read the thrown error, whose fields survive the plugin boundary
    // because getPlaybackManifest is a direct renderer call.
    const tryIdx = engine.indexOf('await startWidevine();');
    const catchIdx = engine.indexOf('} catch (error) {', tryIdx);
    const catchBody = engine.slice(catchIdx, catchIdx + 2600);
    expect(catchBody).toContain("error.reason === 'superseded'");
    expect(catchBody).toContain('handlePlanRefusal(error, resolverId, streamLabel)');
    expect(catchBody).toContain("error.reason === 'not-signed-in'");
  });
});

describe('the seams the engine relies on below it', () => {
  test('the player exposes playPlugin and registers the licence router through the preload surface', () => {
    expect(player).toContain('async function playPlugin(audio, { resolverId, manifestResult, relayLicense, trackContext, startTime } = {}) {');
    expect(player).toContain('bridge.onPluginLicenseRequest(async (request) => {');
    expect(player).toContain('session.pluginRelay.relayLicense(request.challenge, request.context)');
  });

  test('the preload exposes openSession + onPluginLicenseRequest on window.electron.widevine', () => {
    expect(preload).toContain("openSession: (resolverId, manifest, type, drm, context) =>");
    expect(preload).toContain('onPluginLicenseRequest: (callback) => {');
    expect(preload).toContain("ipcRenderer.on('widevine:plugin-license', handler);");
  });

  test('the bridge opens plugin sessions under the provider gates (rate window shared, minted before any await)', () => {
    expect(bridge).toContain("ipcMain.handle('widevine:open-session'");
    expect(bridge).toContain('markManifestForRateLimit(resolverId)');
    expect(bridge).toContain("sender.send('widevine:plugin-license'");
  });
});

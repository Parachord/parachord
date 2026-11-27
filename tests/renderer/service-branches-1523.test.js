/**
 * #1523: four places that branched on a plug-in's id now ask the registry.
 *
 * - The playbar's Buy button: the plug-in that declares capabilities.purchase
 *   (lib/purchase-source.js), not Bandcamp by id.
 * - A track's own service link during resolution: the plug-in the registry
 *   routes the link to, as a track link, builds the source
 *   (lib/source-url-hint.js), not `resolver.id === 'bandcamp'`.
 * - The welcome tour's assistant: any chat plug-in that's set up, not Claude.
 * - The engine's sign-in prompt: the plug-in that refused, if it's on the
 *   status surface with a signIn method, not Amazon by id.
 * (The AI chat's error wording is tests/chat/ai-provider-errors.test.js.)
 */
const fs = require('fs');
const path = require('path');

global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const ResolverLoader = require('../../resolver-loader');
const { purchaseSource } = require('../../src/renderer/lib/purchase-source');
const { sourceUrlHint, sourceFromUrlHint } = require('../../src/renderer/lib/source-url-hint');
const { FirstRunTutorial } = require('../../src/renderer/components/first-run-tutorial');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const loadAxe = (id) => JSON.parse(read(`plugins/${id}.axe`));
const manifest = (id) => JSON.parse(read(`plugins-src/${id}/manifest.json`));

describe('Buy: the plug-in that declares purchase', () => {
  const bandcamp = { id: 'bandcamp', name: 'Bandcamp', capabilities: manifest('bandcamp').capabilities };
  const spotify = { id: 'spotify', name: 'Spotify', capabilities: manifest('spotify').capabilities };
  const track = { artist: 'Quarantine Angst', title: 'Lopped Off' };
  const sure = { artist: 'Quarantine Angst', title: 'Lopped Off', confidence: 0.95, purchaseUrl: 'https://qa.bandcamp.com/track/lopped-off' };

  test('Bandcamp declares it; Spotify does not', () => {
    expect(bandcamp.capabilities.purchase).toBe(true);
    expect(spotify.capabilities.purchase).toBeFalsy();
  });

  test('offers the purchase plug-in\'s sure source, by its own name', () => {
    expect(purchaseSource({ resolvers: [spotify, bandcamp], sources: { spotify: { ...sure }, bandcamp: sure }, track }))
      .toEqual({ resolverId: 'bandcamp', resolverName: 'Bandcamp', purchaseUrl: sure.purchaseUrl });
  });

  test('a new plug-in that declares purchase gets the button with no code change', () => {
    const shop = { id: 'some-shop', name: 'Some Shop', capabilities: { resolve: true, purchase: true } };
    const url = 'https://shop.example/t/1';
    expect(purchaseSource({ resolvers: [shop], sources: { 'some-shop': { ...sure, purchaseUrl: url } }, track }))
      .toEqual({ resolverId: 'some-shop', resolverName: 'Some Shop', purchaseUrl: url });
  });

  test('never a source that is unsure, by someone else, another version, or has no purchase link', () => {
    const offer = (src) => purchaseSource({ resolvers: [bandcamp], sources: { bandcamp: src }, track });
    expect(offer({ ...sure, confidence: 0.7 })).toBeNull();
    expect(offer({ ...sure, artist: 'Someone Else' })).toBeNull();
    expect(offer({ ...sure, title: 'Lopped Off (Live)' })).toBeNull();
    expect(offer({ ...sure, purchaseUrl: undefined })).toBeNull();
    expect(purchaseSource({ resolvers: [spotify], sources: { spotify: sure }, track })).toBeNull();
  });

  test('the playbar asks the lib, never Bandcamp by id', () => {
    const src = read('src/renderer/components/playbar.js');
    expect(src).toContain('pickPurchaseSource({ resolvers: allResolvers, sources: effectiveSources, track: currentTrack })');
    expect(src).not.toMatch(/\.id === 'bandcamp'/);
  });
});

describe('a track\'s own link: routed by the registry', () => {
  let loader;
  let bandcamp;
  beforeAll(async () => {
    loader = new ResolverLoader();
    await loader.loadResolvers(['bandcamp', 'spotify'].map(loadAxe));
    bandcamp = loader.getResolver('bandcamp');
  });
  const track = { title: 'Lopped Off', album: 'Gentle Hands', duration: 0, sourceUrl: 'https://qa.bandcamp.com/track/lopped-off' };

  test('a track link the registry routes to the plug-in builds its source, without a fetch', async () => {
    global.fetch = jest.fn();
    expect(sourceUrlHint(track, bandcamp, loader)).toBe(track.sourceUrl);
    const result = await sourceFromUrlHint(track, bandcamp, loader, 'Quarantine Angst', {});
    expect(global.fetch).not.toHaveBeenCalled();
    delete global.fetch;
    expect(result).toMatchObject({
      title: 'Lopped Off', artist: 'Quarantine Angst', album: 'Gentle Hands', duration: null,
      sources: ['bandcamp'], bandcampUrl: track.sourceUrl, purchaseUrl: track.sourceUrl,
    });
  });

  test('not for an album link, another plug-in, or a plug-in without sourceFromUrl', () => {
    expect(sourceUrlHint({ ...track, sourceUrl: 'https://qa.bandcamp.com/album/gentle-hands' }, bandcamp, loader)).toBeNull();
    expect(sourceUrlHint(track, loader.getResolver('spotify'), loader)).toBeNull();
    expect(sourceUrlHint(track, { ...bandcamp, sourceFromUrl: undefined }, loader)).toBeNull();
    expect(sourceUrlHint({ ...track, sourceUrl: null }, bandcamp, loader)).toBeNull();
  });

  test('resolveTrack asks the lib at both sites, and never tests the Bandcamp id', () => {
    const app = read('src/renderer/app.js');
    expect(app.split('result = await sourceFromUrlHint(track, resolver, resolverLoaderRef.current, artistName, config);').length - 1).toBe(2);
    expect(app).not.toMatch(/resolver\.id === 'bandcamp'/);
  });
});

describe('the tour\'s Apps screen: a neutral assistant mark', () => {
  // The assistant row is Parachord's MCP server, which any assistant that
  // speaks MCP can use. An in-app chat plug-in (Ollama, ChatGPT) can't drive
  // Parachord over MCP, so its logo there would mislead: the mark is always
  // the sparkle, and the copy names no assistant.
  test('always the sparkle, whatever chat plug-in is set up', () => {
    global.window = global.window || {};
    const html = renderToStaticMarkup(React.createElement(FirstRunTutorial, {
      firstRunTutorial: { open: true, step: 'apps' }, loadedResolvers: [],
      navigateTo: () => {}, getTrackArt: () => null, setFirstRunTutorial: () => {}, startGettingStarted: () => {},
    }));
    expect(html).toContain('Or ask an AI assistant to play something');
    expect(html).not.toContain('such as Claude');
    const src = read('src/renderer/components/first-run-tutorial.js');
    expect(src).not.toMatch(/\.id === 'claude'/);
    expect(src).not.toMatch(/capabilities\.chat/);
    expect(src).not.toMatch(/metaServiceConfigs/);
  });
});

describe('the engine\'s sign-in prompt: routed by capability', () => {
  const engine = read('src/renderer/hooks/use-playback-engine.js');
  const app = read('src/renderer/app.js');

  test('the engine never names Amazon for the prompt', () => {
    expect(engine).not.toMatch(/resolverId === 'amazonmusic'/);
    expect(engine).not.toContain('__parachordManageAmazonMusic');
    expect(engine).toMatch(/error\.reason === 'not-signed-in' && typeof window\.__parachordPromptPluginSignIn === 'function'\s*&& window\.__parachordPromptPluginSignIn\.canPrompt\(resolverId\)/);
    expect(engine).toContain('await window.__parachordPromptPluginSignIn(resolverId, { explicit: true, reason: error.reason, ask: !hasOtherSource });');
  });

  // app.js's promptPluginSignIn, run against fakes: the real flow
  // (lib/plugin-sign-in-flow.js), with the dialog setter, the refs and the
  // status read stubbed. Every plug-in on the status surface asks first
  // (#1624); Amazon's flow is no longer a separate one.
  const { createPluginSignInFlow, newSignInState } = require('../../src/renderer/lib/plugin-sign-in-flow');
  const build = ({ resolvers }) => {
    const start = app.indexOf('  const promptPluginSignIn = (() => {');
    const end = app.indexOf('  window.__parachordPromptPluginSignIn = promptPluginSignIn;', start);
    expect(start).toBeGreaterThan(0);
    const body = app.slice(start, end);
    const dialogs = [];
    const fakes = {
      resolverLoaderRef: { current: { getResolver: (id) => resolvers[id] || null } },
      refreshPluginStatus: jest.fn(async () => ({ signedIn: false, cdm: true })),
      setPluginSignInDialog: (next) => dialogs.push(typeof next === 'function' ? next(dialogs[dialogs.length - 1] || {}) : next),
      isAdvancingTrackRef: { current: false },
      spinoffModeRef: { current: false },
      clearResolverMisses: jest.fn(),
      showToast: jest.fn(),
      pluginSignInStateRef: { current: newSignInState() },
      setPluginsSignedOut: jest.fn(),
      PlaybackLimits: require('../../src/renderer/lib/playback-limits'),
      playbackLimitsRef: { current: {} },
    };
    const names = Object.keys(fakes);
    const fn = new Function(...names, 'createPluginSignInFlow', `${body}\nreturn promptPluginSignIn;`);
    return { prompt: fn(...names.map((n) => fakes[n]), createPluginSignInFlow), dialogs, ...fakes };
  };
  const tick = () => new Promise((r) => setImmediate(r));
  const answerLast = (dialogs, yes) => dialogs.filter((d) => d.onResolve).pop().onResolve(yes);

  test('Amazon asks "Sign in to Amazon Music?" with its manifest\'s tip before its window opens', async () => {
    const m = manifest('amazonmusic');
    const amazon = { id: 'amazonmusic', name: m.manifest.name, capabilities: m.capabilities, settings: m.settings, signIn: jest.fn(async () => ({ signedIn: true })) };
    expect(amazon.capabilities.status).toBe(true);
    const { prompt, dialogs, clearResolverMisses } = build({ resolvers: { amazonmusic: amazon } });
    expect(prompt.canPrompt('amazonmusic')).toBe(true);
    const run = prompt('amazonmusic', { explicit: true, reason: 'not-signed-in' });
    await tick();
    expect(dialogs[0]).toMatchObject({ show: true, pluginId: 'amazonmusic', name: 'Amazon Music', refused: true, hint: m.settings.signInPromptHint });
    expect(amazon.signIn).not.toHaveBeenCalled();
    answerLast(dialogs, true);
    await expect(run).resolves.toBe(true);
    expect(amazon.signIn).toHaveBeenCalledTimes(1);
    expect(clearResolverMisses).toHaveBeenCalledWith('amazonmusic');
    expect(dialogs[dialogs.length - 1]).toEqual({ show: false });
  });

  test('any other plug-in on the status surface asks the same way before its own signIn (the issue)', async () => {
    const other = { id: 'some-web-player', name: 'Some Web Player', capabilities: { resolve: true, status: true }, signIn: jest.fn(async () => ({ signedIn: true })) };
    const { prompt, dialogs, refreshPluginStatus, clearResolverMisses } = build({ resolvers: { 'some-web-player': other } });
    expect(prompt.canPrompt('some-web-player')).toBe(true);
    const run = prompt('some-web-player', { explicit: true, reason: 'not-signed-in' });
    await tick();
    expect(other.signIn).not.toHaveBeenCalled(); // no window before the question
    expect(dialogs[0]).toMatchObject({ pluginId: 'some-web-player', name: 'Some Web Player', hint: null });
    answerLast(dialogs, true);
    await expect(run).resolves.toBe(true);
    expect(other.signIn).toHaveBeenCalled();
    expect(refreshPluginStatus).toHaveBeenCalledWith('some-web-player');
    expect(clearResolverMisses).toHaveBeenCalledWith('some-web-player');
  });

  test('a plug-in without the status surface or a signIn is never prompted', async () => {
    const noStatus = { id: 'a', capabilities: { resolve: true }, signIn: jest.fn() };
    const noSignIn = { id: 'b', capabilities: { status: true } };
    const { prompt, dialogs } = build({ resolvers: { a: noStatus, b: noSignIn } });
    expect(prompt.canPrompt('a')).toBe(false);
    expect(prompt.canPrompt('b')).toBe(false);
    expect(prompt.canPrompt('missing')).toBe(false);
    await expect(prompt('a', {})).resolves.toBe(false);
    expect(noStatus.signIn).not.toHaveBeenCalled();
    expect(dialogs).toEqual([]);
  });

  test('every sign-in for a status plug-in goes through it: Settings, Home\'s Connect, and the plug-in\'s own search', () => {
    const dialog = read('src/renderer/components/plugin-settings-dialog.js');
    expect(dialog).toMatch(/if \(canPromptPlugin\(selectedResolver\)\) \{\s*await promptPluginSignIn\(selectedResolver\.id, \{ explicit: true, reason: 'not-signed-in', forcePrompt: true \}\);/);
    expect(dialog).not.toMatch(/manageAmazonMusic/);
    expect(app).toMatch(/\? \(\) => promptPluginSignIn\(pluginId, \{ explicit: true, reason: 'not-signed-in', forcePrompt: true \}\)/);
    // Installed Amazon plug-ins still call their old name; it is the same flow.
    expect(app).toContain("window.__parachordManageAmazonMusic = (opts) => promptPluginSignIn('amazonmusic', opts);");
    expect(app).not.toMatch(/const manageAmazonMusic|hostSignInFlows/);
  });
});

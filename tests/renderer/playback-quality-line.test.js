/**
 * #1608: each music plug-in's dialog says how its playback quality is set,
 * and Settings › General's Playback Quality sentence comes from the same rule
 * (lib/playback-quality-line.js): by capability, the plug-in's manifest
 * (settings.playbackQuality) and what the host plays it with, never its id.
 */
const fs = require('fs');
const path = require('path');
const {
  playbackQualityLine,
  playbackQualityCopy,
  followsWidevine,
  joinNames,
} = require('../../src/renderer/lib/playback-quality-line');

const root = path.join(__dirname, '..', '..');
const manifestOf = (id) => JSON.parse(fs.readFileSync(path.join(root, 'plugins-src', id, 'manifest.json'), 'utf8'));
// A plug-in as the dialog sees it: the manifest's fields on the resolver.
const plugin = (id, extra = {}) => {
  const m = manifestOf(id);
  return { id, name: m.manifest.name, capabilities: m.capabilities, settings: m.settings, ...extra };
};
const drmPair = { getPlaybackManifest() {}, relayLicense() {} };
const amazon = () => plugin('amazonmusic', drmPair);
const MAX = { quality: 'max', abr: false, spatial: false };

describe('a plug-in that follows Playback Quality', () => {
  test('a Widevine plug-in with its own manifest and licence follows every option', () => {
    expect(followsWidevine(amazon())).toBe(true);
    expect(playbackQualityLine(amazon(), MAX)).toEqual({ follows: true, summary: 'Follows Playback Quality: Max: best available, lossless where playable' });
    expect(playbackQualityLine(amazon(), { quality: 'standard', abr: true, spatial: true }).summary)
      .toBe('Follows Playback Quality: Standard: up to 200 kbps · Adjust to your connection · Dolby Atmos when available');
    expect(playbackQualityLine(amazon(), { quality: 'saver' }).summary).toBe('Follows Playback Quality: Data saver: up to 100 kbps');
    expect(playbackQualityLine(amazon(), { quality: 'high' }).summary).toBe('Follows Playback Quality: High: up to 500 kbps');
  });

  test('the Widevine capability alone is not the pair (a catalog entry, before it loads)', () => {
    expect(followsWidevine(plugin('amazonmusic'))).toBe(false);
    expect(playbackQualityLine(plugin('amazonmusic'), MAX)).toBeNull();
  });

  test('Apple Music follows the tier through MusicKit JS, and the Music app\'s setting through the macOS helper', () => {
    expect(playbackQualityLine(plugin('applemusic'), { quality: 'saver', abr: true, spatial: true }))
      .toEqual({ follows: true, summary: 'Follows Playback Quality: Data saver: up to 100 kbps' });
    expect(playbackQualityLine(plugin('applemusic'), MAX, { nativeApp: true }))
      .toEqual({ follows: false, summary: 'Set in the Music app (Settings › Playback › Audio Quality)' });
    expect(playbackQualityLine(plugin('applemusic'), MAX, { nativeApp: false }).follows).toBe(true);
  });
});

describe('a plug-in whose quality is set elsewhere says where', () => {
  test.each([
    ['spotify', 'Set in the Spotify app (Settings › Audio quality)'],
    ['soundcloud', 'Set by its player'],
    ['bandcamp', 'Set by its player'],
    ['subsonic', 'Set by your server'],
    ['plex', 'Set by your server'],
    ['localfiles', 'Plays the file as it is'],
  ])('%s', (id, summary) => {
    expect(playbackQualityLine(plugin(id), MAX)).toEqual({ follows: false, summary });
  });

  test('a plug-in with no rule, or one that doesn\'t play music, shows no line', () => {
    expect(playbackQualityLine(plugin('youtube'), MAX)).toBeNull();
    expect(playbackQualityLine({ ...plugin('lastfm'), type: 'meta-service' }, MAX)).toBeNull();
    expect(playbackQualityLine(null, MAX)).toBeNull();
  });

  test('the cases come from capabilities and the manifest, so a new plug-in gets its line by declaring them', () => {
    expect(playbackQualityLine({ id: 'newserver', name: 'New', capabilities: { resolve: true, html5Stream: true } }, MAX).summary).toBe('Set by your server');
    expect(playbackQualityLine({ id: 'newapp', name: 'New', capabilities: { resolve: true }, settings: { playbackQuality: { summary: 'Set in its app' } } }, MAX).summary).toBe('Set in its app');
    const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'lib', 'playback-quality-line.js'), 'utf8');
    expect(source).not.toMatch(/\.id\s*[!=]==\s*'/);
  });
});

describe('the Playback Quality section\'s copy (Settings › General)', () => {
  const installed = (host) => playbackQualityCopy(
    [amazon(), plugin('applemusic'), plugin('spotify'), plugin('soundcloud'), { ...plugin('lastfm'), type: 'meta-service' }], host);

  test('names the plug-ins that follow it, by the same rule as their lines', () => {
    expect(installed({}).description).toBe('Amazon Music and Apple Music use these settings. Other services choose their own quality.');
    expect(installed({ applemusic: { nativeApp: true } }).description).toBe('Amazon Music uses these settings. Other services choose their own quality.');
    expect(playbackQualityCopy([plugin('spotify')], {}).description).toBe('None of your plug-ins use these settings yet. Services choose their own quality.');
  });

  test('the connection and Atmos options name only the Widevine plug-ins', () => {
    expect(installed({}).adjustPrefix).toBe('Amazon Music only.');
    expect(installed({}).atmosPrefix).toBe('Amazon Music only.');
    expect(playbackQualityCopy([plugin('applemusic')], {}).adjustPrefix).toBe('None of your plug-ins use this yet.');
  });

  test('joins names in sentence form', () => {
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('the dialog\'s row', () => {
  global.React = require('react');
  const ReactDOMServer = require('react-dom/server');
  const { PlaybackQualityRow } = require('../../src/renderer/components/plugin-extras');
  const render = (props) => ReactDOMServer.renderToStaticMarkup(global.React.createElement(PlaybackQualityRow, props));

  test('a plug-in that follows it gets Change, which opens the setting', () => {
    const html = render({ line: { follows: true, summary: 'Follows Playback Quality: Max: best available, lossless where playable' }, onOpenSettings() {} });
    expect(html).toContain('Playback quality');
    expect(html).toContain('Follows Playback Quality: Max: best available, lossless where playable');
    expect(html).toContain('aria-label="Change Playback Quality in Settings"');
  });

  test('one set elsewhere says where, with no control', () => {
    const html = render({ line: { follows: false, summary: 'Set by its player' }, onOpenSettings() {} });
    expect(html).toContain('Set by its player');
    expect(html).not.toContain('<button');
  });
});

describe('the wiring', () => {
  const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
  const dialog = read('src', 'renderer', 'components', 'plugin-settings-dialog.js');
  const settings = read('src', 'renderer', 'components', 'settings-page.js');
  const app = read('src', 'renderer', 'app.js');

  test('the dialog draws the line while the plug-in is on, from the rule, with the host\'s fact for it', () => {
    expect(dialog).toMatch(/switchState\.checked && \(\(\) => \{\s*const line = playbackQualityLine\(selectedResolver,\s*\{ quality: playbackQuality, abr: playbackAbr, spatial: playbackSpatial \},\s*hostPlayback && hostPlayback\[selectedResolver\.id\]\);/);
    expect(dialog).toContain('React.createElement(PlaybackQualityRow, { line, onOpenSettings: openPlaybackQualitySettings })');
  });

  test('General\'s section is built from the rule and has an id for Change to open', () => {
    expect(settings).toContain("id: 'playback-quality-settings',");
    expect(settings).toContain('description: qualityCopy.description');
    expect(settings).not.toContain('Amazon Music and Apple Music use these settings');
    expect(settings).not.toContain("hint: 'Amazon Music only.");
  });

  test('the host says when it plays a plug-in with the service\'s own app, and Change opens General at the section', () => {
    expect(app).toMatch(/const hostPlayback = useMemo\(\(\) => \(\{\s*applemusic: \{ nativeApp: appleMusicNativeAvailable \},\s*\}\), \[appleMusicNativeAvailable\]\);/);
    const open = app.slice(app.indexOf('const openPlaybackQualitySettings = () => {'));
    expect(open.slice(0, 400)).toMatch(/setSelectedResolver\(null\);\s*setActiveView\('settings'\);\s*setSettingsTab\('general'\);/);
    expect(open.slice(0, 400)).toContain("document.getElementById('playback-quality-settings')");
  });
});
